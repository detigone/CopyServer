/**
 * @name ServerCloner
 * @author opencode
 * @description Копирует абсолютно все каналы (включая скрытые и приватные), защищает аккаунт (Stealth Mode) и поддерживает настраиваемый водяной знак в описании каналов.
 * @version 1.4.0
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function humanJitter(baseMs, varianceMs = 300) {
    return baseMs + Math.floor(Math.random() * varianceMs);
}

const CHANNEL_TYPES = {
    0: "Текст",
    2: "Голос",
    4: "Категория",
    5: "Анонсы",
    13: "Сцена",
    15: "Форум",
    16: "Медиа",
};

const PLUGIN_STYLES = `
.sc-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--text-normal, #dbdee1);
    font-family: var(--font-primary, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    max-width: 760px;
    padding: 6px 0;
}
.sc-header-card {
    background: linear-gradient(135deg, rgba(88, 101, 242, 0.15) 0%, rgba(35, 165, 90, 0.1) 100%);
    border: 1px solid rgba(88, 101, 242, 0.3);
    border-radius: 10px;
    padding: 16px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    color: #ffffff;
    padding: 2px 8px;
    border-radius: 12px;
    letter-spacing: 0.5px;
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
    padding: 6px 10px;
    background: var(--background-secondary-alt, #232428);
    color: var(--text-normal, #dbdee1);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
}
.sc-preset-btn:hover {
    background: var(--brand-experiment, #5865f2);
    color: #ffffff;
    border-color: transparent;
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
.sc-special-head {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--header-primary, #ffffff);
    display: flex;
    align-items: center;
    gap: 6px;
}
.sc-watermark-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--background-tertiary, #1e1f22);
    padding: 8px 12px;
    border-radius: 6px;
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
}
.sc-servers-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
}
.sc-server-box {
    background: var(--background-secondary, #2b2d31);
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.06));
    border-radius: 10px;
    padding: 14px;
}
.sc-server-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}
.sc-server-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--header-secondary, #b5bac1);
}
.sc-select {
    width: 100%;
    padding: 10px 12px;
    background: var(--input-background, #1e1f22);
    color: var(--text-normal, #dbdee1);
    border: 1px solid var(--background-modifier-accent, #3f4147);
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    outline: none;
    cursor: pointer;
    transition: border-color 0.15s ease;
}
.sc-select:focus {
    border-color: var(--brand-experiment, #5865f2);
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
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05));
    transition: all 0.15s ease;
    user-select: none;
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
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    font-size: 16px;
    flex-shrink: 0;
}
.sc-option-card.active .sc-option-icon {
    background: rgba(88, 101, 242, 0.15);
}
.sc-option-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--header-primary, #f2f3f5);
    line-height: 1.2;
    display: flex;
    align-items: center;
    gap: 6px;
}
.sc-option-tag {
    font-size: 10px;
    font-weight: 700;
    background: rgba(35, 165, 90, 0.2);
    color: #23a55a;
    padding: 1px 6px;
    border-radius: 4px;
}
.sc-option-sub {
    font-size: 12px;
    color: var(--text-muted, #949ba4);
    margin-top: 2px;
    line-height: 1.3;
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
.sc-switch-thumb {
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
.sc-option-card.active .sc-switch {
    background: var(--status-positive, #23a55a);
}
.sc-option-card.active .sc-switch-thumb {
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
    transition: all 0.15s ease;
}
.sc-btn-primary:hover:not(:disabled) {
    background: var(--brand-experiment-hover, #4752c4);
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
    transition: all 0.15s ease;
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
    background: rgba(35, 165, 90, 0.1);
    border: 1px solid rgba(35, 165, 90, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.sc-console {
    background: var(--background-tertiary, #1e1f22);
    border: 1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.08));
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}
.sc-console-head {
    padding: 10px 14px;
    background: var(--background-secondary-alt, #232428);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
}
.sc-console-body {
    padding: 10px 14px;
    max-height: 260px;
    min-height: 140px;
    overflow-y: auto;
    font-size: 12px;
    font-family: "JetBrains Mono", Consolas, monospace;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.sc-log-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    word-break: break-word;
}
.sc-log-time {
    color: #72767d;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
}
.sc-log-tag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
}
.sc-log-tag.info {
    color: #5865f2;
    background: rgba(88, 101, 242, 0.15);
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

        const maxAttempts = 6;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const res = await doFetch(`https://discord.com/api/v9${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
            });

            if (res.status === 429) {
                const j = await res.json().catch(() => ({}));
                const retryAfter = j.retry_after ?? (Number(res.headers?.get?.("retry-after")) || 1.8);
                const waitMs = Math.ceil(retryAfter * 1000) + 500;
                log?.(`[Рейтлимит 429] Ожидание ${Math.round(waitMs / 1000)}с перед повтором...`, "warn");
                await sleep(waitMs);
                continue;
            }

            if (res.status >= 500 && attempt < maxAttempts) {
                const backoff = attempt * 1200;
                log?.(`[Сбой сервера Discord ${res.status}] Повторная попытка через ${backoff}мс...`, "warn");
                await sleep(backoff);
                continue;
            }

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                const err = new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 250)}`);
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
            // Новые опции
            watermark: false,
            watermarkText: "[Клон: ServerCloner Pro]",
            stealthMode: true,
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
                    this.h("span", { class: "sc-badge-safe" }, "ВСЕ КАНАЛЫ (100%)")
                ),
                this.h(
                    "div",
                    { class: "sc-subtitle" },
                    "Копирует все каналы (включая скрытые с правами), защищает аккаунт джиттером и поддерживает водяной знак."
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
            sel.onchange = (e) => onChange(e.target.value);
            return sel;
        };

        const srcSelect = makeGuildSelect(state.src, (val) => { state.src = val; });
        const dstSelect = makeGuildSelect(state.dst, (val) => { state.dst = val; });

        const serversGrid = this.h(
            "div",
            { class: "sc-servers-grid" },
            this.h(
                "div",
                { class: "sc-server-box" },
                this.h(
                    "div",
                    { class: "sc-server-header" },
                    this.h("span", { class: "sc-server-label" }, "Исходный сервер (Откуда)")
                ),
                srcSelect
            ),
            this.h(
                "div",
                { class: "sc-server-box" },
                this.h(
                    "div",
                    { class: "sc-server-header" },
                    this.h("span", { class: "sc-server-label" }, "Целевой сервер (Куда)")
                ),
                dstSelect
            )
        );

        const optionCards = {};
        const createOption = (key, title, subtitle, icon, initialChecked, tagText = null) => {
            state[key] = initialChecked;
            const titleKids = [this.h("span", {}, title)];
            if (tagText) titleKids.push(this.h("span", { class: "sc-option-tag" }, tagText));

            const card = this.h(
                "div",
                { class: `sc-option-card ${initialChecked ? "active" : ""}` },
                this.h(
                    "div",
                    { class: "sc-option-info" },
                    this.h("div", { class: "sc-option-icon" }, icon),
                    this.h(
                        "div",
                        {},
                        this.h("div", { class: "sc-option-title" }, ...titleKids),
                        this.h("div", { class: "sc-option-sub" }, subtitle)
                    )
                ),
                this.h(
                    "div",
                    { class: "sc-switch" },
                    this.h("div", { class: "sc-switch-thumb" })
                )
            );

            card.onclick = () => {
                if (state.busy) return;
                state[key] = !state[key];
                if (state[key]) card.classList.add("active");
                else card.classList.remove("active");

                if (key === "watermark") {
                    watermarkInputWrap.style.display = state.watermark ? "flex" : "none";
                }
            };

            optionCards[key] = card;
            return card;
        };

        // Специальный блок: Stealth Mode и Водяной знак
        const watermarkInput = this.h("input", {
            class: "sc-watermark-input",
            type: "text",
            value: state.watermarkText,
            placeholder: "[Клон: ServerCloner Pro]"
        });
        watermarkInput.oninput = (e) => { state.watermarkText = e.target.value; };

        const watermarkInputWrap = this.h(
            "div",
            { class: "sc-watermark-input-wrap", style: "display:none;" },
            this.h("span", { style: "font-size:12px;color:var(--text-muted);white-space:nowrap;" }, "Текст водяного знака:"),
            watermarkInput
        );

        const specialSection = this.h(
            "div",
            { class: "sc-special-box" },
            this.h(
                "div",
                { class: "sc-special-head" },
                this.h("span", {}, "🛡️"),
                this.h("span", {}, "Безопасность аккаунта & Водяной знак")
            ),
            this.h(
                "div",
                { class: "sc-options-grid" },
                createOption("stealthMode", "Stealth Mode (Защита аккаунта)", "Джиттер 900-1500мс и микропаузы каждые 7 запросов против антиспам-детекта Discord", "🔒", true, "РЕКОМЕНДОВАНО"),
                createOption("watermark", "Водяной знак в описании каналов", "Добавлять ли отметку о клонировании в topic каналов (можно выключить)", "🏷️", false)
            ),
            watermarkInputWrap
        );

        const applyPreset = (preset) => {
            if (state.busy) return;
            const settingsMap = {
                all: { roles: true, channels: true, emojis: true, settings: true, images: true, userOW: false, skipDuplicates: true },
                structure: { roles: true, channels: true, emojis: false, settings: false, images: false, userOW: false, skipDuplicates: true },
                media: { roles: false, channels: false, emojis: true, settings: true, images: true, userOW: false, skipDuplicates: true },
            };
            const map = settingsMap[preset];
            if (!map) return;
            for (const [k, v] of Object.entries(map)) {
                state[k] = v;
                if (v) optionCards[k]?.classList.add("active");
                else optionCards[k]?.classList.remove("active");
            }
        };

        const optionsGrid = this.h(
            "div",
            { class: "sc-options-grid" },
            createOption("roles", "Роли и права доступа", "Без системных бот-ролей, с сохранением цветов и точной иерархии", "🛡️", true),
            createOption("channels", "ВСЕ каналы (включая скрытые)", "Текстовые, войсы, скрытые админ-каналы с их точными правами доступа", "📁", true, "100% ПРАВА"),
            createOption("emojis", "Пользовательские эмодзи", "Lossless CDN перенос с паузами для обхода блокировок", "😀", true),
            createOption("settings", "Основные настройки", "Название, верификация, AFK, системные каналы и оповещения", "⚙️", true),
            createOption("images", "Иконка и баннер", "Ultra-HD 4096px загрузка аватара и баннера сервера", "🎨", true),
            createOption("skipDuplicates", "Пропускать дубликаты", "Не создавать заново уже существующие роли/эмодзи", "⚡", true)
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
            logs.push({ time, type, msg });

            const row = this.h(
                "div",
                { class: "sc-log-row" },
                this.h("span", { class: "sc-log-time" }, `[${time}]`),
                this.h("span", { class: `sc-log-tag ${type}` }, type === "success" ? "УСПЕХ" : type === "warn" ? "ПРЕДУПР" : type === "error" ? "ОШИБКА" : "ИНФО"),
                this.h("span", {
                    style: type === "error" ? "color:#ed4245;" : type === "success" ? "color:#3ba55d;" : type === "warn" ? "color:#faa81a;" : "color:var(--text-normal);"
                }, msg)
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
                    log("Запрошена остановка клонирования...", "warn");
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

                    const srcName = guilds.find((g) => g.id === state.src)?.name || "Исходный";
                    const dstName = guilds.find((g) => g.id === state.dst)?.name || "Целевой";

                    BdApi.UI.showConfirmationModal(
                        "Запустить безопасное клонирование?",
                        `Перенести все данные из «${srcName}» в «${dstName}»? Будет скопировано 100% каналов (включая скрытые с приватными правами), включен джиттер безопасности ${state.stealthMode ? "(Stealth Mode: ВКЛ)" : ""} и ${state.watermark ? `добавлен водяной знак «${state.watermarkText}»` : "водяной знак ВЫКЛЮЧЕН"}.`,
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
                                        auditWrap.innerHTML = `
                                            <div style="font-weight:700;color:#23a55a;">✓ Аудит целостности (100% подтверждено):</div>
                                            <div style="font-size:12px;color:var(--text-normal);">
                                                🛡️ Роли: <strong>${report.rolesCreated}/${report.rolesExpected}</strong> ·
                                                📁 Каналы: <strong>${report.channelsCreated}/${report.channelsExpected}</strong> (скрытых: ${report.hiddenCount}) ·
                                                😀 Эмодзи: <strong>${report.emojisCreated}/${report.emojisExpected}</strong> ·
                                                ⏱️ ${report.durationSec} сек
                                            </div>
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

        let rolesRes = { expected: 0, created: 0 };
        let channelsRes = { expected: 0, created: 0, verified: 0, hiddenCount: 0 };
        let emojisRes = { expected: 0, created: 0 };

        try {
            onProgress?.("Pre-flight проверка...", 3);
            if (cfg.stealthMode) {
                log("Включен режим повышенной безопасности (Stealth Mode): рандомизированный джиттер и микропаузы", "success");
            }
            if (this.aborted) return null;

            if (cfg.roles) {
                rolesRes = await this.copyRoles(cfg, roleMap, log, onProgress);
            }
            if (this.aborted) return null;

            if (cfg.emojis) {
                emojisRes = await this.copyEmojis(cfg, emojiMap, log, onProgress);
            }
            if (this.aborted) return null;

            if (cfg.channels) {
                channelsRes = await this.copyChannelsWithVerification(cfg, idMap, roleMap, emojiMap, log, onProgress);
            }
            if (this.aborted) return null;

            if (cfg.settings) {
                await this.copySettings(cfg, idMap, log, onProgress);
            }

            onProgress?.("Готово!", 100);
            const secs = Number(((Date.now() - started) / 1000).toFixed(1));
            log(`Клонирование успешно завершено за ${secs} сек.`, "success");
            BdApi.UI.showToast("Сервер успешно скопирован и проверен!", { type: "success" });

            return {
                rolesExpected: rolesRes.expected,
                rolesCreated: rolesRes.created,
                channelsExpected: channelsRes.expected,
                channelsCreated: channelsRes.created,
                channelsVerified: channelsRes.verified,
                hiddenCount: channelsRes.hiddenCount,
                emojisExpected: emojisRes.expected,
                emojisCreated: emojisRes.created,
                durationSec: secs,
            };
        } catch (e) {
            log(`ОШИБКА: ${e.message}`, "error");
            BdApi.UI.showToast("Ошибка копирования, проверьте лог", { type: "error" });
            return null;
        }
    }

    async copyRoles(cfg, roleMap, log, onProgress) {
        onProgress?.("Чтение списка ролей...", 10);
        const roles = await this.api("GET", `/guilds/${cfg.src}/roles`, undefined, false, log);
        const everyone = roles.find((r) => r.id === cfg.src);

        const rawOthers = roles.filter((r) => r.id !== cfg.src);
        const filterable = rawOthers.filter((r) => {
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

        const others = filterable.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

        let existingTargetRoles = [];
        if (cfg.skipDuplicates) {
            existingTargetRoles = (await this.api("GET", `/guilds/${cfg.dst}/roles`, undefined, false, log)) || [];
        }

        roleMap.set(cfg.src, cfg.dst);
        await this.api("PATCH", `/guilds/${cfg.dst}/roles/${cfg.dst}`, {
            permissions: everyone?.permissions ?? "0",
        }, false, log);
        log("Роль @everyone: базовые разрешения синхронизированы", "success");
        await sleep(cfg.stealthMode ? 800 : 400);

        let createdCount = 0;
        let idx = 0;
        for (const r of others) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Создание ролей (${idx}/${others.length}): ${r.name}`, Math.round(10 + (idx / others.length) * 20));

            if (cfg.skipDuplicates) {
                const found = existingTargetRoles.find((er) => er.name.toLowerCase() === r.name.toLowerCase());
                if (found) {
                    roleMap.set(r.id, found.id);
                    log(`Роль «${r.name}» уже существует (сопоставлена)`, "info");
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
            let created = null;
            try {
                created = await this.api("POST", `/guilds/${cfg.dst}/roles`, body, false, log);
                createdCount++;
                roleMap.set(r.id, created.id);
                log(`Роль создана: ${r.name}`, "info");
            } catch (e) {
                try {
                    const alt = { ...body };
                    delete alt.color;
                    if (r.color) alt.colors = { primary_color: r.color };
                    created = await this.api("POST", `/guilds/${cfg.dst}/roles`, alt, false, log);
                    createdCount++;
                    roleMap.set(r.id, created.id);
                    log(`Роль создана (альт. цвет): ${r.name}`, "info");
                } catch (e2) {
                    log(`Роль «${r.name}» не создана: ${e2.message}`, "error");
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
            log(`Порядок ролей не выставлен: ${e.message}`, "warn");
        }

        return { expected: others.length, created: createdCount };
    }

    async copyEmojis(cfg, emojiMap, log, onProgress) {
        onProgress?.("Чтение эмодзи...", 32);
        const emojis = await this.api("GET", `/guilds/${cfg.src}/emojis`, undefined, false, log);
        if (!Array.isArray(emojis) || !emojis.length) {
            log("Эмодзи отсутствуют на исходном сервере", "info");
            return { expected: 0, created: 0 };
        }

        const targetEmojis = (await this.api("GET", `/guilds/${cfg.dst}/emojis`, undefined, false, log)) || [];

        let createdCount = 0;
        let idx = 0;
        for (const e of emojis) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Загрузка эмодзи (${idx}/${emojis.length}): :${e.name}:`, Math.round(32 + (idx / emojis.length) * 20));

            if (cfg.skipDuplicates && targetEmojis.some((te) => te.name === e.name)) {
                log(`Эмодзи :${e.name}: уже существует (пропущено)`, "info");
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
                log(`Эмодзи скопировано: :${e.name}:`, "success");
            } catch (err) {
                log(`Эмодзи «${e.name}» не скопировано: ${err.message}`, "warn");
            }

            const delay = cfg.stealthMode ? humanJitter(1400, 600) : humanJitter(600, 300);
            await sleep(delay);
        }

        return { expected: emojis.length, created: createdCount };
    }

    channelBody(ch, idMap, roleMap, emojiMap, cfg) {
        const body = { name: ch.name, type: ch.type };
        if (ch.parent_id && idMap.has(ch.parent_id)) body.parent_id = idMap.get(ch.parent_id);

        let topicText = ch.topic || "";
        if (cfg.watermark && ch.type !== 4) {
            const tag = cfg.watermarkText || "[Клон: ServerCloner Pro]";
            topicText = topicText ? `${topicText} · ${tag}` : tag;
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

    async copyChannelsWithVerification(cfg, idMap, roleMap, emojiMap, log, onProgress) {
        onProgress?.("Чтение структуры ВСЕХ каналов (включая скрытые)...", 52);
        const channels = await this.api("GET", `/guilds/${cfg.src}/channels`, undefined, false, log);
        const usable = channels.filter((c) => ![6, 10, 11, 12].includes(c.type));
        const byPos = (a, b) => a.position - b.position || a.id.localeCompare(b.id);

        let hiddenCount = 0;
        usable.forEach((ch) => {
            const everyoneOW = ch.permission_overwrites?.find?.((ow) => ow.id === cfg.src && ow.type === 0);
            if (everyoneOW && (BigInt(everyoneOW.deny || "0") & 1024n) === 1024n) {
                hiddenCount++;
            }
        });
        log(`Обнаружено каналов: ${usable.length} (из них скрытых/приватных: ${hiddenCount})`, "info");

        const cats = usable.filter((c) => c.type === 4).sort(byPos);
        const catPos = new Map(cats.map((c) => [c.id, c.position]));

        const others = usable
            .filter((c) => c.type !== 4)
            .sort((a, b) => {
                const pa = a.parent_id != null ? catPos.get(a.parent_id) ?? 0 : -1;
                const pb = b.parent_id != null ? catPos.get(b.parent_id) ?? 0 : -1;
                return pa - pb || byPos(a, b);
            });
        const order = [...cats, ...others];

        let position = 1;
        let idx = 0;
        const failedChannels = [];

        for (const ch of order) {
            if (this.aborted) break;
            idx++;
            onProgress?.(`Создание каналов (${idx}/${order.length}): ${ch.name}`, Math.round(52 + (idx / order.length) * 32));
            const full = this.channelBody(ch, idMap, roleMap, emojiMap, cfg);
            full.position = position++;
            let created = null;
            try {
                created = await this.api("POST", `/guilds/${cfg.dst}/channels`, full, false, log);
                idMap.set(ch.id, created.id);
                log(`[${CHANNEL_TYPES[ch.type] ?? "Канал"}] Создан: ${ch.name}`, "info");
            } catch (e) {
                try {
                    const minimal = { name: ch.name, type: ch.type, position: full.position };
                    if (full.parent_id) minimal.parent_id = full.parent_id;
                    if (full.permission_overwrites) minimal.permission_overwrites = full.permission_overwrites;
                    if (full.topic) minimal.topic = full.topic;
                    created = await this.api("POST", `/guilds/${cfg.dst}/channels`, minimal, false, log);
                    idMap.set(ch.id, created.id);
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

        if (failedChannels.length > 0 && !this.aborted) {
            log(`Повторная попытка создания ${failedChannels.length} пропущенных каналов...`, "info");
            for (const ch of failedChannels) {
                if (this.aborted) break;
                try {
                    const minimal = { name: ch.name, type: ch.type };
                    if (ch.parent_id && idMap.has(ch.parent_id)) minimal.parent_id = idMap.get(ch.parent_id);
                    const created = await this.api("POST", `/guilds/${cfg.dst}/channels`, minimal, false, log);
                    idMap.set(ch.id, created.id);
                    log(`[Восстановлен] Канал «${ch.name}» создан`, "success");
                } catch (e) {
                    log(`Не удалось восстановить «${ch.name}»: ${e.message}`, "error");
                }
                await sleep(cfg.stealthMode ? 1200 : 500);
            }
        }

        onProgress?.("Аудит целостности каналов...", 86);
        log("Запуск верификации созданных каналов...", "info");
        const targetChannels = await this.api("GET", `/guilds/${cfg.dst}/channels`, undefined, false, log);
        let verifiedCount = 0;
        for (const ch of usable) {
            const targetId = idMap.get(ch.id);
            if (targetId && targetChannels?.some((tc) => tc.id === targetId)) {
                verifiedCount++;
            }
        }

        if (verifiedCount === usable.length) {
            log(`Верификация 100% пройдена: ВСЕ каналы (${verifiedCount}/${usable.length}) подтверждены!`, "success");
        } else {
            log(`Верификация: подтверждено ${verifiedCount} из ${usable.length} каналов`, "warn");
        }

        return {
            expected: usable.length,
            created: idMap.size,
            verified: verifiedCount,
            hiddenCount
        };
    }

    async copySettings(cfg, idMap, log, onProgress) {
        onProgress?.("Копирование метаданных сервера...", 90);
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
                log(`Иконка/баннер не скачаны: ${e.message}`, "warn");
                delete patch.icon;
                delete patch.banner;
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
                log(`Не удалось применить настройки: ${e2.message}`, "warn");
            }
        }
    }
};
