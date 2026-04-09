'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  User, Bot, ShieldCheck, ChevronLeft, UserCircle, Send,
  Package, Phone, MapPin, Hash, Clock, MessageSquare, Info,
} from 'lucide-react';
import { api } from '../lib/api';

export default function ChatView() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  // Mobile panel: 'list' | 'chat' | 'info'
  const [mobilePanel, setMobilePanel] = useState('list');
  const messagesEnd = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadUsers();
    const interval = setInterval(loadUsers, 5000);
    return () => clearInterval(interval);
  }, [search]);

  useEffect(() => {
    if (selected) {
      loadMessages();
      loadOrders();
      pollRef.current = setInterval(loadMessages, 3000);
      return () => clearInterval(pollRef.current);
    }
  }, [selected?.id]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadUsers() {
    try { setUsers(await api.getUsers(search)); } catch (e) { console.error(e); }
  }

  async function loadMessages() {
    if (!selected) return;
    try { setMessages(await api.getMessages(selected.id)); } catch (e) { console.error(e); }
  }

  async function loadOrders() {
    if (!selected) return;
    try { setOrders(await api.getUserOrders(selected.id)); } catch (e) { console.error(e); }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!input.trim() || !selected || sending) return;
    setSending(true);
    try {
      await api.sendMessage(selected.id, input.trim());
      setInput('');
      await loadMessages();
    } catch (e) { console.error(e); }
    setSending(false);
  }

  async function toggleAI() {
    if (!selected) return;
    const newVal = !selected.ai_enabled;
    try {
      await api.toggleAI(selected.id, newVal);
      setSelected({ ...selected, ai_enabled: newVal });
      loadUsers();
    } catch (e) { console.error(e); }
  }

  async function changeAiMode(mode) {
    if (!selected) return;
    try {
      const user = await api.setAiMode(selected.id, mode);
      setSelected({ ...selected, ai_mode: mode });
      loadUsers();
    } catch (e) { console.error(e); }
  }

  const AI_MODE_OPTIONS = [
    { value: 'OBSERVE', icon: '👁', label: 'Наблюдает' },
    { value: 'HYBRID', icon: '🤖', label: 'Иногда' },
    { value: 'AUTO', icon: '⚡', label: 'Всегда' },
    { value: 'AUTO_WITH_MANAGER_OVERRIDE', icon: '👨‍💼', label: 'При менеджере молчит' },
  ];

  function getAiStatusInfo(user) {
    if (!user) return { text: '', color: '' };
    if (!user.ai_enabled) return { text: 'AI выкл', color: '#ef4444' };
    if (user.manager_active) return { text: 'Менеджер в диалоге', color: '#f59e0b' };
    const mode = user.ai_mode || 'AUTO';
    if (mode === 'OBSERVE') return { text: 'AI наблюдает', color: '#6b7280' };
    if (mode === 'HYBRID') return { text: 'AI частично', color: '#3b82f6' };
    if (mode === 'AUTO_WITH_MANAGER_OVERRIDE') return { text: 'AI активен', color: '#22c55e' };
    return { text: 'AI активен', color: '#22c55e' };
  }

  const selectUser = useCallback((u) => {
    setSelected(u);
    setMobilePanel('chat');
  }, []);

  function formatTime(date) {
    return new Date(date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(date) {
    return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  const roleIcon = { user: <User size={10} />, ai: <Bot size={10} />, admin: <ShieldCheck size={10} /> };
  const roleLabel = { user: 'Клиент', ai: 'AI', admin: 'Админ' };

  return (
    <div className="app" style={{ flex: 1 }}>
      {/* ===== SIDEBAR ===== */}
      <div className={`sidebar ${mobilePanel !== 'list' ? 'hidden' : ''}`}>
        <div className="sidebar-header">
          <h2>Клиенты</h2>
          <input
            type="text"
            className="search-input"
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="chat-list">
          {users.map((u) => (
            <div
              key={u.id}
              className={`chat-item ${selected?.id === u.id ? 'active' : ''}`}
              onClick={() => selectUser(u)}
            >
              <div className="chat-item-name">
                {u.name || 'Без имени'}
                <span className={`badge badge-${u.state?.toLowerCase()}`}>{u.state}</span>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginLeft: 6,
                  backgroundColor: getAiStatusInfo(u).color,
                }} title={getAiStatusInfo(u).text} />
              </div>
              <div className="chat-item-preview">
                {u.last_message || 'Нет сообщений'}
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="empty-state">Нет клиентов</div>}
        </div>
      </div>

      {/* ===== CHAT ===== */}
      <div className={`chat-panel ${mobilePanel !== 'chat' ? 'hidden' : ''}`}>
        {selected ? (
          <>
            <div className="chat-header">
              <div className="chat-header-left">
                <button className="btn-icon back-btn" onClick={() => setMobilePanel('list')}>
                  <ChevronLeft size={18} />
                </button>
                <h3>
                  {selected.name || 'Без имени'}
                  {selected.username && <span className="username">@{selected.username}</span>}
                </h3>
              </div>
              <div className="chat-header-right">
                <button className="btn-icon back-btn" onClick={() => setMobilePanel('info')} title="Карточка клиента">
                  <Info size={16} />
                </button>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 12,
                  background: getAiStatusInfo(selected).color + '22',
                  color: getAiStatusInfo(selected).color,
                  fontWeight: 600,
                }}>
                  {getAiStatusInfo(selected).text}
                </span>
                <span className="ai-label">AI</span>
                <div className={`toggle ${selected.ai_enabled ? 'active' : ''}`} onClick={toggleAI} />
              </div>
            </div>

            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`message message-${m.role}`}>
                  <div className="message-label">
                    {roleIcon[m.role]} {roleLabel[m.role]}
                  </div>
                  {m.text}
                  <div className="message-time">{formatTime(m.created_at)}</div>
                </div>
              ))}
              <div ref={messagesEnd} />
            </div>

            <form className="chat-input-area" onSubmit={sendMessage}>
              <input
                type="text"
                className="chat-input"
                placeholder="Ответить от имени админа..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={sending}>
                <Send size={14} />
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state">
            <MessageSquare size={32} style={{ opacity: 0.3 }} />
            Выберите чат
          </div>
        )}
      </div>

      {/* ===== RIGHT PANEL ===== */}
      <div className={`right-panel ${mobilePanel !== 'info' ? 'hidden' : ''}`}>
        {selected ? (
          <>
            <div className="panel-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="panel-section-title"><UserCircle size={14} /> Клиент</div>
                <button className="btn-icon back-btn" onClick={() => setMobilePanel('chat')}>
                  <ChevronLeft size={18} />
                </button>
              </div>
              <div className="info-row">
                <span className="info-label">Имя</span>
                <span className="info-value">{selected.name || '—'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Username</span>
                <span className="info-value">@{selected.username || '—'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Telegram ID</span>
                <span className="info-value">{selected.telegram_id}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Статус</span>
                <span className={`badge badge-${selected.state?.toLowerCase()}`}>{selected.state}</span>
              </div>
              <div className="info-row">
                <span className="info-label">AI автоответ</span>
                <span className="info-value">{selected.ai_enabled ? 'Вкл' : 'Выкл'}</span>
              </div>
              <div className="info-row">
                <span className="info-label">AI режим</span>
                <span className="info-value" style={{ fontSize: 12 }}>
                  {AI_MODE_OPTIONS.find((m) => m.value === (selected.ai_mode || 'AUTO'))?.icon}{' '}
                  {AI_MODE_OPTIONS.find((m) => m.value === (selected.ai_mode || 'AUTO'))?.label}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {AI_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => changeAiMode(opt.value)}
                    className={`btn ${(selected.ai_mode || 'AUTO') === opt.value ? 'btn-primary' : ''}`}
                    style={{ fontSize: 11, padding: '4px 8px', flex: '1 1 45%' }}
                    title={opt.label}
                  >
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
              {selected.manager_active && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', borderRadius: 8,
                  background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                  fontSize: 12, textAlign: 'center',
                }}>
                  👨‍💼 Менеджер в диалоге — AI молчит
                </div>
              )}
              <div className="info-row">
                <span className="info-label">Сообщений</span>
                <span className="info-value">{selected.message_count || 0}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Активность</span>
                <span className="info-value">{formatDate(selected.last_seen)}</span>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-title"><Package size={14} /> Заказы</div>
              {orders.length > 0 ? (
                orders.map((o) => (
                  <div key={o.id} className="order-card">
                    <div className="order-card-title">
                      <Hash size={12} /> Заказ {o.id}
                    </div>
                    <div className="info-row">
                      <span className="info-label">Товар</span>
                      <span className="info-value">{o.product || '—'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Размер</span>
                      <span className="info-value">{o.size || '—'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">ФИО</span>
                      <span className="info-value">{o.full_name || '—'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Телефон</span>
                      <span className="info-value">{o.phone || '—'}</span>
                    </div>
                    <div className="info-row">
                      <span className="info-label">Статус</span>
                      <span className={`badge badge-${o.status?.toLowerCase()}`}>{o.status}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Нет заказов</div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <UserCircle size={32} style={{ opacity: 0.3 }} />
            Выберите клиента
          </div>
        )}
      </div>
    </div>
  );
}
