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
            <h3 className="text-base font-bold text-white">Интеграция в Vencord (Два способа)</h3>
          </div>

          <div className="flex flex-col gap-4 text-xs text-[#949ba4]">
            {/* Method A: UserPlugins folder in source build */}
            <div className="bg-[#1e1f22] p-3 rounded-lg border border-white/5">
              <span className="text-white font-bold block mb-1.5 text-xs text-[#5865f2]">
                Способ 1: Локальный Vencord (UserPlugins / Сборка)
              </span>
              <ol className="list-decimal list-inside space-y-1 text-[#dbdee1]">
                <li>
                  Клонируйте репозиторий Vencord: <code className="text-[#23a55a] font-mono text-[11px]">git clone https://github.com/Vendicated/Vencord</code>
                </li>
                <li>
                  Перейдите в папку <code className="text-[#5865f2] font-mono text-[11px]">src/userplugins/</code> (если папки нет — создайте её).
                </li>
                <li>
                  Создайте папку <code className="text-[#5865f2] font-mono text-[11px]">copyServer/</code> и поместите внутрь файл <code className="text-white font-mono text-[11px]">index.tsx</code>:
                  <div className="bg-[#2b2d31] p-1.5 rounded mt-1 font-mono text-[11px] text-[#dbdee1]">
                    src/userplugins/copyServer/index.tsx
                  </div>
                </li>
                <li>
                  Установите зависимости и соберите: <code className="text-[#23a55a] font-mono text-[11px]">pnpm i && pnpm build</code>
                </li>
                <li>
                  Установите Vencord в Discord через установщик: <code className="text-[#23a55a] font-mono text-[11px]">pnpm inject</code>
                </li>
              </ol>
            </div>

            {/* Method B: UserScripts / Browser Extension / Vencord Companion */}
            <div className="bg-[#1e1f22] p-3 rounded-lg border border-white/5">
              <span className="text-white font-bold block mb-1.5 text-xs text-[#23a55a]">
                Способ 2: Готовый JS-плагин (BetterDiscord / Vencord Quick CSS & JS)
              </span>
              <p className="text-[#dbdee1] mb-1.5 leading-relaxed">
                Если вы используете уже установленный Vencord без сборки из исходников, используйте готовый скомпилированный бандл <strong className="text-white">CopyServer.plugin.js</strong> либо загрузите его через расширение Vencord Companion / BetterDiscord.
              </p>
              <div className="text-[11px] text-[#949ba4]">
                • В Vencord откройте <strong>Настройки ➔ Vencord ➔ Плагины</strong> и включите <strong>CopyServer</strong>.<br />
                • Панель откроется по нажатию на шестерёнку настроек плагина.
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
