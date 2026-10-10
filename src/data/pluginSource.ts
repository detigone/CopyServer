export const VENCORD_INDEX_TSX = `/**
 * ServerCloner — userplugin for Vencord
 * Копирует сервер 1:1: роли + права, каналы + overwrites, настройки, иконка/баннер, эмодзи.
 * Работает через внутренний RestAPI клиента, права на исходном сервере не нужны (только доступ к просмотру).
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
}

type LogFn = (msg: string, type?: "info" | "success" | "warn" | "error") => void;
type ProgressFn = (step: string, percent: number) => void;

function errMsg(e: any): string {
    try {
        if (e?.body) return JSON.stringify(e.body).slice(0, 250);
    } catch { /* ignore */ }
    return String(e?.message ?? e?.text ?? e);
}

async function apiGet(url: string) {
    return (await RestAPI.get({ url })).body;
}

async function apiPost(url: string, body?: any) {
    return (await RestAPI.post({ url, body })).body;
}

async function apiPatch(url: string, body?: any) {
    return (await RestAPI.patch({ url, body })).body;
}

async function cdnDataUrl(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(\`CDN \${res.status}\`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Не удалось прочитать изображение"));
        reader.readAsDataURL(blob);
    });
}

async function copyRoles(cfg: CopyCfg, roleMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Чтение ролей исходного сервера...", 10);
    const roles = await apiGet(\`/guilds/\${cfg.src}/roles\`);
    const everyone = roles.find((r: any) => r.id === cfg.src);
    const others = roles
        .filter((r: any) => r.id !== cfg.src)
        .sort((a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

    roleMap.set(cfg.src, cfg.dst);
    await apiPatch(\`/guilds/\${cfg.dst}/roles/\${cfg.dst}\`, {
        permissions: everyone?.permissions ?? "0"
    });
    log("Роль @everyone: базовые разрешения скопированы", "success");
    await sleep(300);

    let idx = 0;
    for (const r of others) {
        idx++;
        onProgress?.(\`Создание ролей (\${idx}/\${others.length}): \${r.name}\`, Math.round(10 + (idx / others.length) * 20));
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
            created = await apiPost(\`/guilds/\${cfg.dst}/roles\`, body);
        } catch (e) {
            try {
                const alt = { ...body };
                delete alt.color;
                if (r.color) alt.colors = { primary_color: r.color };
                created = await apiPost(\`/guilds/\${cfg.dst}/roles\`, alt);
            } catch (e2) {
                log(\`Роль «\${r.name}» не создана: \${errMsg(e2)}\`, "error");
                continue;
            }
        }
        roleMap.set(r.id, created.id);
        log(\`Роль: \${r.name}\`, "info");
        await sleep(300);
    }

    const positions: any[] = [{ id: cfg.dst, position: 0 }];
    others.forEach((r: any, i: number) => {
        const nid = roleMap.get(r.id);
        if (nid) positions.push({ id: nid, position: i + 1 });
    });
    try {
        await apiPatch(\`/guilds/\${cfg.dst}/roles\`, positions);
        log("Порядок и иерархия ролей успешно выставлены", "success");
    } catch (e) {
        log(\`Порядок ролей не выставлен: \${errMsg(e)}\`, "warn");
    }
}

async function copyEmojis(cfg: CopyCfg, emojiMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Чтение эмодзи...", 32);
    const emojis = await apiGet(\`/guilds/\${cfg.src}/emojis\`);
    if (!Array.isArray(emojis) || !emojis.length) {
        log("Пользовательские эмодзи на сервере отсутствуют", "info");
        return;
    }
    let idx = 0;
    for (const e of emojis) {
        idx++;
        onProgress?.(\`Загрузка эмодзи (\${idx}/\${emojis.length}): :\${e.name}:\`, Math.round(32 + (idx / emojis.length) * 20));
        try {
            const ext = e.animated ? "gif" : "png";
            const res = await fetch(
                \`https://cdn.discordapp.com/emojis/\${e.id}.\${ext}?size=128&quality=lossless\`
            );
            if (!res.ok) throw new Error(\`CDN \${res.status}\`);
            const blob = await res.blob();
            const fd = new FormData();
            fd.append("name", e.name);
            fd.append("image", blob, \`\${e.name}.\${ext}\`);
            const created = await apiPost(\`/guilds/\${cfg.dst}/emojis\`, fd);
            if (created?.id) emojiMap.set(e.id, created.id);
            log(\`Эмодзи скопировано: :\${e.name}:\`, "success");
        } catch (err) {
            log(\`Эмодзи «\${e.name}» не скопировано: \${errMsg(err)}\`, "warn");
        }
        await sleep(300);
    }
}

function channelBody(ch: any, idMap: Map<string, string>, roleMap: Map<string, string>, emojiMap: Map<string, string>, allowUserOW: boolean): any {
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

async function copyChannels(
    cfg: CopyCfg,
    idMap: Map<string, string>,
    roleMap: Map<string, string>,
    emojiMap: Map<string, string>,
    log: LogFn,
    onProgress?: ProgressFn
) {
    onProgress?.("Анализ структуры каналов и категорий...", 55);
    const channels = await apiGet(\`/guilds/\${cfg.src}/channels\`);
    const usable = channels.filter((c: any) => ![6, 10, 11, 12].includes(c.type));
    const byPos = (a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id));
    const cats = usable.filter((c: any) => c.type === 4).sort(byPos);
    const catPos = new Map<string, number>(cats.map((c: any) => [c.id as string, c.position as number]));
    const others = usable
        .filter((c: any) => c.type !== 4)
        .sort((a: any, b: any) => {
            const pa = a.parent_id != null ? catPos.get(a.parent_id) ?? 0 : -1;
            const pb = b.parent_id != null ? catPos.get(b.parent_id) ?? 0 : -1;
            return pa - pb || byPos(a, b);
        });
    const order = [...cats, ...others];

    let position = 1;
    let idx = 0;
    for (const ch of order) {
        idx++;
        onProgress?.(\`Создание каналов (\${idx}/\${order.length}): \${ch.name}\`, Math.round(55 + (idx / order.length) * 30));
        const full = channelBody(ch, idMap, roleMap, emojiMap, cfg.userOW);
        full.position = position++;
        let created: any = null;
        try {
            created = await apiPost(\`/guilds/\${cfg.dst}/channels\`, full);
        } catch (e) {
            try {
                const minimal: any = { name: ch.name, type: ch.type, position: full.position };
                if (full.parent_id) minimal.parent_id = full.parent_id;
                if (full.permission_overwrites)
                    minimal.permission_overwrites = full.permission_overwrites;
                created = await apiPost(\`/guilds/\${cfg.dst}/channels\`, minimal);
            } catch (e2) {
                log(\`Канал «\${ch.name}» не создан: \${errMsg(e2)}\`, "error");
                continue;
            }
        }
        idMap.set(ch.id, created.id);
        log(\`[\${CHANNEL_TYPES[ch.type] ?? "Канал"}] \${ch.name}\`, "info");
        await sleep(250);
    }
    log(\`Всего создано каналов: \${idMap.size}\`, "success");
}

async function copySettings(cfg: CopyCfg, idMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Копирование метаданных и настроек сервера...", 88);
    const g = await apiGet(\`/guilds/\${cfg.src}\`);
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
        onProgress?.("Загрузка иконки и баннера сервера...", 92);
        try {
            if (g.icon) {
                const ext = g.icon.startsWith("a_") ? "gif" : "png";
                patch.icon = await cdnDataUrl(
                    \`https://cdn.discordapp.com/icons/\${cfg.src}/\${g.icon}.\${ext}?size=4096\`
                );
                log("Иконка сервера скачана в максимальном разрешении", "success");
            }
            if (g.banner) {
                const ext = g.banner.startsWith("a_") ? "gif" : "png";
                patch.banner = await cdnDataUrl(
                    \`https://cdn.discordapp.com/banners/\${cfg.src}/\${g.banner}.\${ext}?size=4096\`
                );
                log("Баннер сервера скачан в максимальном разрешении", "success");
            }
        } catch (e) {
            log(\`Иконка/баннер не скачаны: \${errMsg(e)}\`, "warn");
            delete patch.icon;
            delete patch.banner;
        }
    }

    try {
        await apiPatch(\`/guilds/\${cfg.dst}\`, patch);
        log(\`Настройки сервера применены («\${g.name}»)\`, "success");
    } catch (e) {
        delete patch.icon;
        delete patch.banner;
        await apiPatch(\`/guilds/\${cfg.dst}\`, patch);
        log(\`Настройки скопированы без иконки/баннера: \${errMsg(e)}\`, "warn");
    }
}

async function runCopy(cfg: CopyCfg, log: LogFn, onProgress: ProgressFn) {
    const started = Date.now();
    const idMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    const emojiMap = new Map<string, string>();
    try {
        onProgress("Инициализация копирования...", 5);
        log(\`Запуск клонирования: \${cfg.src} ➔ \${cfg.dst}\`, "info");

        if (cfg.roles) await copyRoles(cfg, roleMap, log, onProgress);
        if (cfg.emojis) await copyEmojis(cfg, emojiMap, log, onProgress);
        if (cfg.channels) await copyChannels(cfg, idMap, roleMap, emojiMap, log, onProgress);
        if (cfg.settings) await copySettings(cfg, idMap, log, onProgress);

        onProgress("Завершено успешно!", 100);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        log(\`Клонирование успешно завершено за \${secs} сек.\`, "success");
        showToast("Сервер успешно скопирован!", "success");
    } catch (e) {
        log(\`КРИТИЧЕСКАЯ ОШИБКА: \${errMsg(e)}\`, "error");
        showToast("Ошибка копирования. Подробности в логе.", "failure");
    }
}

// ... UI Component SettingsPanel with DiscordSwitch, Presets, Progress Bar and Terminal ...
`;

export const BETTERDISCORD_JS = `/**
 * @name ServerCloner
 * @author opencode
 * @description Копирует сервер 1:1 (роли + права, каналы + overwrites, настройки, иконка/баннер, эмодзи) через внутренний Rest API Discord. Работает без прав администратора на исходном сервере.
 * @version 1.2.0
 */

// ... Includes injected styles, Discord switches, server selectors, animated progress and console ...
`;
