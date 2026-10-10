/**
 * @name ServerCloner
 * @author opencode
 * @description Копирует сервер 1:1 (роли + права, каналы + overwrites, настройки, иконка/баннер, эмодзи) через user token. Работает без прав на исходном сервере — достаточно иметь доступ к просмотру.
 * @version 1.0.0
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHANNEL_TYPES = {
    0: "Текст",
    2: "Голос",
    4: "Категория",
    5: "Анонсы",
    13: "Сцена",
    15: "Форум",
    16: "Медиа",
};

module.exports = class ServerCloner {
    start() {}
    stop() {}

    getToken() {
        const mod = BdApi.Webpack.getModule(
            (m) => typeof m?.getToken === "function" && typeof m?.logout === "function",
            { searchExports: true }
        );
        return mod?.getToken?.();
    }

    async api(method, path, body, isForm = false) {
        const token = this.getToken();
        if (!token) throw new Error("Не удалось получить токен");
        const headers = { Authorization: token };
        if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";
        const doFetch = BdApi.Net?.fetch ? BdApi.Net.fetch.bind(BdApi.Net) : window.fetch.bind(window);
        for (let attempt = 0; attempt < 6; attempt++) {
            const res = await doFetch(`https://discord.com/api/v9${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
            });
            if (res.status === 429) {
                const j = await res.json().catch(() => ({}));
                await sleep(((j.retry_after ?? 1) + 0.3) * 1000);
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
        throw new Error("Слишком много запросов 429");
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
        const guilds = Object.values(GuildStore.getGuilds()).sort((a, b) =>
            a.name.localeCompare(b.name, "ru")
        );
        const current = SelectedGuildStore.getGuildId?.();

        const makeSelect = (defValue) => {
            const sel = this.h(
                "select",
                { style: "width:100%;padding:6px;background:var(--input-background);color:var(--text-normal);border:1px solid var(--background-modifier-accent);border-radius:4px;" },
                this.h("option", { value: "" }, "— выбрать сервер —")
            );
            for (const g of guilds) {
                const o = this.h("option", { value: g.id }, g.name);
                if (g.id === defValue) o.selected = true;
                sel.append(o);
            }
            return sel;
        };

        const srcSelect = makeSelect(current);
        const dstSelect = makeSelect(null);

        const checks = {};
        const checkbox = (key, label, checked) => {
            const input = this.h("input", { type: "checkbox" });
            input.checked = checked;
            checks[key] = input;
            return this.h(
                "label",
                { style: "display:flex;align-items:center;gap:8px;cursor:pointer;" },
                input,
                label
            );
        };

        const logBox = this.h("pre", {
            style:
                "max-height:260px;overflow:auto;background:#1e1f22;padding:8px;border-radius:4px;font-size:12px;white-space:pre-wrap;word-break:break-all;color:var(--text-normal);",
        });
        const log = (msg) => {
            const t = new Date().toLocaleTimeString();
            logBox.textContent += `[${t}] ${msg}\n`;
            logBox.scrollTop = logBox.scrollHeight;
        };

        const copyBtn = this.h(
            "button",
            {
                style:
                    "padding:10px;background:var(--brand-experiment,#5865f2);color:#fff;border:none;border-radius:4px;font-weight:600;cursor:pointer;",
                onclick: () => {
                    const cfg = {
                        src: srcSelect.value,
                        dst: dstSelect.value,
                        roles: checks.roles.checked,
                        channels: checks.channels.checked,
                        emojis: checks.emojis.checked,
                        settings: checks.settings.checked,
                        images: checks.images.checked,
                        userOW: checks.userOW.checked,
                    };
                    if (!cfg.src || !cfg.dst) return BdApi.UI.showToast("Выбери оба сервера", { type: "error" });
                    if (cfg.src === cfg.dst) return BdApi.UI.showToast("Серверы должны отличаться", { type: "error" });
                    if (!Object.values(checks).some((c) => c.checked && c !== checks.userOW))
                        return BdApi.UI.showToast("Выбери, что копировать", { type: "error" });
                    BdApi.UI.showConfirmationModal(
                        "Копировать сервер?",
                        `Из «${guilds.find((g) => g.id === cfg.src)?.name}» в «${
                            guilds.find((g) => g.id === cfg.dst)?.name
                        }». Все роли и каналы будут созданы заново.`,
                        {
                            confirmText: "Копировать",
                            cancelText: "Отмена",
                            onConfirm: () => this.copy(cfg, log),
                        }
                    );
                },
            },
            "Копировать"
        );

        const row = (label, node) =>
            this.h(
                "div",
                { style: "display:flex;flex-direction:column;gap:4px;" },
                this.h("div", { style: "font-weight:600;color:var(--header-primary);" }, label),
                node
            );

        return this.h(
            "div",
            { style: "padding:10px;display:flex;flex-direction:column;gap:12px;color:var(--text-normal);" },
            row("Исходный сервер", srcSelect),
            row("Куда копировать", dstSelect),
            row(
                "Что копировать",
                this.h(
                    "div",
                    { style: "display:flex;flex-direction:column;gap:6px;" },
                    checkbox("roles", "Роли + разрешения (включая @everyone)", true),
                    checkbox("channels", "Каналы, категории, права в каналах", true),
                    checkbox("emojis", "Эмодзи", true),
                    checkbox("settings", "Настройки сервера (верификация, AFK, системный канал...)", true),
                    checkbox("images", "Иконка и баннер", true),
                    checkbox("userOW", "Персональные overwrites пользователей (медленно)", false)
                )
            ),
            copyBtn,
            this.h("div", { style: "font-weight:600;color:var(--header-primary);" }, "Лог"),
            logBox
        );
    }

    async copy(cfg, log) {
        const started = Date.now();
        const idMap = new Map();
        const roleMap = new Map();
        const emojiMap = new Map();
        try {
            log(`Копирование ${cfg.src} -> ${cfg.dst}`);

            if (cfg.roles) await this.copyRoles(cfg, roleMap, log);
            if (cfg.emojis) await this.copyEmojis(cfg, emojiMap, log);
            if (cfg.channels) await this.copyChannels(cfg, idMap, roleMap, emojiMap, log);
            if (cfg.settings) await this.copySettings(cfg, idMap, log);

            const secs = ((Date.now() - started) / 1000).toFixed(1);
            log(`Готово за ${secs} сек.`);
            BdApi.UI.showToast("Копирование завершено", { type: "success" });
        } catch (e) {
            log(`ОШИБКА: ${e.message}`);
            BdApi.UI.showToast("Ошибка копирования, смотри лог", { type: "error" });
        }
    }

    async copyRoles(cfg, roleMap, log) {
        const roles = await this.api("GET", `/guilds/${cfg.src}/roles`);
        const everyone = roles.find((r) => r.id === cfg.src);
        const others = roles
            .filter((r) => r.id !== cfg.src)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

        roleMap.set(cfg.src, cfg.dst);
        await this.api("PATCH", `/guilds/${cfg.dst}/roles/${cfg.dst}`, {
            permissions: everyone?.permissions ?? "0",
        });
        log("Роль @everyone: разрешения скопированы");
        await sleep(300);

        for (const r of others) {
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
                created = await this.api("POST", `/guilds/${cfg.dst}/roles`, body);
            } catch (e) {
                try {
                    const alt = { ...body };
                    delete alt.color;
                    if (r.color) alt.colors = { primary_color: r.color };
                    created = await this.api("POST", `/guilds/${cfg.dst}/roles`, alt);
                } catch (e2) {
                    log(`Роль «${r.name}» не создана: ${e2.message}`);
                    continue;
                }
            }
            roleMap.set(r.id, created.id);
            log(`Роль: ${r.name}`);
            await sleep(300);
        }

        const positions = [{ id: cfg.dst, position: 0 }];
        others.forEach((r, i) => {
            const nid = roleMap.get(r.id);
            if (nid) positions.push({ id: nid, position: i + 1 });
        });
        try {
            await this.api("PATCH", `/guilds/${cfg.dst}/roles`, positions);
            log("Порядок ролей выставлен");
        } catch (e) {
            log(`Порядок ролей не выставлен: ${e.message}`);
        }
    }

    async copyEmojis(cfg, emojiMap, log) {
        const emojis = await this.api("GET", `/guilds/${cfg.src}/emojis`);
        if (!Array.isArray(emojis) || !emojis.length) {
            log("Эмодзи отсутствуют");
            return;
        }
        for (const e of emojis) {
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
                const created = await this.api("POST", `/guilds/${cfg.dst}/emojis`, fd, true);
                if (created?.id) emojiMap.set(e.id, created.id);
                log(`Эмодзи: :${e.name}:`);
            } catch (err) {
                log(`Эмодзи «${e.name}» не скопировано: ${err.message}`);
            }
            await sleep(300);
        }
    }

    channelBody(ch, idMap, roleMap, emojiMap) {
        const body = { name: ch.name, type: ch.type };
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
        if (ch.permission_overwrites?.length) {
            const ows = [];
            for (const ow of ch.permission_overwrites) {
                if (ow.type === 0) {
                    if (!roleMap.has(ow.id)) continue;
                    ows.push({ id: roleMap.get(ow.id), type: 0, allow: ow.allow, deny: ow.deny });
                } else {
                    ows.push({ id: ow.id, type: 1, allow: ow.allow, deny: ow.deny });
                }
            }
            if (ows.length) body.permission_overwrites = ows;
        }
        return body;
    }

    async copyChannels(cfg, idMap, roleMap, emojiMap, log) {
        const channels = await this.api("GET", `/guilds/${cfg.src}/channels`);
        const usable = channels.filter((c) => ![6, 10, 11, 12].includes(c.type));
        const byPos = (a, b) => a.position - b.position || a.id.localeCompare(b.id);
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
        for (const ch of order) {
            const full = this.channelBody(ch, idMap, roleMap, emojiMap);
            full.position = position++;
            let created = null;
            try {
                created = await this.api("POST", `/guilds/${cfg.dst}/channels`, full);
            } catch (e) {
                try {
                    const minimal = { name: ch.name, type: ch.type, position: full.position };
                    if (full.parent_id) minimal.parent_id = full.parent_id;
                    if (full.permission_overwrites) minimal.permission_overwrites = full.permission_overwrites;
                    created = await this.api("POST", `/guilds/${cfg.dst}/channels`, minimal);
                } catch (e2) {
                    log(`Канал «${ch.name}» не создан: ${e2.message}`);
                    continue;
                }
            }
            idMap.set(ch.id, created.id);
            log(`${CHANNEL_TYPES[ch.type] ?? ch.type}: ${ch.name}`);
            await sleep(250);
        }
        log(`Создано каналов: ${idMap.size}`);
    }

    async copySettings(cfg, idMap, log) {
        const g = await this.api("GET", `/guilds/${cfg.src}`);
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
            try {
                if (g.icon) {
                    const ext = g.icon.startsWith("a_") ? "gif" : "png";
                    patch.icon = await this.cdnDataUrl(
                        `https://cdn.discordapp.com/icons/${cfg.src}/${g.icon}.${ext}?size=4096`
                    );
                }
                if (g.banner) {
                    const ext = g.banner.startsWith("a_") ? "gif" : "png";
                    patch.banner = await this.cdnDataUrl(
                        `https://cdn.discordapp.com/banners/${cfg.src}/${g.banner}.${ext}?size=4096`
                    );
                }
            } catch (e) {
                log(`Иконка/баннер не скачаны: ${e.message}`);
                delete patch.icon;
                delete patch.banner;
            }
        }

        try {
            await this.api("PATCH", `/guilds/${cfg.dst}`, patch);
            log(`Настройки сервера скопированы («${g.name}»)`);
        } catch (e) {
            delete patch.icon;
            delete patch.banner;
            await this.api("PATCH", `/guilds/${cfg.dst}`, patch);
            log(`Настройки скопированы без иконки/баннера: ${e.message}`);
        }
    }
};
