import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_GUILDS, MockGuild } from '../data/mockGuilds';
import {
  Shield,
  FolderTree,
  Smile,
  Settings2,
  Image as ImageIcon,
  UserCheck,
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
  Server
} from 'lucide-react';

interface LogItem {
  id: string;
  time: string;
  tag: 'ИНФО' | 'УСПЕХ' | 'ПРЕДУПР' | 'ОШИБКА';
  type: 'info' | 'success' | 'warn' | 'error';
  msg: string;
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
  const [userOW, setUserOW] = useState(false);

  // Simulation execution
  const [isCloning, setIsCloning] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterTag, setFilterTag] = useState<'all' | 'info' | 'success' | 'warn' | 'error'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedLog, setCopiedLog] = useState(false);

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
      setUserOW(false);
      showToast('Выбран пресет: Полный клон 1:1');
    } else if (preset === 'structure') {
      setRoles(true);
      setChannels(true);
      setEmojis(false);
      setSettings(false);
      setImages(false);
      setUserOW(false);
      showToast('Выбран пресет: Только структура (роли + каналы)');
    } else if (preset === 'media') {
      setRoles(false);
      setChannels(false);
      setEmojis(true);
      setSettings(true);
      setImages(true);
      setUserOW(false);
      showToast('Выбран пресет: Медиа & Оформление');
    }
  };

  const handleStartClone = async () => {
    if (!srcGuildId || !dstGuildId) {
      showToast('Пожалуйста, выберите оба сервера');
      return;
    }
    if (srcGuildId === dstGuildId) {
      showToast('Исходный и целевой сервер должны отличаться');
      return;
    }
    if (!roles && !channels && !emojis && !settings && !images) {
      showToast('Выберите хотя бы один пункт для копирования');
      return;
    }

    setIsCloning(true);
    setLogs([]);
    setProgressPercent(5);
    setProgressStep('Инициализация сессии и авторизация RestAPI...');

    addLog(`Запуск клонирования: [${srcGuild?.name}] ➔ [${dstGuild?.name}]`, 'info');
    await new Promise(r => setTimeout(r, 450));

    // 1. Roles
    if (roles) {
      setProgressStep('Копирование прав @everyone и ролей...');
      setProgressPercent(15);
      addLog('Роль @everyone: базовые разрешения скопированы', 'success');
      await new Promise(r => setTimeout(r, 350));

      const mockRolesList = ['Admin [Администратор]', 'Moderator', 'VIP Club', 'Community Member', 'Bot Integration'];
      for (let i = 0; i < mockRolesList.length; i++) {
        setProgressPercent(15 + Math.round(((i + 1) / mockRolesList.length) * 20));
        setProgressStep(`Создание ролей (${i + 1}/${mockRolesList.length}): ${mockRolesList[i]}`);
        addLog(`Роль создана с цветом и правами: ${mockRolesList[i]}`, 'info');
        await new Promise(r => setTimeout(r, 220));
      }
      addLog('Иерархия и порядок позиций ролей успешно применены', 'success');
    }

    // 2. Emojis
    if (emojis) {
      setProgressStep('Чтение и перенос пользовательских эмодзи...');
      setProgressPercent(40);
      const mockEmojisList = ['kekw', 'fire_dance', 'discord_nitro', 'pepe_hype'];
      for (let i = 0; i < mockEmojisList.length; i++) {
        setProgressPercent(40 + Math.round(((i + 1) / mockEmojisList.length) * 15));
        setProgressStep(`Загрузка эмодзи (${i + 1}/${mockEmojisList.length}): :${mockEmojisList[i]}:`);
        addLog(`Эмодзи перенесено (Lossless CDN): :${mockEmojisList[i]}:`, 'success');
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // 3. Channels
    if (channels) {
      setProgressStep('Создание категорий и каналов...');
      setProgressPercent(60);
      const mockChannelsList = [
        '📁 ━━━ ИНФОРМАЦИЯ ━━━',
        '📢 announcements (Анонсы)',
        '💬 general-chat (Текст)',
        '🤖 bot-commands (Текст)',
        '📁 ━━━ ГОЛОСОВЫЕ ━━━',
        '🔊 Lounge #1 (Голос 96kbps)',
        '🎮 Gaming Room #1 (Голос)'
      ];
      for (let i = 0; i < mockChannelsList.length; i++) {
        setProgressPercent(60 + Math.round(((i + 1) / mockChannelsList.length) * 25));
        setProgressStep(`Создание каналов (${i + 1}/${mockChannelsList.length}): ${mockChannelsList[i]}`);
        addLog(`Канал создан с правами и slowmode: ${mockChannelsList[i]}`, 'info');
        await new Promise(r => setTimeout(r, 250));
      }
      addLog('Все категории, каналы и overwrites прав успешно перенесены', 'success');
    }

    // 4. Settings & Images
    if (settings || images) {
      setProgressStep('Применение настроек сервера, иконки и баннера...');
      setProgressPercent(90);
      if (images) {
        addLog('Ultra-HD 4096px Иконка сервера загружена через CDN Discord', 'success');
        addLog('Ultra-HD 4096px Баннер сервера успешно применен', 'success');
      }
      if (settings) {
        addLog('Настройки AFK-канала, верификации и системных уведомлений применены', 'success');
      }
      await new Promise(r => setTimeout(r, 400));
    }

    setProgressPercent(100);
    setProgressStep('Клонирование успешно завершено!');
    addLog('Готово! Сервер скопирован 1:1. Все структуры идентичны.', 'success');
    setIsCloning(false);
    showToast('Сервер успешно скопирован 1:1!');
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

      {/* Simulator Control Ribbon */}
      <div className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#5865f2]/20 text-[#5865f2] flex items-center justify-center font-bold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Интерактивный симулятор плагина
              <span className="text-[11px] font-semibold text-[#23a55a] bg-[#23a55a]/15 px-2 py-0.5 rounded">
                Live Preview
              </span>
            </h2>
            <p className="text-xs text-[#949ba4]">
              Протестируйте обновленный дизайн настроек прямо в браузере перед установкой в клиент
            </p>
          </div>
        </div>

        {/* Client Mode & Theme Switcher */}
        <div className="flex items-center gap-3">
          {/* Client Switcher */}
          <div className="flex items-center p-1 bg-[#1e1f22] rounded-lg border border-[#3f4147]/40 text-xs font-semibold">
            <button
              onClick={() => setClientType('vencord')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                clientType === 'vencord'
                  ? 'bg-[#5865f2] text-white shadow-sm'
                  : 'text-[#949ba4] hover:text-white'
              }`}
            >
              Vencord (TSX)
            </button>
            <button
              onClick={() => setClientType('betterdiscord')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                clientType === 'betterdiscord'
                  ? 'bg-[#5865f2] text-white shadow-sm'
                  : 'text-[#949ba4] hover:text-white'
              }`}
            >
              BetterDiscord (JS)
            </button>
          </div>

          {/* Theme preview mode */}
          <div className="flex items-center p-1 bg-[#1e1f22] rounded-lg border border-[#3f4147]/40 text-xs font-semibold">
            <button
              onClick={() => setThemeMode('dark')}
              className={`px-2.5 py-1.5 rounded-md transition-colors ${
                themeMode === 'dark' ? 'bg-[#313338] text-white' : 'text-[#949ba4] hover:text-white'
              }`}
            >
              Dark Theme
            </button>
            <button
              onClick={() => setThemeMode('midnight')}
              className={`px-2.5 py-1.5 rounded-md transition-colors ${
                themeMode === 'midnight' ? 'bg-[#111214] text-white' : 'text-[#949ba4] hover:text-white'
              }`}
            >
              Midnight AMOLED
            </button>
          </div>
        </div>
      </div>

      {/* Simulated Discord Window Frame */}
      <div className={`rounded-2xl border border-[#3f4147]/70 shadow-2xl overflow-hidden transition-colors ${
        themeMode === 'midnight' ? 'bg-[#111214]' : 'bg-[#313338]'
      }`}>
        {/* Discord Client Window Header Bar */}
        <div className="bg-[#1e1f22] px-4 py-3 border-b border-[#3f4147]/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ed4245]" />
              <span className="w-3 h-3 rounded-full bg-[#faa81a]" />
              <span className="w-3 h-3 rounded-full bg-[#3ba55d]" />
            </div>
            <span className="text-xs font-bold text-[#949ba4] tracking-wide ml-2">
              DISCORD SETTINGS / НАСТРОЙКИ ПЛАГИНА
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#949ba4]">
            <span className="bg-[#2b2d31] px-2 py-0.5 rounded text-[11px] font-mono">
              v1.2.0-pro
            </span>
            <span className="text-[#dbdee1] font-medium">
              {clientType === 'vencord' ? 'Vencord UserPlugin' : 'BetterDiscord Plugin'}
            </span>
          </div>
        </div>

        {/* Plugin Settings Content (Simulating inside Discord modal) */}
        <div className="p-6 md:p-8 flex flex-col gap-6 max-w-4xl mx-auto">
          {/* Header Card with Gradient Accent */}
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
                  <Check className="w-3 h-3" /> Без прав админа на источнике
                </span>
              </div>
              <p className="text-xs text-[#949ba4] mt-1.5 max-w-xl">
                Копирует структуру сервера 1:1: роли, каналы, точные права доступа, эмодзи, оформление и системные настройки через внутренний клиентский Rest API Discord.
              </p>
            </div>

            {/* Quick Presets */}
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
            </div>
          </div>

          {/* Server Selector Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source Guild Card */}
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

            {/* Target Guild Card */}
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
                  <span className="text-[#f0b232]">Все роли и каналы будут созданы с нуля</span>
                </div>
              )}
            </div>
          </div>

          {/* Options Toggles Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#949ba4]">
                Параметры клонирования элементов
              </span>
              <span className="text-xs text-[#949ba4]">
                Кликните на карточку для переключения
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {/* Option 1: Roles */}
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
                    <h3 className="text-sm font-semibold text-white">Роли и права доступа</h3>
                    <p className="text-xs text-[#949ba4]">Цвета, иерархия, @everyone, hoist и полные разрешения</p>
                  </div>
                </div>
                {/* Switch knob */}
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  roles ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    roles ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>

              {/* Option 2: Channels */}
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
                    <p className="text-xs text-[#949ba4]">Текстовые, войсы, форумы, slowmode, bitrate и overwrites</p>
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

              {/* Option 3: Emojis */}
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
                    <p className="text-xs text-[#949ba4]">Статичные (.png) и анимированные (.gif) эмодзи в оригинале</p>
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

              {/* Option 4: Settings */}
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
                    <p className="text-xs text-[#949ba4]">Название, AFK-таймаут, системные каналы и верификация</p>
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

              {/* Option 5: Images */}
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

              {/* Option 6: User Overwrites */}
              <div
                onClick={() => !isCloning && setUserOW(!userOW)}
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  userOW
                    ? 'bg-[#2b2d31] border-[#5865f2]/40 shadow-sm'
                    : 'bg-[#2b2d31]/60 border-[#3f4147]/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    userOW ? 'bg-[#5865f2]/20 text-[#5865f2]' : 'bg-white/5 text-[#949ba4]'
                  }`}>
                    <UserCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Индивидуальные overwrites юзеров</h3>
                    <p className="text-xs text-[#949ba4]">Персональные доступы конкретных пользователей (медленнее)</p>
                  </div>
                </div>
                <div className={`w-11 h-6 rounded-full relative transition-colors duration-200 shrink-0 ${
                  userOW ? 'bg-[#23a55a]' : 'bg-[#4e5058]'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-1 transition-all duration-200 ${
                    userOW ? 'left-6' : 'left-1'
                  }`} />
                </div>
              </div>
            </div>
          </div>

          {/* Action Trigger & Progress Bar */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleStartClone}
              disabled={isCloning}
              className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-lg ${
                isCloning
                  ? 'bg-[#4e5058] text-[#949ba4] cursor-not-allowed'
                  : 'bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white shadow-[#5865f2]/25'
              }`}
            >
              {isCloning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Клонирование в процессе...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Запустить клонирование сервера</span>
                </>
              )}
            </button>

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
          </div>

          {/* Terminal Console View */}
          <div className="bg-[#1e1f22] border border-[#3f4147]/70 rounded-xl overflow-hidden flex flex-col shadow-inner">
            {/* Console Toolbar */}
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

              {/* Log filter pills & actions */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-[11px] font-semibold">
                  <button
                    onClick={() => setFilterTag('all')}
                    className={`px-2 py-0.5 rounded ${
                      filterTag === 'all' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4] hover:text-white'
                    }`}
                  >
                    Все
                  </button>
                  <button
                    onClick={() => setFilterTag('success')}
                    className={`px-2 py-0.5 rounded ${
                      filterTag === 'success' ? 'bg-[#23a55a] text-white' : 'text-[#949ba4] hover:text-white'
                    }`}
                  >
                    Успех
                  </button>
                  <button
                    onClick={() => setFilterTag('error')}
                    className={`px-2 py-0.5 rounded ${
                      filterTag === 'error' ? 'bg-[#f23f43] text-white' : 'text-[#949ba4] hover:text-white'
                    }`}
                  >
                    Ошибки
                  </button>
                </div>

                <div className="h-3 w-[1px] bg-[#3f4147]" />

                <button
                  onClick={copyLogToClipboard}
                  disabled={!logs.length}
                  className="text-xs text-[#949ba4] hover:text-white px-2 py-1 rounded bg-[#2b2d31] hover:bg-[#3f4147] transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Скопировать весь лог"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedLog ? 'Скопировано!' : 'Копировать'}</span>
                </button>

                <button
                  onClick={() => setLogs([])}
                  disabled={!logs.length || isCloning}
                  className="text-xs text-[#949ba4] hover:text-[#f23f43] px-2 py-1 rounded bg-[#2b2d31] hover:bg-[#3f4147] transition-colors flex items-center gap-1 disabled:opacity-50"
                  title="Очистить консоль"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Очистить</span>
                </button>
              </div>
            </div>

            {/* Console Output Body */}
            <div className="p-4 max-h-64 min-h-[160px] overflow-y-auto font-mono text-xs flex flex-col gap-1.5 leading-relaxed">
              {filteredLogs.length === 0 ? (
                <div className="text-[#949ba4] italic text-center py-8">
                  Здесь будут отображаться пошаговые события создания ролей, каналов и эмодзи.
                  <br />
                  <span className="text-[11px] text-[#5865f2] not-italic mt-1 block">
                    Нажмите «Запустить клонирование сервера» выше для демонстрации работы.
                  </span>
                </div>
              ) : (
                filteredLogs.map(l => (
                  <div key={l.id} className="flex items-baseline gap-2.5">
                    <span className="text-[#72767d] tabular-nums shrink-0">[{l.time}]</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                        l.type === 'success'
                          ? 'bg-[#23a55a]/20 text-[#23a55a]'
                          : l.type === 'error'
                          ? 'bg-[#f23f43]/20 text-[#f23f43]'
                          : l.type === 'warn'
                          ? 'bg-[#f0b232]/20 text-[#f0b232]'
                          : 'bg-[#5865f2]/20 text-[#5865f2]'
                      }`}
                    >
                      {l.tag}
                    </span>
                    <span
                      className={`${
                        l.type === 'success'
                          ? 'text-[#3ba55d]'
                          : l.type === 'error'
                          ? 'text-[#f23f43]'
                          : l.type === 'warn'
                          ? 'text-[#faa81a]'
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
