import React, { useState } from 'react';
import { Copy, Check, Download, FileCode, CheckCircle2 } from 'lucide-react';

interface CodeViewerProps {
  vencordCode: string;
  betterDiscordCode: string;
}

export function CodeViewer({ vencordCode, betterDiscordCode }: CodeViewerProps) {
  const [activeTab, setActiveTab] = useState<'vencord' | 'betterdiscord'>('vencord');
  const [copied, setCopied] = useState(false);

  const currentCode = activeTab === 'vencord' ? vencordCode : betterDiscordCode;
  const currentFileName = activeTab === 'vencord' ? 'index.tsx (Vencord)' : 'ServerCloner.plugin.js (BetterDiscord)';
  const currentDownloadName = activeTab === 'vencord' ? 'index.tsx' : 'ServerCloner.plugin.js';

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentDownloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col gap-6">
      {/* Feature comparison highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#5865f2] mb-1.5 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>Нативный Discord Switch</span>
          </div>
          <p className="text-xs text-[#949ba4] leading-relaxed">
            Вместо стандартных HTML checkbox добавлены плавные Discord тогглы со статусом и hover-эффектом.
          </p>
        </div>

        <div className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#23a55a] mb-1.5 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>Индикатор прогресса & ETA</span>
          </div>
          <p className="text-xs text-[#949ba4] leading-relaxed">
            Анимированный градиентный прогресс-бар показывает процент выполнения и текущий этап в реальном времени.
          </p>
        </div>

        <div className="bg-[#2b2d31] border border-[#3f4147]/60 rounded-xl p-4">
          <div className="flex items-center gap-2 text-[#f0b232] mb-1.5 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4" />
            <span>Терминал с тегами & Копированием</span>
          </div>
          <p className="text-xs text-[#949ba4] leading-relaxed">
            Цветовая подсветка (ИНФО, УСПЕХ, ОШИБКА), фильтры, автопрокрутка и кнопка копирования всего журнала.
          </p>
        </div>
      </div>

      {/* Code Editor Frame */}
      <div className="bg-[#1e1f22] border border-[#3f4147]/70 rounded-2xl overflow-hidden shadow-2xl flex flex-col">
        {/* Tab navigation & buttons */}
        <div className="bg-[#232428] px-4 py-3 border-b border-[#3f4147]/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-[#5865f2]" />
            <div className="flex items-center p-1 bg-[#1e1f22] rounded-lg border border-[#3f4147]/40 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('vencord')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === 'vencord'
                    ? 'bg-[#5865f2] text-white shadow-sm'
                    : 'text-[#949ba4] hover:text-white'
                }`}
              >
                serverCloner/index.tsx (Vencord)
              </button>
              <button
                onClick={() => setActiveTab('betterdiscord')}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  activeTab === 'betterdiscord'
                    ? 'bg-[#5865f2] text-white shadow-sm'
                    : 'text-[#949ba4] hover:text-white'
                }`}
              >
                ServerCloner.plugin.js (BetterDiscord)
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-[#2b2d31] hover:bg-[#3f4147] text-[#dbdee1] text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#23a55a]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано в буфер!' : 'Копировать код'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="px-3.5 py-1.5 rounded-lg bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать файл</span>
            </button>
          </div>
        </div>

        {/* Code View Body */}
        <div className="p-4 overflow-x-auto max-h-[600px] bg-[#1a1b1e]">
          <pre className="font-mono text-xs text-[#dbdee1] leading-relaxed">
            <code>{currentCode}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
