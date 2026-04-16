'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

function formatTime(date) {
  return new Date(date).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatView() {
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      try {
        const data = await api.getUsers();
        if (cancelled) return;
        setUsers(data);
        if (!selectedId && data[0]) {
          setSelectedId(data[0].id);
        }
      } catch {}
    }

    loadUsers();
    const interval = setInterval(loadUsers, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    async function loadMessages() {
      try {
        const data = await api.getMessages(selectedId);
        if (!cancelled) setMessages(data);
      } catch {}
    }

    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) || null,
    [users, selectedId]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-title">Диалоги</div>
        <div className="sidebar-list">
          {users.map((user) => (
            <button
              key={user.id}
              className={`chat-row ${user.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(user.id)}
            >
              <div className="chat-row-name">{user.name || user.username || user.telegram_id}</div>
              <div className="chat-row-last">{user.last_message || 'Нет сообщений'}</div>
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-panel">
        <div className="chat-header">
          {selectedUser ? (selectedUser.name || selectedUser.username || selectedUser.telegram_id) : 'Выберите диалог'}
        </div>
        <div className="chat-messages">
          {messages.map((message) => (
            <div key={message.id} className={`bubble ${message.role}`}>
              <div>{message.text}</div>
              <div className="bubble-meta">
                {formatTime(message.created_at)}
                {message.role === 'ai' && message.delivery_status ? ` · ${message.delivery_status}` : ''}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
