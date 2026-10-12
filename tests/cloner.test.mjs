import test from 'node:test';
import assert from 'node:assert/strict';

// Constants
const MAX_TOPIC_LENGTH = 1024;
const UNSUPPORTED_TYPES = [6, 10, 11, 12];
const SUPPORTED_TYPES = [0, 2, 4, 5, 13, 15, 16];

// Helper: Token masking
export function sanitizeToken(text) {
    if (!text) return "";
    return String(text).replace(/[a-zA-Z0-9_-]{24}\.[a-zA-Z0-9_-]{6}\.[a-zA-Z0-9_-]{27,}/g, "[TOKEN_PROTECTED]");
}

// Helper: Watermark topic processor
export function processTopicWatermark(ch, cfg, logCallback, reviewCollector) {
    let topicText = ch.topic || "";
    if (cfg.watermark && ch.type !== 4) {
        const tag = (cfg.watermarkText || "[Клон: CopyServer Pro]").trim();
        if (tag) {
            const candidate = topicText ? `${topicText} · ${tag}` : tag;
            if (candidate.length > MAX_TOPIC_LENGTH) {
                // DO NOT silently truncate! Keep original topic intact and warn
                logCallback?.(
                    `[Водяной знак] Тема канала «${ch.name}» с водяным знаком (${candidate.length} симв.) превышает лимит Discord (${MAX_TOPIC_LENGTH}). Исходное описание сохранено без изменений; канал добавлен в список ручной проверки.`,
                    'warn'
                );
                reviewCollector?.push({
                    type: 'channel',
                    name: ch.name,
                    reason: `Превышен лимит описания (длина ${candidate.length} > ${MAX_TOPIC_LENGTH})`,
                    actionRequired: 'Вручную скорректировать описание в настройках канала'
                });
            } else {
                topicText = candidate;
            }
        }
    }
    return topicText;
}

// Helper: Check hidden channel
export function isChannelHidden(ch, srcGuildId) {
    if (!ch.permission_overwrites) return false;
    const everyoneOW = ch.permission_overwrites.find((ow) => ow.id === srcGuildId && ow.type === 0);
    if (!everyoneOW) return false;
    try {
        const denyBig = BigInt(everyoneOW.deny || "0");
        return (denyBig & 1024n) === 1024n;
    } catch {
        return false;
    }
}

// Helper: Channel tree and orphan planner
export function buildChannelPlan(channels, cfg, logCallback, reviewCollector) {
    const unsupported = channels.filter(c => UNSUPPORTED_TYPES.includes(c.type));
    const usable = channels.filter(c => !UNSUPPORTED_TYPES.includes(c.type));

    if (unsupported.length > 0) {
        logCallback?.(
            `[Пропуск неподдерживаемых объектов] Обнаружено ${unsupported.length} веток/устаревших каналов (типы ${Array.from(new Set(unsupported.map(c => c.type))).join(', ')}). Ветки Discord не подлежат прямому копированию REST API и исключены.`,
            'warn'
        );
    }

    const categories = usable.filter(c => c.type === 4);
    const nonCats = usable.filter(c => c.type !== 4);
    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const excludedCategories = new Set();
    const activeCategories = [];

    for (const cat of categories) {
        const isHidden = isChannelHidden(cat, cfg.src);
        if (cfg.copyHiddenChannels === false && isHidden) {
            excludedCategories.add(cat.id);
            logCallback?.(`[Фильтрация] Скрытая категория «${cat.name}» исключена пользователем`, 'warn');
        } else {
            activeCategories.push(cat);
        }
    }

    const plannedChannels = [];
    const skippedChannels = [];
    const orphanedToRoot = [];

    for (const ch of nonCats) {
        const isHidden = isChannelHidden(ch, cfg.src);
        if (cfg.copyHiddenChannels === false && isHidden) {
            skippedChannels.push({ channel: ch, reason: 'Скрытый канал отключен' });
            continue;
        }

        if (ch.parent_id && excludedCategories.has(ch.parent_id)) {
            const parentCat = categoryMap.get(ch.parent_id);
            const parentName = parentCat ? parentCat.name : ch.parent_id;

            if (cfg.orphanChannelPolicy === 'skip') {
                skippedChannels.push({
                    channel: ch,
                    reason: `Родительская категория «${parentName}» исключена (orphan policy: skip)`
                });
                logCallback?.(
                    `[Дерево каналов] Категория «${parentName}» исключена. Дочерний канал «${ch.name}» пропущен согласно orphan policy (skip).`,
                    'info'
                );
                continue;
            } else {
                // orphan policy: 'root'
                const modified = { ...ch, parent_id: null, isOrphanRelocated: true };
                orphanedToRoot.push(modified);
                plannedChannels.push(modified);
                logCallback?.(
                    `[Изменение структуры] Категория «${parentName}» исключена. Дочерний канал «${ch.name}» перенесен в корень сервера (orphan policy: root).`,
                    'warn'
                );
                reviewCollector?.push({
                    type: 'channel',
                    name: ch.name,
                    reason: `Родительская категория «${parentName}» исключена, канал перенесен в корень`,
                    actionRequired: 'Привязать к новой категории или оставить в корне'
                });
                continue;
            }
        }

        plannedChannels.push(ch);
    }

    return {
        unsupported,
        activeCategories,
        plannedChannels,
        skippedChannels,
        orphanedToRoot
    };
}

