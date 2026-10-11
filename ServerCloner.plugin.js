/**
 * @name ServerCloner
 * @author opencode
 * @description Копирует структуру сервера 1:1: роли + права, категории + каналы + overwrites (включая скрытые и приватные), настройки сервера, иконка/баннер, эмодзи.
 * @version 1.2.0
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function humanJitter(baseMs, varianceMs = 300) {
    return baseMs + Math.floor(Math.random() * varianceMs);
}

function sanitizeLogText(text) {
    if (!text) return "";
    return String(text).replace(/[a-zA-Z0-9_-]{24}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g, "[TOKEN_PROTECTED]");
}

const SUPPORTED_CHANNEL_TYPES = {
    0: { name: "Текст (GUILD_TEXT)", canClone: true, note: "Название, тема, права, slowmode, nsfw" },
    2: { name: "Голос (GUILD_VOICE)", canClone: true, note: "Битрейт, лимит участников, rtc_region, права" },
    4: { name: "Категория (GUILD_CATEGORY)", canClone: true, note: "Иерархия, позиция, категорийные права" },
    5: { name: "Анонсы (GUILD_ANNOUNCEMENT)", canClone: true, note: "Новостной канал, топик, права" },
    13: { name: "Трибуна (GUILD_STAGE_VOICE)", canClone: true, note: "Сцена, топик, лимит пользователей, права" },
    15: { name: "Форум (GUILD_FORUM)", canClone: true, note: "Теги форума, дефолтные реакции, сортировка, права" },
    16: { name: "Медиа (GUILD_MEDIA)", canClone: true, note: "Медиа-канал, теги, права" },
};

const UNSUPPORTED_CHANNEL_TYPES = {
    6: { name: "Магазин (GUILD_STORE)", reason: "Устаревший тип каналов Discord (deprecated)" },
    10: { name: "Ветка анонсов (GUILD_NEWS_THREAD)", reason: "Ветки привязаны к сообщениям и не переносятся через REST" },
    11: { name: "Публичная ветка (GUILD_PUBLIC_THREAD)", reason: "Ветки требуют активного стартового сообщения" },
    12: { name: "Приватная ветка (GUILD_PRIVATE_THREAD)", reason: "Приватные ветки не подлежат прямому копированию REST" },
};

const PLUGIN_STYLES = `
.sc-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--text-normal, #dbdee1);
    font-family: var(--font-primary, sans-serif);
    padding: 8px 4px;
}
.sc-header-card {
    background: linear-gradient(135deg, rgba(88, 101, 242, 0.15) 0%, rgba(35, 165, 90, 0.1) 100%);
    border: 1px solid rgba(88, 101, 242, 0.3);
    border-radius: 10px;
    padding: 16px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}
.sc-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--header-primary, #ffffff);
    display: flex;
    align-items: center;
    gap: 8px;
}
.sc-badge {
    font-size: 11px;
    font-weight: 600;
    background: var(--brand-experiment, #5865f2);
    color: #fff;
    padding: 2px 8px;
    border-radius: 12px;
}
.sc-badge-safe {
    font-size: 11px;
    font-weight: 600;
    background: rgba(35, 165, 90, 0.2);
    color: #23a55a;
    padding: 2px 8px;
    border-radius: 12px;
    border: 1px solid rgba(35, 165, 90, 0.3);
}
.sc-subtitle {
    font-size: 12px;
    color: var(--text-muted, #949ba4);
    margin-top: 4px;
}
.sc-presets {
    display: flex;
    gap: 6px;
}
.sc-preset-btn {
    padding: 6px 12px;
    background: rgba(88, 101, 242, 0.15);
    border: 1px solid rgba(88, 101, 242, 0.3);
    border-radius: 6px;
    color: var(--brand-experiment, #5865f2);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
}
.sc-preset-btn:hover {
    background: var(--brand-experiment, #5865f2);
    color: #ffffff;
}
.sc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    background: var(--background-secondary, #2b2d31);
    padding: 14px;
    border-radius: 10px;
}
.sc-field-label {
    display: block;
    font-size: 12px;
    font-weight: 700;
    color: var(--header-secondary, #b5bac1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}
.sc-select {
    width: 100%;
    padding: 10px 12px;
    background: var(--input-background, #1e1f22);
    border: 1px solid var(--background-modifier-accent, #3f4147);
    border-radius: 6px;
    color: var(--text-normal, #dbdee1);
    font-size: 13px;
    cursor: pointer;
}
.sc-special-box {
    background: var(--background-secondary, #2b2d31);
    border: 1px solid rgba(88, 101, 242, 0.25);
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.sc-watermark-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--background-tertiary, #1e1f22);
    border: 1px solid rgba(88, 101, 242, 0.3);
    padding: 8px 12px;
    border-radius: 6px;
    margin-top: 4px;
}
.sc-watermark-input {
    flex: 1;
    background: var(--input-background, #2b2d31);
    border: 1px solid var(--background-modifier-accent, #3f4147);
    border-radius: 4px;
    color: var(--text-normal, #dbdee1);
    padding: 6px 10px;
    font-size: 12px;
    outline: none;
    font-family: monospace;
}
.sc-watermark-reset-btn {
    background: var(--background-secondary, #2b2d31);
    border: 1px solid var(--background-modifier-accent, #3f4147);
    color: var(--text-muted, #949ba4);
    padding: 5px 10px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}
.sc-watermark-reset-btn:hover {
    color: var(--text-normal, #dbdee1);
    border-color: rgba(255, 255, 255, 0.2);
}
.sc-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 8px;
}
.sc-option-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--background-secondary, #2b2d31);
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05));
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s ease;
}
.sc-option-card:hover {
    background: var(--background-secondary-alt, #232428);
}
.sc-option-info {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding-right: 12px;
}
.sc-option-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    font-size: 18px;
    flex-shrink: 0;
}
.sc-option-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--header-primary, #f2f3f5);
    display: flex;
    align-items: center;
    gap: 6px;
}
.sc-option-desc {
    font-size: 12px;
    color: var(--text-muted, #949ba4);
    margin-top: 2px;
}
.sc-switch {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: #4e5058;
    position: relative;
    flex-shrink: 0;
    transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.sc-switch.active {
    background: var(--status-positive, #23a55a);
}
.sc-switch-slider {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    transition: left 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.sc-switch.active .sc-switch-slider {
    left: 23px;
}
.sc-actions-row {
    display: flex;
    gap: 10px;
}
.sc-btn-primary {
    flex: 1;
    padding: 12px 18px;
    background: var(--brand-experiment, #5865f2);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(88, 101, 242, 0.3);
}
.sc-btn-primary:disabled {
    background: #4e5058;
    cursor: not-allowed;
    box-shadow: none;
}
.sc-btn-abort {
    padding: 12px 18px;
    background: #da373c;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
}
.sc-progress-wrap {
    background: var(--background-secondary, #2b2d31);
    border-radius: 8px;
    padding: 10px 14px;
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
}
.sc-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--background-tertiary, #1e1f22);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 6px;
}
.sc-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #5865f2, #23a55a);
    transition: width 0.25s ease;
}
.sc-audit-box {
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sc-audit-box.success {
    background: rgba(35, 165, 90, 0.1);
    border: 1px solid rgba(35, 165, 90, 0.4);
}
.sc-audit-box.warning {
    background: rgba(240, 178, 50, 0.1);
    border: 1px solid rgba(240, 178, 50, 0.4);
}
.sc-audit-box.aborted {
    background: rgba(116, 127, 141, 0.1);
    border: 1px solid rgba(116, 127, 141, 0.4);
}
.sc-console {
    background: var(--background-tertiary, #1e1f22);
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
    border-radius: 10px;
    overflow: hidden;
}
.sc-console-head {
    padding: 10px 14px;
    background: var(--background-secondary-alt, #232428);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.sc-console-body {
    padding: 12px;
    max-height: 260px;
    overflow-y: auto;
    font-family: Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.sc-log-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    word-break: break-word;
}
.sc-log-time {
    color: #949ba4;
    flex-shrink: 0;
}
.sc-log-tag {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
}
.sc-log-tag.info {
    color: #dbdee1;
    background: rgba(255, 255, 255, 0.08);
}
.sc-log-tag.success {
    color: #3ba55d;
    background: rgba(59, 165, 93, 0.15);
}
.sc-log-tag.warn {
    color: #faa81a;
    background: rgba(250, 168, 26, 0.15);
}
.sc-log-tag.error {
    color: #ed4245;
    background: rgba(237, 66, 69, 0.15);
}
.sc-tool-btn {
    padding: 4px 8px;
    background: transparent;
    color: var(--text-muted, #949ba4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.sc-tool-btn:hover {
    color: var(--text-normal, #dbdee1);
    background: rgba(255, 255, 255, 0.05);
}
`;

module.exports = class ServerCloner {
    constructor() {
        this.aborted = false;
    }

    start() {
        if (typeof BdApi !== "undefined" && BdApi.DOM?.addStyle) {
            BdApi.DOM.addStyle("ServerClonerTheme", PLUGIN_STYLES);
        }
    }

    stop() {
        if (typeof BdApi !== "undefined" && BdApi.DOM?.removeStyle) {
            BdApi.DOM.removeStyle("ServerClonerTheme");
        }
    }

    getToken() {
        const mod = BdApi.Webpack.getModule(
            (m) => typeof m?.getToken === "function" && typeof m?.logout === "function",
            { searchExports: true }
        );
        return mod?.getToken?.();
    }

    async api(method, path, body, isForm = false, log = null) {
        const token = this.getToken();
        if (!token) throw new Error("Не удалось получить токен авторизации Discord");
        const headers = { Authorization: token };
        if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";
        const doFetch = BdApi.Net?.fetch ? BdApi.Net.fetch.bind(BdApi.Net) : window.fetch.bind(window);

        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const res = await doFetch(`https://discord.com/api/v9${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
            });

            // Блокирующие ошибки прав/авторизации — не повторять вслепую
            if (res.status === 401 || res.status === 403) {
                const msg = `[Блокирующая ошибка ${res.status}] Недостаточно прав или недействительный токен (${path})`;
                log?.(msg, "error");
                const err = new Error(msg);
                err.status = res.status;
                throw err;
            }

            if (res.status === 429) {
                const j = await res.json().catch(() => ({}));
                const retryAfter = j.retry_after ?? (Number(res.headers?.get?.("retry-after")) || 2.0);
                const waitMs = Math.ceil(retryAfter * 1000) + humanJitter(600, 400);
                log?.(`[Рейтлимит 429] Ожидание ${Math.round(waitMs / 1000)}с перед повтором...`, "warn");
                await sleep(waitMs);
                continue;
            }

            if (res.status >= 500 && attempt < maxAttempts) {
                const backoff = attempt * 1500 + humanJitter(200, 300);
                log?.(`[Сбой сервера Discord ${res.status}] Повторная попытка ${attempt}/${maxAttempts} через ${backoff}мс...`, "warn");
                await sleep(backoff);
                continue;
            }

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                const safeErr = sanitizeLogText(`${method} ${path} -> ${res.status}: ${text.slice(0, 250)}`);
                const err = new Error(safeErr);
                err.status = res.status;
                throw err;
            }

            if (res.status === 204) return null;
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("application/json")) return res.json();
            return null;
        }
        throw new Error("Слишком много запросов (Rate Limit 429)");
    }

    async cdnDataUrl(url) {
        const res = await window.fetch(url);
        if (!res.ok) throw new Error(`CDN ${res.status}`);
        const blob = await res.blob();
        return await new Promise((ok, err) => {
            const fr = new FileReader();
            fr.onload = () => ok(fr.result);
            fr.onerror = () => err(new Error("Не удалось прочитать изображение"));
            fr.readAsDataURL(blob);
        });
    }

    h(tag, attrs = {}, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === "style") el.style.cssText = v;
            else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (k === "class") el.className = v;
            else el.setAttribute(k, v);
        }
        for (const kid of kids.flat()) {
            if (kid == null) continue;
            el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        }
        return el;
    }

    getSettingsPanel() {
        const GuildStore = BdApi.Webpack.getStore("GuildStore");
        const SelectedGuildStore = BdApi.Webpack.getStore("SelectedGuildStore");
        const guilds = Object.values(GuildStore?.getGuilds?.() ?? {}).sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", "ru")
        );
        const current = SelectedGuildStore?.getGuildId?.();

        const state = {
            src: current || "",
            dst: "",
            roles: true,
            channels: true,
            emojis: true,
            settings: true,
            images: true,
            userOW: false,
            skipDuplicates: true,
            watermark: false,
            watermarkText: "[Клон: ServerCloner Pro]",
            stealthMode: true,
            copyHiddenChannels: true,
            orphanChannelPolicy: "skip",
            busy: false,
            autoScroll: true,
        };

        const root = this.h("div", { class: "sc-container" });

        // Header Card
        const header = this.h(
            "div",
            { class: "sc-header-card" },
            this.h(
                "div",
                {},
                this.h(
                    "div",
                    { class: "sc-title" },
                    this.h("span", {}, "ServerCloner Pro"),
                    this.h("span", { class: "sc-badge" }, "STEALTH MODE"),
                    this.h("span", { class: "sc-badge-safe" }, "v1.2.0")
                ),
                this.h(
                    "div",
                    { class: "sc-subtitle" },
                    "Клонирование структуры 1:1 · Дерево категорий · Orphan Policy · Двухфазная верификация"
                )
            ),
            this.h(
                "div",
                { class: "sc-presets" },
                this.h("button", {
                    class: "sc-preset-btn",
                    onclick: () => applyPreset("all")
                }, "Всё 1:1"),
                this.h("button", {
                    class: "sc-preset-btn",
                    onclick: () => applyPreset("structure")
                }, "Структура"),
                this.h("button", {
                    class: "sc-preset-btn",
                    onclick: () => applyPreset("media")
                }, "Медиа")
            )
        );

        // Server Dropdowns
        const makeGuildSelect = (defVal, onChange) => {
            const sel = this.h("select", { class: "sc-select" });
            sel.append(this.h("option", { value: "" }, "— Выбрать сервер —"));
            for (const g of guilds) {
                const opt = this.h("option", { value: g.id }, g.name);
                if (g.id === defVal) opt.selected = true;
                sel.append(opt);
            }
            sel.addEventListener("change", (e) => onChange(e.target.value));
            return sel;
        };

        const srcSelect = makeGuildSelect(state.src, (val) => (state.src = val));
        const dstSelect = makeGuildSelect(state.dst, (val) => (state.dst = val));

        const serversGrid = this.h(
            "div",
            { class: "sc-grid" },
            this.h("div", {}, this.h("label", { class: "sc-field-label" }, "Исходный сервер"), srcSelect),
            this.h("div", {}, this.h("label", { class: "sc-field-label" }, "Целевой сервер"), dstSelect)
        );

        const optionCards = new Map();
        const createOption = (key, title, desc, icon, defChecked = true) => {
            state[key] = defChecked;
            const card = this.h("div", { class: "sc-option-card" });
            const sw = this.h("div", { class: `sc-switch ${state[key] ? "active" : ""}` }, this.h("div", { class: "sc-switch-slider" }));

            card.append(
                this.h(
                    "div",
                    { class: "sc-option-info" },
                    this.h("div", { class: "sc-option-icon" }, icon),
                    this.h("div", {}, this.h("div", { class: "sc-option-title" }, title), this.h("div", { class: "sc-option-desc" }, desc))
                ),
                sw
            );

            card.onclick = () => {
                if (state.busy) return;
                state[key] = !state[key];
                sw.classList.toggle("active", state[key]);
                if (key === "watermark") {
                    watermarkInputWrap.style.display = state[key] ? "flex" : "none";
                }
            };
            optionCards.set(key, { card, sw });
            return card;
        };

        // Специальный блок: Stealth Mode, Скрытые каналы, Orphan Policy и Водяной знак
        const watermarkInput = this.h("input", {
            class: "sc-watermark-input",
            type: "text",
            value: state.watermarkText,
            placeholder: "Например: [Клон: ServerCloner Pro]",
            oninput: (e) => (state.watermarkText = e.target.value),
        });

        const watermarkResetBtn = this.h("button", {
            class: "sc-watermark-reset-btn",
            onclick: () => {
                state.watermarkText = "[Клон: ServerCloner Pro]";
                watermarkInput.value = state.watermarkText;
            }
        }, "Сброс");

        const watermarkInputWrap = this.h(
            "div",
            {
                class: "sc-watermark-input-wrap",
                style: state.watermark ? "display: flex;" : "display: none;"
            },
            this.h("span", { style: "font-size:12px;color:var(--text-muted);white-space:nowrap;" }, "🏷️ Текст метки:"),
            watermarkInput,
            watermarkResetBtn
        );

        const specialSection = this.h(
            "div",
            { class: "sc-special-box" },
            this.h(
                "div",
                { style: "font-size:12px;font-weight:700;text-transform:uppercase;color:var(--header-primary);display:flex;align-items:center;gap:6px;" },
                this.h("span", {}, "🛡️"),
                this.h("span", {}, "Безопасность аккаунта, скрытые каналы & водяной знак")
            ),
            this.h(
                "div",
                { class: "sc-options-grid" },
                createOption("stealthMode", "Stealth Mode (Снижение риска)", "Рандомизированные задержки (900-1500мс) и микропаузы. Снижает риск детекта антиспамом.", "🔒", true),
                createOption("copyHiddenChannels", "Скрытые каналы (с правами)", "Копировать скрытые админ-каналы и секретные комнаты с их правами доступа (overwrites).", "👁️", true),
                createOption("orphanChannelPolicy", "Режим перемещения сиротских каналов", "Вкл: переносить каналы исключенных категорий в корень. Выкл: пропускать вместе с категорией.", "🌳", false),
                createOption("watermark", "Водяной знак в описании каналов", "Добавлять отметку в topic (с контролем лимита 1024 символа). Выключен по умолчанию.", "🏷️", false)
            ),
            watermarkInputWrap
        );

        const applyPreset = (preset) => {
            if (state.busy) return;
            const updateOpt = (key, val) => {
                state[key] = val;
                const item = optionCards.get(key);
                if (item) item.sw.classList.toggle("active", val);
            };

            if (preset === "all") {
                updateOpt("roles", true);
                updateOpt("channels", true);
                updateOpt("emojis", true);
                updateOpt("settings", true);
                updateOpt("images", true);
                updateOpt("skipDuplicates", true);
                updateOpt("copyHiddenChannels", true);
                updateOpt("orphanChannelPolicy", false);
                BdApi.UI.showToast("Пресет: Полный клон 1:1", { type: "info" });
            } else if (preset === "structure") {
                updateOpt("roles", true);
                updateOpt("channels", true);
                updateOpt("emojis", false);
                updateOpt("settings", false);
                updateOpt("images", false);
                updateOpt("skipDuplicates", true);
                updateOpt("copyHiddenChannels", true);
                updateOpt("orphanChannelPolicy", false);
                BdApi.UI.showToast("Пресет: Структура (роли и каналы)", { type: "info" });
            } else if (preset === "media") {
                updateOpt("roles", false);
                updateOpt("channels", false);
                updateOpt("emojis", true);
                updateOpt("settings", true);
                updateOpt("images", true);
                updateOpt("skipDuplicates", true);
                updateOpt("copyHiddenChannels", false);
                BdApi.UI.showToast("Пресет: Медиа и настройки", { type: "info" });
            }
        };

        const optionsGrid = this.h(
            "div",
            { class: "sc-options-grid" },
            createOption("roles", "Роли и права доступа", "Без системных бот-ролей, с сохранением цветов и точной иерархии", "🛡️", true),
            createOption("channels", "Каналы и категории", "Текстовые, войсы, форумы и категории с точным позиционированием", "📁", true),
            createOption("emojis", "Пользовательские эмодзи", "Lossless CDN перенос с паузами для обхода блокировок", "😀", true),
            createOption("settings", "Основные настройки", "Название, верификация, AFK, системные каналы и оповещения", "⚙️", true),
            createOption("images", "Иконка и баннер", "Ultra-HD 4096px загрузка аватара и баннера сервера", "🎨", true),
            createOption("skipDuplicates", "Пропускать дубликаты", "Не создавать заново уже существующие роли/эмодзи", "⚡", true),
            createOption("userOW", "Индивидуальные права участников", "Переносить персональные права конкретных пользователей на каналы", "👤", false)
        );

        // Progress bar container
        const progressWrap = this.h("div", { class: "sc-progress-wrap", style: "display:none;" });
        const progressLabel = this.h("div", {
            style: "display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:var(--header-primary);"
        });
        const progressText = this.h("span", {}, "Подготовка...");
        const progressPercent = this.h("span", { style: "color:var(--brand-experiment,#5865f2);font-variant-numeric:tabular-nums;" }, "0%");
        progressLabel.append(progressText, progressPercent);

        const progressFill = this.h("div", { class: "sc-progress-fill", style: "width:0%;" });
        const progressBar = this.h("div", { class: "sc-progress-bar" }, progressFill);
        progressWrap.append(progressLabel, progressBar);

        const updateProgress = (step, pct) => {
            progressWrap.style.display = "block";
            progressText.textContent = step;
            progressPercent.textContent = `${pct}%`;
            progressFill.style.width = `${pct}%`;
            if (pct === 100) progressFill.style.background = "var(--status-positive, #23a55a)";
        };

        // Audit Summary Card
        const auditWrap = this.h("div", { class: "sc-audit-box", style: "display:none;" });

        // Console Log
        const logBody = this.h("div", { class: "sc-console-body" });
        const emptyNotice = this.h(
            "div",
            { style: "color:var(--text-muted,#949ba4);font-style:italic;padding:20px 0;text-align:center;" },
            "Журнал готов. Нажмите «Запустить безопасное клонирование»."
        );
        logBody.append(emptyNotice);

        const logs = [];
        const log = (msg, type = "info") => {
            if (logs.length === 0) emptyNotice.remove();
            const time = new Date().toLocaleTimeString([], { hour12: false });
            const sanitized = sanitizeLogText(msg);
            logs.push({ time, type, msg: sanitized });

            const row = this.h(
                "div",
                { class: "sc-log-row" },
                this.h("span", { class: "sc-log-time" }, `[${time}]`),
                this.h("span", { class: `sc-log-tag ${type}` }, type === "success" ? "УСПЕХ" : type === "warn" ? "ПРЕДУПР" : type === "error" ? "ОШИБКА" : "ИНФО"),
                this.h("span", {
                    style: type === "error" ? "color:#ed4245;" : type === "success" ? "color:#3ba55d;" : type === "warn" ? "color:#faa81a;" : "color:var(--text-normal);"
                }, sanitized)
            );
            logBody.append(row);

            if (state.autoScroll) {
                logBody.scrollTop = logBody.scrollHeight;
            }
        };

        const abortBtn = this.h(
            "button",
            {
                class: "sc-btn-abort",
                style: "display:none;",
                onclick: () => {
                    this.aborted = true;
                    log("Запрошена остановка клонирования пользователем...", "warn");
                }
            },
            "Остановить"
        );

        const copyBtn = this.h(
            "button",
            {
                class: "sc-btn-primary",
                onclick: () => {
                    if (!state.src || !state.dst) {
                        return BdApi.UI.showToast("Выберите оба сервера", { type: "error" });
                    }
                    if (state.src === state.dst) {
                        return BdApi.UI.showToast("Серверы должны отличаться", { type: "error" });
                    }
                    if (!state.roles && !state.channels && !state.emojis && !state.settings) {
                        return BdApi.UI.showToast("Выберите хотя бы один пункт для копирования", { type: "error" });
                    }

                    const srcName = guilds.find((g) => g.id === state.src)?.name || state.src;
                    const dstName = guilds.find((g) => g.id === state.dst)?.name || state.dst;

                    const hiddenInfo = state.copyHiddenChannels
                        ? "100% каналов (включая скрытые с правами, ветки исключены)"
                        : "только публичные (скрытые отключены)";
                    const watermarkInfo = state.watermark
                        ? `включен («${state.watermarkText}» с валидацией длины)`
                        : "выключен (описания 1:1)";
                    const stealthInfo = state.stealthMode
                        ? "Stealth Mode (джиттер 900-1500мс и микропаузы)"
                        : "обычный режим";

                    BdApi.UI.showConfirmationModal(
                        "Запустить безопасное клонирование?",
                        `Перенести структуру сервера из «${srcName}» в «${dstName}»?\n\n` +
                        `• Каналы: ${state.channels ? hiddenInfo : "отключено в пресете"}\n` +
                        `• Orphan Policy: ${state.orphanChannelPolicy ? "перенос в корень без родителя" : "исключать вместе с категорией"}\n` +
                        `• Водяной знак: ${watermarkInfo}\n` +
                        `• Безопасность: ${stealthInfo}\n` +
                        `• Защита от дубликатов: ${state.skipDuplicates ? "включена" : "выключена"}\n` +
                        `• Верификация: двухфазная сверка целостности структуры.`,
                        {
                            confirmText: "Клонировать",
                            cancelText: "Отмена",
                            danger: false,
                            onConfirm: async () => {
                                this.aborted = false;
                                state.busy = true;
                                copyBtn.disabled = true;
                                abortBtn.style.display = "block";
                                copyBtn.innerHTML = "<span>⏳</span><span>Клонирование в процессе...</span>";
                                logBody.innerHTML = "";
                                auditWrap.style.display = "none";
                                updateProgress("Pre-flight проверка доступности...", 2);

                                try {
                                    const report = await this.copy(state, log, updateProgress);
                                    if (report) {
                                        auditWrap.style.display = "flex";
                                        const isSuccess = report.status === "success";
                                        const isAborted = report.status === "aborted";
                                        auditWrap.className = `sc-audit-box ${isSuccess ? "success" : isAborted ? "aborted" : "warning"}`;

                                        const statusTitle = isSuccess
                                            ? "✓ Аудит целостности (100% подтверждено):"
                                            : isAborted
                                            ? "⛔ Клонирование остановлено пользователем:"
                                            : "⚠️ Завершено с замечаниями (требуется ручная проверка):";

                                        let reviewListHtml = "";
                                        if (report.manualReviews && report.manualReviews.length > 0) {
                                            reviewListHtml = `
                                                <div style="margin-top:6px;font-size:11px;color:#faa81a;">
                                                    <strong>Требуют ручной проверки (${report.manualReviews.length}):</strong>
                                                    <div style="background:var(--background-tertiary);border-radius:4px;padding:6px;margin-top:4px;max-height:120px;overflow-y:auto;">
                                                        ${report.manualReviews.map(r => `<div>• <strong>[${r.type.toUpperCase()}] ${r.name}:</strong> ${r.reason} (${r.actionRequired})</div>`).join("")}
                                                    </div>
                                                </div>
                                            `;
                                        }

                                        auditWrap.innerHTML = `
                                            <div style="font-weight:700;color:${isSuccess ? "#23a55a" : isAborted ? "#949ba4" : "#faa81a"};">
                                                ${statusTitle}
                                            </div>
                                            <div style="font-size:12px;color:var(--text-normal);">
                                                🛡️ Роли: <strong>${report.roles.created}/${report.roles.expected}</strong> (сопост.: ${report.roles.matchedExisting}) ·
                                                📁 Каналы: <strong>${report.channels.created}/${report.channels.expected}</strong> (скрытых: ${report.hiddenCount}) ·
                                                😀 Эмодзи: <strong>${report.emojis.created}/${report.emojis.expected}</strong> ·
                                                ⏱️ ${report.durationSec} сек
                                            </div>
                                            ${report.unsupportedSkippedCount > 0 ? `<div style="font-size:11px;color:var(--text-muted);">ℹ️ Ветки тредов (${report.unsupportedSkippedCount} шт.) пропущены: не поддерживаются REST созданием каналов.</div>` : ""}
                                            ${reviewListHtml}
                                        `;
                                    }
                                } finally {
                                    state.busy = false;
                                    copyBtn.disabled = false;
                                    abortBtn.style.display = "none";
                                    copyBtn.innerHTML = "<span>🚀</span><span>Запустить безопасное клонирование</span>";
                                }
                            },
                        }
                    );
                },
            },
            this.h("span", {}, "🚀"),
            this.h("span", {}, "Запустить безопасное клонирование")
        );

        const actionsRow = this.h("div", { class: "sc-actions-row" }, copyBtn, abortBtn);

        const consoleHead = this.h(
            "div",
            { class: "sc-console-head" },
            this.h(
                "div",
                { style: "display:flex;align-items:center;gap:8px;" },
                this.h("span", { style: "width:8px;height:8px;border-radius:50%;background:#5865f2;" }),
                this.h("span", { style: "font-size:13px;font-weight:700;color:var(--header-primary);" }, "Журнал операций")
            ),
            this.h(
                "div",
                { style: "display:flex;align-items:center;gap:6px;" },
                this.h("button", {
                    class: "sc-tool-btn",
                    onclick: () => {
                        state.autoScroll = !state.autoScroll;
                        BdApi.UI.showToast(`Автопрокрутка: ${state.autoScroll ? "Вкл" : "Выкл"}`, { type: "info" });
                    }
                }, "Автоскролл"),
                this.h("button", {
                    class: "sc-tool-btn",
                    onclick: () => {
                        if (!logs.length) return;
                        const text = logs.map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.msg}`).join("\n");
                        navigator.clipboard.writeText(text);
                        BdApi.UI.showToast("Лог скопирован в буфер обмена", { type: "success" });
                    }
                }, "Копировать"),
                this.h("button", {
                    class: "sc-tool-btn",
                    onclick: () => {
                        logs.length = 0;
                        logBody.innerHTML = "";
                        logBody.append(emptyNotice);
                    }
                }, "Очистить")
            )
        );

        const consoleBox = this.h("div", { class: "sc-console" }, consoleHead, logBody);

        root.append(
            header,
            serversGrid,
            specialSection,
            optionsGrid,
            actionsRow,
            progressWrap,
            auditWrap,
            consoleBox
        );

        return root;
    }

    async copy(cfg, log, onProgress) {
        const started = Date.now();
        const idMap = new Map();
        const roleMap = new Map();
        const emojiMap = new Map();

        const warnings = [];
        const errors = [];
        const manualReviews = [];

        let rolesRes = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
        let channelsRes = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
        let emojisRes = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
        let hiddenCount = 0;
        let unsupportedSkippedCount = 0;
        let orphanAdjustedCount = 0;

        try {
            onProgress?.("Pre-flight проверка...", 3);
            if (cfg.stealthMode) {
                log("Stealth Mode активен: рандомизированный джиттер и микропаузы для снижения риска детекта антиспамом", "info");
            }
            if (this.aborted) throw new Error("ABORTED");

            // Выполнение Pre-flight проверки прав и доступности целевого сервера
            try {
                const targetGuild = await this.api("GET", `/guilds/${cfg.dst}`, undefined, false, log);
                if (!targetGuild) {
                    const errCritical = "Целевой сервер недоступен или отсутствует доступ (критическая ошибка)";
                    log(errCritical, "error");
                    errors.push(errCritical);
                    throw new Error("PREFLIGHT_FAILED");
                }
            } catch (prefErr) {
                if (prefErr.message === "PREFLIGHT_FAILED" || /401|403|unauthorized|forbidden|недействительный|отсутствует доступ/i.test(prefErr.message)) {
                    const critMsg = `Критическая ошибка доступа Pre-Flight [${prefErr.message}]. Копирование прервано.`;
                    log(critMsg, "error");
                    errors.push(critMsg);
                    throw new Error("PREFLIGHT_FAILED");
                } else {
                    warnings.push(`Предупреждение Pre-Flight: ${prefErr.message}`);
                }
            }

            if (cfg.roles) {
                rolesRes = await this.copyRoles(cfg, roleMap, log, warnings, errors, manualReviews, onProgress);
            }
            if (this.aborted) throw new Error("ABORTED");

            if (cfg.emojis) {
                emojisRes = await this.copyEmojis(cfg, emojiMap, log, warnings, errors, manualReviews, onProgress);
            }
            if (this.aborted) throw new Error("ABORTED");

            if (cfg.channels) {
                const chRes = await this.copyChannelsWithVerification(cfg, idMap, roleMap, emojiMap, log, warnings, errors, manualReviews, onProgress);
                channelsRes = chRes.metrics;
                hiddenCount = chRes.hiddenCount;
                unsupportedSkippedCount = chRes.unsupportedSkippedCount;
                orphanAdjustedCount = chRes.orphanAdjustedCount;
            }
            if (this.aborted) throw new Error("ABORTED");

            if (cfg.settings) {
                await this.copySettings(cfg, idMap, log, warnings, manualReviews, onProgress);
            }

            const secs = Number(((Date.now() - started) / 1000).toFixed(1));
            let status = "success";
            if (errors.length > 0 || rolesRes.failed > 0 || channelsRes.failed > 0 || manualReviews.length > 0) {
                status = "partial_with_errors";
            }

            if (status === "success") {
                onProgress?.("Готово 100%!", 100);
                log(`Клонирование успешно завершено и проверено за ${secs} сек.`, "success");
                BdApi.UI.showToast("Сервер успешно скопирован и верифицирован!", { type: "success" });
            } else {
                onProgress?.("Завершено с замечаниями", 100);
                log(`Клонирование завершено за ${secs} сек., но есть объекты для проверки (ошибок: ${errors.length})`, "warn");
                BdApi.UI.showToast("Клонирование завершено с замечаниями, см. аудит", { type: "warn" });
            }

            return {
                status,
                roles: rolesRes,
                channels: channelsRes,
                emojis: emojisRes,
                hiddenCount,
                unsupportedSkippedCount,
                orphanAdjustedCount,
                warnings,
                errors,
                manualReviews,
                durationSec: secs,
            };
        } catch (e) {
            const secs = Number(((Date.now() - started) / 1000).toFixed(1));
            const wasAborted = e.message === "ABORTED" || this.aborted;

            if (wasAborted) {
                log("Клонирование остановлено пользователем", "warn");
                BdApi.UI.showToast("Процесс клонирования прерван", { type: "info" });
            } else {
                log(`КРИТИЧЕСКАЯ ОШИБКА: ${e.message}`, "error");
                errors.push(e.message);
                BdApi.UI.showToast("Ошибка копирования, проверьте лог", { type: "error" });
            }

            return {
                status: wasAborted ? "aborted" : "failed",
                roles: rolesRes,
                channels: channelsRes,
                emojis: emojisRes,
                hiddenCount,
                unsupportedSkippedCount,
                orphanAdjustedCount,
                warnings,
                errors,
                manualReviews,
                durationSec: secs,
            };
        }
    }

    async copyRoles(cfg, roleMap, log, warnings, errors, manualReviews, onProgress) {
        onProgress?.("Чтение списка ролей...", 10);
        const roles = await this.api("GET", `/guilds/${cfg.src}/roles`, undefined, false, log);
        const everyone = roles.find((r) => r.id === cfg.src);

        const rawOthers = roles.filter((r) => r.id !== cfg.src);
        let skippedBotRoles = 0;
        const filterable = rawOthers.filter((r) => {
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

        const others = filterable.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

        let existingTargetRoles = [];
        if (cfg.skipDuplicates) {
            existingTargetRoles = (await this.api("GET", `/guilds/${cfg.dst}/roles`, undefined, false, log)) || [];
        }

        roleMap.set(cfg.src, cfg.dst);
        try {
            await this.api("PATCH", `/guilds/${cfg.dst}/roles/${cfg.dst}`, {
                permissions: everyone?.permissions ?? "0",
            }, false, log);
            log("Роль @everyone: базовые разрешения синхронизированы", "success");
        } catch (err) {
            warnings.push(`Ошибка @everyone: ${err.message}`);
        }
        await sleep(cfg.stealthMode ? 800 : 400);

        let createdCount = 0;
        let matchedCount = 0;
        let failedCount = 0;
        let idx = 0;

        for (const r of others) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Создание ролей (${idx}/${others.length}): ${r.name}`, Math.round(10 + (idx / others.length) * 20));

            if (cfg.skipDuplicates) {
                const found = existingTargetRoles.find((er) => er.name.toLowerCase() === r.name.toLowerCase());
                if (found) {
                    roleMap.set(r.id, found.id);
                    matchedCount++;
                    log(`Роль «${r.name}» уже существует на цели (сопоставлена)`, "info");
                    continue;
                }
            }

            const body = {
                name: r.name,
                permissions: r.permissions,
                hoist: !!r.hoist,
                mentionable: !!r.mentionable,
            };
            if (r.color) body.color = r.color;
            if (r.unicode_emoji) body.unicode_emoji = r.unicode_emoji;

            // Перенос расширенной палитры цветов (градиентные / голографические роли)
            if (r.colors && typeof r.colors === "object") {
                body.colors = {
                    primary_color: r.colors.primary_color ?? r.color ?? 0,
                    ...(r.colors.secondary_color !== undefined ? { secondary_color: r.colors.secondary_color } : {}),
                    ...(r.colors.tertiary_color !== undefined ? { tertiary_color: r.colors.tertiary_color } : {})
                };
            }

            let created = null;
            try {
                created = await this.api("POST", `/guilds/${cfg.dst}/roles`, body, false, log);
                createdCount++;
                roleMap.set(r.id, created.id);

                if (r.colors && (r.colors.secondary_color || r.colors.tertiary_color)) {
                    if (!created.colors || !created.colors.secondary_color) {
                        const warnGrad = `Роль «${r.name}»: градиентный стиль не поддерживается сервером назначения`;
                        log(`[Стили ролей] ${warnGrad}`, "warn");
                        warnings.push(warnGrad);
                        manualReviews.push({
                            type: "role",
                            name: r.name,
                            id: r.id,
                            reason: "Целевой сервер не поддерживает градиентный/голографический цвет",
                            actionRequired: "Настроить премиум-бусты сервера или задать цвет вручную"
                        });
                    }
                }

                log(`Роль создана: ${r.name}`, "info");
            } catch (e) {
                try {
                    const alt = { ...body };
                    delete alt.color;
                    alt.colors = {
                        primary_color: r.colors?.primary_color ?? r.color ?? 0,
                        ...(r.colors?.secondary_color !== undefined ? { secondary_color: r.colors.secondary_color } : {}),
                        ...(r.colors?.tertiary_color !== undefined ? { tertiary_color: r.colors.tertiary_color } : {})
                    };
                    created = await this.api("POST", `/guilds/${cfg.dst}/roles`, alt, false, log);
                    createdCount++;
                    roleMap.set(r.id, created.id);

                    if (r.colors && (r.colors.secondary_color || r.colors.tertiary_color)) {
                        if (!created.colors || !created.colors.secondary_color) {
                            const warnGrad = `Роль «${r.name}»: градиент не сохранен (применен монохромный цвет)`;
                            log(`[Стили ролей] ${warnGrad}`, "warn");
                            warnings.push(warnGrad);
                        }
                    }

                    log(`Роль создана (альт. colors): ${r.name}`, "info");
                } catch (e2) {
                    failedCount++;
                    const msg = `Роль «${r.name}» не создана: ${e2.message}`;
                    log(msg, "error");
                    errors.push(msg);
                    manualReviews.push({
                        type: "role",
                        name: r.name,
                        id: r.id,
                        reason: e2.message,
                        actionRequired: "Создать роль вручную"
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

        const positions = [{ id: cfg.dst, position: 0 }];
        others.forEach((r, i) => {
            const nid = roleMap.get(r.id);
            if (nid) positions.push({ id: nid, position: i + 1 });
        });
        try {
            await this.api("PATCH", `/guilds/${cfg.dst}/roles`, positions, false, log);
            log("Иерархия ролей успешно выставлена", "success");
        } catch (e) {
            warnings.push(`Иерархия ролей не выставлена: ${e.message}`);
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

    async copyEmojis(cfg, emojiMap, log, warnings, errors, manualReviews, onProgress) {
        onProgress?.("Чтение эмодзи...", 32);
        const emojis = await this.api("GET", `/guilds/${cfg.src}/emojis`, undefined, false, log);
        if (!Array.isArray(emojis) || !emojis.length) {
            log("Пользовательские эмодзи на сервере отсутствуют", "info");
            return { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
        }

        const targetEmojis = (await this.api("GET", `/guilds/${cfg.dst}/emojis`, undefined, false, log)) || [];
        let createdCount = 0;
        let matchedCount = 0;
        let failedCount = 0;
        let idx = 0;

        for (const e of emojis) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Загрузка эмодзи (${idx}/${emojis.length}): :${e.name}:`, Math.round(32 + (idx / emojis.length) * 20));

            if (cfg.skipDuplicates && targetEmojis.some((te) => te.name === e.name)) {
                matchedCount++;
                log(`Эмодзи :${e.name}: уже существует на цели (пропущено)`, "info");
                continue;
            }

            try {
                const ext = e.animated ? "gif" : "png";
                const res = await window.fetch(
                    `https://cdn.discordapp.com/emojis/${e.id}.${ext}?size=128&quality=lossless`
                );
                if (!res.ok) throw new Error(`CDN ${res.status}`);
                const blob = await res.blob();
                const fd = new FormData();
                fd.append("name", e.name);
                fd.append("image", blob, `${e.name}.${ext}`);
                const created = await this.api("POST", `/guilds/${cfg.dst}/emojis`, fd, true, log);
                if (created?.id) {
                    emojiMap.set(e.id, created.id);
                    createdCount++;
                }
                log(`Эмодзи перенесено: :${e.name}:`, "success");
            } catch (err) {
                failedCount++;
                const m = `Эмодзи «${e.name}» не перенесено: ${err.message}`;
                log(m, "warn");
                warnings.push(m);
                manualReviews.push({
                    type: "emoji",
                    name: e.name,
                    id: e.id,
                    reason: err.message,
                    actionRequired: "Загрузить эмодзи вручную"
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

    channelBody(ch, idMap, roleMap, emojiMap, cfg, log, warnings, manualReviews) {
        const body = { name: ch.name, type: ch.type };
        if (ch.parent_id && idMap.has(ch.parent_id)) body.parent_id = idMap.get(ch.parent_id);

        const MAX_TOPIC_LENGTH = 1024;
        let topicText = ch.topic || "";

        if (cfg.watermark && ch.type !== 4) {
            const tag = (cfg.watermarkText || "[Клон: ServerCloner Pro]").trim();
            if (tag) {
                const candidateTopic = topicText ? `${topicText} · ${tag}` : tag;
                if (candidateTopic.length > MAX_TOPIC_LENGTH) {
                    const w = `[Водяной знак] Тема канала «${ch.name}» с водяным знаком (${candidateTopic.length} симв.) превышает лимит Discord (1024). Исходное описание сохранено без изменений; канал добавлен в список ручной проверки.`;
                    log?.(w, "warn");
                    warnings.push(w);
                    manualReviews.push({
                        type: "channel",
                        name: ch.name,
                        id: ch.id,
                        reason: `Превышен лимит описания (${candidateTopic.length} > 1024)`,
                        actionRequired: "Вручную скорректировать описание в настройках канала"
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
            body.available_tags = ch.available_tags.map((t) => ({
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

        // Перенос всех прав, включая приватные (@everyone deny)
        if (ch.permission_overwrites?.length) {
            const ows = [];
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

    async copyChannelsWithVerification(cfg, idMap, roleMap, emojiMap, log, warnings, errors, manualReviews, onProgress) {
        onProgress?.("Чтение структуры ВСЕХ каналов (включая скрытые)...", 52);
        const allChannels = await this.api("GET", `/guilds/${cfg.src}/channels`, undefined, false, log);

        // Фильтрация неподдерживаемых веток
        const UNSUPPORTED = [6, 10, 11, 12];
        const unsupported = allChannels.filter((c) => UNSUPPORTED.includes(c.type));
        const usable = allChannels.filter((c) => !UNSUPPORTED.includes(c.type));

        if (unsupported.length > 0) {
            const warnThreads = `[Пропуск веток] Обнаружено ${unsupported.length} веток/устаревших объектов (типы ${Array.from(new Set(unsupported.map(c => c.type))).join(", ")}). Ветки не переносятся через REST создание каналов.`;
            log(warnThreads, "warn");
            warnings.push(warnThreads);
        }

        const isChanHidden = (ch) => {
            const everyoneOW = ch.permission_overwrites?.find?.((ow) => ow.id === cfg.src && ow.type === 0);
            return !!(everyoneOW && (BigInt(everyoneOW.deny || "0") & 1024n) === 1024n);
        };

        let hiddenCount = 0;
        usable.forEach((ch) => {
            if (isChanHidden(ch)) hiddenCount++;
        });
        log(`Обнаружено поддерживаемых каналов: ${usable.length} (из них скрытых/приватных: ${hiddenCount})`, "info");

        const categories = usable.filter((c) => c.type === 4);
        const nonCats = usable.filter((c) => c.type !== 4);
        const categoryMap = new Map(categories.map((c) => [c.id, c]));

        const excludedCategoryIds = new Set();
        const activeCategories = [];

        for (const cat of categories) {
            const isHidden = isChanHidden(cat);
            if (cfg.copyHiddenChannels === false && isHidden) {
                excludedCategoryIds.add(cat.id);
                log(`[Дерево категорий] Скрытая категория «${cat.name}» исключена`, "warn");
            } else {
                activeCategories.push(cat);
            }
        }

        const plannedChannels = [];
        let orphanAdjustedCount = 0;
        let skippedByFilter = 0;

        for (const ch of nonCats) {
            const isHidden = isChanHidden(ch);
            if (cfg.copyHiddenChannels === false && isHidden) {
                skippedByFilter++;
                continue;
            }

            if (ch.parent_id && excludedCategoryIds.has(ch.parent_id)) {
                const parentCat = categoryMap.get(ch.parent_id);
                const parentName = parentCat ? parentCat.name : ch.parent_id;

                if (!cfg.orphanChannelPolicy || cfg.orphanChannelPolicy === "skip") {
                    orphanAdjustedCount++;
                    log(`[Orphan Policy] Категория «${parentName}» исключена. Дочерний канал «${ch.name}» пропущен (skip).`, "info");
                    continue;
                } else {
                    orphanAdjustedCount++;
                    const relocated = { ...ch, parent_id: null, isOrphanRelocated: true };
                    plannedChannels.push(relocated);
                    const w = `[Изменение структуры] Категория «${parentName}» исключена. Канал «${ch.name}» перенесен в корень сервера (root).`;
                    log(w, "warn");
                    warnings.push(w);
                    manualReviews.push({
                        type: "channel",
                        name: ch.name,
                        id: ch.id,
                        reason: `Родительская категория «${parentName}» исключена, канал перенесен в корень`,
                        actionRequired: "Привязать канал к категории или оставить в корне"
                    });
                    continue;
                }
            }
            plannedChannels.push(ch);
        }

        const byPos = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
        const sortedCats = [...activeCategories].sort(byPos);
        const catPos = new Map(sortedCats.map((c) => [c.id, c.position]));

        const sortedOthers = [...plannedChannels].sort((a, b) => {
            const pa = a.parent_id != null ? catPos.get(a.parent_id) ?? 0 : -1;
            const pb = b.parent_id != null ? catPos.get(b.parent_id) ?? 0 : -1;
            return pa - pb || byPos(a, b);
        });

        const orderedList = [...sortedCats, ...sortedOthers];
        let position = 1;
        let idx = 0;
        let createdCount = 0;
        let failedCount = 0;
        const failedChannels = [];

        for (const ch of orderedList) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Создание каналов (${idx}/${orderedList.length}): ${ch.name}`, Math.round(52 + (idx / orderedList.length) * 32));

            const isHidden = isChanHidden(ch);
            const full = this.channelBody(ch, idMap, roleMap, emojiMap, cfg, log, warnings, manualReviews);
            full.position = position++;
            let created = null;

            try {
                created = await this.api("POST", `/guilds/${cfg.dst}/channels`, full, false, log);
                idMap.set(ch.id, created.id);
                createdCount++;

                if (ch.parent_id && idMap.has(ch.parent_id)) {
                    const expectedParent = idMap.get(ch.parent_id);
                    if (created.parent_id !== expectedParent) {
                        const warnP = `[Несоответствие структуры] Канал «${ch.name}»: parent_id (${created.parent_id}) != целевая категория (${expectedParent})`;
                        log(warnP, "warn");
                        warnings.push(warnP);
                        manualReviews.push({
                            type: "channel",
                            name: ch.name,
                            id: ch.id,
                            reason: "Несовпадение parent_id с целевой категорией",
                            actionRequired: "Вручную переместить в правильную категорию"
                        });
                    }
                }

                const hiddenBadge = isHidden ? " [🔒 ПРИВАТНЫЙ]" : "";
                const orphanBadge = ch.isOrphanRelocated ? " [В КОРНЕ]" : "";
                log(`[${SUPPORTED_CHANNEL_TYPES[ch.type]?.name ?? "Канал"}] Создан: ${ch.name}${hiddenBadge}${orphanBadge}`, "info");
            } catch (e) {
                try {
                    const minimal = { name: ch.name, type: ch.type, position: full.position };
                    if (full.parent_id) minimal.parent_id = full.parent_id;
                    if (full.permission_overwrites) minimal.permission_overwrites = full.permission_overwrites;
                    if (full.topic) minimal.topic = full.topic;
                    created = await this.api("POST", `/guilds/${cfg.dst}/channels`, minimal, false, log);
                    idMap.set(ch.id, created.id);
                    createdCount++;
                    log(`[${SUPPORTED_CHANNEL_TYPES[ch.type]?.name ?? "Канал"}] Создан (упрощенный): ${ch.name}`, "info");
                } catch (e2) {
                    log(`Канал «${ch.name}» не создан: ${e2.message}`, "warn");
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
        if (failedChannels.length > 0 && !this.aborted) {
            log(`Повторная попытка создания ${failedChannels.length} пропущенных каналов...`, "info");
            for (const ch of failedChannels) {
                if (this.aborted) break;
                try {
                    const minimal = { name: ch.name, type: ch.type };
                    if (ch.parent_id && idMap.has(ch.parent_id)) minimal.parent_id = idMap.get(ch.parent_id);
                    const created = await this.api("POST", `/guilds/${cfg.dst}/channels`, minimal, false, log);
                    idMap.set(ch.id, created.id);
                    createdCount++;
                    log(`[Восстановлен] Канал «${ch.name}» успешно создан`, "success");
                } catch (retryErr) {
                    failedCount++;
                    const m = `Повторная попытка для «${ch.name}» не удалась: ${retryErr.message}`;
                    log(m, "error");
                    errors.push(m);
                    manualReviews.push({
                        type: ch.type === 4 ? "category" : "channel",
                        name: ch.name,
                        id: ch.id,
                        reason: retryErr.message,
                        actionRequired: "Создать вручную в настройках сервера"
                    });
                }
                await sleep(cfg.stealthMode ? 1200 : 500);
            }
        }

        // Фаза 3: ВЕРИФИКАЦИЯ
        onProgress?.("Аудит целостности каналов на целевом сервере...", 86);
        log("Запуск двухфазной верификации созданных каналов...", "info");
        const targetChannels = await this.api("GET", `/guilds/${cfg.dst}/channels`, undefined, false, log);
        let verifiedCount = 0;

        for (const ch of orderedList) {
            const targetId = idMap.get(ch.id);
            if (targetId && targetChannels.some((tc) => tc.id === targetId)) {
                verifiedCount++;
            }
        }

        if (verifiedCount === orderedList.length && failedCount === 0) {
            log(`Верификация 100% пройдена: ВСЕ каналы (${verifiedCount}/${orderedList.length}) подтверждены!`, "success");
        } else {
            const w = `Верификация: подтверждено ${verifiedCount} из ${orderedList.length} каналов (ошибок: ${failedCount})`;
            log(w, "warn");
            warnings.push(w);
        }

        return {
            metrics: {
                expected: orderedList.length,
                created: createdCount,
                matchedExisting: 0,
                skipped: skippedByFilter + (cfg.orphanChannelPolicy ? 0 : orphanAdjustedCount),
                verified: verifiedCount,
                failed: failedCount,
            },
            hiddenCount,
            unsupportedSkippedCount: unsupported.length,
            orphanAdjustedCount,
        };
    }

    async copySettings(cfg, idMap, log, warnings, manualReviews, onProgress) {
        onProgress?.("Копирование настроек сервера...", 90);
        const g = await this.api("GET", `/guilds/${cfg.src}`, undefined, false, log);
        const patch = {
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
            onProgress?.("Загрузка аватара и баннера сервера...", 94);
            try {
                if (g.icon) {
                    const ext = g.icon.startsWith("a_") ? "gif" : "png";
                    patch.icon = await this.cdnDataUrl(
                        `https://cdn.discordapp.com/icons/${cfg.src}/${g.icon}.${ext}?size=4096`
                    );
                    log("Иконка сервера успешно скачана", "success");
                }
                if (g.banner) {
                    const ext = g.banner.startsWith("a_") ? "gif" : "png";
                    patch.banner = await this.cdnDataUrl(
                        `https://cdn.discordapp.com/banners/${cfg.src}/${g.banner}.${ext}?size=4096`
                    );
                    log("Баннер сервера успешно скачан", "success");
                }
            } catch (e) {
                const w = `Иконка/баннер не скачаны: ${e.message}`;
                log(w, "warn");
                warnings.push(w);
                delete patch.icon;
                delete patch.banner;
                manualReviews.push({
                    type: "setting",
                    name: "Иконка / Баннер",
                    reason: e.message,
                    actionRequired: "Загрузить графику вручную"
                });
            }
        }

        try {
            await this.api("PATCH", `/guilds/${cfg.dst}`, patch, false, log);
            log(`Настройки сервера применены («${g.name}»)`, "success");
        } catch (e) {
            delete patch.icon;
            delete patch.banner;
            delete patch.rules_channel_id;
            delete patch.public_updates_channel_id;
            try {
                await this.api("PATCH", `/guilds/${cfg.dst}`, patch, false, log);
                log(`Настройки применены в базовом формате: ${e.message}`, "warn");
            } catch (e2) {
                const m = `Не удалось применить настройки: ${e2.message}`;
                log(m, "warn");
                warnings.push(m);
                manualReviews.push({
                    type: "setting",
                    name: "Основные настройки",
                    reason: e2.message,
                    actionRequired: "Проверить настройки вручную"
                });
            }
        }
    }
};
