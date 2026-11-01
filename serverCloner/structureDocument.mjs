/**
 * CopyServer Structure Document format.
 * A portable, editable JSON document stored with a .txt extension.
 */

export const STRUCTURE_FORMAT = "copyserver-structure";
export const STRUCTURE_VERSION = 1;
export const SUPPORTED_CHANNEL_TYPES = [0, 2, 4, 5, 13, 15, 16];

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const asString = value => value == null ? "" : String(value);
const decimalBits = value => {
    const text = asString(value || "0");
    try {
        if (!/^\d+$/.test(text)) return null;
        return BigInt(text).toString();
    } catch {
        return null;
    }
};

function pick(source, keys) {
    const result = {};
    for (const key of keys) {
        if (source?.[key] !== undefined && source[key] !== null) result[key] = source[key];
    }
    return result;
}

export function createStructureDocument(guild, sourceRoles = [], sourceChannels = []) {
    const roles = sourceRoles.filter(role =>
        role.id === guild.id || (!role.managed && !role.tags?.bot_id && !role.tags?.integration_id)
    );
    const roleKeyByDiscordId = new Map([[String(guild.id), "everyone"]]);
    let roleIndex = 0;
    for (const role of roles) {
        if (String(role.id) === String(guild.id)) continue;
        roleKeyByDiscordId.set(String(role.id), `role_${++roleIndex}`);
    }

    const roleDocs = roles.map(role => {
        const isEveryone = String(role.id) === String(guild.id);
        return {
            key: isEveryone ? "everyone" : roleKeyByDiscordId.get(String(role.id)),
            name: role.name,
            isEveryone,
            position: Number(role.position) || 0,
            permissions: decimalBits(role.permissions) ?? "0",
            color: Number(role.color) || 0,
            colors: pick(role.colors, ["primary_color", "secondary_color", "tertiary_color"]),
            hoist: !!role.hoist,
            mentionable: !!role.mentionable,
            ...(role.unicode_emoji ? { unicodeEmoji: role.unicode_emoji } : {})
        };
    }).sort((a, b) => a.position - b.position);

    const channelKeyByDiscordId = new Map();
    let categoryIndex = 0;
    let channelIndex = 0;
    for (const channel of sourceChannels) {
        if (!SUPPORTED_CHANNEL_TYPES.includes(Number(channel.type))) continue;
        const key = Number(channel.type) === 4 ? `category_${++categoryIndex}` : `channel_${++channelIndex}`;
        channelKeyByDiscordId.set(String(channel.id), key);
    }

    const channelDocs = sourceChannels
        .filter(channel => SUPPORTED_CHANNEL_TYPES.includes(Number(channel.type)))
        .map(channel => {
            const overwrites = (channel.permission_overwrites ?? []).map(overwrite => {
                if (Number(overwrite.type) === 0) {
                    const roleKey = roleKeyByDiscordId.get(String(overwrite.id));
                    return roleKey ? {
                        target: roleKey === "everyone" ? "everyone" : "role",
                        ...(roleKey === "everyone" ? {} : { role: roleKey }),
                        allow: decimalBits(overwrite.allow) ?? "0",
                        deny: decimalBits(overwrite.deny) ?? "0"
                    } : null;
                }
                if (Number(overwrite.type) === 1) {
                    return {
                        target: "member",
                        memberId: String(overwrite.id),
                        allow: decimalBits(overwrite.allow) ?? "0",
                        deny: decimalBits(overwrite.deny) ?? "0"
                    };
                }
                return null;
            }).filter(Boolean);

            const channelDoc = {
                key: channelKeyByDiscordId.get(String(channel.id)),
                name: channel.name,
                type: Number(channel.type),
                position: Number(channel.position) || 0,
                parent: channel.parent_id ? channelKeyByDiscordId.get(String(channel.parent_id)) ?? null : null,
                permissionOverwrites: overwrites
            };
            const optional = {
                topic: channel.topic,
                nsfw: channel.nsfw,
                bitrate: channel.bitrate,
                user_limit: channel.user_limit,
                rate_limit_per_user: channel.rate_limit_per_user,
                rtc_region: channel.rtc_region,
                video_quality_mode: channel.video_quality_mode,
                default_auto_archive_duration: channel.default_auto_archive_duration,
                default_thread_rate_limit_per_user: channel.default_thread_rate_limit_per_user,
                default_sort_order: channel.default_sort_order,
                default_forum_layout: channel.default_forum_layout,
                available_tags: channel.available_tags,
                default_reaction_emoji: channel.default_reaction_emoji
            };
            for (const [key, value] of Object.entries(optional)) {
                if (value !== undefined && value !== null) channelDoc[key] = value;
            }
            return channelDoc;
        }).sort((a, b) => a.position - b.position);

    const unsupported = sourceChannels
        .filter(channel => !SUPPORTED_CHANNEL_TYPES.includes(Number(channel.type)))
        .map(channel => ({ name: channel.name, type: Number(channel.type) }));

    return {
        format: STRUCTURE_FORMAT,
        version: STRUCTURE_VERSION,
        exportedAt: new Date().toISOString(),
        guild: {
            name: asString(guild.name) || "Imported server",
            description: asString(guild.description)
        },
        roles: roleDocs,
        channels: channelDocs,
        exportNotes: {
            unsupportedChannels: unsupported,
            omittedManagedRoles: sourceRoles.filter(role => role.id !== guild.id && (role.managed || role.tags?.bot_id || role.tags?.integration_id)).length,
            roleIconsNotIncluded: sourceRoles.some(role => role.icon)
        }
    };
}