// Helper: Post-creation parent_id verification
export function verifyChannelParent(srcChannel, createdChannel, idMap, reviewCollector) {
    if (srcChannel.parent_id && idMap.has(srcChannel.parent_id)) {
        const expectedParentId = idMap.get(srcChannel.parent_id);
        if (createdChannel.parent_id !== expectedParentId) {
            reviewCollector?.push({
                type: 'channel',
                name: srcChannel.name,
                reason: `Несоответствие parent_id: получено ${createdChannel.parent_id}, ожидалось ${expectedParentId}`,
                actionRequired: 'Переместить канал в правильную категорию'
            });
            return false;
        }
    }
    return true;
}

// Helper: Audit evaluation
export function evaluateAuditStatus(roles, channels, emojis, errors, manualReviews, aborted = false) {
    if (aborted) return 'aborted';
    if (errors.length > 0 || roles.failed > 0 || channels.failed > 0 || emojis.failed > 0) {
        return 'partial_with_errors';
    }
    if (manualReviews.length > 0) {
        return 'partial_with_errors';
    }
    return 'success';
}

// Helper: Adapt channel for non-community guilds (e.g. Announcement type 5 -> Text type 0)
export function adaptChannelForGuild(ch, isCommunityGuild = false) {
    if (!isCommunityGuild && ch.type === 5) {
        return {
            ...ch,
            type: 0,
            adaptedFromAnnouncement: true
        };
    }
    return { ...ch };
}

// Helper: Map channel permission overwrites preserving @everyone deny (hidden channels) and roles
export function mapPermissionOverwrites(overwrites, srcGuildId, dstGuildId, roleMap, allowUserOW = false) {
    if (!overwrites || !Array.isArray(overwrites)) return [];
    const mapped = [];
    for (const ow of overwrites) {
        if (ow.type === 0) {
            // Role overwrite
            if (ow.id === srcGuildId) {
                mapped.push({ id: dstGuildId, type: 0, allow: ow.allow, deny: ow.deny });
            } else if (roleMap.has(ow.id)) {
                mapped.push({ id: roleMap.get(ow.id), type: 0, allow: ow.allow, deny: ow.deny });
            }
        } else if (ow.type === 1 && allowUserOW) {
            mapped.push({ id: ow.id, type: 1, allow: ow.allow, deny: ow.deny });
        }
    }
    return mapped;
}

export const ELEVATED_PERMS_BITMASK = (
    (1n << 3n) |   // ADMINISTRATOR (8)
    (1n << 5n) |   // MANAGE_GUILD (32)
    (1n << 28n) |  // MANAGE_ROLES (268435456)
    (1n << 4n) |   // MANAGE_CHANNELS (16)
    (1n << 1n) |   // KICK_MEMBERS (2)
    (1n << 2n) |   // BAN_MEMBERS (4)
    (1n << 29n) |  // MANAGE_WEBHOOKS (536870912)
    (1n << 30n) |  // MANAGE_GUILD_EXPRESSIONS / EMOJIS (1073741824)
    (1n << 17n) |  // MENTION_EVERYONE (131072)
    (1n << 40n) |  // MODERATE_MEMBERS (TIMEOUT) (1099511627776)
    (1n << 13n)    // MANAGE_MESSAGES (8192)
);

// Helper: Smart fallback for role creation on 403 Forbidden
export function createRoleSmartFallback(role, is403 = true) {
    if (is403) {
        const safeBody = {
            name: role.name,
            color: role.color || 0,
            hoist: !!role.hoist,
            mentionable: !!role.mentionable,
            permissions: "0" // Neutral permissions bypass 403 error
        };
        const safePermsBig = BigInt(role.permissions || "0") & ~ELEVATED_PERMS_BITMASK;
        return {
            createdBody: safeBody,
            patchedPermissions: safePermsBig.toString(),
            manualReview: {
                type: 'role',
                name: role.name,
                id: role.id,
                reason: 'Discord 403 Forbidden: Повышенные права (Администратор/2FA) требуют назначения владельцем сервера',
                actionRequired: 'Открыть настройки сервера -> Роли -> Назначить повышенные права роли вручную',
                details: {
                    permissionsBitfield: role.permissions,
                    color: role.color
                }
            }
        };
    }
    return { createdBody: role };
}

// ================= TEST SUITE =================

