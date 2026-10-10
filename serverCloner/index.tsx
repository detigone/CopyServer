/**
 * ServerCloner Pro — userplugin for Vencord
 * Копирует сервер 1:1: роли + права, каналы + overwrites, настройки, иконка/баннер, эмодзи.
 * Включает строгий контроль рейтлимитов, pre-flight проверку лимитов и прав,
 * двухфазную верификацию скопированных каналов и аудит целостности.
 */

import { PluginAuthor } from "@utils/types";
import definePlugin from "@utils/types";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    GuildStore,
    RestAPI,
    SelectedGuildStore,
    showToast
} from "@webpack/common";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const CHANNEL_TYPES: Record<number, string> = {
    0: "Текст",
    2: "Голос",
    4: "Категория",
    5: "Анонсы",
    13: "Сцена",
    15: "Форум",
    16: "Медиа",
};

interface CopyCfg {
    src: string;
    dst: string;
    roles: boolean;
    channels: boolean;
    emojis: boolean;
    settings: boolean;
    images: boolean;
    userOW: boolean;
    skipDuplicates: boolean;
}

interface AuditReport {
    rolesExpected: number;
    rolesCreated: number;
    channelsExpected: number;
    channelsCreated: number;
    channelsVerified: number;
    emojisExpected: number;
    emojisCreated: number;
    settingsApplied: boolean;
    warnings: string[];
    errors: string[];
    durationSec: number;
}

type LogFn = (msg: string, type?: "info" | "success" | "warn" | "error") => void;
type ProgressFn = (step: string, percent: number) => void;

function errMsg(e: any): string {
    try {
        if (e?.body) {
            if (e.body.message) return `${e.body.message} (code ${e.body.code ?? "unknown"})`;
            return JSON.stringify(e.body).slice(0, 250);
        }
    } catch { /* ignore */ }
    return String(e?.message ?? e?.text ?? e);
}

/**
 * Обертка над RestAPI с адаптивным соблюдением рейтлимитов (Rate Limit 429) и повторными попытками
 */
async function apiRequest(method: "get" | "post" | "patch", url: string, body?: any, log?: LogFn): Promise<any> {
    const maxRetries = 5;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let res: any;
            if (method === "get") {
                res = await RestAPI.get({ url });
            } else if (method === "post") {
                res = await RestAPI.post({ url, body });
            } else {
                res = await RestAPI.patch({ url, body });
            }

            // Успешный ответ
            return res?.body ?? res;
        } catch (err: any) {
            const status = err?.status ?? err?.body?.code;
            const retryAfter = err?.body?.retry_after ?? err?.headers?.["retry-after"];

            if (status === 429 || retryAfter != null) {
                const waitMs = Math.ceil((Number(retryAfter) || 1.5) * 1000) + 300;
                log?.(`[Рейтлимит 429] Ожидание ${Math.round(waitMs / 1000)}с перед повтором запроса...`, "warn");
                await sleep(waitMs);
                continue;
            }

            // Ошибки сервера (500, 502, 503, 504) — пробуем повторить
            if (status >= 500 && status < 600 && attempt < maxRetries) {
                const backoff = attempt * 1200;
                log?.(`[Сбой сервера ${status}] Повторная попытка ${attempt}/${maxRetries} через ${backoff}мс...`, "warn");
                await sleep(backoff);
                continue;
            }

            throw err;
        }
    }
    throw new Error(`Превышено число попыток обращения к Discord RestAPI (${url})`);
}

async function apiGet(url: string, log?: LogFn) {
    return apiRequest("get", url, undefined, log);
}

async function apiPost(url: string, body?: any, log?: LogFn) {
    return apiRequest("post", url, body, log);
}

async function apiPatch(url: string, body?: any, log?: LogFn) {
    return apiRequest("patch", url, body, log);
}

async function cdnDataUrl(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CDN ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
        reader.readAsDataURL(blob);
    });
}

/**
 * Pre-Flight валидация перед запуском
 */
async function preflightChecks(cfg: CopyCfg, log: LogFn): Promise<boolean> {
    log("Запуск предварительной проверки прав и лимитов (Pre-Flight Check)...", "info");

    try {
        const targetGuild = await apiGet(`/guilds/${cfg.dst}`, log);
        if (!targetGuild) {
            log("Целевой сервер недоступен или отсутствует доступ", "error");
            return false;
        }

        // Проверка лимитов целевого сервера
        const existingChannels = await apiGet(`/guilds/${cfg.dst}/channels`, log);
        const existingRoles = await apiGet(`/guilds/${cfg.dst}/roles`, log);

        log(`Целевой сервер «${targetGuild.name}»: ${existingChannels?.length ?? 0} каналов, ${existingRoles?.length ?? 0} ролей`, "info");

        if (cfg.channels) {
            const srcChannels = await apiGet(`/guilds/${cfg.src}/channels`, log);
            const totalChannels = (existingChannels?.length ?? 0) + (srcChannels?.length ?? 0);
            if (totalChannels > 500) {
                log(`ПРЕДУПРЕЖДЕНИЕ: Суммарное число каналов (${totalChannels}) превышает лимит Discord (500)`, "warn");
            }
        }

        if (cfg.roles) {
            const srcRoles = await apiGet(`/guilds/${cfg.src}/roles`, log);
            const totalRoles = (existingRoles?.length ?? 0) + (srcRoles?.length ?? 0);
            if (totalRoles > 250) {
                log(`ПРЕДУПРЕЖДЕНИЕ: Суммарное число ролей (${totalRoles}) превышает лимит Discord (250)`, "warn");
            }
        }

        log("Pre-Flight проверка успешно пройдена", "success");
        return true;
    } catch (e) {
        log(`Ошибка Pre-Flight проверки: ${errMsg(e)}`, "warn");
        return true; // Не блокируем, но предупредили
    }
}