export function serializeStructureDocument(document) {
    const validation = validateStructureDocument(document);
    if (!validation.valid) {
        throw new Error(`Cannot serialize invalid CopyServer document: ${validation.errors.join("; ")}`);
    }
    return JSON.stringify(document, null, 2) + "\n";
}

export function parseStructureDocument(text) {
    let parsed;
    try {
        parsed = JSON.parse(String(text).replace(/^\uFEFF/, ""));
    } catch (error) {
        throw new Error(`Invalid JSON in TXT document: ${error.message}`);
    }
    const validation = validateStructureDocument(parsed);
    if (!validation.valid) {
        throw new Error(validation.errors.join("\n"));
    }
    return { document: parsed, ...validation };
}

export function validateStructureDocument(document) {
    const errors = [];
    const warnings = [];
    if (!isObject(document)) return { valid: false, errors: ["Document root must be a JSON object"], warnings };
    if (document.format !== STRUCTURE_FORMAT) errors.push(`format must be "${STRUCTURE_FORMAT}"`);
    if (document.version !== STRUCTURE_VERSION) errors.push(`Unsupported document version: ${document.version}`);
    if (!isObject(document.guild) || !asString(document.guild.name).trim()) errors.push("guild.name is required");
    if (!Array.isArray(document.roles)) errors.push("roles must be an array");
    if (!Array.isArray(document.channels)) errors.push("channels must be an array");
    if (errors.length) return { valid: false, errors, warnings };

    const roleKeys = new Set();
    let everyoneCount = 0;
    for (const [index, role] of document.roles.entries()) {
        const label = `roles[${index}]`;
        if (!isObject(role)) { errors.push(`${label} must be an object`); continue; }
        if (!asString(role.key).trim()) errors.push(`${label}.key is required`);
        else if (roleKeys.has(role.key)) errors.push(`Duplicate role key: ${role.key}`);
        else roleKeys.add(role.key);
        if (!asString(role.name).trim()) errors.push(`${label}.name is required`);
        if (decimalBits(role.permissions) === null) errors.push(`${label}.permissions must be an unsigned decimal bitfield string`);
        if (role.isEveryone || role.key === "everyone") everyoneCount++;
    }
    if (everyoneCount !== 1) errors.push("Exactly one @everyone role entry is required");

    const channelKeys = new Set();
    const categoryKeys = new Set();
    for (const [index, channel] of document.channels.entries()) {
        const label = `channels[${index}]`;
        if (!isObject(channel)) { errors.push(`${label} must be an object`); continue; }
        if (!asString(channel.key).trim()) errors.push(`${label}.key is required`);
        else if (channelKeys.has(channel.key)) errors.push(`Duplicate channel key: ${channel.key}`);
        else channelKeys.add(channel.key);
        if (!asString(channel.name).trim()) errors.push(`${label}.name is required`);
        if (!SUPPORTED_CHANNEL_TYPES.includes(Number(channel.type))) errors.push(`${label} has unsupported channel type ${channel.type}`);
        if (Number(channel.type) === 4) categoryKeys.add(channel.key);
        if (channel.permissionOverwrites !== undefined && !Array.isArray(channel.permissionOverwrites)) {
            errors.push(`${label}.permissionOverwrites must be an array`);
        }
        for (const [owIndex, overwrite] of (channel.permissionOverwrites ?? []).entries()) {
            const owLabel = `${label}.permissionOverwrites[${owIndex}]`;
            if (!isObject(overwrite)) { errors.push(`${owLabel} must be an object`); continue; }
            if (!["everyone", "role", "member"].includes(overwrite.target)) errors.push(`${owLabel}.target must be everyone, role, or member`);
            if (overwrite.target === "role" && !roleKeys.has(overwrite.role)) errors.push(`${owLabel} references unknown role key "${overwrite.role}"`);
            if (overwrite.target === "member" && !asString(overwrite.memberId).trim()) errors.push(`${owLabel}.memberId is required`);
            if (decimalBits(overwrite.allow) === null || decimalBits(overwrite.deny) === null) errors.push(`${owLabel} allow/deny must be unsigned decimal bitfield strings`);
        }
    }
    for (const channel of document.channels) {
        if (channel?.parent && !channelKeys.has(channel.parent)) errors.push(`Channel "${channel.name}" references unknown parent "${channel.parent}"`);
        else if (channel?.parent && !categoryKeys.has(channel.parent)) errors.push(`Channel "${channel.name}" parent must reference a category`);
    }
    if (!document.channels.some(channel => Number(channel.type) === 4)) warnings.push("Document contains no categories");
    if (document.exportNotes?.unsupportedChannels?.length) warnings.push(`${document.exportNotes.unsupportedChannels.length} unsupported source channel(s) were omitted during export`);
    if (document.exportNotes?.roleIconsNotIncluded) warnings.push("Role icon images are not embedded in Structure Document v1");
    return { valid: errors.length === 0, errors, warnings };
}