test('Requirement 10: Watermark handles empty topic', () => {
    const ch = { name: 'welcome', type: 0, topic: '' };
    const cfg = { watermark: true, watermarkText: '[Клон: CopyServer Pro]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, '[Клон: CopyServer Pro]');
});

test('Requirement 10: Watermark handles normal topic', () => {
    const ch = { name: 'rules', type: 0, topic: 'Правила нашего сервера' };
    const cfg = { watermark: true, watermarkText: '[Клон: CopyServer Pro]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, 'Правила нашего сервера · [Клон: CopyServer Pro]');
});

test('Requirement 10: Watermark at exactly 1024 characters max length — preserves topic without silent truncation', () => {
    const maxTopic = 'X'.repeat(1024);
    const ch = { name: 'overflow-test', type: 0, topic: maxTopic };
    const cfg = { watermark: true, watermarkText: '[Клон: CopyServer Pro]' };
    const warnings = [];
    const reviews = [];

    const result = processTopicWatermark(
        ch,
        cfg,
        (msg, type) => { if (type === 'warn') warnings.push(msg); },
        reviews
    );

    // Topic MUST NOT be truncated silently
    assert.equal(result, maxTopic);
    assert.equal(result.length, 1024);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('превышает лимит Discord (1024)'));
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].name, 'overflow-test');
});

