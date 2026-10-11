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
        const tag = (cfg.watermarkText || "[Клон: ServerCloner Pro]").trim();
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

// ================= TEST SUITE =================

test('Requirement 10: Watermark handles empty topic', () => {
    const ch = { name: 'welcome', type: 0, topic: '' };
    const cfg = { watermark: true, watermarkText: '[Клон: ServerCloner Pro]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, '[Клон: ServerCloner Pro]');
});

test('Requirement 10: Watermark handles normal topic', () => {
    const ch = { name: 'rules', type: 0, topic: 'Правила нашего сервера' };
    const cfg = { watermark: true, watermarkText: '[Клон: ServerCloner Pro]' };
    const result = processTopicWatermark(ch, cfg);
    assert.equal(result, 'Правила нашего сервера · [Клон: ServerCloner Pro]');
});

test('Requirement 10: Watermark at exactly 1024 characters max length — preserves topic without silent truncation', () => {
    const maxTopic = 'X'.repeat(1024);
    const ch = { name: 'overflow-test', type: 0, topic: maxTopic };
    const cfg = { watermark: true, watermarkText: '[Клон: ServerCloner Pro]' };
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