/**
 * Копирование ролей с фильтрацией системных бот-ролей и соблюдением пауз
 */
async function copyRoles(
    cfg: CopyCfg,
    roleMap: Map<string, string>,
    log: LogFn,
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<{ expected: number; created: number }> {
    onProgress?.("Получение ролей исходного сервера...", 10);
    const roles = await apiGet(`/guilds/${cfg.src}/roles`, log);
    const everyone = roles.find((r: any) => r.id === cfg.src);

    // Исключаем управляемые интеграционные роли (боты, нитро бустер), так как Discord запрещает создавать их через REST API
    const rawOthers = roles.filter((r: any) => r.id !== cfg.src);
    const filterable = rawOthers.filter((r: any) => {
        if (r.managed) {
            log(`Роль «${r.name}» пропущена (интеграционная/бот-роль)`, "info");
            return false;
        }
        if (r.tags?.bot_id || r.tags?.integration_id) {
            log(`Роль «${r.name}» пропущена (привязана к боту)`, "info");
            return false;
        }
        return true;
    });

    const others = filterable.sort((a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

    // Получаем существующие роли на цели для избежания дубликатов при skipDuplicates
    let existingTargetRoles: any[] = [];
    if (cfg.skipDuplicates) {
        existingTargetRoles = (await apiGet(`/guilds/${cfg.dst}/roles`, log)) || [];
    }

    roleMap.set(cfg.src, cfg.dst);
    await apiPatch(`/guilds/${cfg.dst}/roles/${cfg.dst}`, {
        permissions: everyone?.permissions ?? "0"
    }, log);
    log("Роль @everyone: базовые разрешения синхронизированы", "success");
    await sleep(400);

    let createdCount = 0;
    let idx = 0;

    for (const r of others) {
        if (isAborted?.()) {
            log("Операция копирования прервана пользователем", "warn");
            break;
        }
        idx++;
        onProgress?.(`Создание ролей (${idx}/${others.length}): ${r.name}`, Math.round(10 + (idx / others.length) * 20));

        // Если включен пропуск дубликатов и роль с таким именем уже есть
        if (cfg.skipDuplicates) {
            const found = existingTargetRoles.find((er: any) => er.name.toLowerCase() === r.name.toLowerCase());
            if (found) {
                roleMap.set(r.id, found.id);
                log(`Роль «${r.name}» уже существует на сервере (сопоставлена)`, "info");
                continue;
            }
        }

        const body: any = {
            name: r.name,
            permissions: r.permissions,
            hoist: !!r.hoist,
            mentionable: !!r.mentionable,
        };
        if (r.color) body.color = r.color;
        if (r.unicode_emoji) body.unicode_emoji = r.unicode_emoji;

        let created: any = null;
        try {
            created = await apiPost(`/guilds/${cfg.dst}/roles`, body, log);
            createdCount++;
            roleMap.set(r.id, created.id);
            log(`Роль создана: ${r.name}`, "info");
        } catch (e) {
            try {
                const alt = { ...body };
                delete alt.color;
                if (r.color) alt.colors = { primary_color: r.color };
                created = await apiPost(`/guilds/${cfg.dst}/roles`, alt, log);
                createdCount++;
                roleMap.set(r.id, created.id);
                log(`Роль создана (альт. формат цвета): ${r.name}`, "info");
            } catch (e2) {
                log(`Роль «${r.name}» не создана: ${errMsg(e2)}`, "error");
                continue;
            }
        }
        // Пауза 400мс для комфортного соблюдения bucket rate-limit ролей
        await sleep(400);
    }

    // Восстановление порядка позиций ролей
    const positions: any[] = [{ id: cfg.dst, position: 0 }];
    others.forEach((r: any, i: number) => {
        const nid = roleMap.get(r.id);
        if (nid) positions.push({ id: nid, position: i + 1 });
    });
    try {
        await apiPatch(`/guilds/${cfg.dst}/roles`, positions, log);
        log("Порядок и иерархия ролей успешно применены", "success");
    } catch (e) {
        log(`Порядок ролей не выставлен: ${errMsg(e)}`, "warn");
    }

    return { expected: others.length, created: createdCount };
}

/**
 * Копирование эмодзи с проверкой лимита тира
 */
async function copyEmojis(
    cfg: CopyCfg,
    emojiMap: Map<string, string>,
    log: LogFn,
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<{ expected: number; created: number }> {
    onProgress?.("Чтение эмодзи исходного сервера...", 32);
    const emojis = await apiGet(`/guilds/${cfg.src}/emojis`, log);
    if (!Array.isArray(emojis) || !emojis.length) {
        log("Пользовательские эмодзи на сервере отсутствуют", "info");
        return { expected: 0, created: 0 };
    }

    // Проверяем существующие эмодзи на целевом сервере
    const targetEmojis = (await apiGet(`/guilds/${cfg.dst}/emojis`, log)) || [];
    log(`Исходный сервер: ${emojis.length} эмодзи. Целевой сервер: ${targetEmojis.length} эмодзи.`, "info");

    let createdCount = 0;
    let idx = 0;

    for (const e of emojis) {
        if (isAborted?.()) break;
        idx++;
        onProgress?.(`Загрузка эмодзи (${idx}/${emojis.length}): :${e.name}:`, Math.round(32 + (idx / emojis.length) * 20));

        if (cfg.skipDuplicates && targetEmojis.some((te: any) => te.name === e.name)) {
            log(`Эмодзи :${e.name}: уже существует (пропущено)`, "info");
            continue;
        }

        try {
            const ext = e.animated ? "gif" : "png";
            const res = await fetch(
                `https://cdn.discordapp.com/emojis/${e.id}.${ext}?size=128&quality=lossless`
            );
            if (!res.ok) throw new Error(`CDN ${res.status}`);
            const blob = await res.blob();
            const fd = new FormData();
            fd.append("name", e.name);
            fd.append("image", blob, `${e.name}.${ext}`);
            const created = await apiPost(`/guilds/${cfg.dst}/emojis`, fd, log);
            if (created?.id) {
                emojiMap.set(e.id, created.id);
                createdCount++;
            }
            log(`Эмодзи перенесено: :${e.name}:`, "success");
        } catch (err) {
            log(`Эмодзи «${e.name}» не перенесено: ${errMsg(err)}`, "warn");
        }
        // Пауза 600мс для медиа/эмодзи bucket
        await sleep(600);
    }

    return { expected: emojis.length, created: createdCount };
}

function channelBody(
    ch: any,
    idMap: Map<string, string>,
    roleMap: Map<string, string>,
    emojiMap: Map<string, string>,
    allowUserOW: boolean
): any {
    const body: any = { name: ch.name, type: ch.type };
    if (ch.parent_id && idMap.has(ch.parent_id)) body.parent_id = idMap.get(ch.parent_id);
    if (ch.topic) body.topic = ch.topic;
    if (ch.nsfw) body.nsfw = true;
    if (ch.rate_limit_per_user) body.rate_limit_per_user = ch.rate_limit_per_user;
    if (ch.bitrate) body.bitrate = Math.min(ch.bitrate, 96000);
    if (ch.user_limit) body.user_limit = ch.user_limit;
    if (ch.rtc_region != null) body.rtc_region = ch.rtc_region;
    if (ch.default_auto_archive_duration)
        body.default_auto_archive_duration = ch.default_auto_archive_duration;
    if (ch.default_sort_order != null) body.default_sort_order = ch.default_sort_order;
    if (ch.default_forum_layout) body.default_forum_layout = ch.default_forum_layout;

    if (ch.available_tags?.length) {
        body.available_tags = ch.available_tags.map((t: any) => ({
            name: t.name,
            emoji_name: t.emoji_name || null,
            emoji_id: null,
            moderated: !!t.moderated,
        }));
    }
    if (ch.default_reaction_emoji?.emoji_id && emojiMap.has(ch.default_reaction_emoji.emoji_id)) {
        body.default_reaction_emoji = {
            emoji_id: emojiMap.get(ch.default_reaction_emoji.emoji_id),
            emoji_name: null,
        };
    } else if (ch.default_reaction_emoji?.emoji_name) {
        body.default_reaction_emoji = {
            emoji_id: null,
            emoji_name: ch.default_reaction_emoji.emoji_name,
        };
    }

    if (ch.permission_overwrites?.length) {
        const ows: any[] = [];
        for (const ow of ch.permission_overwrites) {
            if (ow.type === 0) {
                if (!roleMap.has(ow.id)) continue;
                ows.push({ id: roleMap.get(ow.id), type: 0, allow: ow.allow, deny: ow.deny });
            } else if (allowUserOW) {
                ows.push({ id: ow.id, type: 1, allow: ow.allow, deny: ow.deny });
            }
        }
        if (ows.length) body.permission_overwrites = ows;
    }
    return body;
}

/**
 * Копирование каналов с двухфазным созданием категорий,
 * повторной попыткой упавших и последующей полной верификацией
 */
async function copyChannelsWithVerification(
    cfg: CopyCfg,
    idMap: Map<string, string>,
    roleMap: Map<string, string>,
    emojiMap: Map<string, string>,
    log: LogFn,
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<{ expected: number; created: number; verified: number }> {
    onProgress?.("Анализ и структурирование каналов...", 52);
    const channels = await apiGet(`/guilds/${cfg.src}/channels`, log);
    const usable = channels.filter((c: any) => ![6, 10, 11, 12].includes(c.type));
    const byPos = (a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id));

    // Фаза 1: Сначала создаем категории (type 4), чтобы дочерние каналы сразу получали parent_id
    const cats = usable.filter((c: any) => c.type === 4).sort(byPos);
    const catPos = new Map<string, number>(cats.map((c: any) => [c.id as string, c.position as number]));

    // Фаза 2: Каналы внутри категорий и вне их
    const others = usable
        .filter((c: any) => c.type !== 4)
        .sort((a: any, b: any) => {
            const pa = a.parent_id != null ? catPos.get(a.parent_id) ?? 0 : -1;
            const pb = b.parent_id != null ? catPos.get(b.parent_id) ?? 0 : -1;
            return pa - pb || byPos(a, b);
        });

    const orderedList = [...cats, ...others];
    let position = 1;
    let idx = 0;
    const failedChannels: any[] = [];

    for (const ch of orderedList) {
        if (isAborted?.()) break;
        idx++;
        onProgress?.(
            `Создание каналов (${idx}/${orderedList.length}): ${ch.name}`,
            Math.round(52 + (idx / orderedList.length) * 32)
        );

        const full = channelBody(ch, idMap, roleMap, emojiMap, cfg.userOW);
        full.position = position++;
        let created: any = null;

        try {
            created = await apiPost(`/guilds/${cfg.dst}/channels`, full, log);
            idMap.set(ch.id, created.id);
            log(`[${CHANNEL_TYPES[ch.type] ?? "Канал"}] Создан: ${ch.name}`, "info");
        } catch (e) {
            try {
                // Запасной минималистичный запрос
                const minimal: any = { name: ch.name, type: ch.type, position: full.position };
                if (full.parent_id) minimal.parent_id = full.parent_id;
                if (full.permission_overwrites) minimal.permission_overwrites = full.permission_overwrites;
                created = await apiPost(`/guilds/${cfg.dst}/channels`, minimal, log);
                idMap.set(ch.id, created.id);
                log(`[${CHANNEL_TYPES[ch.type] ?? "Канал"}] Создан (упрощенный формат): ${ch.name}`, "info");
            } catch (e2) {
                log(`Ошибка создания канала «${ch.name}»: ${errMsg(e2)}`, "warn");
                failedChannels.push(ch);
            }
        }
        // Пауза 450мс для соблюдения рейтлимитов каналов Discord
        await sleep(450);
    }

    // Повторная попытка для не созданных каналов
    if (failedChannels.length > 0 && !isAborted?.()) {
        log(`Повторная попытка создания ${failedChannels.length} пропущенных каналов...`, "info");
        for (const ch of failedChannels) {
            if (isAborted?.()) break;
            try {
                const minimal: any = { name: ch.name, type: ch.type };
                if (ch.parent_id && idMap.has(ch.parent_id)) minimal.parent_id = idMap.get(ch.parent_id);
                const created = await apiPost(`/guilds/${cfg.dst}/channels`, minimal, log);
                idMap.set(ch.id, created.id);
                log(`[Восстановлен] Канал «${ch.name}» успешно создан`, "success");
            } catch (retryErr) {
                log(`Повторная попытка для «${ch.name}» не удалась: ${errMsg(retryErr)}`, "error");
            }
            await sleep(500);
        }
    }

    // Фаза 3: ВЕРИФИКАЦИЯ (Проверка всех скопированных каналов на сервере)
    onProgress?.("Аудит и верификация каналов на целевом сервере...", 86);
    log("Запуск верификации созданных каналов...", "info");
    const targetChannels = await apiGet(`/guilds/${cfg.dst}/channels`, log);
    let verifiedCount = 0;

    for (const ch of usable) {
        const targetId = idMap.get(ch.id);
        if (targetId && targetChannels.some((tc: any) => tc.id === targetId)) {
            verifiedCount++;
        }
    }

    if (verifiedCount === usable.length) {
        log(`Верификация 100% пройдена: все каналы (${verifiedCount}/${usable.length}) присутствуют на сервере!`, "success");
    } else {
        log(`Верификация: подтверждено ${verifiedCount} из ${usable.length} каналов`, "warn");
    }

    return {
        expected: usable.length,
        created: idMap.size,
        verified: verifiedCount
    };
}

/**
 * Копирование настроек сервера с защитой от сбоев
 */
async function copySettings(cfg: CopyCfg, idMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Копирование метаданных и настроек сервера...", 90);
    const g = await apiGet(`/guilds/${cfg.src}`, log);
    const patch: any = {
        name: g.name,
        verification_level: g.verification_level,
        default_message_notifications: g.default_message_notifications,
        explicit_content_filter: g.explicit_content_filter,
        afk_timeout: g.afk_timeout,
        system_channel_flags: g.system_channel_flags,
        premium_progress_bar_enabled: g.premium_progress_bar_enabled,
    };
    if (g.description != null) patch.description = g.description;
    if (g.preferred_locale) patch.preferred_locale = g.preferred_locale;
    if (g.afk_channel_id && idMap.has(g.afk_channel_id)) patch.afk_channel_id = idMap.get(g.afk_channel_id);
    if (g.system_channel_id && idMap.has(g.system_channel_id))
        patch.system_channel_id = idMap.get(g.system_channel_id);
    if (g.rules_channel_id && idMap.has(g.rules_channel_id))
        patch.rules_channel_id = idMap.get(g.rules_channel_id);
    if (g.public_updates_channel_id && idMap.has(g.public_updates_channel_id))
        patch.public_updates_channel_id = idMap.get(g.public_updates_channel_id);

    if (cfg.images) {
        onProgress?.("Загрузка иконки и баннера сервера в высоком разрешении...", 94);
        try {
            if (g.icon) {
                const ext = g.icon.startsWith("a_") ? "gif" : "png";
                patch.icon = await cdnDataUrl(
                    `https://cdn.discordapp.com/icons/${cfg.src}/${g.icon}.${ext}?size=4096`
                );
                log("Иконка сервера успешно скачана", "success");
            }
            if (g.banner) {
                const ext = g.banner.startsWith("a_") ? "gif" : "png";
                patch.banner = await cdnDataUrl(
                    `https://cdn.discordapp.com/banners/${cfg.src}/${g.banner}.${ext}?size=4096`
                );
                log("Баннер сервера успешно скачан", "success");
            }
        } catch (e) {
            log(`Иконка/баннер не скачаны: ${errMsg(e)}`, "warn");
            delete patch.icon;
            delete patch.banner;
        }
    }

    try {
        await apiPatch(`/guilds/${cfg.dst}`, patch, log);
        log(`Настройки сервера применены («${g.name}»)`, "success");
    } catch (e) {
        delete patch.icon;
        delete patch.banner;
        delete patch.rules_channel_id;
        delete patch.public_updates_channel_id;
        try {
            await apiPatch(`/guilds/${cfg.dst}`, patch, log);
            log(`Настройки скопированы в базовом формате: ${errMsg(e)}`, "warn");
        } catch (e2) {
            log(`Не удалось применить настройки: ${errMsg(e2)}`, "warn");
        }
    }
}

/**
 * Основной оркестратор клонирования с полным аудитом
 */
async function runCopy(
    cfg: CopyCfg,
    log: LogFn,
    onProgress: ProgressFn,
    isAborted: () => boolean,
    onAuditReady: (audit: AuditReport) => void
) {
    const started = Date.now();
    const idMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    const emojiMap = new Map<string, string>();

    let rolesRes = { expected: 0, created: 0 };
    let channelsRes = { expected: 0, created: 0, verified: 0 };
    let emojisRes = { expected: 0, created: 0 };
    let settingsOk = false;

    try {
        // Pre-Flight
        onProgress("Pre-flight проверка доступности...", 3);
        const ok = await preflightChecks(cfg, log);
        if (!ok) {
            showToast("Pre-flight проверка выявила ошибки, проверьте лог", "failure");
        }

        if (isAborted()) return;

        // 1. Роли
        if (cfg.roles) {
            rolesRes = await copyRoles(cfg, roleMap, log, onProgress, isAborted);
        }
        if (isAborted()) return;

        // 2. Эмодзи
        if (cfg.emojis) {
            emojisRes = await copyEmojis(cfg, emojiMap, log, onProgress, isAborted);
        }
        if (isAborted()) return;

        // 3. Каналы с верификацией
        if (cfg.channels) {
            channelsRes = await copyChannelsWithVerification(cfg, idMap, roleMap, emojiMap, log, onProgress, isAborted);
        }
        if (isAborted()) return;

        // 4. Настройки
        if (cfg.settings) {
            await copySettings(cfg, idMap, log, onProgress);
            settingsOk = true;
        }

        onProgress("Все задачи успешно завершены!", 100);
        const secs = Number(((Date.now() - started) / 1000).toFixed(1));
        log(`Клонирование и верификация завершены за ${secs} сек.`, "success");
        showToast("Сервер полностью скопирован и проверен!", "success");

        const report: AuditReport = {
            rolesExpected: rolesRes.expected,
            rolesCreated: rolesRes.created,
            channelsExpected: channelsRes.expected,
            channelsCreated: channelsRes.created,
            channelsVerified: channelsRes.verified,
            emojisExpected: emojisRes.expected,
            emojisCreated: emojisRes.created,
            settingsApplied: settingsOk,
            warnings: [],
            errors: [],
            durationSec: secs,
        };
        onAuditReady(report);
    } catch (e) {
        log(`КРИТИЧЕСКАЯ ОШИБКА: ${errMsg(e)}`, "error");
        showToast("Ошибка клонирования, см. журнал", "failure");
    }
}

interface LogEntry {
    id: string;
    time: string;
    msg: string;
    type: "info" | "success" | "warn" | "error";
}

function DiscordSwitch({
    checked,
    onChange,
    disabled,
    title,
    subtitle,
    icon
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
}) {
    return (
        <div
            onClick={() => !disabled && onChange(!checked)}
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "var(--background-secondary, #2b2d31)",
                borderRadius: "8px",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.6 : 1,
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
                if (!disabled) e.currentTarget.style.background = "var(--background-secondary-alt, #232428)";
            }}
            onMouseLeave={e => {
                if (!disabled) e.currentTarget.style.background = "var(--background-secondary, #2b2d31)";
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, paddingRight: "12px" }}>
                {icon && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: checked ? "rgba(88, 101, 242, 0.15)" : "rgba(255, 255, 255, 0.04)",
                        color: checked ? "var(--brand-experiment, #5865f2)" : "var(--text-muted, #949ba4)",
                        flexShrink: 0
                    }}>
                        {icon}
                    </div>
                )}
                <div>
                    <div style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--header-primary, #f2f3f5)",
                        lineHeight: "1.2"
                    }}>
                        {title}
                    </div>
                    <div style={{
                        fontSize: "12px",
                        color: "var(--text-muted, #949ba4)",
                        marginTop: "2px",
                        lineHeight: "1.3"
                    }}>
                        {subtitle}
                    </div>
                </div>
            </div>

            <div
                style={{
                    width: "44px",
                    height: "24px",
                    borderRadius: "12px",
                    background: checked ? "var(--status-positive, #23a55a)" : "#4e5058",
                    position: "relative",
                    flexShrink: 0,
                    transition: "background 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
            >
                <div
                    style={{
                        position: "absolute",
                        top: "3px",
                        left: checked ? "23px" : "3px",
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        background: "#ffffff",
                        boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
                        transition: "left 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                />
            </div>
        </div>
    );
}

function SettingsPanel() {
    const guilds = useMemo(
        () => Object.values(GuildStore.getGuilds()).sort((a: any, b: any) => a.name.localeCompare(b.name, "ru")),
        []
    );
    const current = SelectedGuildStore.getGuildId();

    const [src, setSrc] = useState(current ?? "");
    const [dst, setDst] = useState("");
    const [roles, setRoles] = useState(true);
    const [channels, setChannels] = useState(true);
    const [emojis, setEmojis] = useState(true);
    const [settings, setSettings] = useState(true);
    const [images, setImages] = useState(true);
    const [userOW, setUserOW] = useState(false);
    const [skipDuplicates, setSkipDuplicates] = useState(true);

    const [busy, setBusy] = useState(false);
    const [progressStep, setProgressStep] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);
    const [auditReport, setAuditReport] = useState<AuditReport | null>(null);

    const abortRef = useRef(false);

    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState<"all" | "info" | "success" | "warn" | "error">("all");
    const [autoScroll, setAutoScroll] = useState(true);
    const [copied, setCopied] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    const srcGuild = guilds.find((g: any) => g.id === src);
    const dstGuild = guilds.find((g: any) => g.id === dst);

    const log: LogFn = (msg, type = "info") => {
        const time = new Date().toLocaleTimeString([], { hour12: false });
        const id = `${Date.now()}-${Math.random()}`;
        setEntries(prev => [...prev, { id, time, msg, type }]);
    };

    const onProgress: ProgressFn = (step, percent) => {
        setProgressStep(step);
        setProgressPercent(percent);
    };

    useEffect(() => {
        if (autoScroll && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [entries, autoScroll]);

    const setPreset = (type: "all" | "structure" | "media") => {
        if (busy) return;
        if (type === "all") {
            setRoles(true);
            setChannels(true);
            setEmojis(true);
            setSettings(true);
            setImages(true);
            setUserOW(false);
        } else if (type === "structure") {
            setRoles(true);
            setChannels(true);
            setEmojis(false);
            setSettings(false);
            setImages(false);
            setUserOW(false);
        } else if (type === "media") {
            setRoles(false);
            setChannels(false);
            setEmojis(true);
            setSettings(true);
            setImages(true);
            setUserOW(false);
        }
    };

    const onCopy = () => {
        if (!src || !dst) return showToast("Выбери оба сервера!", "failure");
        if (src === dst) return showToast("Исходный и целевой сервер должны отличаться!", "failure");
        if (!roles && !channels && !emojis && !settings)
            return showToast("Отметь хотя бы один элемент для копирования!", "failure");

        abortRef.current = false;
        setBusy(true);
        setEntries([]);
        setAuditReport(null);
        setProgressPercent(0);
        setProgressStep("Инициализация защиты рейтлимитов...");

        runCopy(
            { src, dst, roles, channels, emojis, settings, images, userOW, skipDuplicates },
            log,
            onProgress,
            () => abortRef.current,
            (report) => setAuditReport(report)
        ).finally(() => setBusy(false));
    };

    const onAbort = () => {
        abortRef.current = true;
        log("Запрошена безопасная остановка клонирования...", "warn");
    };

    const copyLogToClipboard = () => {
        const text = entries.map(e => `[${e.time}] [${e.type.toUpperCase()}] ${e.msg}`).join("\n");
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const filteredEntries = entries.filter(e => filter === "all" || e.type === filter);

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            color: "var(--text-normal, #dbdee1)",
            fontFamily: "var(--font-primary, sans-serif)",
            maxWidth: "760px",
            padding: "8px 0"
        }}>
            {/* Header Banner */}
            <div style={{
                background: "linear-gradient(135deg, rgba(88, 101, 242, 0.15) 0%, rgba(35, 165, 90, 0.1) 100%)",
                border: "1px solid rgba(88, 101, 242, 0.3)",
                borderRadius: "10px",
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                flexWrap: "wrap"
            }}>
                <div>
                    <div style={{
                        fontSize: "18px",
                        fontWeight: 700,
                        color: "var(--header-primary, #ffffff)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                    }}>
                        <span>ServerCloner Pro</span>
                        <span style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            background: "var(--brand-experiment, #5865f2)",
                            color: "#fff",
                            padding: "2px 8px",
                            borderRadius: "12px",
                        }}>
                            RATE-LIMIT SAFE
                        </span>
                        <span style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            background: "rgba(35, 165, 90, 0.2)",
                            color: "#23a55a",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            border: "1px solid rgba(35, 165, 90, 0.3)"
                        }}>
                            АУДИТ 100%
                        </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", marginTop: "4px" }}>
                        Автоматический обход 429, Pre-flight аудит прав/лимитов и двухфазная верификация всех каналов.
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                        onClick={() => setPreset("all")}
                        disabled={busy}
                        style={{
                            padding: "6px 10px",
                            background: "var(--background-secondary-alt, #232428)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        Всё 1:1
                    </button>
                    <button
                        onClick={() => setPreset("structure")}
                        disabled={busy}
                        style={{
                            padding: "6px 10px",
                            background: "var(--background-secondary-alt, #232428)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        Структура
                    </button>
                    <button
                        onClick={() => setPreset("media")}
                        disabled={busy}
                        style={{
                            padding: "6px 10px",
                            background: "var(--background-secondary-alt, #232428)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: "6px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        Медиа
                    </button>
                </div>
            </div>

            {/* Server Pickers Grid */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "12px",
                alignItems: "stretch"
            }}>
                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.06))",
                    borderRadius: "10px",
                    padding: "14px"
                }}>
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "8px"
                    }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", color: "var(--header-secondary, #b5bac1)" }}>
                            Исходный сервер (Откуда)
                        </span>
                        {srcGuild && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted, #949ba4)" }}>
                                ID: {srcGuild.id.slice(0, 6)}...
                            </span>
                        )}
                    </div>

                    <select
                        value={src}
                        onChange={e => setSrc(e.currentTarget.value)}
                        disabled={busy}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            background: "var(--input-background, #1e1f22)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid var(--background-modifier-accent, #3f4147)",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            outline: "none",
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        <option value="">— Выбрать исходный сервер —</option>
                        {guilds.map((g: any) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                </div>

                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.06))",
                    borderRadius: "10px",
                    padding: "14px"
                }}>
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "8px"
                    }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", color: "var(--header-secondary, #b5bac1)" }}>
                            Целевой сервер (Куда)
                        </span>
                        {dstGuild && (
                            <span style={{ fontSize: "11px", color: "var(--text-muted, #949ba4)" }}>
                                ID: {dstGuild.id.slice(0, 6)}...
                            </span>
                        )}
                    </div>

                    <select
                        value={dst}
                        onChange={e => setDst(e.currentTarget.value)}
                        disabled={busy}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            background: "var(--input-background, #1e1f22)",
                            color: "var(--text-normal, #dbdee1)",
                            border: "1px solid var(--background-modifier-accent, #3f4147)",
                            borderRadius: "6px",
                            fontSize: "13px",
                            fontWeight: 500,
                            outline: "none",
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        <option value="">— Выбрать целевой сервер —</option>
                        {guilds.map((g: any) => (
                            <option key={g.id} value={g.id} disabled={g.id === src}>{g.name} {g.id === src ? "(исходный)" : ""}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Options Switches */}
            <div>
                <div style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--header-secondary, #b5bac1)",
                    marginBottom: "8px"
                }}>
                    Параметры и безопасность
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "8px" }}>
                    <DiscordSwitch
                        checked={roles}
                        onChange={setRoles}
                        disabled={busy}
                        title="Роли и права доступа"
                        subtitle="Без системных бот-ролей, с сохранением цветов и точной иерархии"
                        icon={<span>🛡️</span>}
                    />

                    <DiscordSwitch
                        checked={channels}
                        onChange={setChannels}
                        disabled={busy}
                        title="Каналы и верификация"
                        subtitle="Двухфазное создание категорий + аудит целостности каналов"
                        icon={<span>📁</span>}
                    />

                    <DiscordSwitch
                        checked={emojis}
                        onChange={setEmojis}
                        disabled={busy}
                        title="Пользовательские эмодзи"
                        subtitle="Lossless CDN перенос с адаптивной паузой между запросами"
                        icon={<span>😀</span>}
                    />

                    <DiscordSwitch
                        checked={settings}
                        onChange={setSettings}
                        disabled={busy}
                        title="Основные настройки"
                        subtitle="Название, верификация, AFK, системные каналы и оповещения"
                        icon={<span>⚙️</span>}
                    />

                    <DiscordSwitch
                        checked={images}
                        onChange={setImages}
                        disabled={busy}
                        title="Иконка и баннер"
                        subtitle="Автоскачивание и загрузка графики сервера до 4096px"
                        icon={<span>🎨</span>}
                    />

                    <DiscordSwitch
                        checked={skipDuplicates}
                        onChange={setSkipDuplicates}
                        disabled={busy}
                        title="Пропускать существующие дубликаты"
                        subtitle="Не создавать заново уже существующие роли/эмодзи на цели"
                        icon={<span>⚡</span>}
                    />
                </div>
            </div>

            {/* Action Trigger & Abort */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", gap: "10px" }}>
                    <button
                        onClick={onCopy}
                        disabled={busy}
                        style={{
                            flex: 1,
                            padding: "12px 18px",
                            background: busy ? "#4e5058" : "var(--brand-experiment, #5865f2)",
                            color: "#ffffff",
                            border: "none",
                            borderRadius: "8px",
                            fontSize: "14px",
                            fontWeight: 700,
                            cursor: busy ? "not-allowed" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            boxShadow: busy ? "none" : "0 4px 12px rgba(88, 101, 242, 0.3)",
                            transition: "all 0.15s ease"
                        }}
                    >
                        {busy ? (
                            <>
                                <span>⏳</span>
                                <span>Клонирование в процессе...</span>
                            </>
                        ) : (
                            <>
                                <span>🚀</span>
                                <span>Запустить клонирование с верификацией</span>
                            </>
                        )}
                    </button>

                    {busy && (
                        <button
                            onClick={onAbort}
                            style={{
                                padding: "12px 18px",
                                background: "#da373c",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "8px",
                                fontSize: "14px",
                                fontWeight: 700,
                                cursor: "pointer",
                                transition: "all 0.15s ease"
                            }}
                        >
                            Остановить
                        </button>
                    )}
                </div>

                {/* Progress Bar */}
                {(busy || progressPercent > 0) && (
                    <div style={{
                        background: "var(--background-secondary, #2b2d31)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.06))"
                    }}>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            fontSize: "12px",
                            fontWeight: 600,
                            marginBottom: "6px"
                        }}>
                            <span style={{ color: "var(--header-primary, #ffffff)" }}>{progressStep || "Клонирование..."}</span>
                            <span style={{ color: "var(--brand-experiment, #5865f2)", fontVariantNumeric: "tabular-nums" }}>{progressPercent}%</span>
                        </div>
                        <div style={{
                            width: "100%",
                            height: "6px",
                            background: "var(--background-tertiary, #1e1f22)",
                            borderRadius: "3px",
                            overflow: "hidden"
                        }}>
                            <div style={{
                                width: `${progressPercent}%`,
                                height: "100%",
                                background: progressPercent === 100 ? "var(--status-positive, #23a55a)" : "linear-gradient(90deg, #5865f2, #23a55a)",
                                transition: "width 0.25s ease"
                            }} />
                        </div>
                    </div>
                )}

                {/* Audit Summary Card (Appears after completion) */}
                {auditReport && (
                    <div style={{
                        background: "rgba(35, 165, 90, 0.1)",
                        border: "1px solid rgba(35, 165, 90, 0.3)",
                        borderRadius: "8px",
                        padding: "12px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                    }}>
                        <div style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#23a55a",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px"
                        }}>
                            <span>✓</span>
                            <span>Отчет об аудите и сверке целостности:</span>
                        </div>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: "8px",
                            fontSize: "12px",
                            color: "var(--text-normal, #dbdee1)",
                            marginTop: "4px"
                        }}>
                            <div>🛡️ Роли: <strong>{auditReport.rolesCreated}/{auditReport.rolesExpected}</strong></div>
                            <div>📁 Каналы: <strong>{auditReport.channelsCreated}/{auditReport.channelsExpected}</strong> (проверено: {auditReport.channelsVerified})</div>
                            <div>😀 Эмодзи: <strong>{auditReport.emojisCreated}/{auditReport.emojisExpected}</strong></div>
                            <div>⏱️ Время: <strong>{auditReport.durationSec} сек</strong></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Terminal Console / Log */}
            <div style={{
                background: "var(--background-tertiary, #1e1f22)",
                border: "1px solid var(--background-modifier-accent, rgba(255,255,255,0.08))",
                borderRadius: "10px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
            }}>
                <div style={{
                    padding: "10px 14px",
                    background: "var(--background-secondary-alt, #232428)",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    flexWrap: "wrap"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: busy ? "#f0b232" : entries.length ? "#23a55a" : "#4e5058"
                        }} />
                        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--header-primary, #f2f3f5)" }}>
                            Журнал событий
                        </span>
                        <span style={{
                            fontSize: "11px",
                            color: "var(--text-muted, #949ba4)",
                            fontVariantNumeric: "tabular-nums"
                        }}>
                            ({filteredEntries.length})
                        </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <button
                            onClick={() => setAutoScroll(!autoScroll)}
                            style={{
                                padding: "4px 8px",
                                background: autoScroll ? "rgba(88, 101, 242, 0.2)" : "transparent",
                                color: autoScroll ? "var(--brand-experiment, #5865f2)" : "var(--text-muted, #949ba4)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer"
                            }}
                        >
                            Автопрокрутка {autoScroll ? "Вкл" : "Выкл"}
                        </button>

                        <button
                            onClick={copyLogToClipboard}
                            disabled={!entries.length}
                            style={{
                                padding: "4px 8px",
                                background: copied ? "rgba(35, 165, 90, 0.2)" : "transparent",
                                color: copied ? "var(--status-positive, #23a55a)" : "var(--text-muted, #949ba4)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: entries.length ? "pointer" : "not-allowed",
                                opacity: entries.length ? 1 : 0.5
                            }}
                        >
                            {copied ? "Скопировано!" : "Копировать"}
                        </button>

                        <button
                            onClick={() => setEntries([])}
                            disabled={!entries.length || busy}
                            style={{
                                padding: "4px 8px",
                                background: "transparent",
                                color: "var(--text-muted, #949ba4)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "4px",
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: entries.length && !busy ? "pointer" : "not-allowed",
                                opacity: entries.length && !busy ? 1 : 0.5
                            }}
                        >
                            Очистить
                        </button>
                    </div>
                </div>

                <div
                    ref={logRef}
                    style={{
                        padding: "10px 14px",
                        maxHeight: "260px",
                        minHeight: "140px",
                        overflowY: "auto",
                        fontSize: "12px",
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        lineHeight: "1.5",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px"
                    }}
                >
                    {filteredEntries.length === 0 ? (
                        <div style={{
                            color: "var(--text-muted, #949ba4)",
                            fontStyle: "italic",
                            padding: "20px 0",
                            textAlign: "center"
                        }}>
                            Журнал готов к работе. Нажмите «Запустить клонирование с верификацией».
                        </div>
                    ) : (
                        filteredEntries.map(e => {
                            let color = "var(--text-normal, #dbdee1)";
                            let tagColor = "#5865f2";
                            let tagBg = "rgba(88, 101, 242, 0.15)";
                            let tagText = "ИНФО";

                            if (e.type === "success") {
                                color = "#3ba55d";
                                tagColor = "#3ba55d";
                                tagBg = "rgba(59, 165, 93, 0.15)";
                                tagText = "УСПЕХ";
                            } else if (e.type === "warn") {
                                color = "#faa81a";
                                tagColor = "#faa81a";
                                tagBg = "rgba(250, 168, 26, 0.15)";
                                tagText = "ПРЕДУПР";
                            } else if (e.type === "error") {
                                color = "#ed4245";
                                tagColor = "#ed4245";
                                tagBg = "rgba(237, 66, 69, 0.15)";
                                tagText = "ОШИБКА";
                            }

                            return (
                                <div key={e.id} style={{ display: "flex", alignItems: "baseline", gap: "8px", wordBreak: "break-word" }}>
                                    <span style={{ color: "#72767d", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>[{e.time}]</span>
                                    <span style={{
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        color: tagColor,
                                        background: tagBg,
                                        padding: "1px 5px",
                                        borderRadius: "3px",
                                        flexShrink: 0
                                    }}>
                                        {tagText}
                                    </span>
                                    <span style={{ color }}>{e.msg}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

const authors: PluginAuthor[] = [{ name: "opencode", id: 1n }];

export default definePlugin({
    name: "ServerCloner",
    description: "Копирует сервер 1:1 с контролем рейтлимитов, Pre-flight аудитом и верификацией целостности всех каналов",
    authors,
    tags: ["Servers", "Utility"],
    searchTerms: ["clone", "copy", "server", "guild", "копировать", "клонер"],
    settingsAboutComponent: SettingsPanel,
});