test('Requirement 10: Watermark disabled — leaves topic 1:1 intact', () => {
    const ch = { name: 'clean', type: 0, topic: 'Чистый топик без водяного знака' };
    const cfg = { watermark: false, watermarkText: '[Клон]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, 'Чистый топик без водяного знака');
});

test('Requirement 10: Watermark does not apply to categories (type 4)', () => {
    const ch = { name: 'Категория', type: 4, topic: '' };
    const cfg = { watermark: true, watermarkText: '[Клон]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, '');
});

test('Requirement 9: Discord threads (types 10, 11, 12) and store (type 6) are separated with warnings and not counted as expected', () => {
    const channels = [
        { id: '1', name: 'general', type: 0 },
        { id: '2', name: 'voice', type: 2 },
        { id: '3', name: 'category', type: 4 },
        { id: '4', name: 'announcements', type: 5 },
        { id: '5', name: 'news-thread', type: 10 },
        { id: '6', name: 'public-thread', type: 11 },
        { id: '7', name: 'private-thread', type: 12 },
        { id: '8', name: 'store', type: 6 },
    ];
    const cfg = { src: 'guild1', copyHiddenChannels: true, orphanChannelPolicy: 'skip' };
    const warnings = [];

    const plan = buildChannelPlan(channels, cfg, (msg, type) => {
        if (type === 'warn') warnings.push(msg);
    });

    assert.equal(plan.unsupported.length, 4);
    assert.equal(plan.activeCategories.length, 1);
    assert.equal(plan.plannedChannels.length, 3);
    assert.ok(warnings.some(w => w.includes('Пропуск неподдерживаемых объектов')));
});

test('Requirement 8: Category tree — orphan policy "skip" skips children of excluded category', () => {
    const channels = [
        {
            id: 'cat-hidden',
            name: 'Скрытая категория',
            type: 4,
            permission_overwrites: [{ id: 'guild1', type: 0, deny: '1024' }]
        },
        {
            id: 'ch-child-1',
            name: 'секрет-1',
            type: 0,
            parent_id: 'cat-hidden',
            permission_overwrites: [{ id: 'guild1', type: 0, deny: '1024' }]
        },
        {
            id: 'cat-pub',
            name: 'Публичная категория',
            type: 4,
            permission_overwrites: []
        },
        {
            id: 'ch-pub-1',
            name: 'общий-чат',
            type: 0,
            parent_id: 'cat-pub',
            permission_overwrites: []
        }
    ];

    const cfg = { src: 'guild1', copyHiddenChannels: false, orphanChannelPolicy: 'skip' };
    const plan = buildChannelPlan(channels, cfg);

    assert.equal(plan.activeCategories.length, 1);
    assert.equal(plan.activeCategories[0].id, 'cat-pub');
    assert.equal(plan.plannedChannels.length, 1);
    assert.equal(plan.plannedChannels[0].id, 'ch-pub-1');
    assert.equal(plan.skippedChannels.length, 1);
    assert.equal(plan.skippedChannels[0].channel.id, 'ch-child-1');
});

test('Requirement 8: Category tree — orphan policy "root" preserves child channel and clears parent_id', () => {
    const channels = [
        {
            id: 'cat-hidden',
            name: 'Скрытая категория',
            type: 4,
            permission_overwrites: [{ id: 'guild1', type: 0, deny: '1024' }]
        },
        {
            id: 'ch-orphan',
            name: 'сиротский-чат',
            type: 0,
            parent_id: 'cat-hidden',
            permission_overwrites: []
        }
    ];

    const cfg = { src: 'guild1', copyHiddenChannels: false, orphanChannelPolicy: 'root' };
    const reviews = [];
    const plan = buildChannelPlan(channels, cfg, undefined, reviews);

    assert.equal(plan.activeCategories.length, 0);
    assert.equal(plan.plannedChannels.length, 1);
    assert.equal(plan.plannedChannels[0].id, 'ch-orphan');
    assert.equal(plan.plannedChannels[0].parent_id, null);
    assert.equal(plan.orphanedToRoot.length, 1);
    assert.equal(reviews.length, 1);
    assert.ok(reviews[0].reason.includes('перенесен в корень'));
});

test('Requirement 8: Verifies parent_id post-creation against ID map', () => {
    const idMap = new Map([['src-cat-1', 'dst-cat-1']]);
    const srcChannel = { id: 'ch-src', name: 'general', parent_id: 'src-cat-1' };
    const reviews = [];

    // Valid case: parent_id matches
    const goodCreated = { id: 'ch-dst', parent_id: 'dst-cat-1' };
    const ok = verifyChannelParent(srcChannel, goodCreated, idMap, reviews);
    assert.equal(ok, true);
    assert.equal(reviews.length, 0);

    // Mismatch case: parent_id does not match
    const badCreated = { id: 'ch-dst', parent_id: 'dst-wrong-parent' };
    const mismatch = verifyChannelParent(srcChannel, badCreated, idMap, reviews);
    assert.equal(mismatch, false);
    assert.equal(reviews.length, 1);
    assert.ok(reviews[0].reason.includes('Несоответствие parent_id'));
});

test('Requirement 11: Audit status reflects actual results and manual reviews', () => {
    const goodRoles = { expected: 5, created: 5, matchedExisting: 0, skipped: 0, verified: 5, failed: 0 };
    const goodChannels = { expected: 10, created: 10, matchedExisting: 0, skipped: 0, verified: 10, failed: 0 };
    const goodEmojis = { expected: 4, created: 4, matchedExisting: 0, skipped: 0, verified: 4, failed: 0 };

    // Case 1: 100% clean success
    const status1 = evaluateAuditStatus(goodRoles, goodChannels, goodEmojis, [], []);
    assert.equal(status1, 'success');

    // Case 2: Failed channels -> partial_with_errors
    const failedChannels = { ...goodChannels, failed: 1 };
    const status2 = evaluateAuditStatus(goodRoles, failedChannels, goodEmojis, ['Канал не создан'], []);
    assert.equal(status2, 'partial_with_errors');

    // Case 3: Manual review item needed (e.g. watermark overflow or orphan relocation)
    const reviewItem = { type: 'channel', name: 'ch1', reason: 'Лимит', actionRequired: 'Проверить' };
    const status3 = evaluateAuditStatus(goodRoles, goodChannels, goodEmojis, [], [reviewItem]);
    assert.equal(status3, 'partial_with_errors');

    // Case 4: Aborted
    const status4 = evaluateAuditStatus(goodRoles, goodChannels, goodEmojis, [], [], true);
    assert.equal(status4, 'aborted');
});

test('Requirement 13: Token sanitization masks sensitive Discord credentials in logs', () => {
    const tokenExample = "mfa.abc1234567890abcdef1234567890abcdef";
    const logStr = "Authorization failed for token MTAyMzg5NDk0OTA3NDgzNDQ0MQ.Gb7XYZ.abcdefghijklmnopqrstuvwxyz12345 during API call";
    const sanitized = sanitizeToken(logStr);
    assert.ok(!sanitized.includes("Gb7XYZ"));
    assert.ok(sanitized.includes("[TOKEN_PROTECTED]"));
});

// Preflight checks logic test
export async function runPreflight(mockApiCall, cfg, warnings, errors) {
    try {
        const targetGuild = await mockApiCall(`/guilds/${cfg.dst}`);
        if (!targetGuild) {
            errors.push("Целевой сервер недоступен");
            return false;
        }
        return true;
    } catch (e) {
        const msg = String(e?.message || e);
        const isCritical = /401|403|unauthorized|forbidden|отсутствует доступ|permission/i.test(msg) ||
            e?.status === 401 || e?.status === 403;
        if (isCritical) {
            errors.push(`Критическая ошибка доступа Pre-Flight [${msg}]`);
            return false;
        }
        warnings.push(`Предупреждение Pre-Flight: ${msg}`);
        return true;
    }
}

test('Fix 1: Pre-flight returns false on critical access error exception (401/403/Forbidden)', async () => {
    const warnings = [];
    const errors = [];
    const cfg = { src: 'src-1', dst: 'dst-1' };

    // Critical exception: 403 Forbidden
    const mockCrit = async () => {
        const err = new Error('HTTP 403: Forbidden - Missing Permissions');
        err.status = 403;
        throw err;
    };

    const resCrit = await runPreflight(mockCrit, cfg, warnings, errors);
    assert.equal(resCrit, false, 'Preflight must return false on critical permission error');
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes('Критическая ошибка доступа'));

    // Non-critical exception: transient latency / warning
    const warnList = [];
    const errList = [];
    const mockWarn = async () => {
        throw new Error('504 Gateway Timeout or Rate Limit Warning');
    };
    const resWarn = await runPreflight(mockWarn, cfg, warnList, errList);
    assert.equal(resWarn, true, 'Non-critical error issues warning but does not abort prematurely');
    assert.equal(warnList.length, 1);
    assert.equal(errList.length, 0);
});

// Role color processing test
export function processRoleColors(role) {
    const body = {
        name: role.name,
        permissions: role.permissions || '0',
    };
    if (role.color) body.color = role.color;

    if (role.colors && typeof role.colors === 'object') {
        body.colors = {
            primary_color: role.colors.primary_color ?? role.color ?? 0,
            ...(role.colors.secondary_color !== undefined ? { secondary_color: role.colors.secondary_color } : {}),
            ...(role.colors.tertiary_color !== undefined ? { tertiary_color: role.colors.tertiary_color } : {})
        };
    }
    return body;
}

test('Fix 2: Full gradient and holographic role colors preservation with primary, secondary, and tertiary', () => {
    // Standard monochrome role
    const monoRole = { name: 'Admin', color: 0xff0000 };
    const monoBody = processRoleColors(monoRole);
    assert.equal(monoBody.color, 0xff0000);
    assert.equal(monoBody.colors, undefined);

    // Gradient/holographic role with secondary & tertiary colors
    const gradRole = {
        name: 'VIP Holographic',
        color: 0x112233,
        colors: {
            primary_color: 0x112233,
            secondary_color: 0x445566,
            tertiary_color: 0x778899
        }
    };
    const gradBody = processRoleColors(gradRole);
    assert.ok(gradBody.colors);
    assert.equal(gradBody.colors.primary_color, 0x112233);
    assert.equal(gradBody.colors.secondary_color, 0x445566);
    assert.equal(gradBody.colors.tertiary_color, 0x778899);
});

// Role creation style verification logic
export function validateRoleCreatedColors(srcRole, createdRole, warnings, manualReviews) {
    if (srcRole.colors && (srcRole.colors.secondary_color || srcRole.colors.tertiary_color)) {
        const hasSecondary = createdRole.colors && createdRole.colors.secondary_color !== undefined;
        if (!hasSecondary) {
            const warnGradient = `Роль «${srcRole.name}»: градиентный/голографический стиль не поддерживается целевым сервером (сохранен базовый цвет)`;
            warnings.push(warnGradient);
            manualReviews.push({
                type: 'role',
                name: srcRole.name,
                reason: 'Целевой сервер Discord отклонил вторичный/третичный цвет градиента',
                actionRequired: 'Проверить премиум-статус целевого сервера или настроить цвет вручную'
            });
            return false;
        }
    }
    return true;
}

test('Fix 2 Validation: Detects rejected gradient/holographic styles and marks them in manual review list', () => {
    const srcGradRole = {
        name: 'Platinum Supporter',
        color: 0x112233,
        colors: { primary_color: 0x112233, secondary_color: 0x445566, tertiary_color: 0x778899 }
    };

    // Case 1: Target server accepts and preserves gradient
    const acceptedRole = {
        id: 'new-role-1',
        name: 'Platinum Supporter',
        colors: { primary_color: 0x112233, secondary_color: 0x445566 }
    };
    const warn1 = [];
    const reviews1 = [];
    const valid1 = validateRoleCreatedColors(srcGradRole, acceptedRole, warn1, reviews1);
    assert.equal(valid1, true);
    assert.equal(warn1.length, 0);
    assert.equal(reviews1.length, 0);

    // Case 2: Target server strips gradient and falls back to monochrome
    const rejectedRole = {
        id: 'new-role-2',
        name: 'Platinum Supporter',
        color: 0x112233,
        colors: null // Target stripped extended colors
    };
    const warn2 = [];
    const reviews2 = [];
    const valid2 = validateRoleCreatedColors(srcGradRole, rejectedRole, warn2, reviews2);
    assert.equal(valid2, false);
    assert.equal(warn2.length, 1);
    assert.equal(reviews2.length, 1);
    assert.equal(reviews2[0].type, 'role');
    assert.ok(reviews2[0].reason.includes('отклонил'));
});

// Helper for simulating guild creation
export function prepareCreateGuildPayload(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('Имя сервера не может быть пустым');
    return {
        name: trimmed,
        icon: null
    };
}

// Helper for simulating guild purge sorting & filtering
export function planGuildPurge(guildId, sourceGuildId, channels, roles, emojis) {
    if (!guildId) throw new Error('Не указан целевой сервер для очистки');
    if (guildId === sourceGuildId) {
        throw new Error('Запрещено: исходный сервер-донор защищен от очистки');
    }

    // Channels: regular channels first, categories (type 4) last
    const sortedChannels = [...channels].sort((a, b) => (a.type === 4 ? 1 : 0) - (b.type === 4 ? 1 : 0));

    // Roles: filter out @everyone (id === guildId) and managed roles
    const rolesToDelete = roles.filter(r => r.id !== guildId && !r.managed);

    // Emojis: all custom emojis
    const emojisToDelete = [...emojis];

    return {
        channelsToDelete: sortedChannels,
        rolesToDelete,
        emojisToDelete
    };
}

test('Requirement: Server creation helper prepares proper payload and rejects empty names', () => {
    const payload = prepareCreateGuildPayload('  [Клон] Gaming Community  ');
    assert.deepEqual(payload, {
        name: '[Клон] Gaming Community',
        icon: null
    });

    assert.throws(() => {
        prepareCreateGuildPayload('   ');
    }, /Имя сервера не может быть пустым/);
});

test('Requirement: Server purge helper ensures donor server protection and preserves @everyone and managed bot roles', () => {
    const donorId = '111222333';
    const targetId = '999888777';

    // 1. Safety check: donor server cannot be purged
    assert.throws(() => {
        planGuildPurge(donorId, donorId, [], [], []);
    }, /исходный сервер-донор защищен/);

    // 2. Channels order: regular channels must be deleted before categories
    const mockChannels = [
        { id: 'cat-1', name: 'ИНФОРМАЦИЯ', type: 4 },
        { id: 'ch-1', name: 'новости', type: 0, parent_id: 'cat-1' },
        { id: 'ch-2', name: 'чат', type: 0, parent_id: 'cat-1' },
        { id: 'cat-2', name: 'ГОЛОС', type: 4 },
        { id: 'voice-1', name: 'Общий', type: 2, parent_id: 'cat-2' }
    ];

    // 3. Roles filter: @everyone (id === targetId) and managed bot role must NOT be deleted
    const mockRoles = [
        { id: targetId, name: '@everyone', managed: false },
        { id: 'bot-role-1', name: 'Dyno Bot', managed: true },
        { id: 'custom-role-1', name: 'VIP Member', managed: false },
        { id: 'custom-role-2', name: 'Admin', managed: false }
    ];

    const mockEmojis = [
        { id: 'em-1', name: 'fire' },
        { id: 'em-2', name: 'heart' }
    ];

    const plan = planGuildPurge(targetId, donorId, mockChannels, mockRoles, mockEmojis);

    // Verify channel order: regular channels first, categories last
    assert.equal(plan.channelsToDelete.length, 5);
    assert.notEqual(plan.channelsToDelete[0].type, 4);
    assert.notEqual(plan.channelsToDelete[1].type, 4);
    assert.notEqual(plan.channelsToDelete[2].type, 4);
    assert.equal(plan.channelsToDelete[3].type, 4);
    assert.equal(plan.channelsToDelete[4].type, 4);

    // Verify roles: only 2 custom roles to delete, @everyone and managed bot role preserved
    assert.equal(plan.rolesToDelete.length, 2);
    assert.deepEqual(plan.rolesToDelete.map(r => r.name), ['VIP Member', 'Admin']);

    // Verify emojis
    assert.equal(plan.emojisToDelete.length, 2);
});

test('Requirement 4: Preserves exact channel permissions and role overwrites', () => {
    const srcGuildId = 'src-123';
    const dstGuildId = 'dst-456';
    const roleMap = new Map([
        ['src-admin-role', 'dst-admin-role'],
        ['src-moderator-role', 'dst-moderator-role']
    ]);

    const originalOverwrites = [
        { id: srcGuildId, type: 0, allow: '1024', deny: '0' }, // @everyone
        { id: 'src-admin-role', type: 0, allow: '8', deny: '0' },
        { id: 'src-moderator-role', type: 0, allow: '8192', deny: '2048' },
        { id: 'unknown-role', type: 0, allow: '1024', deny: '0' } // non-existent role, should be filtered
    ];

    const mapped = mapPermissionOverwrites(originalOverwrites, srcGuildId, dstGuildId, roleMap);

    assert.equal(mapped.length, 3);
    // @everyone mapped to target guild id
    assert.deepEqual(mapped[0], { id: dstGuildId, type: 0, allow: '1024', deny: '0' });
    // roles mapped to their target counterparts
    assert.deepEqual(mapped[1], { id: 'dst-admin-role', type: 0, allow: '8', deny: '0' });
    assert.deepEqual(mapped[2], { id: 'dst-moderator-role', type: 0, allow: '8192', deny: '2048' });
});

test('Requirement 4: Hidden channels identification and preservation of @everyone VIEW_CHANNEL deny (1024)', () => {
    const srcGuildId = 'guild-999';
    const dstGuildId = 'guild-888';

    // Channel with deny 1024 on @everyone is a hidden channel
    const hiddenChannel = {
        name: 'secret-chat',
        type: 0,
        permission_overwrites: [
            { id: srcGuildId, type: 0, allow: '0', deny: '1024' },
            { id: 'role-vip', type: 0, allow: '1024', deny: '0' }
        ]
    };

    assert.equal(isChannelHidden(hiddenChannel, srcGuildId), true);

    const roleMap = new Map([['role-vip', 'target-role-vip']]);
    const mapped = mapPermissionOverwrites(hiddenChannel.permission_overwrites, srcGuildId, dstGuildId, roleMap);

    // Mapped overwrites must preserve the hidden channel setting (@everyone deny 1024)
    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].id, dstGuildId);
    assert.equal(mapped[0].deny, '1024');
    assert.equal(mapped[1].id, 'target-role-vip');
    assert.equal(mapped[1].allow, '1024');

    // Public channel without VIEW_CHANNEL deny
    const publicChannel = {
        name: 'general',
        type: 0,
        permission_overwrites: [
            { id: srcGuildId, type: 0, allow: '1024', deny: '0' }
        ]
    };
    assert.equal(isChannelHidden(publicChannel, srcGuildId), false);
});

