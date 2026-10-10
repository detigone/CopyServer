/**
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
    if (!res.ok) throw new Error(`CDN ${res.status}`);
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
    const roles = await apiGet(`/guilds/${cfg.src}/roles`);
    const everyone = roles.find((r: any) => r.id === cfg.src);
    const others = roles
        .filter((r: any) => r.id !== cfg.src)
        .sort((a: any, b: any) => a.position - b.position || String(a.id).localeCompare(String(b.id)));

    roleMap.set(cfg.src, cfg.dst);
    await apiPatch(`/guilds/${cfg.dst}/roles/${cfg.dst}`, {
        permissions: everyone?.permissions ?? "0"
    });
    log("Роль @everyone: базовые разрешения скопированы", "success");
    await sleep(300);

    let idx = 0;
    for (const r of others) {
        idx++;
        onProgress?.(`Создание ролей (${idx}/${others.length}): ${r.name}`, Math.round(10 + (idx / others.length) * 20));
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
            created = await apiPost(`/guilds/${cfg.dst}/roles`, body);
        } catch (e) {
            try {
                const alt = { ...body };
                delete alt.color;
                if (r.color) alt.colors = { primary_color: r.color };
                created = await apiPost(`/guilds/${cfg.dst}/roles`, alt);
            } catch (e2) {
                log(`Роль «${r.name}» не создана: ${errMsg(e2)}`, "error");
                continue;
            }
        }
        roleMap.set(r.id, created.id);
        log(`Роль: ${r.name}`, "info");
        await sleep(300);
    }

    const positions: any[] = [{ id: cfg.dst, position: 0 }];
    others.forEach((r: any, i: number) => {
        const nid = roleMap.get(r.id);
        if (nid) positions.push({ id: nid, position: i + 1 });
    });
    try {
        await apiPatch(`/guilds/${cfg.dst}/roles`, positions);
        log("Порядок и иерархия ролей успешно выставлены", "success");
    } catch (e) {
        log(`Порядок ролей не выставлен: ${errMsg(e)}`, "warn");
    }
}

async function copyEmojis(cfg: CopyCfg, emojiMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Чтение эмодзи...", 32);
    const emojis = await apiGet(`/guilds/${cfg.src}/emojis`);
    if (!Array.isArray(emojis) || !emojis.length) {
        log("Пользовательские эмодзи на сервере отсутствуют", "info");
        return;
    }
    let idx = 0;
    for (const e of emojis) {
        idx++;
        onProgress?.(`Загрузка эмодзи (${idx}/${emojis.length}): :${e.name}:`, Math.round(32 + (idx / emojis.length) * 20));
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
            const created = await apiPost(`/guilds/${cfg.dst}/emojis`, fd);
            if (created?.id) emojiMap.set(e.id, created.id);
            log(`Эмодзи скопировано: :${e.name}:`, "success");
        } catch (err) {
            log(`Эмодзи «${e.name}» не скопировано: ${errMsg(err)}`, "warn");
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
    const channels = await apiGet(`/guilds/${cfg.src}/channels`);
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
        onProgress?.(`Создание каналов (${idx}/${order.length}): ${ch.name}`, Math.round(55 + (idx / order.length) * 30));
        const full = channelBody(ch, idMap, roleMap, emojiMap, cfg.userOW);
        full.position = position++;
        let created: any = null;
        try {
            created = await apiPost(`/guilds/${cfg.dst}/channels`, full);
        } catch (e) {
            try {
                const minimal: any = { name: ch.name, type: ch.type, position: full.position };
                if (full.parent_id) minimal.parent_id = full.parent_id;
                if (full.permission_overwrites)
                    minimal.permission_overwrites = full.permission_overwrites;
                created = await apiPost(`/guilds/${cfg.dst}/channels`, minimal);
            } catch (e2) {
                log(`Канал «${ch.name}» не создан: ${errMsg(e2)}`, "error");
                continue;
            }
        }
        idMap.set(ch.id, created.id);
        log(`[${CHANNEL_TYPES[ch.type] ?? "Канал"}] ${ch.name}`, "info");
        await sleep(250);
    }
    log(`Всего создано каналов: ${idMap.size}`, "success");
}

async function copySettings(cfg: CopyCfg, idMap: Map<string, string>, log: LogFn, onProgress?: ProgressFn) {
    onProgress?.("Копирование метаданных и настроек сервера...", 88);
    const g = await apiGet(`/guilds/${cfg.src}`);
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
                    `https://cdn.discordapp.com/icons/${cfg.src}/${g.icon}.${ext}?size=4096`
                );
                log("Иконка сервера скачана в максимальном разрешении", "success");
            }
            if (g.banner) {
                const ext = g.banner.startsWith("a_") ? "gif" : "png";
                patch.banner = await cdnDataUrl(
                    `https://cdn.discordapp.com/banners/${cfg.src}/${g.banner}.${ext}?size=4096`
                );
                log("Баннер сервера скачан в максимальном разрешении", "success");
            }
        } catch (e) {
            log(`Иконка/баннер не скачаны: ${errMsg(e)}`, "warn");
            delete patch.icon;
            delete patch.banner;
        }
    }

    try {
        await apiPatch(`/guilds/${cfg.dst}`, patch);
        log(`Настройки сервера применены («${g.name}»)`, "success");
    } catch (e) {
        delete patch.icon;
        delete patch.banner;
        await apiPatch(`/guilds/${cfg.dst}`, patch);
        log(`Настройки скопированы без иконки/баннера: ${errMsg(e)}`, "warn");
    }
}

async function runCopy(cfg: CopyCfg, log: LogFn, onProgress: ProgressFn) {
    const started = Date.now();
    const idMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    const emojiMap = new Map<string, string>();
    try {
        onProgress("Инициализация копирования...", 5);
        log(`Запуск клонирования: ${cfg.src} ➔ ${cfg.dst}`, "info");

        if (cfg.roles) await copyRoles(cfg, roleMap, log, onProgress);
        if (cfg.emojis) await copyEmojis(cfg, emojiMap, log, onProgress);
        if (cfg.channels) await copyChannels(cfg, idMap, roleMap, emojiMap, log, onProgress);
        if (cfg.settings) await copySettings(cfg, idMap, log, onProgress);

        onProgress("Завершено успешно!", 100);
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        log(`Клонирование успешно завершено за ${secs} сек.`, "success");
        showToast("Сервер успешно скопирован!", "success");
    } catch (e) {
        log(`КРИТИЧЕСКАЯ ОШИБКА: ${errMsg(e)}`, "error");
        showToast("Ошибка копирования. Подробности в логе.", "failure");
    }
}

interface LogEntry {
    id: string;
    time: string;
    msg: string;
    type: "info" | "success" | "warn" | "error";
}

/* Discord-Style Switch Toggle Component */
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

            {/* Custom Track & Thumb */}
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

    const [busy, setBusy] = useState(false);
    const [progressStep, setProgressStep] = useState("");
    const [progressPercent, setProgressPercent] = useState(0);

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

        setBusy(true);
        setEntries([]);
        setProgressPercent(0);
        setProgressStep("Подготовка...");

        runCopy({ src, dst, roles, channels, emojis, settings, images, userOW }, log, onProgress)
            .finally(() => setBusy(false));
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
                background: "linear-gradient(135deg, rgba(88, 101, 242, 0.12) 0%, rgba(35, 165, 90, 0.08) 100%)",
                border: "1px solid rgba(88, 101, 242, 0.25)",
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
                            letterSpacing: "0.5px"
                        }}>
                            VENCORD
                        </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted, #949ba4)", marginTop: "4px" }}>
                        Копирует роли, каналы, права, эмодзи и дизайн сервера без прав администратора на источнике.
                    </div>
                </div>

                {/* Preset Controls */}
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
                {/* Source Server */}
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

                {/* Target Server */}
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
                    Параметры клонирования
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "8px" }}>
                    <DiscordSwitch
                        checked={roles}
                        onChange={setRoles}
                        disabled={busy}
                        title="Роли и права доступа"
                        subtitle="Иерархия, цвета, @everyone, hoist, mentionable и точные права"
                        icon={<span>🛡️</span>}
                    />

                    <DiscordSwitch
                        checked={channels}
                        onChange={setChannels}
                        disabled={busy}
                        title="Каналы и категории"
                        subtitle="Текстовые, голосовые, форумы, битрейт, slowmode и права доступа"
                        icon={<span>📁</span>}
                    />

                    <DiscordSwitch
                        checked={emojis}
                        onChange={setEmojis}
                        disabled={busy}
                        title="Пользовательские эмодзи"
                        subtitle="Статичные (.png) и анимированные (.gif) эмодзи в оригинальном качестве"
                        icon={<span>😀</span>}
                    />

                    <DiscordSwitch
                        checked={settings}
                        onChange={setSettings}
                        disabled={busy}
                        title="Основные настройки"
                        subtitle="Название, верификация, AFK-таймаут, системные и правила-каналы"
                        icon={<span>⚙️</span>}
                    />

                    <DiscordSwitch
                        checked={images}
                        onChange={setImages}
                        disabled={busy}
                        title="Иконка и баннер"
                        subtitle="Скачивание и установка аватара и баннера в максимальном разрешении"
                        icon={<span>🎨</span>}
                    />

                    <DiscordSwitch
                        checked={userOW}
                        onChange={setUserOW}
                        disabled={busy}
                        title="Индивидуальные права пользователей"
                        subtitle="Перенос персональных overwrites конкретных юзеров (занимает больше времени)"
                        icon={<span>👤</span>}
                    />
                </div>
            </div>

            {/* Action Button & Progress */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button
                    onClick={onCopy}
                    disabled={busy}
                    style={{
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
                    onMouseEnter={e => {
                        if (!busy) e.currentTarget.style.background = "var(--brand-experiment-560, #4752c4)";
                    }}
                    onMouseLeave={e => {
                        if (!busy) e.currentTarget.style.background = "var(--brand-experiment, #5865f2)";
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
                            <span>Запустить клонирование</span>
                        </>
                    )}
                </button>

                {/* Progress Bar (Visible when busy or progress > 0) */}
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
                {/* Log Header */}
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

                {/* Log Lines Container */}
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
                            Здесь будут отображаться шаги клонирования серверов. Выберите серверы и нажмите «Запустить клонирование».
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
    description: "Копирует сервер 1:1: роли, права, каналы, настройки, иконку/баннер, эмодзи",
    authors,
    tags: ["Servers", "Utility"],
    searchTerms: ["clone", "copy", "server", "guild", "копировать", "клонер"],
    settingsAboutComponent: SettingsPanel,
});
