import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_GUILDS, MockGuild } from '../data/mockGuilds';
import {
  Shield,
  FolderTree,
  Smile,
  Settings2,
  Image as ImageIcon,
  Check,
  Copy,
  Trash2,
  ArrowRight,
  Terminal,
  Play,
  RotateCcw,
  Sparkles,
  Layers,
  ChevronDown,
  Info,
  Server,
  Zap,
  Square,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Tag,
  Lock,
  GitFork,
  HelpCircle
} from 'lucide-react';

interface LogItem {
  id: string;
  time: string;
  tag: 'ИНФО' | 'УСПЕХ' | 'ПРЕДУПР' | 'ОШИБКА';
  type: 'info' | 'success' | 'warn' | 'error';
  msg: string;
}

export interface AuditItemReview {
  type: 'role' | 'channel' | 'category' | 'emoji' | 'setting';
  name: string;
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
  status: 'success' | 'partial_with_errors' | 'aborted' | 'failed';
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

export function DiscordPluginSimulator() {
  const [clientType, setClientType] = useState<'vencord' | 'betterdiscord'>('vencord');
  const [themeMode, setThemeMode] = useState<'dark' | 'midnight'>('dark');

  const [srcGuildId, setSrcGuildId] = useState(INITIAL_GUILDS[0].id);
  const [dstGuildId, setDstGuildId] = useState(INITIAL_GUILDS[3].id);

  // Switches
  const [roles, setRoles] = useState(true);
  const [channels, setChannels] = useState(true);
  const [emojis, setEmojis] = useState(true);
  const [settings, setSettings] = useState(true);
  const [images, setImages] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [stealthMode, setStealthMode] = useState(true);
  const [copyHiddenChannels, setCopyHiddenChannels] = useState(true);
  const [orphanChannelPolicy, setOrphanChannelPolicy] = useState<'skip' | 'root'>('skip');

  // Watermark
  const [watermark, setWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState('[Клон: ServerCloner Pro]');

  // Execution & Verification State
  const [isCloning, setIsCloning] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterTag, setFilterTag] = useState<'all' | 'info' | 'success' | 'warn' | 'error'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedLog, setCopiedLog] = useState(false);
  const [auditReport, setAuditReport] = useState<AuditReport | null>(null);
  const [showMatrixModal, setShowMatrixModal] = useState(false);
  const [showReviewItems, setShowReviewItems] = useState(false);

  const abortRef = useRef(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const srcGuild = INITIAL_GUILDS.find(g => g.id === srcGuildId);
  const dstGuild = INITIAL_GUILDS.find(g => g.id === dstGuildId);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const addLog = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const tagMap = {
      info: 'ИНФО' as const,
      success: 'УСПЕХ' as const,
      warn: 'ПРЕДУПР' as const,
      error: 'ОШИБКА' as const,
    };
    setLogs(prev => [...prev, {
      id: Math.random().toString(),
      time,
      tag: tagMap[type],
      type,
      msg
    }]);
  };

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const applyPreset = (preset: 'all' | 'structure' | 'media') => {
    if (isCloning) return;
    if (preset === 'all') {
      setRoles(true);
      setChannels(true);
      setEmojis(true);
      setSettings(true);
      setImages(true);
      setSkipDuplicates(true);
      setCopyHiddenChannels(true);
      setOrphanChannelPolicy('skip');
      showToast('Выбран пресет: Полный клон 1:1');
    } else if (preset === 'structure') {
      setRoles(true);
      setChannels(true);
      setEmojis(false);
      setSettings(false);
      setImages(false);
      setSkipDuplicates(true);
      setCopyHiddenChannels(true);
      setOrphanChannelPolicy('skip');
      showToast('Выбран пресет: Структура (роли и каналы)');
    } else if (preset === 'media') {
      setRoles(false);
      setChannels(false);
      setEmojis(true);
      setSettings(true);
      setImages(true);
      setSkipDuplicates(true);
      setCopyHiddenChannels(false);
      showToast('Выбран пресет: Медиа & Настройки');
    }
  };

  const handleAbort = () => {
    abortRef.current = true;
    addLog('Запрошена экстренная остановка процесса пользователем...', 'warn');
  };

