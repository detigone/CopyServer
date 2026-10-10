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
  Square,
  Lock,
  Tag,
  ShieldAlert
} from 'lucide-react';

export function FeaturesBreakdown() {
  const improvements = [
    {
      title: "Копирование ВСЕХ каналов (включая скрытые)",
      desc: "Точный перенос закрытых админ-каналов и секретных комнат с сохранением прав доступа: маски @everyone deny: 1024 (VIEW_CHANNEL) и списки разрешений для специфических ролей переносятся без утечки приватности.",
      icon: Lock,
      color: "#23a55a"
    },
    {
      title: "Повышенная безопасность аккаунта (Stealth Mode)",
      desc: "Имитация естественного поведения: рандомизированный джиттер между запросами (900-1500мс) и автоматические микропаузы (3-4с каждые 7 запросов) исключают триггеры антиспам-эвристик Discord.",
      icon: ShieldAlert,
      color: "#f0b232"
    },
    {
      title: "Настраиваемый водяной знак (с кнопкой выключения)",
      desc: "Возможность добавлять ненавязчивую отметку о клонировании в поле topic описания каналов (например, «[Клон: ServerCloner Pro]») или полностью отключить её перед началом копирования одним кликом.",
      icon: Tag,
      color: "#5865f2"
    },
    {
      title: "Контроль и обход рейтлимитов (429 Backoff)",
      desc: "Интеллектуальный перехватчик считывает заголовок Retry-After от серверов Discord, добавляет защитный джиттер и автоматически возобновляет работу без падения плагина.",
      icon: Clock,
      color: "#f0b232"
    },
    {
      title: "Двухфазная верификация структуры каналов",
      desc: "Сначала создаются все родительские категории (type 4), затем каналы с гарантированной привязкой parent_id. В конце выполняется аудит GET /channels с подтверждением 100% результата.",
      icon: ShieldCheck,
      color: "#23a55a"
    },
    {
      title: "Фильтрация системных бот-ролей и дубликатов",
      desc: "Автоматический пропуск ролей ботов (managed: true, Nitro Booster), вызывающих системные ошибки API Discord, а также предотвращение дублирования уже имеющихся элементов.",
      icon: Zap,
      color: "#5865f2"
    }
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5">
        <h2 className="text-base font-bold text-white mb-2">Безопасность, скрытые каналы и кастомизация v1.4.0</h2>
        <p className="text-xs text-[#949ba4] leading-relaxed">
          Плагин гарантирует сохранность аккаунта, не допускает случайного раскрытия приватных каналов и позволяет гибко управлять метаданными создаваемых комнат.
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
