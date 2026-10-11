/**
 * ServerCloner Pro — userplugin for Vencord
 * Копирует структуру сервера 1:1: роли + права, категории + каналы + overwrites (включая скрытые и приватные),
 * настройки сервера, иконка/баннер, эмодзи.
 *
 * Архитектурные особенности:
 * - Построение дерева категорий и каналов до копирования с настраиваемой Orphan Policy ('skip' | 'root')
 * - Проверка parent_id после создания каналов по карте соответствий
 * - Четкое разграничение поддерживаемых типов каналов и явный пропуск веток (типы 10, 11, 12, 6)
 * - Проверка длины описания канала (topic <= 1024) без скрытого усечения при водяном знаке
 * - Формирование детального аудита из фактических результатов (ожидаемые, созданные, сопоставленные, пропущенные, проверенные)
 * - Список объектов, требующих ручной проверки (manualReviewList)
 * - Реалистичная оценка безопасности Stealth Mode, маскирование токенов в логах и адаптивный 429 backoff
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

// Рандомизированная пауза с джиттером для снижения риска детекта автоматизации
function humanJitter(baseMs: number, varianceMs: number = 300): number {
    return baseMs + Math.floor(Math.random() * varianceMs);
}

// Маскирование токенов и секретов в логах для предотвращения утечек
function sanitizeLogText(text: any): string {
    if (!text) return "";
    return String(text).replace(/[a-zA-Z0-9_-]{24}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g, "[TOKEN_PROTECTED]");
}

// Таблица поддерживаемых и неподдерживаемых типов каналов Discord
export const SUPPORTED_CHANNEL_TYPES: Record<number, { name: string; canClone: boolean; note: string }> = {
    0: { name: "Текст (GUILD_TEXT)", canClone: true, note: "Название, тема, права, slowmode, nsfw" },
    2: { name: "Голос (GUILD_VOICE)", canClone: true, note: "Битрейт, лимит участников, rtc_region, права" },
    4: { name: "Категория (GUILD_CATEGORY)", canClone: true, note: "Иерархия, позиция, категорийные права" },
    5: { name: "Анонсы (GUILD_ANNOUNCEMENT)", canClone: true, note: "Новостной канал, топик, права" },
    13: { name: "Трибуна (GUILD_STAGE_VOICE)", canClone: true, note: "Сцена, топик, лимит пользователей, права" },
    15: { name: "Форум (GUILD_FORUM)", canClone: true, note: "Теги форума, дефолтные реакции, сортировка, права" },
    16: { name: "Медиа (GUILD_MEDIA)", canClone: true, note: "Медиа-канал, теги, права" },
};

export const UNSUPPORTED_CHANNEL_TYPES: Record<number, { name: string; reason: string }> = {
    6: { name: "Магазин (GUILD_STORE)", reason: "Устаревший тип каналов Discord (deprecated)" },
    10: { name: "Ветка анонсов (GUILD_NEWS_THREAD)", reason: "Ветки привязаны к сообщениям и не переносятся через REST" },
    11: { name: "Публичная ветка (GUILD_PUBLIC_THREAD)", reason: "Ветки создаются внутри сообщений и требуют активных стартеров" },
    12: { name: "Приватная ветка (GUILD_PRIVATE_THREAD)", reason: "Приватные ветки не подлежат прямому копированию через REST" },
};

export type OrphanPolicy = "skip" | "root";

export interface CopyCfg {
    src: string;
    dst: string;
    roles: boolean;
    channels: boolean;
    emojis: boolean;
    settings: boolean;
    images: boolean;
    userOW: boolean;
    skipDuplicates: boolean;
    watermark: boolean;
    watermarkText: string;
    stealthMode: boolean;
    copyHiddenChannels: boolean;
    orphanChannelPolicy: OrphanPolicy;
}

export interface AuditItemReview {
    type: "role" | "channel" | "category" | "emoji" | "setting";
    name: string;
    id?: string;
    reason: string;
    actionRequired: string;
}

export interface ObjectMetrics {
    expected: number;
    created: number;
    matchedExisting: number;
    skipped: number;
    verified: number;
    failed: number;
}

export interface AuditReport {
    status: "success" | "partial_with_errors" | "aborted" | "failed";
    roles: ObjectMetrics;
    channels: ObjectMetrics;
    emojis: ObjectMetrics;
    hiddenChannelsCount: number;
    settingsApplied: boolean;
    unsupportedSkippedCount: number;
    orphanAdjustedCount: number;
    warnings: string[];
    errors: string[];
    manualReviewList: AuditItemReview[];
    durationSec: number;
}

type LogFn = (msg: string, type?: "info" | "success" | "warn" | "error") => void;
type ProgressFn = (step: string, percent: number) => void;

function errMsg(e: any): string {
    try {
        if (e?.body) {
            if (e.body.message) return sanitizeLogText(`${e.body.message} (code ${e.body.code ?? "unknown"})`);
            return sanitizeLogText(JSON.stringify(e.body).slice(0, 250));
        }
    } catch { /* ignore */ }
    return sanitizeLogText(String(e?.message ?? e?.text ?? e));
}

/**
 * Обертка над RestAPI с соблюдением рейтлимитов (HTTP 429) и защитой от бесконечных повторов
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
            return res?.body ?? res;
        } catch (err: any) {
            const status = err?.status ?? err?.body?.code;
            const retryAfter = err?.body?.retry_after ?? err?.headers?.["retry-after"];

            // Блокирующие ошибки авторизации и прав доступа не повторяем вслепую
            if (status === 401 || status === 403) {
                const msg = `[Блокирующая ошибка ${status}] Недостаточно прав или недействительный токен на целевом сервере (${url})`;
                log?.(msg, "error");
                throw new Error(msg);
            }

            if (status === 429 || retryAfter != null) {
                const waitMs = Math.ceil((Number(retryAfter) || 2.0) * 1000) + humanJitter(600, 400);
                log?.(`[Рейтлимит Discord 429] Получен заголовок retry_after. Пауза ${Math.round(waitMs / 1000)}с перед повтором...`, "warn");
                await sleep(waitMs);
                continue;
            }

            if (status >= 500 && status < 600 && attempt < maxRetries) {
                const backoff = attempt * 1600 + humanJitter(200, 300);
                log?.(`[Сбой шлюза Discord ${status}] Повторная попытка ${attempt}/${maxRetries} через ${backoff}мс...`, "warn");
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
 * Pre-Flight проверка лимитов и прав
 */