export function buildStructureImportPlan(document, targetGuildId) {
    const validation = validateStructureDocument(document);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const everyone = document.roles.find(role => role.isEveryone || role.key === "everyone");
    const roleMap = new Map([["everyone", String(targetGuildId)]]);
    const roles = document.roles
        .filter(role => !(role.isEveryone || role.key === "everyone"))
        .sort((a, b) => Number(a.position) - Number(b.position));
    const categories = document.channels.filter(channel => Number(channel.type) === 4).sort((a, b) => Number(a.position) - Number(b.position));
    const channels = document.channels.filter(channel => Number(channel.type) !== 4).sort((a, b) => Number(a.position) - Number(b.position));
    return {
        everyonePermissions: decimalBits(everyone.permissions),
        roles,
        categories,
        channels,
        roleMap,
        mapOverwrites(overwrites = []) {
            return overwrites.map(overwrite => {
                if (overwrite.target === "everyone") return { id: String(targetGuildId), type: 0, allow: decimalBits(overwrite.allow), deny: decimalBits(overwrite.deny) };
                if (overwrite.target === "role") {
                    const id = roleMap.get(overwrite.role);
                    if (!id) throw new Error(`Role "${overwrite.role}" has not been created; cannot map permission overwrite`);
                    return { id, type: 0, allow: decimalBits(overwrite.allow), deny: decimalBits(overwrite.deny) };
                }
                return { id: String(overwrite.memberId), type: 1, allow: decimalBits(overwrite.allow), deny: decimalBits(overwrite.deny) };
            });
        }
    };
}
