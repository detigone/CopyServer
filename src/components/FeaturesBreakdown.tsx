import React from 'react';
import {
  Sparkles,
  Palette,
  Terminal,
  Activity,
  CheckCircle2,
  Sliders,
  Layers,
  ShieldCheck,
  Zap,
  RefreshCw,
  Clock,
  Square,
  Lock,
  Tag,
  ShieldAlert,
  GitFork,
  AlertTriangle,
  FileText,
  Ban,
  Trash2
} from 'lucide-react';

export function FeaturesBreakdown() {
  const improvements = [
    {
      title: "Копирование скрытых каналов (с точными правами)",
      desc: "Точный перенос закрытых админ-комнат и секретных категорий: маски @everyone deny: 1024 (VIEW_CHANNEL) и списки персональных разрешений ролей переносятся без утечки приватности. Внимание: ветки тредов исключены.",
      icon: Lock,
      color: "#23a55a"
    },
    {
      title: "Дерево категорий & Orphan Channel Policy",
      desc: "Перед копированием строится иерархическое дерево категорий и каналов. При исключении скрытой категории политика Orphan Policy явно определяет судьбу дочерних комнат: пропустить ('skip') или перенести в корень сервера ('root').",
      icon: GitFork,
      color: "#5865f2"
    },
    {
      title: "Валидация длины водяного знака (Topic <= 1024)",
      desc: "Текст водяного знака проверяется на лимит Discord. Исходное описание никогда не обрезается молча: при превышении 1024 символов описание сохраняется нетронутым, а канал помечается в отчете для ручной проверки.",
      icon: Tag,
      color: "#5865f2"
    },
    {
      title: "Stealth Mode (Снижение риска детекта)",
      desc: "Рандомизированный джиттер между запросами (900-1500мс) и микропаузы (3-4с каждые 7-8 запросов) снижают риск срабатывания антиспам-эвристик. Внимание: задержки снижают вероятность блокировок, но не дают 100% гарантии от ручных проверок.",
      icon: ShieldAlert,
      color: "#f0b232"
    },
    {
      title: "Контроль рейтлимитов 429 и блокирующих ошибок",
      desc: "Адаптивное чтение заголовка Retry-After с джиттер-паузой. Блокирующие ошибки авторизации и прав (HTTP 401, 403) не повторяются вслепую — плагин мгновенно прекращает работу с понятным объяснением причины.",
      icon: Clock,
      color: "#f0b232"
    },
    {
      title: "Итоговый аудит и список ручной проверки",
      desc: "Формирование отчета из реальных результатов: раздельный подсчет созданных, сопоставленных дубликатов, пропущенных бот-ролей и верифицированных каналов. Список manualReviewList сохраняет проблемные объекты.",
      icon: ShieldCheck,
      color: "#23a55a"
    },
    {
      title: "Градиентные цвета ролей (primary, secondary, tertiary)",
      desc: "Перенос расширенной палитры Discord (голографические и многоцветные стили). Валидация проверяет результат на целевом сервере: если сервер не сохранил градиент (нет достаточного уровня буста), плагин фиксирует это в отчете и помечает роль для ручной проверки.",
      icon: Palette,
      color: "#9b59b6"
    },
    {
      title: "Кнопка «Создать сервер» (Клонирование в чистый сервер)",
      desc: "Создание нового пустого сервера через Discord REST API (POST /guilds) прямо из интерфейса плагина. Сервер автоматически выбирается как целевой, гарантируя идеальный перенос без наложения на старую структуру.",
      icon: Sparkles,
      color: "#5865f2"
    },
    {
      title: "Кнопка «Удалить содержимое сервера» (Полная зачистка)",
      desc: "Быстрое удаление всех каналов, категорий, пользовательских ролей и эмодзи на целевом сервере перед копированием. Оснащено подтверждением для защиты от случайного удаления и строгой защитой от очистки исходного сервера-донора.",
      icon: Trash2,
      color: "#da373c"
    }
  ];

  const channelSupportMatrix = [
    { type: "0", name: "GUILD_TEXT (Текстовый канал)", status: "Поддерживается", note: "Название, тема (topic), NSFW, Slowmode, порядок, все Overwrites" },
    { type: "2", name: "GUILD_VOICE (Голосовой канал)", status: "Поддерживается", note: "Битрейт (до 96kbps), лимит пользователей, регион RTC, права" },
    { type: "4", name: "GUILD_CATEGORY (Категория)", status: "Поддерживается", note: "Иерархия, позиция, категорийные права доступа" },
    { type: "5", name: "GUILD_ANNOUNCEMENT (Канал анонсов)", status: "Поддерживается", note: "Новостной канал, топик, позиция, права доступа" },
    { type: "13", name: "GUILD_STAGE_VOICE (Трибуна / Сцена)", status: "Поддерживается", note: "Сцена, топик, лимит пользователей, права доступа" },
    { type: "15", name: "GUILD_FORUM (Форум сообщества)", status: "Поддерживается", note: "Теги форума, реакции по умолчанию, порядок сортировки, права" },
    { type: "16", name: "GUILD_MEDIA (Медиа-канал)", status: "Поддерживается", note: "Медиа-канал, теги форума, реакции, права доступа" },
    { type: "6", name: "GUILD_STORE (Магазин)", status: "Не поддерживается", note: "Устаревший тип каналов Discord (deprecated)" },
    { type: "10", name: "GUILD_NEWS_THREAD (Ветка анонсов)", status: "Не поддерживается", note: "Ветки создаются внутри сообщений и не переносятся через REST" },
    { type: "11", name: "GUILD_PUBLIC_THREAD (Публичная ветка)", status: "Не поддерживается", note: "Требует активного родительского стартового сообщения" },
    { type: "12", name: "GUILD_PRIVATE_THREAD (Приватная ветка)", status: "Не поддерживается", note: "Приватные ветки привязаны к сообщениям и участникам (REST создание невозможно)" },
  ];

  const metadataSupportMatrix = [
    { category: "Иерархия и каналы", transferred: "Да", details: "Название, тема, parent_id категорий, позиция, битрейт, slowmode, NSFW" },
    { category: "Права доступа (Overwrites)", transferred: "Да", details: "Роли @everyone allow/deny, списки ролей, индивидуальные права пользователей" },
    { category: "Роли сервера", transferred: "Да", details: "Название, цвета, hoist (отображение отдельно), mentionable, иерархия позиций" },
    { category: "Эмодзи и графика", transferred: "Да", details: "Пользовательские эмодзи (lossless CDN), иконка сервера до 4096px, баннер сервера" },
    { category: "Системные настройки", transferred: "Да", details: "Уровень верификации, AFK-канал и таймаут, системные уведомления, locale" },
    { category: "История сообщений", transferred: "Нет", details: "Текстовые сообщения участников, вложения файлов, реакции к сообщениям" },
    { category: "Ветки Discord (Threads)", transferred: "Нет", details: "Активные и архивные треды (типы 10, 11, 12) не переносятся через REST" },
    { category: "Интеграции и бот-роли", transferred: "Нет", details: "Системные бот-роли (managed: true) исключаются во избежание 403 Forbidden" }
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5">
        <h2 className="text-base font-bold text-white mb-2">Стандарты надежности структуры сервера v1.2.0</h2>
        <p className="text-xs text-[#949ba4] leading-relaxed">
          Плагин реализует точный перенос иерархии категорий, защищает от развала связей parent_id, проверяет лимит описаний каналов, соблюдает политику рейтлимитов и формирует прозрачный аудит с перечнем ручных проверок.
        </p>
      </div>

      {/* Grid of Key Features */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {improvements.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={idx}
              className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-5 flex flex-col gap-3 hover:border-[#5865f2]/50 transition-colors"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${item.color}20`, color: item.color }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white mb-1.5">{item.title}</h3>
                <p className="text-xs text-[#949ba4] leading-relaxed">{item.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Channel Types Matrix Table */}
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#5865f2]" />
            <h3 className="text-sm font-bold text-white">Таблица поддерживаемых типов каналов Discord</h3>
          </div>
          <span className="text-xs text-[#949ba4]">Ветки тредов (10, 11, 12) явно исключены</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#3f4147] text-[#949ba4] font-semibold">
                <th className="py-2.5 px-3">Код типа</th>
                <th className="py-2.5 px-3">Название типа канала</th>
                <th className="py-2.5 px-3">Статус поддержки</th>
                <th className="py-2.5 px-3">Параметры и примечания</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4147]/40">
              {channelSupportMatrix.map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-mono text-[#949ba4]">{row.type}</td>
                  <td className="py-2.5 px-3 font-medium text-white">{row.name}</td>
                  <td className="py-2.5 px-3">
                    {row.status === "Поддерживается" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#23a55a] bg-[#23a55a]/15 px-2 py-0.5 rounded">
                        <CheckCircle2 className="w-3 h-3" /> Переносится 1:1
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#f0b232] bg-[#f0b232]/15 px-2 py-0.5 rounded">
                        <Ban className="w-3 h-3" /> Пропускается
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[#949ba4]">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Metadata Transfer Matrix Table */}
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#23a55a]" />
          <h3 className="text-sm font-bold text-white">Документация метаданных: что переносится vs не переносится</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#3f4147] text-[#949ba4] font-semibold">
                <th className="py-2.5 px-3">Категория данных</th>
                <th className="py-2.5 px-3">Перенос</th>
                <th className="py-2.5 px-3">Подробности реализации</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3f4147]/40">
              {metadataSupportMatrix.map((row, i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-medium text-white">{row.category}</td>
                  <td className="py-2.5 px-3">
                    {row.transferred === "Да" ? (
                      <span className="text-[#23a55a] font-semibold">✓ Да</span>
                    ) : (
                      <span className="text-[#949ba4] font-semibold">✗ Нет</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-[#dbdee1]">{row.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