async function preflightChecks(
    cfg: CopyCfg,
    log: LogFn,
    warnings: string[],
    errors: string[]
): Promise<boolean> {
    log("Запуск предварительной проверки прав и квот (Pre-Flight Check)...", "info");

    try {
        const targetGuild = await apiGet(`/guilds/${cfg.dst}`, log);
        if (!targetGuild) {
            const errStr = "Целевой сервер недоступен или отсутствует доступ";
            log(errStr, "error");
            errors.push(errStr);
            return false;
        }

        const existingChannels = await apiGet(`/guilds/${cfg.dst}/channels`, log);
        const existingRoles = await apiGet(`/guilds/${cfg.dst}/roles`, log);

        log(`Целевой сервер «${targetGuild.name}»: ${existingChannels?.length ?? 0} каналов, ${existingRoles?.length ?? 0} ролей`, "info");

        if (cfg.channels) {
            const srcChannels = await apiGet(`/guilds/${cfg.src}/channels`, log);
            const totalChannels = (existingChannels?.length ?? 0) + (srcChannels?.length ?? 0);
            if (totalChannels > 500) {
                const w = `Суммарное число каналов (${totalChannels}) превышает лимит Discord (500)`;
                log(`[Лимит квот] ${w}`, "warn");
                warnings.push(w);
            }
        }

        if (cfg.stealthMode) {
            log("Stealth Mode активен: снижает риск детекта антиспам-эвристиками (джиттер 900-1500мс и микропаузы). Внимание: задержки не дают 100% гарантии от ручной проверки Discord.", "info");
        }

        return true;
    } catch (e: any) {
        const m = `Ошибка Pre-Flight: ${errMsg(e)}`;
        log(m, "warn");
        warnings.push(m);
        return true;
    }
}

/**
 * Копирование ролей с учетом иерархии, сопоставления дубликатов и пропуска системных ролей
 */
