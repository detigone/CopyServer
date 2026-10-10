import React from 'react';
import {
  Sparkles,
  Palette,
  Terminal,
  Activity,
  CheckCircle,
  Sliders,
  Layers,
  ShieldCheck,
  Zap,
  RefreshCw,
  Clock,
  Square
} from 'lucide-react';

export function FeaturesBreakdown() {
  const improvements = [
    {
      title: "Соблюдение и обход рейтлимитов (Rate Limit 429)",
      desc: "Интеллектуальная очередь запросов: считывание заголовков Retry-After и X-RateLimit-Reset-After, автоматическая пауза с джиттером (+300мс) и повторные попытки при сбоях 5xx.",
      icon: Clock,
      color: "#f0b232"
    },
    {
      title: "Двухфазная верификация каналов",
      desc: "Последовательное создание: сначала все категории (type 4), затем каналы с привязкой parent_id. В конце выполняется опрос целевого сервера и 100% сверка наличия всех каналов.",
      icon: ShieldCheck,
      color: "#23a55a"
    },
    {
      title: "Pre-Flight аудит прав и лимитов",
      desc: "Перед началом копирования проверяются права на целевом сервере, доступность гильдий и суммарное количество каналов/ролей относительно жестких лимитов Discord (500 каналов, 250 ролей).",
      icon: Activity,
      color: "#5865f2"
    },
    {
      title: "Автоматический пропуск системных бот-ролей",
      desc: "Исключение ролей с managed: true и bot_id/integration_id (Mee6, Nitro Booster, интеграции ботов), которые Discord блокирует при попытке создания через REST API.",
      icon: Zap,
      color: "#23a55a"
    },
    {
      title: "Защита от дубликатов (Skip Duplicates)",
      desc: "Опция автоматического сопоставления: если роль или эмодзи уже созданы на целевом сервере с идентичным именем, они не создаются повторно, предотвращая дубли.",
      icon: RefreshCw,
      color: "#5865f2"
    },
    {
      title: "Возможность безопасной остановки (Abort)",
      desc: "Кнопка «Остановить» позволяет прервать процесс в любой момент между шагами создания, предотвращая нежелательное заполнение сервера при ошибке выбора гильдии.",
      icon: Square,
      color: "#f23f43"
    }
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5">
        <h2 className="text-base font-bold text-white mb-2">Надежность и защита от сбоев v1.3.0</h2>
        <p className="text-xs text-[#949ba4] leading-relaxed">
          В новой версии полностью устранены типичные проблемы Discord-клонеров: блокировки за спам-запросы 429, потеря вложенности каналов в категориях, ошибки при попытке создать роли ботов и отсутствие контроля результата.
        </p>
      </div>

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
    </div>
  );
}