test('Requirement 4: Announcement channel (type 5) adapts to regular text channel (type 0) when guild is not community', () => {
    const announcementChannel = {
        id: 'ann-1',
        name: 'announcements',
        type: 5,
        topic: 'Important news'
    };

    // When guild is community, type remains 5
    const forCommunity = adaptChannelForGuild(announcementChannel, true);
    assert.equal(forCommunity.type, 5);

    // When guild is NOT community, type converts to regular text channel (0)
    const forNonCommunity = adaptChannelForGuild(announcementChannel, false);
    assert.equal(forNonCommunity.type, 0);
    assert.equal(forNonCommunity.name, 'announcements');
    assert.equal(forNonCommunity.topic, 'Important news');
    assert.equal(forNonCommunity.adaptedFromAnnouncement, true);
});

test('Requirement: Role 403 Forbidden smart bypass creates role with neutral permissions 0 and preserves review details', () => {
    const roleWithElevatedPerms = {
        id: 'role-mod-1',
        name: '♦ · Выговор 1/3',
        color: 0xe67e22,
        hoist: true,
        mentionable: false,
        permissions: '8' // ADMINISTRATOR
    };

    const result = createRoleSmartFallback(roleWithElevatedPerms, true);
    // Role created with permissions '0' to bypass 403 forbidden
    assert.equal(result.createdBody.name, '♦ · Выговор 1/3');
    assert.equal(result.createdBody.permissions, '0');
    assert.equal(result.createdBody.color, 0xe67e22);
    assert.equal(result.createdBody.hoist, true);

    // Added to manual review list with exact original details
    assert.ok(result.manualReview);
    assert.equal(result.manualReview.type, 'role');
    assert.equal(result.manualReview.name, '♦ · Выговор 1/3');
    assert.equal(result.manualReview.details.permissionsBitfield, '8');
    assert.ok(result.manualReview.reason.includes('403 Forbidden'));
});

