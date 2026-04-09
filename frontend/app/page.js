'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Settings, Plug, Sun, Moon, LogOut } from 'lucide-react';
import ChatView from '../components/ChatView';
import SettingsView from '../components/SettingsView';
import IntegrationsView from '../components/IntegrationsView';
import StatsBar from '../components/StatsBar';
import { useTheme } from '../lib/ThemeContext';
import { useAuth } from '../lib/AuthContext';

export default function Home() {
  const [tab, setTab] = useState('chats');
  const { theme, toggleTheme } = useTheme();
  const { token, logout, loading } = useAuth();
  const router = useRouter();

  // Show nothing while checking auth
  if (loading) return null;

  // Redirect to login if not authenticated
  if (!token) {
    router.push('/login');
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <nav className="nav-bar">
        <button
          className={`nav-tab ${tab === 'chats' ? 'active' : ''}`}
          onClick={() => setTab('chats')}
        >
          <MessageSquare size={15} /> Чаты
        </button>
        <button
          className={`nav-tab ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <Settings size={15} /> Настройки
        </button>
        <button
          className={`nav-tab ${tab === 'integrations' ? 'active' : ''}`}
          onClick={() => setTab('integrations')}
        >
          <Plug size={15} /> Интеграции
        </button>
        <div className="nav-right">
          <StatsBar />
          <button className="theme-toggle" onClick={toggleTheme} title="Переключить тему">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="theme-toggle" onClick={logout} title="Выйти">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {tab === 'chats' && <ChatView />}
      {tab === 'settings' && <SettingsView />}
      {tab === 'integrations' && <IntegrationsView />}
    </div>
  );
}