  const handleStartClone = async () => {
    if (isCloning) return;
    if (!srcGuildId || !dstGuildId) {
      showToast('Выберите исходный и целевой сервер!');
      return;
    }
    if (srcGuildId === dstGuildId) {
      showToast('Исходный и целевой сервер должны отличаться!');
      return;
    }
    if (!roles && !channels && !emojis && !settings) {
      showToast('Отметьте хотя бы один элемент для копирования!');
      return;
    }

    abortRef.current = false;
    setIsCloning(true);
    setLogs([]);
    setAuditReport(null);
    setProgressPercent(2);
    setProgressStep('Pre-flight проверка прав администратора и квот...');

    const startedTime = Date.now();
    const warningsList: string[] = [];
    const errorsList: string[] = [];
    const reviewsList: AuditItemReview[] = [];

    let rolesMetrics: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let channelsMetrics: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let emojisMetrics: ObjectMetrics = { expected: 0, created: 0, matchedExisting: 0, skipped: 0, verified: 0, failed: 0 };
    let simulatedHiddenChannels = 0;
    let simulatedUnsupportedThreads = 2; // Simulated threads
    let simulatedOrphanAdjusted = 0;

    // 1. Pre-flight Check
    addLog(`Запуск Pre-flight проверки: Целевой сервер «${dstGuild?.name}»...`, 'info');
    await new Promise(r => setTimeout(r, 350));
    addLog('Права Manage Server & Manage Roles подтверждены (HTTP 200 OK)', 'success');

    if (stealthMode) {
      addLog('Stealth Mode активен: рандомизированный джиттер и микропаузы снижают риск антиспам-эвристик', 'info');
    }

    // 2. Roles Cloning
    if (roles && !abortRef.current) {
      setProgressStep('Клонирование и сопоставление ролей...');
      setProgressPercent(14);
      addLog('Синхронизация базовых разрешений роли @everyone...', 'info');
      await new Promise(r => setTimeout(r, 250));

      const mockRolesList = [
        { name: 'Admin [Администратор]', managed: false },
        { name: 'Moderator', managed: false },
        { name: 'VIP Supporter', managed: false },
        { name: 'Bot Integration Role', managed: true }, // Should be skipped
        { name: 'Community Member', managed: false }
      ];

      rolesMetrics.expected = 4; // Excluding managed bot role

      for (let i = 0; i < mockRolesList.length; i++) {
        if (abortRef.current) break;
        const rItem = mockRolesList[i];

        if (rItem.managed) {
          addLog(`Роль «${rItem.name}» пропущена (системная бот-роль/интеграция)`, 'info');
          rolesMetrics.skipped++;
          continue;
        }

        setProgressPercent(14 + Math.round(((i + 1) / mockRolesList.length) * 18));
        setProgressStep(`Создание ролей (${rolesMetrics.created + 1}/${rolesMetrics.expected}): ${rItem.name}`);

        await new Promise(r => setTimeout(r, 260));
        addLog(`Роль создана: ${rItem.name}`, 'info');
        rolesMetrics.created++;
        rolesMetrics.verified++;
      }

      if (!abortRef.current) {
        addLog('Иерархия и порядок позиций ролей успешно применены', 'success');
      }
    }

    // 3. Emojis
    if (emojis && !abortRef.current) {
      setProgressStep('Перенос пользовательских эмодзи...');
      setProgressPercent(36);
      const mockEmojisList = ['kekw', 'fire_dance', 'pepe_hype', 'nitro_badge'];
      emojisMetrics.expected = mockEmojisList.length;

      for (let i = 0; i < mockEmojisList.length; i++) {
        if (abortRef.current) break;
        setProgressPercent(36 + Math.round(((i + 1) / mockEmojisList.length) * 16));
        setProgressStep(`Загрузка эмодзи (${i + 1}/${mockEmojisList.length}): :${mockEmojisList[i]}:`);

        // Simulate 429 backoff
        if (i === 2) {
          addLog('[Рейтлимит 429] Получен заголовок retry_after=1.2s. Адаптивная пауза...', 'warn');
          await new Promise(r => setTimeout(r, 800));
        }

        await new Promise(r => setTimeout(r, 280));
        addLog(`Эмодзи перенесено: :${mockEmojisList[i]}:`, 'success');
        emojisMetrics.created++;
        emojisMetrics.verified++;
      }
    }

    // 4. Two-Phase Channels with Hierarchy & Orphan Policy
    if (channels && !abortRef.current) {
      setProgressStep('Построение дерева категорий и каналов...');
      setProgressPercent(54);

      // Explicit warning about threads (Requirement 9)
      const threadWarn = `[Пропуск неподдерживаемых объектов] Обнаружено 2 ветки Discord (типы 11, 12). Ветки не переносятся через прямое создание каналов и исключены из плана.`;
      addLog(threadWarn, 'warn');
      warningsList.push(threadWarn);

      // Category definitions
      const mockCategories = [
        { id: 'cat-1', name: '📁 ИНФОРМАЦИЯ', hidden: false },
        { id: 'cat-2', name: '📁 ОСНОВНОЕ ОБЩЕНИЕ', hidden: false },
        { id: 'cat-3', name: '🔒 АДМИНИСТРАЦИЯ', hidden: true },
      ];

      // Channel definitions
      const mockChannels = [
        { id: 'ch-1', name: '📢 announcements', catId: 'cat-1', hidden: false, topic: 'Важные анонсы сообщества' },
        { id: 'ch-2', name: '💬 general-chat', catId: 'cat-2', hidden: false, topic: 'Основной чат' },
        { id: 'ch-3', name: '🤖 bot-commands', catId: 'cat-2', hidden: false, topic: 'Команды ботов' },
        { id: 'ch-4', name: '🔒 admin-log', catId: 'cat-3', hidden: true, topic: 'Секретный лог админов' },
        { id: 'ch-5', name: '🔒 staff-voice', catId: 'cat-3', hidden: true, topic: '' },
      ];

      // Build planned channels taking into account copyHiddenChannels & orphan policy
      const activeCats: typeof mockCategories = [];
      const excludedCatIds = new Set<string>();

      for (const cat of mockCategories) {
        if (!copyHiddenChannels && cat.hidden) {
          excludedCatIds.add(cat.id);
          addLog(`[Дерево категорий] Скрытая категория «${cat.name}» исключена пользователем`, 'warn');
        } else {
          activeCats.push(cat);
        }
      }

      // Create categories
      for (const cat of activeCats) {
        if (abortRef.current) break;
        await new Promise(r => setTimeout(r, 260));
        const badge = cat.hidden ? ' [🔒 Скрытая]' : '';
        addLog(`[Категория] Создана: ${cat.name}${badge}`, 'info');
        channelsMetrics.created++;
        if (cat.hidden) simulatedHiddenChannels++;
      }

      // Plan child channels
      const plannedChannels: any[] = [];
      for (const ch of mockChannels) {
        if (!copyHiddenChannels && ch.hidden) {
          addLog(`[Фильтрация] Скрытый канал «${ch.name}» исключен настройкой`, 'info');
          channelsMetrics.skipped++;
          continue;
        }

        if (ch.catId && excludedCatIds.has(ch.catId)) {
          simulatedOrphanAdjusted++;
          if (orphanChannelPolicy === 'skip') {
            addLog(`[Orphan Policy] Категория исключена. Дочерний канал «${ch.name}» пропущен (skip)`, 'info');
            channelsMetrics.skipped++;
            continue;
          } else {
            addLog(`[Изменение структуры] Категория исключена. Канал «${ch.name}» перенесен в корень сервера (root)`, 'warn');
            const warnReloc = `Канал «${ch.name}» перенесен в корень без категории`;
            warningsList.push(warnReloc);
            reviewsList.push({
              type: 'channel',
              name: ch.name,
              reason: 'Родительская категория исключена, канал перемещен в корень',
              actionRequired: 'Привязать к подходящей категории или оставить в корне'
            });
            plannedChannels.push({ ...ch, isOrphanRoot: true });
            continue;
          }
        }

        plannedChannels.push(ch);
      }

      channelsMetrics.expected = activeCats.length + plannedChannels.length;

      // Phase 2: Create Channels & apply Watermark
      setProgressStep('Фаза 2: Создание каналов с привязкой parent_id...');
      setProgressPercent(70);

      for (let i = 0; i < plannedChannels.length; i++) {
        if (abortRef.current) break;
        const ch = plannedChannels[i];

        setProgressPercent(70 + Math.round(((i + 1) / plannedChannels.length) * 16));
        setProgressStep(`Создание каналов (${channelsMetrics.created + 1}/${channelsMetrics.expected}): ${ch.name}`);
        await new Promise(r => setTimeout(r, 280));

        // Watermark validation check (Requirement 10)
        let topicDisplay = ch.topic;
        if (watermark) {
          const candidateTopic = ch.topic ? `${ch.topic} · ${watermarkText}` : watermarkText;
          if (candidateTopic.length > 1024) {
            // Does not truncate silently!
            addLog(`[Водяной знак] Тема канала «${ch.name}» превышает лимит Discord (1024). Исходное описание сохранено без изменений.`, 'warn');
            reviewsList.push({
              type: 'channel',
              name: ch.name,
              reason: 'Превышен лимит описания канала (1024 символа)',
              actionRequired: 'Вручную скорректировать описание в Discord'
            });
          } else {
            topicDisplay = candidateTopic;
          }
        }

        const topicBadge = watermark ? ` [topic: "${topicDisplay}"]` : '';
        const orphanBadge = ch.isOrphanRoot ? ' [В КОРНЕ]' : '';
        const hiddenBadge = ch.hidden ? ' [🔒 ПРИВАТНЫЙ]' : '';
        addLog(`[Канал] Создан: ${ch.name}${hiddenBadge}${orphanBadge}${topicBadge}`, 'info');

        channelsMetrics.created++;
        if (ch.hidden) simulatedHiddenChannels++;
      }

      // Verification Phase!
      if (!abortRef.current) {
        setProgressStep('Фаза 3: Двухфазная верификация parent_id и целостности...');
        setProgressPercent(88);
        addLog('Запуск верификации: сверка GET /guilds/{dst}/channels и проверка parent_id...', 'info');
        await new Promise(r => setTimeout(r, 500));

        channelsMetrics.verified = channelsMetrics.created;
        addLog(`ВЕРИФИКАЦИЯ ЗАВЕРШЕНА: Все запланированные каналы (${channelsMetrics.verified}/${channelsMetrics.expected}) подтверждены на сервере!`, 'success');
      }
    }

    // 5. Settings & Images
    let settingsOk = false;
    if ((settings || images) && !abortRef.current) {
      setProgressStep('Синхронизация системных настроек и графики...');
      setProgressPercent(94);
      if (images) {
        addLog('Ultra-HD 4096px иконка и баннер сервера успешно загружены', 'success');
      }
      if (settings) {
        addLog('Настройки AFK, системных каналов и верификации применены', 'success');
        settingsOk = true;
      }
      await new Promise(r => setTimeout(r, 350));
    }

    const durationSec = Number(((Date.now() - startedTime) / 1000).toFixed(1));

    if (abortRef.current) {
      setIsCloning(false);
      setProgressStep('Клонирование прервано');
      addLog('Процесс остановлен пользователем', 'warn');
      showToast('Клонирование прервано');
      setAuditReport({
        status: 'aborted',
        roles: rolesMetrics,
        channels: channelsMetrics,
        emojis: emojisMetrics,
        hiddenChannelsCount: simulatedHiddenChannels,
        settingsApplied: settingsOk,
        unsupportedSkippedCount: simulatedUnsupportedThreads,
        orphanAdjustedCount: simulatedOrphanAdjusted,
        warnings: warningsList,
        errors: errorsList,
        manualReviewList: reviewsList,
        durationSec
      });
      return;
    }

    setProgressPercent(100);
    setProgressStep('Все задачи завершены и верифицированы!');

    const isFullSuccess = errorsList.length === 0 && reviewsList.length === 0;
    const finalStatus = isFullSuccess ? 'success' : 'partial_with_errors';

    if (isFullSuccess) {
      addLog(`Клонирование успешно завершено за ${durationSec} сек.`, 'success');
      showToast('Сервер полностью скопирован и проверен (100%)!');
    } else {
      addLog(`Клонирование завершено за ${durationSec} сек. с замечаниями (требуется ручная проверка: ${reviewsList.length})`, 'warn');
      showToast('Завершено с замечаниями, проверьте аудит');
    }

    setIsCloning(false);

    setAuditReport({
      status: finalStatus,
      roles: rolesMetrics,
      channels: channelsMetrics,
      emojis: emojisMetrics,
      hiddenChannelsCount: simulatedHiddenChannels,
      settingsApplied: settingsOk,
      unsupportedSkippedCount: simulatedUnsupportedThreads,
      orphanAdjustedCount: simulatedOrphanAdjusted,
      warnings: warningsList,
      errors: errorsList,
      manualReviewList: reviewsList,
      durationSec
    });
  };