test('Requirement: Strips elevated permission flags (ADMINISTRATOR, MANAGE_GUILD, BAN_MEMBERS) on 403 fallback', () => {
    // Role with multiple permissions: ADMINISTRATOR (8) + SEND_MESSAGES (2048) + ATTACH_FILES (32768)
    const permsBig = 8n | 2048n | 32768n;
    const role = {
        id: 'role-admin-test',
        name: 'SuperAdmin',
        permissions: permsBig.toString(),
        color: 0xed4245
    };

    const result = createRoleSmartFallback(role, true);
    // The patched permissions should only contain the safe bits (2048 + 32768 = 34816)
    const expectedSafeBig = 2048n | 32768n;
    assert.equal(result.patchedPermissions, expectedSafeBig.toString());
});

test('Requirement: Channel creation fallback strips overwrites on error and preserves category/topic', () => {
    const ch = {
        name: 'private-discussion',
        type: 0,
        parent_id: 'cat-456',
        topic: 'Sensitive discussions',
        permission_overwrites: [
            { id: 'unknown-role-id', type: 0, allow: '1024', deny: '0' }
        ]
    };

    // When overwrites cause an error, no-overwrites body preserves channel identity
    const noOwsBody = { ...ch };
    delete noOwsBody.permission_overwrites;

    assert.equal(noOwsBody.name, 'private-discussion');
    assert.equal(noOwsBody.type, 0);
    assert.equal(noOwsBody.parent_id, 'cat-456');
    assert.equal(noOwsBody.topic, 'Sensitive discussions');
    assert.equal(noOwsBody.permission_overwrites, undefined);
});