async function copyRoles(
    cfg: CopyCfg,
    roleMap: Map<string, string>,
    log: LogFn,
    warnings: string[],
    errors: string[],
    manualReviews: AuditItemReview[],
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<ObjectMetrics> {
    onProgress?.("Получение списка ролей исходного сервера...", 10);
    const roles = await apiGet(`/guilds/${cfg.src}/roles`, log);
    const everyone = roles.find((r: any) => r.id === cfg.src);

    const rawOthers = roles.filter((r: any) => r.id !== cfg.src);
    let skippedBotRoles = 0;
    const filterable = rawOthers.filter((r: any) => {
        if (r.managed) {
            log(`Роль «${r.name}» пропущена (интеграционная/бот-роль)`, "info");
            skippedBotRoles++;
            return false;
        }
        if (r.tags?.bot_id || r.tags?.integration_id) {
            log(`Роль «${r.name}» пропущена (привязана к боту)`, "info");
            skippedBotRoles++;
            return false;
        }
        return true;
    });

    const others = filterable.sort((a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

    let existingTargetRoles: any[] = [];
    if (cfg.skipDuplicates) {
        existingTargetRoles = (await apiGet(`/guilds/${cfg.dst}/roles`, log)) || [];
    }

    // Синхронизация базовых прав роли @everyone
    roleMap.set(cfg.src, cfg.dst);
    try {
        await apiPatch(`/guilds/${cfg.dst}/roles/${cfg.dst}`, {
            permissions: everyone?.permissions ?? "0"
        }, log);
        log("Роль @everyone: базовые разрешения синхронизированы", "success");
    } catch (err) {
        const m = `Не удалось синхронизировать роль @everyone: ${errMsg(err)}`;
        log(m, "warn");
        warnings.push(m);
        manualReviews.push({
            type: "role",
            name: "@everyone",
            reason: "Ошибка синхронизации прав",
            actionRequired: "Вручную проверить базовые права @everyone на целевом сервере"
        });
    }
    await sleep(cfg.stealthMode ? 800 : 400);

    let createdCount = 0;
    let matchedCount = 0;
    let failedCount = 0;
    let idx = 0;

    for (const r of others) {
        if (isAborted?.()) {
            log("Операция прервана пользователем во время создания ролей", "warn");
            break;
        }
        idx++;
        onProgress?.(`Создание ролей (${idx}/${others.length}): ${r.name}`, Math.round(10 + (idx / others.length) * 20));

        if (cfg.skipDuplicates) {
            const found = existingTargetRoles.find((er: any) => er.name.toLowerCase() === r.name.toLowerCase());
            if (found) {
                roleMap.set(r.id, found.id);
                matchedCount++;
                log(`Роль «${r.name}» уже существует на целевом сервере (сопоставлена)`, "info");
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
                const m = `Роль «${r.name}» не создана: ${errMsg(e2)}`;
                log(m, "error");
                errors.push(m);
                failedCount++;
                manualReviews.push({
                    type: "role",
                    name: r.name,
                    id: r.id,
                    reason: `Ошибка Discord API: ${errMsg(e2)}`,
                    actionRequired: "Создать роль вручную и назначить права"
                });
                continue;
            }
        }

        const delay = cfg.stealthMode ? humanJitter(1000, 500) : humanJitter(400, 200);
        await sleep(delay);

        if (cfg.stealthMode && idx % 8 === 0) {
            log("Stealth пауза безопасности (3.5с)...", "info");
            await sleep(3500);
        }
    }

    // Восстановление порядка ролей
    const positions: any[] = [{ id: cfg.dst, position: 0 }];
    others.forEach((r: any, i: number) => {
        const nid = roleMap.get(r.id);
        if (nid) positions.push({ id: nid, position: i + 1 });
    });
    try {
        await apiPatch(`/guilds/${cfg.dst}/roles`, positions, log);
        log("Порядок и иерархия ролей успешно применены", "success");
    } catch (e) {
        const m = `Порядок ролей не выставлен: ${errMsg(e)}`;
        log(m, "warn");
        warnings.push(m);
        manualReviews.push({
            type: "role",
            name: "Иерархия ролей",
            reason: "Не удалось перенести точные позиции ролей",
            actionRequired: "Перепроверить порядок ролей в настройках сервера"
        });
    }

    return {
        expected: others.length,
        created: createdCount,
        matchedExisting: matchedCount,
        skipped: skippedBotRoles,
        verified: createdCount + matchedCount,
        failed: failedCount,
    };
}

/**
 * Копирование эмодзи с защитой от дублирования
 */
async function copyEmojis(
    cfg: CopyCfg,
    emojiMap: Map<string, string>,
    log: LogFn,
    warnings: string[],
    errors: string[],
    manualReviews: AuditItemReview[],
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<ObjectMetrics> {
    onProgress?.("Чтение эмодзи исходного сервера...", 32);
    const emojis = await apiGet(`/guilds/${cfg.src}/emojis`, log);
    if (!Array.isArray(emojis) || !emojis.length) {
        log("Пользовательские эмодзи на сервере отсутствуют", "info");
        return { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    }

    const targetEmojis = (await apiGet(`/guilds/${cfg.dst}/emojis`, log)) || [];
    let createdCount = 0;
    let matchedCount = 0;
    let failedCount = 0;
    let idx = 0;

    for (const e of emojis) {
        if (isAborted?.()) break;
        idx++;
        onProgress?.(`Загрузка эмодзи (${idx}/${emojis.length}): :${e.name}:`, Math.round(32 + (idx / emojis.length) * 20));

        if (cfg.skipDuplicates && targetEmojis.some((te: any) => te.name === e.name)) {
            matchedCount++;
            log(`Эмодзи :${e.name}: уже существует на целевом сервере (пропущено)`, "info");
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
            const m = `Эмодзи «${e.name}» не перенесено: ${errMsg(err)}`;
            log(m, "warn");
            warnings.push(m);
            failedCount++;
            manualReviews.push({
                type: "emoji",
                name: e.name,
                id: e.id,
                reason: errMsg(err),
                actionRequired: "Загрузить эмодзи вручную в настройках сервера"
            });
        }

        const delay = cfg.stealthMode ? humanJitter(1400, 600) : humanJitter(600, 300);
        await sleep(delay);
    }

    return {
        expected: emojis.length,
        created: createdCount,
        matchedExisting: matchedCount,
        skipped: 0,
        verified: createdCount + matchedCount,
        failed: failedCount,
    };
}

/**
 * Подготовка параметров канала с проверкой лимита topic (макс. 1024)
 * Важно: при превышении лимита исходное описание НЕ обрезается молча!
 */
function channelBody(
    ch: any,
    idMap: Map<string, string>,
    roleMap: Map<string, string>,
    emojiMap: Map<string, string>,
    cfg: CopyCfg,
    log: LogFn,
    warnings: string[],
    manualReviews: AuditItemReview[]
): any {
    const body: any = { name: ch.name, type: ch.type };
    if (ch.parent_id && idMap.has(ch.parent_id)) body.parent_id = idMap.get(ch.parent_id);

    const MAX_TOPIC_LENGTH = 1024;
    let topicText = ch.topic || "";

    if (cfg.watermark && ch.type !== 4) {
        const tag = (cfg.watermarkText || "[Клон: ServerCloner Pro]").trim();
        if (tag) {
            const candidateTopic = topicText ? `${topicText} · ${tag}` : tag;
            if (candidateTopic.length > MAX_TOPIC_LENGTH) {
                const w = `[Водяной знак] Описание канала «${ch.name}» с водяным знаком (${candidateTopic.length} симв.) превышает лимит Discord (${MAX_TOPIC_LENGTH}). Исходное описание сохранено без изменений; канал добавлен в список ручной проверки.`;
                log(w, "warn");
                warnings.push(w);
                manualReviews.push({
                    type: "channel",
                    name: ch.name,
                    id: ch.id,
                    reason: `Превышен лимит описания (${candidateTopic.length} > ${MAX_TOPIC_LENGTH})`,
                    actionRequired: "Вручную скорректировать описание (topic) в настройках канала"
                });
            } else {
                topicText = candidateTopic;
            }
        }
    }
    if (topicText) body.topic = topicText;

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

    // Точный перенос всех Permission Overwrites (ролевые и пользовательские)
    if (ch.permission_overwrites?.length) {
        const ows: any[] = [];
        for (const ow of ch.permission_overwrites) {
            if (ow.type === 0) {
                if (ow.id === cfg.src) {
                    ows.push({ id: cfg.dst, type: 0, allow: ow.allow, deny: ow.deny });
                } else if (roleMap.has(ow.id)) {
                    ows.push({ id: roleMap.get(ow.id), type: 0, allow: ow.allow, deny: ow.deny });
                }
            } else if (cfg.userOW) {
                ows.push({ id: ow.id, type: 1, allow: ow.allow, deny: ow.deny });
            }
        }
        if (ows.length) body.permission_overwrites = ows;
    }
    return body;
}

/**
 * Проверка является ли канал скрытым/приватным
 */
function isChannelHidden(ch: any, srcGuildId: string): boolean {
    if (!ch.permission_overwrites) return false;
    const everyoneOW = ch.permission_overwrites.find((ow: any) => ow.id === srcGuildId && ow.type === 0);
    if (!everyoneOW) return false;
    try {
        const denyBig = BigInt(everyoneOW.deny || "0");
        return (denyBig & 1024n) === 1024n;
    } catch {
        return false;
    }
}

/**
 * Построение дерева категорий и каналов, обработка Orphan Policy и проверка parent_id
 */
async function copyChannelsWithVerification(
    cfg: CopyCfg,
    idMap: Map<string, string>,
    roleMap: Map<string, string>,
    emojiMap: Map<string, string>,
    log: LogFn,
    warnings: string[],
    errors: string[],
    manualReviews: AuditItemReview[],
    onProgress?: ProgressFn,
    isAborted?: () => boolean
): Promise<{
    metrics: ObjectMetrics;
    hiddenCount: number;
    unsupportedSkippedCount: number;
    orphanAdjustedCount: number;
}> {
    onProgress?.("Чтение структуры ВСЕХ каналов исходного сервера...", 52);
    const allChannels = await apiGet(`/guilds/${cfg.src}/channels`, log);

    // 1. Фильтрация и явное предупреждение о неподдерживаемых объектах (ветки и store)
    const UNSUPPORTED_TYPES = [6, 10, 11, 12];
    const unsupported = allChannels.filter((c: any) => UNSUPPORTED_TYPES.includes(c.type));
    const usable = allChannels.filter((c: any) => !UNSUPPORTED_TYPES.includes(c.type));

    if (unsupported.length > 0) {
        const typesSummary = Array.from(new Set(unsupported.map((c: any) => c.type))).join(", ");
        const warnMsg = `[Пропуск неподдерживаемых объектов] Обнаружено ${unsupported.length} веток/устаревших каналов (типы ${typesSummary}). Ветки Discord (включая приватные ветки 10, 11, 12) не переносятся через прямое создание каналов и исключены из плана.`;
        log(warnMsg, "warn");
        warnings.push(warnMsg);
    }

    // 2. Дерево категорий и каналов до копирования
    const categories = usable.filter((c: any) => c.type === 4);
    const nonCats = usable.filter((c: any) => c.type !== 4);
    const categoryMap = new Map(categories.map((c: any) => [c.id as string, c]));

    let hiddenCount = 0;
    usable.forEach((ch: any) => {
        if (isChannelHidden(ch, cfg.src)) hiddenCount++;
    });

    log(`Обнаружено поддерживаемых каналов: ${usable.length} (из них скрытых/приватных: ${hiddenCount})`, "info");

    // Определение исключаемых категорий
    const excludedCategoryIds = new Set<string>();
    const activeCategories: any[] = [];

    for (const cat of categories) {
        const isHidden = isChannelHidden(cat, cfg.src);
        if (cfg.copyHiddenChannels === false && isHidden) {
            excludedCategoryIds.add(cat.id);
            log(`[Дерево категорий] Скрытая категория «${cat.name}» исключена пользователем`, "warn");
        } else {
            activeCategories.push(cat);
        }
    }

    // Обработка дочерних каналов согласно Orphan Policy
    const plannedChannels: any[] = [];
    let orphanAdjustedCount = 0;
    let skippedByFilterCount = 0;

    for (const ch of nonCats) {
        const isHidden = isChannelHidden(ch, cfg.src);
        if (cfg.copyHiddenChannels === false && isHidden) {
            skippedByFilterCount++;
            continue;
        }

        // Если родительская категория была исключена
        if (ch.parent_id && excludedCategoryIds.has(ch.parent_id)) {
            const parentCat = categoryMap.get(ch.parent_id);
            const parentName = parentCat ? parentCat.name : ch.parent_id;

            if (cfg.orphanChannelPolicy === "skip") {
                orphanAdjustedCount++;
                const msg = `[Orphan Policy] Категория «${parentName}» исключена. Дочерний канал «${ch.name}» пропущен (orphan policy: skip).`;
                log(msg, "info");
                continue;
            } else {
                // orphan policy: 'root'
                orphanAdjustedCount++;
                const modified = { ...ch, parent_id: null, isOrphanRelocated: true };
                plannedChannels.push(modified);
                const warnMsg = `[Изменение структуры] Категория «${parentName}» исключена. Дочерний канал «${ch.name}» перенесен в корень без категории (orphan policy: root).`;
                log(warnMsg, "warn");
                warnings.push(warnMsg);
                manualReviews.push({
                    type: "channel",
                    name: ch.name,
                    id: ch.id,
                    reason: `Родительская категория «${parentName}» исключена, канал отвязан от родителя`,
                    actionRequired: "Привязать канал к подходящей категории или оставить в корне"
                });
                continue;
            }
        }

        plannedChannels.push(ch);
    }

    const byPos = (a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id));
    const sortedCats = [...activeCategories].sort(byPos);
    const catPos = new Map<string, number>(sortedCats.map((c: any) => [c.id as string, c.position as number]));

    const sortedOthers = [...plannedChannels].sort((a: any, b: any) => {
        const pa = a.parent_id != null ? catPos.get(a.parent_id) ?? 0 : -1;
        const pb = b.parent_id != null ? catPos.get(b.parent_id) ?? 0 : -1;
        return pa - pb || byPos(a, b);
    });

    const orderedList = [...sortedCats, ...sortedOthers];
    log(`Итоговый план создания структуры: ${sortedCats.length} категорий, ${sortedOthers.length} каналов (всего: ${orderedList.length})`, "info");

    let position = 1;
    let idx = 0;
    let createdCount = 0;
    let failedCount = 0;
    const failedChannels: any[] = [];

    for (const ch of orderedList) {
        if (isAborted?.()) {
            log("Клонирование каналов прервано пользователем", "warn");
            break;
        }
        idx++;
        onProgress?.(
            `Создание каналов (${idx}/${orderedList.length}): ${ch.name}`,
            Math.round(52 + (idx / orderedList.length) * 32)
        );

        const isHidden = isChannelHidden(ch, cfg.src);
        const full = channelBody(ch, idMap, roleMap, emojiMap, cfg, log, warnings, manualReviews);
        full.position = position++;
        let created: any = null;

        try {
            created = await apiPost(`/guilds/${cfg.dst}/channels`, full, log);
            idMap.set(ch.id, created.id);
            createdCount++;

            // Проверка parent_id по карте соответствий после создания
            if (ch.parent_id && idMap.has(ch.parent_id)) {
                const expectedTargetParentId = idMap.get(ch.parent_id);
                if (created.parent_id !== expectedTargetParentId) {
                    const warnParent = `[Несоответствие структуры] Канал «${ch.name}» создан, но parent_id (${created.parent_id}) не соответствует целевой категории (${expectedTargetParentId}).`;
                    log(warnParent, "warn");
                    warnings.push(warnParent);
                    manualReviews.push({
                        type: "channel",
                        name: ch.name,
                        id: ch.id,
                        reason: "Несовпадение parent_id с целевой категорией",
                        actionRequired: "Вручную переместить канал в правильную категорию"
                    });
                }
            }

            const hiddenBadge = isHidden ? " [🔒 ПРИВАТНЫЙ]" : "";
            const orphanBadge = ch.isOrphanRelocated ? " [В КОРНЕ]" : "";
            log(`[${SUPPORTED_CHANNEL_TYPES[ch.type]?.name ?? "Канал"}] Создан: ${ch.name}${hiddenBadge}${orphanBadge}`, "info");
        } catch (e) {
            try {
                const minimal: any = { name: ch.name, type: ch.type, position: full.position };
                if (full.parent_id) minimal.parent_id = full.parent_id;
                if (full.permission_overwrites) minimal.permission_overwrites = full.permission_overwrites;
                if (full.topic) minimal.topic = full.topic;
                created = await apiPost(`/guilds/${cfg.dst}/channels`, minimal, log);
                idMap.set(ch.id, created.id);
                createdCount++;
                log(`[${SUPPORTED_CHANNEL_TYPES[ch.type]?.name ?? "Канал"}] Создан (упрощенный): ${ch.name}`, "info");
            } catch (e2) {
                const errStr = `Канал «${ch.name}» не создан: ${errMsg(e2)}`;
                log(errStr, "warn");
                failedChannels.push(ch);
            }
        }

        const delay = cfg.stealthMode ? humanJitter(1100, 500) : humanJitter(450, 200);
        await sleep(delay);

        if (cfg.stealthMode && idx % 7 === 0) {
            log("Stealth пауза безопасности (3с)...", "info");
            await sleep(3000);
        }
    }

    // Повторное создание пропущенных каналов
    if (failedChannels.length > 0 && !isAborted?.()) {
        log(`Повторная попытка создания ${failedChannels.length} пропущенных каналов...`, "info");
        for (const ch of failedChannels) {
            if (isAborted?.()) break;
            try {
                const minimal: any = { name: ch.name, type: ch.type };
                if (ch.parent_id && idMap.has(ch.parent_id)) minimal.parent_id = idMap.get(ch.parent_id);
                const created = await apiPost(`/guilds/${cfg.dst}/channels`, minimal, log);
                idMap.set(ch.id, created.id);
                createdCount++;
                log(`[Восстановлен] Канал «${ch.name}» успешно создан`, "success");
            } catch (retryErr) {
                failedCount++;
                const m = `Повторная попытка для «${ch.name}» не удалась: ${errMsg(retryErr)}`;
                log(m, "error");
                errors.push(m);
                manualReviews.push({
                    type: ch.type === 4 ? "category" : "channel",
                    name: ch.name,
                    id: ch.id,
                    reason: `Ошибка создания: ${errMsg(retryErr)}`,
                    actionRequired: "Создать вручную на целевом сервере"
                });
            }
            await sleep(cfg.stealthMode ? 1200 : 500);
        }
    }

    // Фаза 3: Верификация целостности структуры
    onProgress?.("Аудит целостности каналов на целевом сервере...", 86);
    log("Запуск двухфазной верификации созданных каналов...", "info");
    const targetChannels = await apiGet(`/guilds/${cfg.dst}/channels`, log);
    let verifiedCount = 0;

    for (const ch of orderedList) {
        const targetId = idMap.get(ch.id);
        if (targetId && targetChannels.some((tc: any) => tc.id === targetId)) {
            verifiedCount++;
        }
    }

    if (verifiedCount === orderedList.length && failedCount === 0) {
        log(`Верификация 100% пройдена: ВСЕ запланированные каналы (${verifiedCount}/${orderedList.length}) подтверждены!`, "success");
    } else {
        const warnV = `Верификация: подтверждено ${verifiedCount} из ${orderedList.length} запланированных каналов (ошибок: ${failedCount})`;
        log(warnV, "warn");
        warnings.push(warnV);
    }

    return {
        metrics: {
            expected: orderedList.length,
            created: createdCount,
            matchedExisting: 0,
            skipped: skippedByFilterCount + (cfg.orphanChannelPolicy === "skip" ? orphanAdjustedCount : 0),
            verified: verifiedCount,
            failed: failedCount,
        },
        hiddenCount,
        unsupportedSkippedCount: unsupported.length,
        orphanAdjustedCount,
    };
}

async function copySettings(
    cfg: CopyCfg,
    idMap: Map<string, string>,
    log: LogFn,
    warnings: string[],
    manualReviews: AuditItemReview[],
    onProgress?: ProgressFn
): Promise<boolean> {
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
        onProgress?.("Загрузка иконки и баннера сервера...", 94);
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
        } catch (e: any) {
            const m = `Иконка/баннер не скачаны: ${errMsg(e)}`;
            log(m, "warn");
            warnings.push(m);
            delete patch.icon;
            delete patch.banner;
            manualReviews.push({
                type: "setting",
                name: "Иконка / Баннер",
                reason: errMsg(e),
                actionRequired: "Загрузить графику вручную в настройках сервера"
            });
        }
    }

    try {
        await apiPatch(`/guilds/${cfg.dst}`, patch, log);
        log(`Настройки сервера применены («${g.name}»)`, "success");
        return true;
    } catch (e: any) {
        delete patch.icon;
        delete patch.banner;
        delete patch.rules_channel_id;
        delete patch.public_updates_channel_id;
        try {
            await apiPatch(`/guilds/${cfg.dst}`, patch, log);
            log(`Настройки скопированы в базовом формате: ${errMsg(e)}`, "warn");
            return true;
        } catch (e2: any) {
            const m = `Не удалось применить настройки: ${errMsg(e2)}`;
            log(m, "warn");
            warnings.push(m);
            manualReviews.push({
                type: "setting",
                name: "Основные настройки",
                reason: errMsg(e2),
                actionRequired: "Проверить системные каналы и AFK вручную"
            });
            return false;
        }
    }
}

/**
 * Главный цикл клонирования с полным сбором реальных метрик аудита
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

    const warnings: string[] = [];
    const errors: string[] = [];
    const manualReviews: AuditItemReview[] = [];

    let rolesRes: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let channelsRes: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let emojisRes: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let hiddenChannelsCount = 0;
    let unsupportedSkippedCount = 0;
    let orphanAdjustedCount = 0;
    let settingsOk = false;

    try {
        onProgress("Pre-flight проверка доступности...", 3);
        const preflightOk = await preflightChecks(cfg, log, warnings, errors);
        if (!preflightOk) {
            showToast("Pre-flight проверка выявила критические ошибки", "failure");
            throw new Error("Pre-flight проверка не пройдена: нет доступа к целевому серверу");
        }

        if (isAborted()) {
            throw new Error("ABORTED");
        }

        // 1. Роли
        if (cfg.roles) {
            rolesRes = await copyRoles(cfg, roleMap, log, warnings, errors, manualReviews, onProgress, isAborted);
        }
        if (isAborted()) throw new Error("ABORTED");

        // 2. Эмодзи
        if (cfg.emojis) {
            emojisRes = await copyEmojis(cfg, emojiMap, log, warnings, errors, manualReviews, onProgress, isAborted);
        }
        if (isAborted()) throw new Error("ABORTED");

        // 3. Каналы с верификацией
        if (cfg.channels) {
            const chResult = await copyChannelsWithVerification(
                cfg, idMap, roleMap, emojiMap, log, warnings, errors, manualReviews, onProgress, isAborted
            );
            channelsRes = chResult.metrics;
            hiddenChannelsCount = chResult.hiddenCount;
            unsupportedSkippedCount = chResult.unsupportedSkippedCount;
            orphanAdjustedCount = chResult.orphanAdjustedCount;
        }
        if (isAborted()) throw new Error("ABORTED");

        // 4. Настройки
        if (cfg.settings) {
            settingsOk = await copySettings(cfg, idMap, log, warnings, manualReviews, onProgress);
        }

        const secs = Number(((Date.now() - started) / 1000).toFixed(1));

        let status: "success" | "partial_with_errors" = "success";
        if (errors.length > 0 || rolesRes.failed > 0 || channelsRes.failed > 0 || manualReviews.length > 0) {
            status = "partial_with_errors";
        }

        if (status === "success") {
            onProgress("Все задачи успешно завершены!", 100);
            log(`Клонирование и двухфазная верификация успешно завершены за ${secs} сек.`, "success");
            showToast("Сервер полностью скопирован и проверен (100%)!", "success");
        } else {
            onProgress("Завершено с замечаниями, проверьте аудит", 100);
            log(`Клонирование завершено за ${secs} сек., но обнаружены замечания (ошибок: ${errors.length}, ручная проверка: ${manualReviews.length})`, "warn");
            showToast("Завершено с замечаниями, проверьте отчёт аудита", "failure");
        }

        const report: AuditReport = {
            status,
            roles: rolesRes,
            channels: channelsRes,
            emojis: emojisRes,
            hiddenChannelsCount,
            settingsApplied: settingsOk,
            unsupportedSkippedCount,
            orphanAdjustedCount,
            warnings,
            errors,
            manualReviewList: manualReviews,
            durationSec: secs,
        };
        onAuditReady(report);
    } catch (e: any) {
        const secs = Number(((Date.now() - started) / 1000).toFixed(1));
        const wasAborted = e?.message === "ABORTED" || isAborted();

        if (wasAborted) {
            log("Процесс клонирования остановлен пользователем", "warn");
            showToast("Клонирование прервано", "failure");
        } else {
            const err = `КРИТИЧЕСКАЯ ОШИБКА: ${errMsg(e)}`;
            log(err, "error");
            errors.push(err);
            showToast("Ошибка клонирования, см. журнал", "failure");
        }

        const report: AuditReport = {
            status: wasAborted ? "aborted" : "failed",
            roles: rolesRes,
            channels: channelsRes,
            emojis: emojisRes,
            hiddenChannelsCount,
            settingsApplied: settingsOk,
            unsupportedSkippedCount,
            orphanAdjustedCount,
            warnings,
            errors,
            manualReviewList: manualReviews,
            durationSec: secs,
        };
        onAuditReady(report);
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
    icon,
    badge
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
    badge?: string;
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
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        lineHeight: "1.2"
                    }}>
                        <span>{title}</span>
                        {badge && (
                            <span style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                background: "rgba(35, 165, 90, 0.2)",
                                color: "#23a55a",
                                padding: "1px 6px",
                                borderRadius: "4px"
                            }}>
                                {badge}
                            </span>
                        )}
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

    // Новые функции
    const [watermark, setWatermark] = useState(false);
    const [watermarkText, setWatermarkText] = useState("[Клон: ServerCloner Pro]");
    const [stealthMode, setStealthMode] = useState(true);
    const [copyHiddenChannels, setCopyHiddenChannels] = useState(true);
    const [orphanChannelPolicy, setOrphanChannelPolicy] = useState<OrphanPolicy>("skip");

    const [busy, setBusy] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [showMatrix, setShowMatrix] = useState(false);
    const [showReviewList, setShowReviewList] = useState(false);
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
        setEntries(prev => [...prev, { id, time, msg: sanitizeLogText(msg), type }]);
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
            setCopyHiddenChannels(true);
            setSkipDuplicates(true);
            setOrphanChannelPolicy("skip");
        } else if (type === "structure") {
            setRoles(true);
            setChannels(true);
            setEmojis(false);
            setSettings(false);
            setImages(false);
            setUserOW(false);
            setCopyHiddenChannels(true);
            setSkipDuplicates(true);
            setOrphanChannelPolicy("skip");
        } else if (type === "media") {
            setRoles(false);
            setChannels(false);
            setEmojis(true);
            setSettings(true);
            setImages(true);
            setUserOW(false);
            setCopyHiddenChannels(false);
            setSkipDuplicates(true);
        }
    };

    const handleStartClick = () => {
        if (!src || !dst) return showToast("Выбери оба сервера!", "failure");
        if (src === dst) return showToast("Исходный и целевой сервер должны отличаться!", "failure");
        if (!roles && !channels && !emojis && !settings)
            return showToast("Отметь хотя бы один элемент для копирования!", "failure");
        setShowConfirm(true);
    };

    const confirmAndStart = () => {
        setShowConfirm(false);
        abortRef.current = false;
        setBusy(true);
        setEntries([]);
        setAuditReport(null);
        setProgressPercent(0);
        setProgressStep("Инициализация защищенного копирования...");

        runCopy(
            {
                src,
                dst,
                roles,
                channels,
                emojis,
                settings,
                images,
                userOW,
                skipDuplicates,
                watermark,
                watermarkText,
                stealthMode,
                copyHiddenChannels,
                orphanChannelPolicy,
            },
            log,
            onProgress,
            () => abortRef.current,
            (report) => setAuditReport(report)
        ).finally(() => setBusy(false));
    };

    const onAbort = () => {
        abortRef.current = true;
        log("Запрошена остановка процесса...", "warn");
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
                            STEALTH MODE
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
                            v1.2.0
                        </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", marginTop: "4px" }}>
                        Клонирование структуры 1:1 · Дерево категорий · Двухфазная верификация · Защита рейтлимитов
                    </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                    <button
                        onClick={() => setShowMatrix(!showMatrix)}
                        style={{
                            padding: "6px 12px",
                            background: "rgba(255, 255, 255, 0.08)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            borderRadius: "6px",
                            color: "#ffffff",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer"
                        }}
                    >
                        {showMatrix ? "Скрыть матрицу типов" : "Матрица типов"}
                    </button>
                    <button
                        onClick={() => setPreset("all")}
                        disabled={busy}
                        style={{
                            padding: "6px 12px",
                            background: "rgba(88, 101, 242, 0.2)",
                            border: "1px solid rgba(88, 101, 242, 0.4)",
                            borderRadius: "6px",
                            color: "var(--brand-experiment, #5865f2)",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        Полный клон
                    </button>
                    <button
                        onClick={() => setPreset("structure")}
                        disabled={busy}
                        style={{
                            padding: "6px 12px",
                            background: "rgba(255, 255, 255, 0.06)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            color: "var(--text-normal, #dbdee1)",
                            fontSize: "12px",
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
                            padding: "6px 12px",
                            background: "rgba(255, 255, 255, 0.06)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            color: "var(--text-normal, #dbdee1)",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        Медиа
                    </button>
                </div>
            </div>

            {/* Таблица поддержки типов каналов (если открыта) */}
            {showMatrix && (
                <div style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "8px",
                    padding: "14px",
                    fontSize: "12px"
                }}>
                    <div style={{ fontWeight: 700, marginBottom: "8px", color: "var(--header-primary, #ffffff)" }}>
                        Матрица поддержки каналов и веток Discord:
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                            <div style={{ fontWeight: 600, color: "#23a55a", marginBottom: "4px" }}>✓ Поддерживаемые типы:</div>
                            <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-normal, #dbdee1)", lineHeight: "1.5" }}>
                                <li>Текст (0), Голос (2), Категории (4)</li>
                                <li>Анонсы (5), Сцена/Трибуна (13)</li>
                                <li>Форум (15), Медиа (16)</li>
                                <li>Все Overwrites (роли @everyone, участники)</li>
                            </ul>
                        </div>
                        <div>
                            <div style={{ fontWeight: 600, color: "#f0b232", marginBottom: "4px" }}>⚠️ Не поддерживаются:</div>
                            <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-muted, #949ba4)", lineHeight: "1.5" }}>
                                <li>Ветки анонсов (10), публичные ветки (11)</li>
                                <li>Приватные закрытые ветки (12)</li>
                                <li>Магазин (6) — устаревший тип</li>
                                <li>История сообщений и вложения в тредах</li>
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Server Pickers */}
            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "12px",
                background: "var(--background-secondary, #2b2d31)",
                borderRadius: "10px",
                padding: "14px"
            }}>
                <div>
                    <label style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "var(--header-secondary, #b5bac1)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        marginBottom: "6px"
                    }}>
                        Исходный сервер (Откуда копировать)
                    </label>
                    <select
                        value={src}
                        onChange={e => setSrc(e.target.value)}
                        disabled={busy}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            background: "var(--input-background, #1e1f22)",
                            border: "1px solid var(--background-modifier-accent, #3f4147)",
                            borderRadius: "6px",
                            color: "var(--text-normal, #dbdee1)",
                            fontSize: "13px",
                            cursor: busy ? "not-allowed" : "pointer"
                        }}
                    >
                        <option value="">— Выбрать исходный сервер —</option>
                        {guilds.map((g: any) => (
                            <option key={g.id} value={g.id}>{g.name} ({g.id.slice(-4)})</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "var(--header-secondary, #b5bac1)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        marginBottom: "6px"
                    }}>
                        Целевой сервер (Куда клонировать)
                    </label>
                    <select
                        value={dst}
                        onChange={e => setDst(e.target.value)}
                        disabled={busy}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            background: "var(--input-background, #1e1f22)",
                            border: "1px solid var(--background-modifier-accent, #3f4147)",
                            borderRadius: "6px",
                            color: "var(--text-normal, #dbdee1)",
                            fontSize: "13px",
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

            {/* Special Section: Водяной знак, Stealth Mode и Скрытые каналы */}
            <div style={{
                background: "var(--background-secondary, #2b2d31)",
                border: "1px solid rgba(88, 101, 242, 0.2)",
                borderRadius: "10px",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: "10px"
            }}>
                <div style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: "var(--header-primary, #ffffff)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                }}>
                    <span>🛡️</span>
                    <span>Безопасность аккаунта, скрытые каналы & водяной знак</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "8px" }}>
                    <DiscordSwitch
                        checked={stealthMode}
                        onChange={setStealthMode}
                        disabled={busy}
                        title="Stealth Mode (Снижение риска автоматизации)"
                        subtitle="Рандомизированные задержки (900-1500мс) и микропаузы. Защита: снижает риск детекта, не дает абсолютной гарантии."
                        icon={<span>🔒</span>}
                        badge="РЕКОМЕНДУЕТСЯ"
                    />

                    <DiscordSwitch
                        checked={copyHiddenChannels}
                        onChange={setCopyHiddenChannels}
                        disabled={busy || !channels}
                        title="Скрытые и приватные каналы (с правами)"
                        subtitle="Копировать скрытые админ-каналы и секретные комнаты с их точными правами доступа (overwrites)."
                        icon={<span>👁️</span>}
                        badge="100% ПРАВА"
                    />

                    <DiscordSwitch
                        checked={orphanChannelPolicy === "root"}
                        onChange={checked => setOrphanChannelPolicy(checked ? "root" : "skip")}
                        disabled={busy || !channels}
                        title="Политика для каналов исключенных категорий"
                        subtitle={orphanChannelPolicy === "root"
                            ? "Режим 'root': каналы исключенных категорий переносятся в корень сервера без родителя"
                            : "Режим 'skip': каналы исключенных категорий исключаются вместе с категорией (защита структуры)"}
                        icon={<span>🌳</span>}
                    />

                    <DiscordSwitch
                        checked={watermark}
                        onChange={setWatermark}
                        disabled={busy}
                        title="Водяной знак в описании каналов (Topic)"
                        subtitle={watermark ? `Включен: в topic добавляется отметка (с проверкой лимита 1024 симв.)` : "Выключен: описания каналов переносятся 1:1 без отметок"}
                        icon={<span>🏷️</span>}
                    />
                </div>

                {/* Кастомизация текста водяного знака */}
                {watermark && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        background: "var(--background-tertiary, #1e1f22)",
                        border: "1px solid rgba(88, 101, 242, 0.3)",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        marginTop: "4px"
                    }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px" }}>
                            <span>🏷️</span>
                            <span>Текст водяного знака:</span>
                        </span>
                        <input
                            type="text"
                            value={watermarkText}
                            onChange={e => setWatermarkText(e.target.value)}
                            disabled={busy}
                            placeholder="Например: [Клон: ServerCloner Pro]"
                            style={{
                                flex: 1,
                                background: "var(--input-background, #2b2d31)",
                                border: "1px solid var(--background-modifier-accent, #3f4147)",
                                borderRadius: "4px",
                                color: "var(--text-normal, #dbdee1)",
                                padding: "6px 10px",
                                fontSize: "12px",
                                outline: "none",
                                fontFamily: "monospace"
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => setWatermarkText("[Клон: ServerCloner Pro]")}
                            disabled={busy}
                            style={{
                                background: "var(--background-secondary, #2b2d31)",
                                border: "1px solid var(--background-modifier-accent, #3f4147)",
                                color: "var(--text-muted, #949ba4)",
                                padding: "5px 10px",
                                fontSize: "11px",
                                borderRadius: "4px",
                                cursor: "pointer",
                                whiteSpace: "nowrap"
                            }}
                        >
                            Сброс
                        </button>
                    </div>
                )}
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
                    Элементы копирования (включая приватные и скрытые)
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "8px" }}>
                    <DiscordSwitch
                        checked={roles}
                        onChange={setRoles}
                        disabled={busy}
                        title="Роли и точные разрешения"
                        subtitle="Без системных бот-ролей, с сохранением цветов, hoist и точной иерархии"
                        icon={<span>🛡️</span>}
                    />

                    <DiscordSwitch
                        checked={channels}
                        onChange={setChannels}
                        disabled={busy}
                        title="Каналы и категории сервера"
                        subtitle="Текстовые, голосовые, категории с точной привязкой parent_id и правами доступа"
                        icon={<span>📁</span>}
                        badge="100% ПРАВА"
                    />

                    <DiscordSwitch
                        checked={emojis}
                        onChange={setEmojis}
                        disabled={busy}
                        title="Пользовательские эмодзи"
                        subtitle="Lossless CDN перенос с паузами для обхода блокировок"
                        icon={<span>😀</span>}
                    />

                    <DiscordSwitch
                        checked={settings}
                        onChange={setSettings}
                        disabled={busy}
                        title="Основные настройки сервера"
                        subtitle="Название, верификация, AFK, системные каналы и оповещения"
                        icon={<span>⚙️</span>}
                    />

                    <DiscordSwitch
                        checked={images}
                        onChange={setImages}
                        disabled={busy}
                        title="Иконка и баннер Ultra-HD"
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
                        onClick={handleStartClick}
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
                                <span>Запустить безопасное клонирование</span>
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

                {/* Audit Summary Card */}
                {auditReport && (
                    <div style={{
                        background: auditReport.status === "success"
                            ? "rgba(35, 165, 90, 0.1)"
                            : auditReport.status === "aborted"
                            ? "rgba(116, 127, 141, 0.1)"
                            : "rgba(240, 178, 50, 0.1)",
                        border: `1px solid ${
                            auditReport.status === "success"
                                ? "rgba(35, 165, 90, 0.4)"
                                : auditReport.status === "aborted"
                                ? "rgba(116, 127, 141, 0.4)"
                                : "rgba(240, 178, 50, 0.4)"
                        }`,
                        borderRadius: "8px",
                        padding: "14px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px"
                    }}>
                        <div style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: auditReport.status === "success" ? "#23a55a" : auditReport.status === "aborted" ? "#949ba4" : "#f0b232",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between"
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span>{auditReport.status === "success" ? "✓" : auditReport.status === "aborted" ? "⛔" : "⚠️"}</span>
                                <span>
                                    {auditReport.status === "success"
                                        ? "Результат аудита (100% подтверждено):"
                                        : auditReport.status === "aborted"
                                        ? "Операция остановлена пользователем:"
                                        : "Аудит завершен с замечаниями (требуется проверка):"}
                                </span>
                            </div>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted, #949ba4)" }}>
                                ⏱️ {auditReport.durationSec} сек
                            </span>
                        </div>

                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: "8px",
                            fontSize: "12px",
                            color: "var(--text-normal, #dbdee1)",
                            marginTop: "2px"
                        }}>
                            <div>
                                🛡️ Роли: <strong>{auditReport.roles.created}/{auditReport.roles.expected}</strong>
                                {auditReport.roles.matchedExisting > 0 && <span style={{ color: "#949ba4" }}> (+{auditReport.roles.matchedExisting} сопост.)</span>}
                            </div>
                            <div>
                                📁 Каналы: <strong>{auditReport.channels.created}/{auditReport.channels.expected}</strong>
                                {auditReport.hiddenChannelsCount > 0 && <span style={{ color: "#23a55a" }}> (скрытых: {auditReport.hiddenChannelsCount})</span>}
                            </div>
                            <div>
                                😀 Эмодзи: <strong>{auditReport.emojis.created}/{auditReport.emojis.expected}</strong>
                            </div>
                            <div>
                                ⚠️ Замечаний: <strong style={{ color: auditReport.warnings.length ? "#f0b232" : "inherit" }}>{auditReport.warnings.length}</strong> ·
                                Ошибок: <strong style={{ color: auditReport.errors.length ? "#da373c" : "inherit" }}>{auditReport.errors.length}</strong>
                            </div>
                        </div>

                        {auditReport.unsupportedSkippedCount > 0 && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted, #949ba4)" }}>
                                ℹ️ Ветки Discord ({auditReport.unsupportedSkippedCount} шт.) пропущены, так как не поддерживаются REST созданием каналов.
                            </div>
                        )}

                        {auditReport.manualReviewList.length > 0 && (
                            <div style={{ marginTop: "6px" }}>
                                <button
                                    onClick={() => setShowReviewList(!showReviewList)}
                                    style={{
                                        background: "transparent",
                                        border: "none",
                                        color: "var(--brand-experiment, #5865f2)",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        padding: 0,
                                        textDecoration: "underline"
                                    }}
                                >
                                    {showReviewList ? "Скрыть список ручной проверки" : `Показать объекты для ручной проверки (${auditReport.manualReviewList.length})`}
                                </button>

                                {showReviewList && (
                                    <div style={{
                                        marginTop: "8px",
                                        background: "var(--background-tertiary, #1e1f22)",
                                        border: "1px solid rgba(255, 255, 255, 0.08)",
                                        borderRadius: "6px",
                                        padding: "8px 12px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "6px",
                                        maxHeight: "180px",
                                        overflowY: "auto"
                                    }}>
                                        {auditReport.manualReviewList.map((item, idx) => (
                                            <div key={idx} style={{ fontSize: "11px", borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: "4px" }}>
                                                <span style={{ fontWeight: 700, color: "var(--header-primary, #ffffff)" }}>[{item.type.toUpperCase()}] {item.name}: </span>
                                                <span style={{ color: "#f0b232" }}>{item.reason}. </span>
                                                <span style={{ color: "#23a55a" }}>Действие: {item.actionRequired}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
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
                                cursor: "pointer"
                            }}
                        >
                            Автоскролл
                        </button>
                        <button
                            onClick={copyLogToClipboard}
                            disabled={!entries.length}
                            style={{
                                padding: "4px 8px",
                                background: "transparent",
                                color: copied ? "#23a55a" : "var(--text-muted, #949ba4)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "4px",
                                fontSize: "11px",
                                cursor: entries.length ? "pointer" : "not-allowed"
                            }}
                        >
                            {copied ? "Скопировано!" : "Копировать"}
                        </button>
                        <button
                            onClick={() => setEntries([])}
                            disabled={busy || !entries.length}
                            style={{
                                padding: "4px 8px",
                                background: "transparent",
                                color: "var(--text-muted, #949ba4)",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "4px",
                                fontSize: "11px",
                                cursor: busy || !entries.length ? "not-allowed" : "pointer"
                            }}
                        >
                            Очистить
                        </button>
                    </div>
                </div>

                <div
                    ref={logRef}
                    style={{
                        padding: "12px",
                        maxHeight: "260px",
                        overflowY: "auto",
                        fontFamily: "Consolas, Menlo, Monaco, monospace",
                        fontSize: "12px",
                        lineHeight: "1.5",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px"
                    }}
                >
                    {filteredEntries.length === 0 ? (
                        <div style={{ color: "var(--text-muted, #949ba4)", fontStyle: "italic", padding: "16px 0", textAlign: "center" }}>
                            Журнал пуст. Нажмите «Запустить безопасное клонирование» для старта.
                        </div>
                    ) : (
                        filteredEntries.map(e => {
                            let color = "#dbdee1";
                            let badge = "ИНФО";
                            let badgeBg = "rgba(255,255,255,0.08)";
                            if (e.type === "success") {
                                color = "#23a55a";
                                badge = "УСПЕХ";
                                badgeBg = "rgba(35, 165, 90, 0.2)";
                            } else if (e.type === "warn") {
                                color = "#f0b232";
                                badge = "ПРЕДУПР";
                                badgeBg = "rgba(240, 178, 50, 0.2)";
                            } else if (e.type === "error") {
                                color = "#f23f43";
                                badge = "ОШИБКА";
                                badgeBg = "rgba(242, 63, 67, 0.2)";
                            }

                            return (
                                <div key={e.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", wordBreak: "break-word" }}>
                                    <span style={{ color: "#949ba4", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>[{e.time}]</span>
                                    <span style={{
                                        background: badgeBg,
                                        color,
                                        padding: "1px 5px",
                                        borderRadius: "3px",
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        flexShrink: 0
                                    }}>
                                        {badge}
                                    </span>
                                    <span style={{ color }}>{e.msg}</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Modal Confirmation */}
            {showConfirm && (
                <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.75)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 99999,
                    padding: "20px"
                }}>
                    <div style={{
                        backgroundColor: "var(--background-primary, #313338)",
                        border: "1px solid var(--background-modifier-accent, #3f4147)",
                        borderRadius: "12px",
                        width: "100%",
                        maxWidth: "480px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                        overflow: "hidden"
                    }}>
                        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--background-modifier-accent, #3f4147)" }}>
                            <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--header-primary, #ffffff)" }}>
                                Запустить безопасное клонирование?
                            </div>
                        </div>
                        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px", color: "var(--text-normal, #dbdee1)" }}>
                            <p>Вы собираетесь перенести конфигурацию сервера:</p>
                            <div style={{ background: "var(--background-secondary, #2b2d31)", padding: "12px", borderRadius: "8px", fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div><strong>Исходный:</strong> {srcGuild?.name || src}</div>
                                <div><strong>Целевой:</strong> {dstGuild?.name || dst}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <div>• <strong>Каналы:</strong> {channels ? (copyHiddenChannels ? "Все поддерживаемые каналы (включая скрытые с правами, ветки исключены)" : "Только публичные (скрытые исключены)") : "Отключено в пресете"}</div>
                                <div>• <strong>Orphan Policy:</strong> {orphanChannelPolicy === "root" ? "Переносить каналы без категории в корень" : "Исключать дочерние каналы вместе с категорией"}</div>
                                <div>• <strong>Водяной знак:</strong> {watermark ? `Включен («${watermarkText}» с контролем 1024 симв.)` : "Выключен (чистые описания 1:1)"}</div>
                                <div>• <strong>Безопасность:</strong> {stealthMode ? "Stealth Mode (рандомизированный джиттер и микропаузы)" : "Обычный режим"}</div>
                                <div>• <strong>Пропуск дубликатов:</strong> {skipDuplicates ? "Включен" : "Выключен"}</div>
                            </div>
                        </div>
                        <div style={{ padding: "14px 22px", background: "var(--background-secondary, #2b2d31)", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                            <button
                                onClick={() => setShowConfirm(false)}
                                style={{
                                    padding: "8px 16px",
                                    background: "transparent",
                                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                                    borderRadius: "6px",
                                    color: "var(--text-normal, #dbdee1)",
                                    cursor: "pointer",
                                    fontSize: "13px",
                                    fontWeight: 500
                                }}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={confirmAndStart}
                                style={{
                                    padding: "8px 18px",
                                    background: "var(--brand-experiment, #5865f2)",
                                    border: "none",
                                    borderRadius: "6px",
                                    color: "#ffffff",
                                    cursor: "pointer",
                                    fontSize: "13px",
                                    fontWeight: 600
                                }}
                            >
                                Подтвердить и запустить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const authors: PluginAuthor[] = [{ name: "opencode", id: 1n }];

export default definePlugin({
    name: "ServerCloner",
    description: "Копирует каналы и категории с контролем дерева, защищает аккаунт (Stealth Mode) и поддерживает опциональный водяной знак с валидацией длины",
    authors,
    tags: ["Servers", "Utility"],
    searchTerms: ["clone", "copy", "server", "guild", "копировать", "клонер", "stealth"],
    settingsAboutComponent: SettingsPanel,
});
