'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Plug, Sun, Moon, LogOut, Activity, Bot } from 'lucide-react';
import ChatView from '../components/ChatView';
import IntegrationsView from '../components/IntegrationsView';
import MonitoringView from '../components/MonitoringView';
import AISettingsView from '../components/AISettingsView';
import StatsBar from '../components/StatsBar';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';

export default function Home() {
  const [tab, setTab] = useState('chats');
  const { theme, toggleTheme } = useTheme();
  const { token, logout, loading } = useAuth();
  const router = useRouter();

  if (loading) return null;

  if (!token) {
    router.push('/login');
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <nav className="nav-bar" role="navigation" aria-label="Основная навигация">
        <button
          className={`nav-tab ${tab === 'chats' ? 'active' : ''}`}
          onClick={() => setTab('chats')}
          aria-current={tab === 'chats' ? 'page' : undefined}
        >
          <MessageSquare size={15} /> Чаты
        </button>
        <button
          className={`nav-tab ${tab === 'ai-settings' ? 'active' : ''}`}
          onClick={() => setTab('ai-settings')}
          aria-current={tab === 'ai-settings' ? 'page' : undefined}
        >
          <Bot size={15} /> Настройки AI
        </button>
        <button
          className={`nav-tab ${tab === 'integrations' ? 'active' : ''}`}
          onClick={() => setTab('integrations')}
          aria-current={tab === 'integrations' ? 'page' : undefined}
        >
          <Plug size={15} /> Интеграции
        </button>
        <button
          className={`nav-tab ${tab === 'monitoring' ? 'active' : ''}`}
          onClick={() => setTab('monitoring')}
          aria-current={tab === 'monitoring' ? 'page' : undefined}
        >
          <Activity size={15} /> Мониторинг
        </button>
        <div className="nav-right">
          <StatsBar />
          <button className="theme-toggle" onClick={toggleTheme} title="Переключить тему" aria-label="Переключить тему">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="theme-toggle" onClick={logout} title="Выйти" aria-label="Выйти">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {tab === 'chats' && <ChatView />}
      {tab === 'ai-settings' && <AISettingsView />}
      {tab === 'integrations' && <IntegrationsView />}
      {tab === 'monitoring' && <MonitoringView />}
    </div>
  );
}