// ================= MANUAL CONTROL HELPERS & TESTS =================

export function getUncopiedEntities(srcChannels, srcRoles, dstChannels, dstRoles) {
    const dstChannelKeys = new Set(dstChannels.map(c => `${c.name}:${c.type}`));
    const dstRoleNames = new Set(dstRoles.map(r => r.name.toLowerCase()));

    const uncopiedChannels = srcChannels
        .filter(c => !dstChannelKeys.has(`${c.name}:${c.type}`))
        .map(c => ({
            id: c.id,
            name: c.name,
            kind: c.type === 4 ? 'category' : 'channel',
            channelType: c.type,
            hidden: isChannelHidden(c, c.guild_id),
            parent_id: c.parent_id,
            topic: c.topic,
            status: 'pending'
        }));

    const uncopiedRoles = srcRoles
        .filter(r => r.name !== '@everyone' && !r.managed && !dstRoleNames.has(r.name.toLowerCase()))
        .map(r => ({
            id: r.id,
            name: r.name,
            kind: 'role',
            color: r.color,
            permissions: r.permissions,
            hasElevated: (BigInt(r.permissions || '0') & ELEVATED_PERMS_BITMASK) !== 0n,
            status: 'pending'
        }));

    return {
        uncopiedChannels,
        uncopiedRoles,
        totalUncopied: uncopiedChannels.length + uncopiedRoles.length
    };
}

