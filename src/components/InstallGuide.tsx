import React from 'react';
import { Folder, Terminal, Settings, CheckCircle2, AlertCircle } from 'lucide-react';

export function InstallGuide() {
  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      {/* Notice box */}
      <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-5 flex items-start gap-3.5">
        <AlertCircle className="w-5 h-5 text-[#f0b232] shrink-0 mt-0.5" />
        <div className="text-xs text-[#dbdee1] leading-relaxed">
          <strong className="text-white font-semibold">Важное примечание:</strong> Плагин выполняет запросы через внутренний RestAPI активной сессии Discord. Для копирования исходного сервера вам <strong className="text-[#23a55a]">не требуются права администратора</strong> на исходном сервере — достаточно иметь к нему доступ для чтения. На целевом сервере вы должны иметь права «Управление сервером», «Управление ролями» и «Управление каналами».
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Vencord Guide */}
        <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#3f4147]/50">
            <span className="w-7 h-7 rounded-lg bg-[#5865f2]/20 text-[#5865f2] flex items-center justify-center font-bold text-xs">
              V
            </span>
            <h3 className="text-base font-bold text-white">Установка в Vencord (UserPlugins)</h3>
          </div>

          <div className="flex flex-col gap-3.5 text-xs text-[#949ba4]">
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                1
              </span>
              <div>
                <strong className="text-white block mb-0.5">Откройте папку userplugins Vencord:</strong>
                <code className="text-[#5865f2] bg-[#1e1f22] px-2 py-0.5 rounded font-mono text-[11px]">
                  %appdata%\Vencord\src\userplugins\serverCloner\index.tsx
                </code>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                2
              </span>
              <div>
                <strong className="text-white block mb-0.5">Поместите файл:</strong>
                Скопируйте обновленный файл <span className="text-white font-mono">serverCloner/index.tsx</span> в эту директорию.
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                3
              </span>
              <div>
                <strong className="text-white block mb-0.5">Соберите или перезапустите:</strong>
                Если вы собираете Vencord из исходников, выполните <code className="text-[#23a55a] font-mono">pnpm build</code>.
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                4
              </span>
              <div>
                <strong className="text-white block mb-0.5">Активация в клиенте:</strong>
                Перейдите в <span className="text-white">Настройки пользователя ➔ Vencord ➔ Плагины ➔ CopyServer</span> и нажмите на шестеренку настроек.
              </div>
            </div>
          </div>
        </div>

        {/* BetterDiscord Guide */}
        <div className="bg-[#2b2d31] border border-[#3f4147]/70 rounded-xl p-6 flex flex-col gap-4">
          <div className="flex items-center gap-2.5 pb-3 border-b border-[#3f4147]/50">
            <span className="w-7 h-7 rounded-lg bg-[#23a55a]/20 text-[#23a55a] flex items-center justify-center font-bold text-xs">
              BD
            </span>
            <h3 className="text-base font-bold text-white">Установка в BetterDiscord</h3>
          </div>

          <div className="flex flex-col gap-3.5 text-xs text-[#949ba4]">
            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                1
              </span>
              <div>
                <strong className="text-white block mb-0.5">Откройте папку плагинов:</strong>
                В Discord зайдите в <span className="text-white">Настройки ➔ BetterDiscord ➔ Плагины</span> и нажмите кнопку <span className="text-white">«Открыть папку плагинов»</span>:
                <code className="text-[#23a55a] bg-[#1e1f22] px-2 py-0.5 rounded font-mono text-[11px] block mt-1">
                  %appdata%\BetterDiscord\plugins\
                </code>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                2
              </span>
              <div>
                <strong className="text-white block mb-0.5">Скопируйте файл плагина:</strong>
                Положите файл <span className="text-white font-mono">CopyServer.plugin.js</span> прямо в эту папку.
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                3
              </span>
              <div>
                <strong className="text-white block mb-0.5">Включите переключатель:</strong>
                BetterDiscord обнаружит плагин автоматически. Активируйте тумблер около <span className="text-white font-medium">CopyServer</span>.
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#1e1f22] text-white flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                4
              </span>
              <div>
                <strong className="text-white block mb-0.5">Открытие панели:</strong>
                Нажмите на иконку шестеренки (Настройки) рядом с названием плагина.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
