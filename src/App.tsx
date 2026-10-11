import React, { useState } from 'react';
import { DiscordPluginSimulator } from './components/DiscordPluginSimulator';
import { CodeViewer } from './components/CodeViewer';
import { InstallGuide } from './components/InstallGuide';
import { FeaturesBreakdown } from './components/FeaturesBreakdown';
import { VENCORD_FULL_CODE, BETTERDISCORD_FULL_CODE } from './data/fullCode';
import {
  Download,
  Terminal,
  Layers,
  Sparkles,
  BookOpen,
  Code2
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'features' | 'code' | 'guide'>('simulator');

  const handleDownloadQuick = () => {
    // Downloads BetterDiscord plugin by default or switches to code tab
    const blob = new Blob([BETTERDISCORD_FULL_CODE], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CopyServer.plugin.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#1e1f22] text-[#dbdee1] flex flex-col font-discord">
      {/* Top Bar Contract (3 zones: Brand title, 4 nav links, 1 primary action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#2b2d31]/90 backdrop-blur-md border-b border-[#3f4147]/50 sticky top-0 z-40">
        {/* Zone 1: Brand title wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#5865f2] flex items-center justify-center text-white shadow-md">
            <Layers className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            CopyServer
          </span>
        </div>

        {/* Zone 2: 4-5 single-line nav links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-[#949ba4]">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`whitespace-nowrap transition-colors hover:text-white py-1 ${
              activeTab === 'simulator' ? 'text-white border-b-2 border-[#5865f2]' : ''
            }`}
          >
            Симулятор
          </button>
          <button
            onClick={() => setActiveTab('features')}
            className={`whitespace-nowrap transition-colors hover:text-white py-1 ${
              activeTab === 'features' ? 'text-white border-b-2 border-[#5865f2]' : ''
            }`}
          >
            Улучшения
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`whitespace-nowrap transition-colors hover:text-white py-1 ${
              activeTab === 'code' ? 'text-white border-b-2 border-[#5865f2]' : ''
            }`}
          >
            Исходный код
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`whitespace-nowrap transition-colors hover:text-white py-1 ${
              activeTab === 'guide' ? 'text-white border-b-2 border-[#5865f2]' : ''
            }`}
          >
            Инструкция
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleDownloadQuick}
            className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] rounded-lg transition-colors flex items-center gap-1.5 shadow-sm whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать плагин (.js)</span>
          </button>
        </div>
      </header>

      {/* Mobile nav tab strip */}
      <div className="md:hidden flex items-center justify-around bg-[#232428] border-b border-[#3f4147]/40 px-2 py-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('simulator')}
          className={`px-2 py-1 rounded ${activeTab === 'simulator' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
        >
          Симулятор
        </button>
        <button
          onClick={() => setActiveTab('features')}
          className={`px-2 py-1 rounded ${activeTab === 'features' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
        >
          Улучшения
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`px-2 py-1 rounded ${activeTab === 'code' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
        >
          Код
        </button>
        <button
          onClick={() => setActiveTab('guide')}
          className={`px-2 py-1 rounded ${activeTab === 'guide' ? 'bg-[#5865f2] text-white' : 'text-[#949ba4]'}`}
        >
          Гайд
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">
        {activeTab === 'simulator' && <DiscordPluginSimulator />}
        {activeTab === 'features' && <FeaturesBreakdown />}
        {activeTab === 'code' && (
          <CodeViewer
            vencordCode={VENCORD_FULL_CODE}
            betterDiscordCode={BETTERDISCORD_FULL_CODE}
          />
        )}
        {activeTab === 'guide' && <InstallGuide />}
      </main>

      {/* Clean quiet footer */}
      <footer className="mt-auto border-t border-[#3f4147]/40 bg-[#1e1f22] px-6 py-4 text-center text-xs text-[#949ba4]">
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
          <span className="font-semibold text-white">CopyServer Pro</span>
          <span>·</span>
          <span>Компания: <strong className="text-[#23a55a]">Lime Systems</strong></span>
          <span>·</span>
          <span>Основатель: <strong className="text-white">detigone</strong></span>
          <span>·</span>
          <span>Vencord (React) & BetterDiscord</span>
          <span>·</span>
          <span>Discord Design System 2026</span>
        </div>
      </footer>
    </div>
  );
}
