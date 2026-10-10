import React from 'react';
import {
  Sparkles,
  Palette,
  Terminal,
  Activity,
  CheckCircle,
  Sliders,
  Layers,
  ShieldAlert
} from 'lucide-react';

export function FeaturesBreakdown() {
  const improvements = [
    {
      title: "Нативная Discord дизайн-система",
      desc: "Использование Discord CSS-переменных (--background-secondary, --brand-experiment, --text-normal, --header-primary) с fallback-значениями для идеальной интеграции в любую тему клиента (Dark, Light, AMOLED Midnight).",
      icon: Palette,
      color: "#5865f2"
    },
    {
      title: "Discord-style тогглы вместо сырых checkbox",
      desc: "Вместо дефолтных браузерных флажков созданы аутентичные Discord Switch с плавным смещением ползунка (0.2s cubic-bezier), мягкими тенями и подсветкой при наведении.",
      icon: Sliders,
      color: "#23a55a"
    },
    {
      title: "Информативные карточки серверов",
      desc: "Отображение идентификатора сервера, счетчика участников, ролей и каналов, а также защита от выбора одинакового сервера в качестве источника и цели.",
      icon: Layers,
      color: "#f0b232"
    },
    {
      title: "Быстрые пресеты в один клик",
      desc: "Пресеты «Всё 1:1», «Только структура» (роли + каналы) и «Медиа & Настройки» для моментальной настройки без ручного клика по всем пунктам.",
      icon: Sparkles,
      color: "#5865f2"
    },
    {
      title: "Анимированный прогресс-бар и счетчик шагов",
      desc: "Отображение текущего этапа (например, «Создание каналов (12/28)») с процентом завершения в реальном времени, избавляющее пользователя от ощущения зависания.",
      icon: Activity,
      color: "#23a55a"
    },
    {
      title: "Стилизованный терминал с тегами и фильтрами",
      desc: "Лог оформлен как встроенная консоль: временные метки [14:20:05], цветовые бейджи [ИНФО], [УСПЕХ], [ПРЕДУПР], [ОШИБКА], кнопки копирования и очистки.",
      icon: Terminal,
      color: "#f23f43"
    }
  ];

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
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