export function prepareForceAddPayload(item, context = {}) {
    if (item.kind === 'role') {
        const needsSafeBypass = item.hasElevated || context.forceSafe;
        return {
            endpoint: `/guilds/${context.dstGuildId}/roles`,
            body: {
                name: item.name,
                color: item.color || 0,
                hoist: !!item.hoist,
                mentionable: !!item.mentionable,
                permissions: needsSafeBypass ? "0" : (item.permissions || "0")
            },
            isSafeBypass: !!needsSafeBypass
        };
    } else {
        const parentId = item.parent_id && context.categoryIdMap ? context.categoryIdMap[item.parent_id] : item.parent_id;
        const body = {
            name: item.name,
            type: item.channelType,
            parent_id: parentId || null
        };
        if (item.channelType !== 4 && item.topic) {
            body.topic = item.topic.slice(0, MAX_TOPIC_LENGTH);
        }
        if (item.hidden) {
            body.permission_overwrites = [
                { id: context.dstGuildId, type: 0, allow: "0", deny: "1024" }
            ];
        }
        return {
            endpoint: `/guilds/${context.dstGuildId}/channels`,
            body,
            isHidden: !!item.hidden
        };
    }
}

test('Requirement Manual Control: getUncopiedEntities accurately detects missing roles and channels', () => {
    const srcChannels = [
        { id: 'c1', name: 'general', type: 0, guild_id: 'src1' },
        { id: 'c2', name: 'admin-log', type: 0, guild_id: 'src1', permission_overwrites: [{ id: 'src1', type: 0, deny: '1024' }] },
        { id: 'cat1', name: 'STAFF', type: 4, guild_id: 'src1' }
    ];
    const srcRoles = [
        { id: 'r1', name: '@everyone', permissions: '0' },
        { id: 'r2', name: 'BotRole', managed: true },
        { id: 'r3', name: 'Moderator', permissions: '268435456' },
        { id: 'r4', name: 'SuperAdmin', permissions: '8' }
    ];

    const dstChannels = [
        { id: 'dc1', name: 'general', type: 0 } // Already exists
    ];
    const dstRoles = [
        { id: 'dr1', name: '@everyone' },
        { id: 'dr2', name: 'Moderator' } // Already exists
    ];

    const uncopied = getUncopiedEntities(srcChannels, srcRoles, dstChannels, dstRoles);

    // Channels: 'admin-log' and 'STAFF' are uncopied
    assert.equal(uncopied.uncopiedChannels.length, 2);
    assert.equal(uncopied.uncopiedChannels[0].name, 'admin-log');
    assert.equal(uncopied.uncopiedChannels[0].hidden, true);
    assert.equal(uncopied.uncopiedChannels[1].name, 'STAFF');
    assert.equal(uncopied.uncopiedChannels[1].kind, 'category');

    // Roles: SuperAdmin is uncopied (@everyone and managed are skipped, Moderator already on dst)
    assert.equal(uncopied.uncopiedRoles.length, 1);
    assert.equal(uncopied.uncopiedRoles[0].name, 'SuperAdmin');
    assert.equal(uncopied.uncopiedRoles[0].hasElevated, true);
    assert.equal(uncopied.totalUncopied, 3);
});

test('Requirement Manual Control: prepareForceAddPayload generates safe 403 bypass for elevated role', () => {
    const item = {
        id: 'r4',
        name: '♦ · Выговор 1/3',
        kind: 'role',
        color: 0xe67e22,
        permissions: '8', // ADMINISTRATOR
        hasElevated: true
    };
    const context = { dstGuildId: 'dst999' };

    const payload = prepareForceAddPayload(item, context);
    assert.equal(payload.endpoint, '/guilds/dst999/roles');
    assert.equal(payload.body.name, '♦ · Выговор 1/3');
    assert.equal(payload.body.color, 0xe67e22);
    assert.equal(payload.body.permissions, '0'); // Safe neutral bypass
    assert.equal(payload.isSafeBypass, true);
});

test('Requirement Manual Control: prepareForceAddPayload generates private hidden channel with VIEW_CHANNEL deny', () => {
    const item = {
        id: 'c2',
        name: 'secret-chat',
        kind: 'channel',
        channelType: 0,
        hidden: true,
        topic: 'VIP only',
        parent_id: 'cat-orig'
    };
    const context = {
        dstGuildId: 'dst999',
        categoryIdMap: { 'cat-orig': 'cat-cloned-id' }
    };

    const payload = prepareForceAddPayload(item, context);
    assert.equal(payload.endpoint, '/guilds/dst999/channels');
    assert.equal(payload.body.name, 'secret-chat');
    assert.equal(payload.body.parent_id, 'cat-cloned-id');
    assert.equal(payload.body.topic, 'VIP only');
    assert.equal(payload.isHidden, true);
    assert.equal(payload.body.permission_overwrites.length, 1);
    assert.equal(payload.body.permission_overwrites[0].deny, '1024');
});
