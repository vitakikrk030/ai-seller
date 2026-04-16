'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Plug, Sun, Moon, LogOut } from 'lucide-react';
import ChatView from '../components/ChatView';
import IntegrationsView from '../components/IntegrationsView';
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
          className={`nav-tab ${tab === 'integrations' ? 'active' : ''}`}
          onClick={() => setTab('integrations')}
          aria-current={tab === 'integrations' ? 'page' : undefined}
        >
          <Plug size={15} /> Интеграции
        </button>
        <div className="nav-right">
          <button className="theme-toggle" onClick={toggleTheme} title="Переключить тему" aria-label="Переключить тему">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="theme-toggle" onClick={logout} title="Выйти" aria-label="Выйти">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {tab === 'chats' && <ChatView />}
      {tab === 'integrations' && <IntegrationsView />}
    </div>
  );
}