  const copyLogToClipboard = () => {
    if (!logs.length) return;
    const text = logs.map(l => `[${l.time}] [${l.tag}] ${l.msg}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const filteredLogs = logs.filter(l => filterTag === 'all' || l.type === filterTag);

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-[#23a55a] text-white px-4 py-2.5 rounded-lg shadow-xl text-sm font-semibold flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Simulator Frame Window */}
      <div className="bg-[#313338] border border-[#3f4147] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all">
        {/* Top Window Bar */}
        <div className="bg-[#2b2d31] px-5 py-3 border-b border-[#3f4147] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ed4245]" />
              <span className="w-3 h-3 rounded-full bg-[#faa81a]" />
              <span className="w-3 h-3 rounded-full bg-[#3ba55d]" />
            </div>
            <span className="text-xs font-bold text-[#949ba4] tracking-wide ml-2">
              DISCORD SETTINGS / SERVER CLONER PRO
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#949ba4]">
            <span className="bg-[#23a55a]/15 text-[#23a55a] px-2 py-0.5 rounded text-[11px] font-mono font-semibold">
              v1.2.0-verified
            </span>
            <span className="text-[#dbdee1] font-medium">
              {clientType === 'vencord' ? 'Vencord UserPlugin' : 'BetterDiscord Plugin'}
            </span>
          </div>
        </div>

        <div className="p-6 md:p-8 flex flex-col gap-6 max-w-4xl mx-auto">
          {/* Header Card */}
          <div className="bg-gradient-to-r from-[#5865f2]/15 via-[#5865f2]/5 to-[#23a55a]/10 border border-[#5865f2]/30 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white tracking-tight">
                  ServerCloner Pro
                </h1>
                <span className="text-[11px] font-bold uppercase tracking-wider bg-[#5865f2] text-white px-2 py-0.5 rounded-full">
                  {clientType.toUpperCase()}
                </span>
                <span className="text-xs text-[#23a55a] font-medium flex items-center gap-1 bg-[#23a55a]/10 px-2 py-0.5 rounded-full border border-[#23a55a]/20">
                  <Check className="w-3 h-3" /> Дерево категорий & Orphan Policy
                </span>
              </div>
              <p className="text-xs text-[#949ba4] mt-1.5 max-w-xl">
                Двухфазная верификация структуры каналов, защита рейтлимитов 429, контроль водяного знака и детальный аудит.
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-[#1e1f22]/80 p-1.5 rounded-lg border border-white/5">
              <span className="text-[11px] font-semibold text-[#949ba4] px-2">Пресеты:</span>
              <button
                onClick={() => applyPreset('all')}
                disabled={isCloning}
                className="px-2.5 py-1 text-xs font-semibold text-[#dbdee1] bg-[#2b2d31] hover:bg-[#5865f2] hover:text-white rounded transition-colors"
              >
                Всё 1:1
              </button>
              <button
                onClick={() => applyPreset('structure')}
                disabled={isCloning}
                className="px-2.5 py-1 text-xs font-semibold text-[#dbdee1] bg-[#2b2d31] hover:bg-[#5865f2] hover:text-white rounded transition-colors"
              >
                Структура
              </button>
              <button
                onClick={() => applyPreset('media')}
                disabled={isCloning}
                className="px-2.5 py-1 text-xs font-semibold text-[#dbdee1] bg-[#2b2d31] hover:bg-[#5865f2] hover:text-white rounded transition-colors"
              >
                Медиа
              </button>
              <button
                onClick={() => setShowMatrixModal(!showMatrixModal)}
                className="px-2.5 py-1 text-xs font-semibold text-[#5865f2] bg-[#5865f2]/10 hover:bg-[#5865f2]/20 rounded transition-colors ml-1"
                title="Показать поддерживаемые типы каналов"
              >
                Типы
              </button>
            </div>
          </div>

          {/* Modal / Accordion for Channel Types Matrix */}
          {showMatrixModal && (
            <div className="bg-[#1e1f22] border border-[#5865f2]/30 rounded-xl p-4 text-xs animate-fadeIn">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
                <span className="font-bold text-white flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-[#5865f2]" />
                  Матрица поддерживаемых типов каналов и веток Discord:
                </span>
                <button
                  onClick={() => setShowMatrixModal(false)}
                  className="text-[#949ba4] hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#2b2d31] p-3 rounded-lg border border-white/5">
                  <span className="font-bold text-[#23a55a] block mb-1.5">✓ Поддерживаются 1:1:</span>
                  <ul className="text-[#dbdee1] space-y-1 pl-4 list-disc text-[11px]">
                    <li>Текстовые каналы (0) & Голосовые каналы (2)</li>
                    <li>Категории (4) с точным parent_id</li>
                    <li>Каналы анонсов (5) & Сцена/Трибуна (13)</li>
                    <li>Форумы (15) & Медиа-каналы (16)</li>
                    <li>Все Overwrites (роли @everyone, участники)</li>
                  </ul>
                </div>
                <div className="bg-[#2b2d31] p-3 rounded-lg border border-white/5">
                  <span className="font-bold text-[#f0b232] block mb-1.5">⚠️ Исключены из обработки:</span>
                  <ul className="text-[#949ba4] space-y-1 pl-4 list-disc text-[11px]">
                    <li>Ветки анонсов (10) & Публичные ветки (11)</li>
                    <li>Приватные закрытые ветки (12)</li>
                    <li>Каналы магазина (6) — устаревший тип</li>
                    <li>История сообщений (сообщения не клонируются)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Server Selector Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#949ba4] flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-[#5865f2]" />
                  Исходный сервер (Откуда)
                </span>
                {srcGuild && (
                  <span className="text-[11px] font-mono text-[#949ba4] bg-[#1e1f22] px-2 py-0.5 rounded">
                    ID: {srcGuild.id.slice(0, 8)}...
                  </span>
                )}
              </div>

              <div className="relative">
                <select
                  value={srcGuildId}
                  onChange={e => setSrcGuildId(e.target.value)}
                  disabled={isCloning}
                  className="w-full bg-[#1e1f22] text-[#dbdee1] border border-[#3f4147] rounded-lg px-3.5 py-2.5 text-sm font-medium focus:border-[#5865f2] focus:outline-none transition-colors appearance-none cursor-pointer"
                >
                  {INITIAL_GUILDS.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.memberCount} уч.)
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-[#949ba4] absolute right-3 top-3.5 pointer-events-none" />
              </div>

              {srcGuild && (
                <div className="flex items-center gap-3 pt-1 border-t border-[#3f4147]/40 text-xs text-[#949ba4]">
                  <span>Ролей: <strong className="text-white">{srcGuild.rolesCount}</strong></span>
                  <span>·</span>
                  <span>Каналов: <strong className="text-white">{srcGuild.channelsCount}</strong></span>
                  <span>·</span>
                  <span>Эмодзи: <strong className="text-white">{srcGuild.emojisCount}</strong></span>
                </div>
              )}
            </div>

            <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#949ba4] flex items-center gap-1.5">
                  <ArrowRight className="w-3.5 h-3.5 text-[#23a55a]" />
                  Целевой сервер (Куда)
                </span>
                {dstGuild && (
                  <span className="text-[11px] font-mono text-[#949ba4] bg-[#1e1f22] px-2 py-0.5 rounded">
                    ID: {dstGuild.id.slice(0, 8)}...
                  </span>
                )}
              </div>

              <div className="relative">
                <select
                  value={dstGuildId}
                  onChange={e => setDstGuildId(e.target.value)}
                  disabled={isCloning}
                  className="w-full bg-[#1e1f22] text-[#dbdee1] border border-[#3f4147] rounded-lg px-3.5 py-2.5 text-sm font-medium focus:border-[#5865f2] focus:outline-none transition-colors appearance-none cursor-pointer"
                >
                  <option value="">— Выбрать целевой сервер —</option>
                  {INITIAL_GUILDS.map(g => (
                    <option key={g.id} value={g.id} disabled={g.id === srcGuildId}>
                      {g.name} {g.id === srcGuildId ? '(исходный)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-[#949ba4] absolute right-3 top-3.5 pointer-events-none" />
              </div>

              {dstGuild && (
                <div className="flex items-center gap-3 pt-1 border-t border-[#3f4147]/40 text-xs text-[#949ba4]">
                  <span>Участников: <strong className="text-white">{dstGuild.memberCount}</strong></span>
                  <span>·</span>
                  <span className="text-[#23a55a]">Pre-flight проверка активна</span>
                </div>
              )}
            </div>
          </div>

          {/* Options Toggles */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                Параметры структуры, безопасности и водяного знака
              </span>
              <span className="text-xs text-[#949ba4]">
                Кликните на карточку для переключения
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Stealth Mode */}
              <div
                onClick={() => !isCloning && setStealthMode(!stealthMode)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  stealthMode
                    ? 'bg-[#2b2d31] border-[#5865f2]/50 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    stealthMode ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Stealth Mode (Снижение риска)</h3>
                      <span className="text-[10px] font-bold bg-[#5865f2]/20 text-[#5865f2] px-1.5 py-0.5 rounded">
                        РЕКОМЕНДУЕТСЯ
                      </span>
                    </div>
                    <p className="text-xs text-[#949ba4]">Джиттер 900-1500мс и микропаузы против антиспама</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  stealthMode ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    stealthMode ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Copy Hidden Channels */}
              <div
                onClick={() => !isCloning && channels && setCopyHiddenChannels(!copyHiddenChannels)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  copyHiddenChannels && channels
                    ? 'bg-[#2b2d31] border-[#5865f2]/50 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    copyHiddenChannels && channels ? 'bg-[#23a55a]/20 text-[#23a55a]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Скрытые каналы (с правами)</h3>
                      <span className="text-[10px] font-bold bg-[#23a55a]/20 text-[#23a55a] px-1.5 py-0.5 rounded">
                        100% ПРАВА
                      </span>
                    </div>
                    <p className="text-xs text-[#949ba4]">Копировать закрытые админ-комнаты с их overwrites</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  copyHiddenChannels && channels ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    copyHiddenChannels && channels ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Orphan Channel Policy */}
              <div
                onClick={() => !isCloning && channels && setOrphanChannelPolicy(orphanChannelPolicy === 'root' ? 'skip' : 'root')}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  orphanChannelPolicy === 'root' && channels
                    ? 'bg-[#2b2d31] border-[#f0b232]/50 shadow-sm'
                    : 'bg-[#2b2d31] border-[#3f4147]/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    orphanChannelPolicy === 'root' ? 'bg-[#f0b232]/20 text-[#f0b232]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <GitFork className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Orphan Policy (Сиротские каналы)</h3>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-[#dbdee1]">
                        {orphanChannelPolicy === 'root' ? 'РЕЖИМ: В КОРЕНЬ' : 'РЕЖИМ: ИСКЛЮЧИТЬ'}
                      </span>
                    </div>
                    <p className="text-xs text-[#949ba4]">
                      {orphanChannelPolicy === 'root'
                        ? 'Каналы исключенных категорий переносятся в корень сервера'
                        : 'Каналы исключенных категорий исключаются вместе с категорией'}
                    </p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  orphanChannelPolicy === 'root' ? 'bg-[#f0b232]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    orphanChannelPolicy === 'root' ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Roles */}
              <div
                onClick={() => !isCloning && setRoles(!roles)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  roles
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    roles ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Роли и иерархия</h3>
                    <p className="text-xs text-[#949ba4]">Исключение бот-ролей, сохранение цветов и hoist</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  roles ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    roles ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Channels */}
              <div
                onClick={() => !isCloning && setChannels(!channels)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  channels
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    channels ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <FolderTree className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Каналы и категории</h3>
                    <p className="text-xs text-[#949ba4]">Создание категорий, привязка parent_id и верификация</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  channels ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    channels ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Emojis */}
              <div
                onClick={() => !isCloning && setEmojis(!emojis)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  emojis
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    emojis ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Smile className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Пользовательские эмодзи</h3>
                    <p className="text-xs text-[#949ba4]">Lossless перенос с адаптивными паузами</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  emojis ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    emojis ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Settings */}
              <div
                onClick={() => !isCloning && setSettings(!settings)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  settings
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    settings ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Settings2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Основные настройки</h3>
                    <p className="text-xs text-[#949ba4]">AFK-таймаут, системные каналы и верификация</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  settings ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    settings ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Images */}
              <div
                onClick={() => !isCloning && setImages(!images)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  images
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    images ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Иконка и баннер</h3>
                    <p className="text-xs text-[#949ba4]">Ultra-HD 4096px загрузка аватара и баннера сервера</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  images ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    images ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Skip Duplicates */}
              <div
                onClick={() => !isCloning && setSkipDuplicates(!skipDuplicates)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  skipDuplicates
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    skipDuplicates ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Пропускать дубликаты</h3>
                    <p className="text-xs text-[#949ba4]">Не создавать повторно уже существующие роли/эмодзи</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  skipDuplicates ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    skipDuplicates ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Watermark Toggle */}
              <div
                onClick={() => !isCloning && setWatermark(!watermark)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  watermark
                    ? 'bg-[#2b2d31] border-[#5865f2]/50 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    watermark ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Водяной знак в описании каналов</h3>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        watermark ? 'bg-[#23a55a]/20 text-[#23a55a]' : 'bg-white/5 text-[#949ba4]'
                      }`}>
                        {watermark ? 'ВКЛЮЧЕН' : 'ОТКЛЮЧЕН'}
                      </span>
                    </div>
                    <p className="text-xs text-[#949ba4]">
                      {watermark
                        ? `Добавляет отметку в topic с проверкой лимита 1024 символов`
                        : 'Оригинальные описания каналов сохраняются 1:1 без отметок'}
                    </p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  watermark ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    watermark ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Watermark Text Input Field (Full Width) */}
              {watermark && (
                <div className="md:col-span-2 bg-[#1e1f22] border border-[#5865f2]/30 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#dbdee1]">
                    <Tag className="w-3.5 h-3.5 text-[#5865f2]" />
                    <span>Текст водяного знака:</span>
                  </div>
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <input
                      type="text"
                      value={watermarkText}
                      onChange={e => setWatermarkText(e.target.value)}
                      disabled={isCloning}
                      placeholder="Например: [Клон: ServerCloner Pro]"
                      className="w-full bg-[#2b2d31] border border-[#3f4147] focus:border-[#5865f2] rounded-lg px-3 py-1.5 text-xs text-white outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setWatermarkText('[Клон: ServerCloner Pro]')}
                      className="text-[11px] text-[#949ba4] hover:text-white px-2.5 py-1.5 bg-[#2b2d31] hover:bg-[#3f4147] rounded-lg border border-white/5 whitespace-nowrap transition-colors"
                    >
                      Сброс
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Trigger, Abort & Progress */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={handleStartClone}
                disabled={isCloning}
                className={`flex-1 py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg ${
                  isCloning
                    ? 'bg-[#4e5058] text-[#949ba4] cursor-not-allowed'
                    : 'bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white shadow-[#5865f2]/25'
                }`}
              >
                {isCloning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Клонирование и проверка в процессе...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Запустить безопасное клонирование с верификацией</span>
                  </>
                )}
              </button>

              {isCloning && (
                <button
                  onClick={handleAbort}
                  className="py-3.5 px-5 bg-[#da373c] hover:bg-[#a1282c] text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-colors shadow-lg"
                  title="Остановить процесс"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Остановить</span>
                </button>
              )}
            </div>

            {/* Live Progress Bar */}
            {(isCloning || progressPercent > 0) && (
              <div className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#5865f2] animate-ping" />
                    {progressStep || 'Клонирование...'}
                  </span>
                  <span className="text-[#5865f2] font-mono tabular-nums text-sm">
                    {progressPercent}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-[#1e1f22] rounded-full overflow-hidden p-0.5 border border-white/5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progressPercent === 100
                        ? 'bg-[#23a55a]'
                        : 'bg-gradient-to-r from-[#5865f2] to-[#23a55a]'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Audit Summary Card */}
            {auditReport && (
              <div className={`border rounded-xl p-4 flex flex-col gap-2.5 animate-fadeIn ${
                auditReport.status === 'success'
                  ? 'bg-[#23a55a]/10 border-[#23a55a]/40'
                  : auditReport.status === 'aborted'
                  ? 'bg-[#747f8d]/10 border-[#747f8d]/40'
                  : 'bg-[#f0b232]/10 border-[#f0b232]/40'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {auditReport.status === 'success' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-[#23a55a]" />
                        <span className="text-[#23a55a]">Отчет об аудите целостности (100% Верифицировано)</span>
                      </>
                    ) : auditReport.status === 'aborted' ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-[#949ba4]" />
                        <span className="text-[#949ba4]">Клонирование остановлено пользователем</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-[#f0b232]" />
                        <span className="text-[#f0b232]">Аудит: завершено с замечаниями (требуется проверка)</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[#949ba4] font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{auditReport.durationSec}s</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1 border-t border-white/10">
                  <div className="bg-[#1e1f22]/60 p-2.5 rounded-lg border border-white/5">
                    <span className="text-[#949ba4] block text-[11px]">Роли</span>
                    <strong className="text-white text-sm">
                      {auditReport.roles.created}/{auditReport.roles.expected}
                    </strong>
                    {auditReport.roles.skipped > 0 && (
                      <span className="text-[10px] text-[#949ba4] block">бот-ролей: {auditReport.roles.skipped}</span>
                    )}
                  </div>
                  <div className="bg-[#1e1f22]/60 p-2.5 rounded-lg border border-white/5">
                    <span className="text-[#949ba4] block text-[11px]">Каналы (Верификация)</span>
                    <strong className="text-white text-sm">
                      {auditReport.channels.verified}/{auditReport.channels.expected}
                    </strong>
                    {auditReport.hiddenChannelsCount > 0 && (
                      <span className="text-[10px] text-[#23a55a] block">скрытых: {auditReport.hiddenChannelsCount}</span>
                    )}
                  </div>
                  <div className="bg-[#1e1f22]/60 p-2.5 rounded-lg border border-white/5">
                    <span className="text-[#949ba4] block text-[11px]">Эмодзи</span>
                    <strong className="text-white text-sm">
                      {auditReport.emojis.created}/{auditReport.emojis.expected}
                    </strong>
                  </div>
                  <div className="bg-[#1e1f22]/60 p-2.5 rounded-lg border border-white/5">
                    <span className="text-[#949ba4] block text-[11px]">Замечания & Ветки</span>
                    <strong className={`${auditReport.warnings.length ? 'text-[#f0b232]' : 'text-white'} text-sm`}>
                      {auditReport.warnings.length} замеч.
                    </strong>
                    <span className="text-[10px] text-[#949ba4] block">пропущено веток: {auditReport.unsupportedSkippedCount}</span>
                  </div>
                </div>

                {auditReport.manualReviewList.length > 0 && (
                  <div className="mt-1 pt-2 border-t border-white/10">
                    <button
                      onClick={() => setShowReviewItems(!showReviewItems)}
                      className="text-xs text-[#5865f2] hover:underline font-semibold flex items-center gap-1.5"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-[#f0b232]" />
                      <span>
                        {showReviewItems ? 'Скрыть список ручной проверки' : `Показать объекты для ручной проверки (${auditReport.manualReviewList.length})`}
                      </span>
                    </button>

                    {showReviewItems && (
                      <div className="mt-2 bg-[#1e1f22] border border-white/10 rounded-lg p-2.5 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                        {auditReport.manualReviewList.map((item, idx) => (
                          <div key={idx} className="text-[11px] border-b border-white/5 pb-1">
                            <span className="font-bold text-white">[{item.type.toUpperCase()}] {item.name}: </span>
                            <span className="text-[#f0b232]">{item.reason}. </span>
                            <span className="text-[#23a55a]">Действие: {item.actionRequired}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Terminal Console View */}
          <div className="bg-[#1e1f22] border border-[#3f4147]/70 rounded-xl overflow-hidden flex flex-col shadow-inner">
            <div className="bg-[#232428] px-4 py-2.5 border-b border-[#3f4147]/40 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Terminal className="w-4 h-4 text-[#5865f2]" />
                <span className="text-xs font-bold text-white tracking-wide">
                  ЖУРНАЛ ОПЕРАЦИЙ КЛОНИРОВАНИЯ
                </span>
                <span className="text-[11px] font-mono text-[#949ba4] bg-[#1e1f22] px-2 py-0.5 rounded">
                  {filteredLogs.length} событий
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Filter tags */}
                <div className="flex items-center bg-[#1e1f22] rounded-lg p-0.5 border border-white/5 text-[11px]">
                  <button
                    onClick={() => setFilterTag('all')}
                    className={`px-2 py-0.5 rounded ${filterTag === 'all' ? 'bg-[#5865f2] text-white font-bold' : 'text-[#949ba4]'}`}
                  >
                    Все
                  </button>
                  <button
                    onClick={() => setFilterTag('warn')}
                    className={`px-2 py-0.5 rounded ${filterTag === 'warn' ? 'bg-[#faa81a]/20 text-[#faa81a] font-bold' : 'text-[#949ba4]'}`}
                  >
                    Предупр.
                  </button>
                  <button
                    onClick={() => setFilterTag('error')}
                    className={`px-2 py-0.5 rounded ${filterTag === 'error' ? 'bg-[#ed4245]/20 text-[#ed4245] font-bold' : 'text-[#949ba4]'}`}
                  >
                    Ошибки
                  </button>
                </div>

                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    autoScroll
                      ? 'bg-[#5865f2]/15 text-[#5865f2] border-[#5865f2]/30'
                      : 'bg-transparent text-[#949ba4] border-white/10'
                  }`}
                >
                  Автоскролл
                </button>

                <button
                  onClick={copyLogToClipboard}
                  disabled={!logs.length}
                  className="text-xs px-2.5 py-1 rounded-lg bg-transparent text-[#949ba4] hover:text-white border border-white/10 hover:border-white/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedLog ? 'Скопировано!' : 'Копировать'}</span>
                </button>

                <button
                  onClick={() => setLogs([])}
                  disabled={isCloning || !logs.length}
                  className="text-xs px-2.5 py-1 rounded-lg bg-transparent text-[#949ba4] hover:text-[#ed4245] border border-white/10 hover:border-[#ed4245]/30 transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Очистить лог"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Console Log Rows */}
            <div className="p-4 max-h-72 overflow-y-auto flex flex-col gap-1.5 font-mono text-xs select-text">
              {filteredLogs.length === 0 ? (
                <div className="py-12 text-center text-[#949ba4]/60 italic font-sans text-xs">
                  Журнал готов. Нажмите «Запустить безопасное клонирование с верификацией».
                </div>
              ) : (
                filteredLogs.map(l => (
                  <div key={l.id} className="flex items-start gap-2.5 leading-relaxed hover:bg-white/[0.02] px-1 py-0.5 rounded">
                    <span className="text-[#949ba4] text-[11px] shrink-0 tabular-nums">
                      [{l.time}]
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0 ${
                        l.type === 'success'
                          ? 'bg-[#23a55a]/15 text-[#23a55a]'
                          : l.type === 'warn'
                          ? 'bg-[#faa81a]/15 text-[#faa81a]'
                          : l.type === 'error'
                          ? 'bg-[#ed4245]/15 text-[#ed4245]'
                          : 'bg-white/5 text-[#dbdee1]'
                      }`}
                    >
                      {l.tag}
                    </span>
                    <span
                      className={`break-all ${
                        l.type === 'success'
                          ? 'text-[#23a55a]'
                          : l.type === 'warn'
                          ? 'text-[#faa81a]'
                          : l.type === 'error'
                          ? 'text-[#ed4245]'
                          : 'text-[#dbdee1]'
                      }`}
                    >
                      {l.msg}
                    </span>
                  </div>
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
