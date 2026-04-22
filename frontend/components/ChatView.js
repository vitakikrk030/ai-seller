'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  User, Bot, ShieldCheck, ChevronLeft, Send,
  Package, Hash, Trash2, Search, Clock,
  AlertTriangle, Flame, CreditCard, Star, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api';

// ── Constants ──

const TZ = 'Europe/Moscow';

const STATE_LABELS = {
  NEW: 'Новый',
  WAITING_SIZE: 'Размер',
  WAITING_FORM: 'Данные',
  WAITING_PAYMENT: 'Оплата',
  PAID: 'Оплачено',
  DONE: 'Завершен',
};

const STATE_COLORS = {
  NEW: 'var(--c-neutral)',
  WAITING_SIZE: 'var(--c-thinking)',
  WAITING_FORM: 'var(--c-thinking)',
  WAITING_PAYMENT: 'var(--c-warning)',
  PAID: 'var(--c-active)',
  DONE: 'var(--c-active)',
};

const HANDOFF_LABELS = {
  human_requested: 'Просит менеджера',
  complaint: 'Жалоба / возврат',
  delivery_problem: 'Проблема доставки',
  payment_issue: 'Проблема оплаты',
  ai_uncertain: 'AI не уверен',
};

// ── Time helpers ──

function fmtTime(date) {
  return new Date(date).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

function fmtDate(date) {
  return new Date(date).toLocaleDateString('ru-RU', {
    timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function fmtClock() {
  return new Date().toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

function fmtToday() {
  return new Date().toLocaleDateString('ru-RU', {
    timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric',
  });
}

function dayKey(date) {
  return new Date(date).toLocaleDateString('ru-RU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
}

function dayLabel(dateStr) {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const dk = dayKey(dateStr);
  if (dk === today) return 'Сегодня';
  if (dk === yesterday) return 'Вчера';
  return new Date(dateStr).toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' });
}

function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 60000) return 'сейчас';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' мин';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' ч';
  return new Date(date).toLocaleDateString('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short' });
}

function fmtWait(minutes) {
  if (!minutes || minutes < 1) return null;
  const m = Math.floor(minutes);
  if (m < 60) return m + ' мин';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' ч ' + (m % 60) + ' мин';
  return Math.floor(h / 24) + ' д';
}

// ── Heat score: hot / warm / cold ──

function heatLevel(user) {
  if (!user.last_message_at) return 'cold';
  const hoursSince = (Date.now() - new Date(user.last_message_at).getTime()) / 3600000;
  const isPayment = user.state === 'WAITING_PAYMENT';
  const isActive = ['WAITING_SIZE', 'WAITING_FORM'].includes(user.state);

  if (isPayment && hoursSince < 24) return 'hot';
  if (isPayment) return 'warm';
  if (isActive && hoursSince < 2) return 'hot';
  if (isActive && hoursSince < 12) return 'warm';
  if (hoursSince < 1 && user.message_count > 3) return 'hot';
  if (hoursSince < 6) return 'warm';
  return 'cold';
}

// ── AI recap: build from last messages ──

function buildRecap(messages, user, latestOrder) {
  if (!messages || messages.length === 0) return null;
  const last5 = messages.slice(-5);
  const aiMsgs = last5.filter(m => m.role === 'ai');
  const userMsgs = last5.filter(m => m.role === 'user');
  const adminMsgs = last5.filter(m => m.role === 'admin');

  const parts = [];
  const sl = STATE_LABELS[user.state] || user.state;
  parts.push('Статус: ' + sl);

  if (latestOrder?.product) parts.push(latestOrder.product);
  if (latestOrder?.price) parts.push(latestOrder.price + ' р');
  if (latestOrder?.size) parts.push('размер ' + latestOrder.size);

  if (userMsgs.length > 0) {
    const lastUserText = userMsgs[userMsgs.length - 1].text;
    if (lastUserText.length <= 60) {
      parts.push('Клиент: "' + lastUserText + '"');
    } else {
      parts.push('Клиент: "' + lastUserText.slice(0, 57) + '..."');
    }
  }

  if (aiMsgs.length > 0 && adminMsgs.length === 0) {
    parts.push('Отвечает AI');
  } else if (adminMsgs.length > 0) {
    parts.push('Отвечал менеджер');
  }

  return parts.join(' · ');
}

// ── Chip component ──

function Chip({ children, color, variant }) {
  const cls = variant ? `cv-chip cv-chip-${variant}` : 'cv-chip';
  return (
    <span className={cls} style={color ? { borderColor: color, color } : undefined}>
      {children}
    </span>
  );
}

// ── Sidebar filter tabs ──

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'needs_manager', label: 'Нужен менеджер' },
  { key: 'unread', label: 'Ждут ответа' },
  { key: 'order', label: 'С заказом' },
];

// ── Main Component ──

export default function ChatView() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [orders, setOrders] = useState([]);
  const [quickReplies, setQuickReplies] = useState([]);
  const [customerMemory, setCustomerMemory] = useState(null);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sending, setSending] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('list');
  const [clock, setClock] = useState(fmtClock());
  const messagesEnd = useRef(null);
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const selectedRef = useRef(null);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock()), 30000);
    return () => clearInterval(t);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const data = await api.getUsers(debouncedSearch);
      setUsers(data);
      setLoadingUsers(false);
      if (selectedRef.current) {
        const fresh = data.find((u) => u.id === selectedRef.current.id);
        if (fresh) setSelected((prev) => prev && prev.id === fresh.id ? fresh : prev);
      }
    } catch (e) { setLoadingUsers(false); }
  }, [debouncedSearch]);

  useEffect(() => {
    loadUsers();
    const interval = setInterval(loadUsers, 5000);
    return () => clearInterval(interval);
  }, [loadUsers]);

  // Messages + orders + quick replies polling
  useEffect(() => {
    if (!selected) return;
    const load = async () => {
      const cur = selectedRef.current;
      if (!cur) return;
      try { setMessages(await api.getMessages(cur.id)); } catch (e) {}
      setLoadingMessages(false);
    };
    const loadOrd = async () => {
      const cur = selectedRef.current;
      if (!cur) return;
      try { setOrders(await api.getUserOrders(cur.id)); } catch (e) {}
    };
    const loadQR = async () => {
      const cur = selectedRef.current;
      if (!cur) return;
      try { setQuickReplies(await api.getQuickReplies(cur.id)); } catch (e) {}
    };
    const loadMem = async () => {
      const cur = selectedRef.current;
      if (!cur) return;
      try { setCustomerMemory(await api.getMemory(cur.id)); } catch (e) {}
    };
    load();
    loadOrd();
    loadQR();
    loadMem();
    pollRef.current = setInterval(load, 3000);
    return () => { clearInterval(pollRef.current); };
  }, [selected?.id]);

  // Auto-scroll
  useEffect(() => {
    const c = messagesEnd.current?.parentElement;
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    if (selected && mobilePanel === 'chat') inputRef.current?.focus();
  }, [selected, mobilePanel]);

  // ── Actions ──

  async function sendMessage(e) {
    e?.preventDefault();
    if (!input.trim() || !selected || sending) return;
    setSending(true);
    try {
      await api.sendMessage(selected.id, input.trim());
      setInput('');
      setMessages(await api.getMessages(selected.id));
      // Refresh quick replies after sending
      try { setQuickReplies(await api.getQuickReplies(selected.id)); } catch (e) {}
    } catch (e) {}
    setSending(false);
    inputRef.current?.focus();
  }

  async function sendQuickReply(text) {
    if (!selected || sending) return;
    setInput('');
    setSending(true);
    try {
      await api.sendMessage(selected.id, text);
      setMessages(await api.getMessages(selected.id));
      try { setQuickReplies(await api.getQuickReplies(selected.id)); } catch (e) {}
    } catch (e) {}
    setSending(false);
    inputRef.current?.focus();
  }

  async function toggleAI() {
    if (!selected) return;
    try {
      await api.toggleAI(selected.id, !selected.ai_enabled);
      setSelected({ ...selected, ai_enabled: !selected.ai_enabled });
      loadUsers();
    } catch (e) {}
  }

  async function toggleMode() {
    if (!selected) return;
    const newMode = (selected.mode || 'ai') === 'ai' ? 'manager' : 'ai';
    try {
      const updated = await api.setMode(selected.id, newMode);
      setSelected({ ...selected, ...updated, mode: newMode });
      loadUsers();
    } catch (e) {}
  }

  async function clearHandoff() {
    if (!selected) return;
    try {
      const updated = await api.setHandoff(selected.id, { needs_manager: false });
      setSelected({ ...selected, ...updated });
      loadUsers();
    } catch (e) {}
  }

  async function deleteDialog() {
    if (!selected) return;
    if (!confirm('Удалить диалог с ' + (selected.name || 'клиентом') + '? Все данные будут удалены.')) return;
    try {
      await api.deleteUser(selected.id);
      setSelected(null);
      setMessages([]);
      setOrders([]);
      setQuickReplies([]);
      setMobilePanel('list');
      loadUsers();
    } catch (e) {}
  }

  const selectUser = useCallback(async (u) => {
    setSelected(u);
    setLoadingMessages(true);
    setCustomerMemory(null);
    setMobilePanel('chat');
    // Mark as read
    try { await api.markRead(u.id); } catch (e) {}
  }, []);

  // ── Derived ──

  function getAiStatus(user) {
    if (!user) return { text: '', cls: '' };
    if (user.needs_manager) return { text: 'Нужен менеджер', cls: 'cv-ai-handoff' };
    if (!user.ai_enabled) return { text: 'AI выкл', cls: 'cv-ai-off' };
    const actor = user.active_actor || ((user.mode || 'ai') === 'manager' ? 'manager' : user.manager_active ? 'paused' : 'ai');
    if (actor === 'manager') return { text: 'Менеджер ведёт', cls: 'cv-ai-manager' };
    if (actor === 'paused') {
      const mins = user.pause_remaining || 0;
      if (mins > 0) return { text: `AI на паузе (${mins} мин)`, cls: 'cv-ai-paused' };
      return { text: 'AI на паузе', cls: 'cv-ai-paused' };
    }
    return { text: 'AI в диалоге', cls: 'cv-ai-active' };
  }

  // Group messages by day
  const groupedMessages = useMemo(() => {
    const groups = [];
    let lastDay = null;
    for (const m of messages) {
      const dk = dayKey(m.created_at);
      if (dk !== lastDay) {
        groups.push({ type: 'separator', label: dayLabel(m.created_at), key: 'sep-' + dk });
        lastDay = dk;
      }
      groups.push({ type: 'message', data: m, key: 'msg-' + m.id });
    }
    return groups;
  }, [messages]);

  // Latest order
  const latestOrder = orders.length > 0 ? orders[0] : null;

  // AI recap
  const recap = useMemo(
    () => buildRecap(messages, selected || {}, latestOrder),
    [messages, selected, latestOrder]
  );

  // Filtered users
  const filteredUsers = useMemo(() => {
    let list = users;
    if (filter === 'needs_manager') list = list.filter(u => u.needs_manager);
    if (filter === 'unread') list = list.filter(u => u.unread);
    if (filter === 'order') list = list.filter(u => u.order_product);
    return list;
  }, [users, filter]);

  const stateLabel = (s) => STATE_LABELS[s] || s || '?';
  const stateColor = (s) => STATE_COLORS[s] || 'var(--c-neutral)';

  // ── Render ──

  return (
    <div className="cv-root">
      {/* LEFT: Chat List */}
      <div className={`cv-sidebar ${mobilePanel !== 'list' ? 'cv-hidden-mobile' : ''}`}>
        <div className="cv-time-bar">
          <span className="cv-time-date">{fmtToday()}</span>
          <span className="cv-time-clock">{clock}</span>
        </div>

        <div className="cv-search-wrap">
          <Search size={14} className="cv-search-icon" />
          <input
            type="text"
            className="cv-search"
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Filter tabs */}
        <div className="cv-filter-bar">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`cv-filter-tab ${filter === f.key ? 'cv-filter-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === 'unread' && users.filter(u => u.unread).length > 0 && (
                <span className="cv-filter-count">{users.filter(u => u.unread).length}</span>
              )}
              {f.key === 'needs_manager' && users.filter(u => u.needs_manager).length > 0 && (
                <span className="cv-filter-count cv-filter-count-alert">{users.filter(u => u.needs_manager).length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="cv-list">
          {loadingUsers && filteredUsers.length === 0 && (
            <div className="cv-list-empty">Загрузка...</div>
          )}
          {filteredUsers.map((u) => {
            const heat = heatLevel(u);
            const aiSt = getAiStatus(u);
            const waitStr = fmtWait(u.wait_minutes);
            return (
              <div
                key={u.id}
                className={`cv-list-item ${selected?.id === u.id ? 'cv-list-active' : ''} ${u.unread ? 'cv-list-unread' : ''}`}
                onClick={() => selectUser(u)}
              >
                {/* Heat stripe */}
                <div className={`cv-heat cv-heat-${heat}`} />
                <div className="cv-list-content">
                  <div className="cv-list-row1">
                    <span className={`cv-list-name ${u.unread ? 'cv-bold' : ''}`}>
                      {u.name || 'Без имени'}
                    </span>
                    <span className="cv-list-time">{u.last_message_at ? timeAgo(u.last_message_at) : ''}</span>
                  </div>
                  <div className="cv-list-row2">
                    <span className={`cv-list-preview ${u.unread ? 'cv-bold' : ''}`}>
                      {u.last_message || 'Нет сообщений'}
                    </span>
                    {u.unread && <span className="cv-unread-dot" />}
                  </div>
                  <div className="cv-list-chips">
                    {u.needs_manager && <Chip variant="handoff">Нужен менеджер</Chip>}
                    <Chip color={stateColor(u.state)}>{stateLabel(u.state)}</Chip>
                    {u.order_price && <Chip>{u.order_price} р</Chip>}
                    {u.order_size && <Chip>{u.order_size}</Chip>}
                    {waitStr && u.unread && <Chip variant="wait"><Clock size={9} /> {waitStr}</Chip>}
                    <span className={`cv-ai-dot ${aiSt.cls}`} title={aiSt.text}>{
                      aiSt.cls === 'cv-ai-manager' ? 'М' :
                      aiSt.cls === 'cv-ai-paused' ? 'П' :
                      aiSt.cls === 'cv-ai-handoff' ? '!' :
                      aiSt.cls === 'cv-ai-active' ? 'AI' : ''
                    }</span>
                  </div>
                </div>
              </div>
            );
          })}
          {!loadingUsers && filteredUsers.length === 0 && (
            <div className="cv-list-empty">
              {filter !== 'all' ? 'Нет подходящих чатов' : 'Нет клиентов'}
            </div>
          )}
        </div>
      </div>

      {/* CENTER: Dialog */}
      <div className={`cv-chat ${mobilePanel !== 'chat' ? 'cv-hidden-mobile' : ''}`}>
        {selected ? (
          <>
            <div className="cv-chat-header">
              <button className="cv-back" onClick={() => setMobilePanel('list')}>
                <ChevronLeft size={18} />
              </button>
              <div className="cv-chat-header-info">
                <span className="cv-chat-name">{selected.name || 'Без имени'}</span>
                {selected.username && <span className="cv-chat-username">@{selected.username}</span>}
              </div>
              <div className="cv-chat-header-right">
                {selected.wait_minutes > 0 && selected.unread && (
                  <span className={`cv-wait-badge ${selected.wait_minutes > 30 ? 'cv-wait-danger' : selected.wait_minutes > 10 ? 'cv-wait-warn' : ''}`}>
                    <Clock size={10} /> {fmtWait(selected.wait_minutes)}
                  </span>
                )}
                <span className={`cv-ai-badge ${getAiStatus(selected).cls}`}>
                  {getAiStatus(selected).text}
                </span>
                <button className="cv-info-btn" onClick={() => setMobilePanel('info')}>
                  Профиль
                </button>
              </div>
            </div>

            {/* AI recap bar */}
            {recap && (
              <div className="cv-recap-bar">
                <Bot size={11} />
                <span className="cv-recap-text">{recap}</span>
              </div>
            )}

            {/* Dialog chips bar */}
            <div className="cv-dialog-chips">
              {selected.needs_manager && (
                <Chip variant="handoff"><AlertTriangle size={9} /> {HANDOFF_LABELS[selected.handoff_reason] || 'Нужен менеджер'}</Chip>
              )}
              <Chip color={stateColor(selected.state)}>{stateLabel(selected.state)}</Chip>
              {customerMemory?.shoe_size && <Chip variant="memory">р.{customerMemory.shoe_size}</Chip>}
              {customerMemory?.city && <Chip variant="memory">{customerMemory.city}</Chip>}
              {customerMemory?.preferred_brand && <Chip variant="memory">{customerMemory.preferred_brand}</Chip>}
              {customerMemory?.phone && <Chip variant="memory">Тел</Chip>}
              {customerMemory?.address && <Chip variant="memory">Адрес</Chip>}
              {((customerMemory?.order_count || 0) >= 2 || (customerMemory?.total_spent || 0) >= 10000) && <Chip variant="vip"><Star size={9} /> VIP</Chip>}
              {latestOrder?.product && (
                <Chip>{latestOrder.product.length > 25 ? latestOrder.product.slice(0, 22) + '..' : latestOrder.product}</Chip>
              )}
              {latestOrder?.price && <Chip>{latestOrder.price} р</Chip>}
              {heatLevel(selected) === 'hot' && <Chip variant="hot"><Flame size={9} /> Горячий</Chip>}
              {selected.wait_minutes > 30 && selected.unread && (
                <Chip variant="wait"><AlertTriangle size={9} /> Долго ждет</Chip>
              )}
            </div>

            {selected.needs_manager && (
              <div className="cv-handoff-banner">
                <AlertTriangle size={12} />
                <span>{selected.handoff_summary || 'AI остановил автоответ и ждет менеджера.'}</span>
              </div>
            )}

            {/* Next action recommendation */}
            {customerMemory?._next_action && (
              <div className="cv-next-action">
                <ArrowRight size={11} />
                <span>{customerMemory._next_action}</span>
              </div>
            )}

            {/* Messages */}
            <div className="cv-messages">
              {loadingMessages && messages.length === 0 && (
                <div className="cv-msg-loading">Загрузка сообщений...</div>
              )}
              {groupedMessages.map((item) => {
                if (item.type === 'separator') {
                  return (
                    <div key={item.key} className="cv-day-sep">
                      <span>{item.label}</span>
                    </div>
                  );
                }
                const m = item.data;
                return (
                  <div key={item.key} className={`cv-msg cv-msg-${m.role}`}>
                    <div className="cv-msg-meta">
                      {m.role === 'user' && <User size={11} />}
                      {m.role === 'ai' && <Bot size={11} />}
                      {m.role === 'admin' && <ShieldCheck size={11} />}
                      <span className="cv-msg-role">
                        {m.role === 'user' ? 'Клиент' : m.role === 'ai' ? 'AI' : 'Менеджер'}
                      </span>
                    </div>
                    <div className="cv-msg-text">{m.text}</div>
                    <div className="cv-msg-time">{fmtTime(m.created_at)}</div>
                  </div>
                );
              })}
              <div ref={messagesEnd} />
            </div>

            {/* Quick replies */}
            {quickReplies.length > 0 && (
              <div className="cv-quick-bar">
                {quickReplies.map((qr, i) => (
                  <button
                    key={i}
                    className="cv-quick-btn"
                    onClick={() => sendQuickReply(qr)}
                    disabled={sending}
                  >
                    {qr}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form className="cv-input-area" onSubmit={sendMessage}>
              <input
                ref={inputRef}
                type="text"
                className="cv-input"
                placeholder="Ответить как менеджер..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button type="submit" className="cv-send" disabled={sending}>
                <Send size={14} />
              </button>
            </form>
          </>
        ) : (
          <div className="cv-empty">Выберите чат</div>
        )}
      </div>

      {/* RIGHT: Client Profile */}
      <div className={`cv-profile ${mobilePanel !== 'info' ? 'cv-hidden-mobile' : ''}`}>
        {selected ? (
          <>
            <div className="cv-profile-header">
              <button className="cv-back" onClick={() => setMobilePanel('chat')}>
                <ChevronLeft size={18} />
              </button>
              <span className="cv-profile-title">Профиль</span>
            </div>

            <div className="cv-section">
              <div className="cv-section-label">Клиент</div>
              <div className="cv-row"><span className="cv-row-label">Имя</span><span>{selected.name || '—'}</span></div>
              <div className="cv-row"><span className="cv-row-label">Ник</span><span>@{selected.username || '—'}</span></div>
              <div className="cv-row"><span className="cv-row-label">Активность</span><span>{fmtDate(selected.last_seen)}</span></div>
              <div className="cv-row">
                <span className="cv-row-label">Статус</span>
                <Chip color={stateColor(selected.state)}>{stateLabel(selected.state)}</Chip>
              </div>
              {latestOrder?.price && (
                <div className="cv-row">
                  <span className="cv-row-label">Сумма</span>
                  <span className="cv-row-price">{latestOrder.price} р</span>
                </div>
              )}
              <div className="cv-row">
                <span className="cv-row-label">Температура</span>
                <Chip variant={heatLevel(selected)}>{
                  heatLevel(selected) === 'hot' ? 'Горячий' :
                  heatLevel(selected) === 'warm' ? 'Теплый' : 'Холодный'
                }</Chip>
              </div>
            </div>

            {/* Customer memory section */}
            {customerMemory && Object.keys(customerMemory).length > 0 && (
              <div className="cv-section">
                <div className="cv-section-label">Память клиента</div>
                {customerMemory.full_name && <div className="cv-row"><span className="cv-row-label">ФИО</span><span>{customerMemory.full_name}</span></div>}
                {customerMemory.phone && <div className="cv-row"><span className="cv-row-label">Телефон</span><span>{customerMemory.phone}</span></div>}
                {customerMemory.city && <div className="cv-row"><span className="cv-row-label">Город</span><span>{customerMemory.city}</span></div>}
                {customerMemory.address && <div className="cv-row"><span className="cv-row-label">Адрес</span><span>{customerMemory.address}</span></div>}
                {customerMemory.shoe_size && <div className="cv-row"><span className="cv-row-label">Размер</span><span>{customerMemory.shoe_size}</span></div>}
                {customerMemory.insole_cm && <div className="cv-row"><span className="cv-row-label">Стелька</span><span>{customerMemory.insole_cm} см</span></div>}
                {customerMemory.preferred_brand && <div className="cv-row"><span className="cv-row-label">Бренд</span><span>{customerMemory.preferred_brand}</span></div>}
                {customerMemory.shoe_type && <div className="cv-row"><span className="cv-row-label">Тип</span><span>{customerMemory.shoe_type}</span></div>}
                {customerMemory.order_count > 0 && <div className="cv-row"><span className="cv-row-label">Заказов</span><span>{customerMemory.order_count}</span></div>}
                {customerMemory.total_spent > 0 && <div className="cv-row"><span className="cv-row-label">Потрачено</span><span>{customerMemory.total_spent} р</span></div>}
                {customerMemory.last_order_summary && <div className="cv-row"><span className="cv-row-label">Посл. заказ</span><span>{customerMemory.last_order_summary.product || '—'}</span></div>}
                {((customerMemory.order_count || 0) >= 2 || (customerMemory.total_spent || 0) >= 10000) && <div className="cv-row"><span className="cv-row-label">Статус</span><Chip variant="vip"><Star size={9} /> VIP</Chip></div>}
                {customerMemory.updated_at && <div className="cv-row"><span className="cv-row-label">Обновлено</span><span className="cv-muted">{fmtDate(customerMemory.updated_at)}</span></div>}
              </div>
            )}

            <div className="cv-section">
              <div className="cv-section-label">Управление диалогом</div>
              {selected.needs_manager && (
                <div className="cv-handoff-card">
                  <div className="cv-handoff-title">AI просит менеджера</div>
                  <div className="cv-handoff-reason">{HANDOFF_LABELS[selected.handoff_reason] || selected.handoff_reason || 'Нужна проверка'}</div>
                  <div className="cv-handoff-text">{selected.handoff_summary || 'Проверьте диалог и ответьте клиенту вручную.'}</div>
                  <button className="btn btn-outline btn-small" onClick={clearHandoff}>Снять флаг</button>
                </div>
              )}
              <div className="cv-mode-toggle-wrap">
                <span className={`cv-mode-label ${(selected.mode || 'ai') === 'ai' ? 'cv-mode-label-active' : ''}`}>AI ведёт</span>
                <div
                  className={`cv-mode-toggle ${(selected.mode || 'ai') === 'manager' ? 'cv-mode-toggle-on' : ''}`}
                  onClick={toggleMode}
                  role="switch"
                  aria-checked={(selected.mode || 'ai') === 'manager'}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMode(); } }}
                />
                <span className={`cv-mode-label ${(selected.mode || 'ai') === 'manager' ? 'cv-mode-label-active' : ''}`}>Менеджер ведёт</span>
              </div>
              <div className={`cv-actor-status cv-actor-${getAiStatus(selected).cls}`}>
                {getAiStatus(selected).text}
              </div>
            </div>

            <div className="cv-section">
              <div className="cv-section-label">Заказы</div>
              {orders.length > 0 ? orders.map((o) => (
                <div key={o.id} className="cv-order">
                  <div className="cv-order-head">
                    <Hash size={11} />
                    <span>Заказ {o.id}</span>
                    <Chip color={stateColor(o.status)}>{o.status}</Chip>
                  </div>
                  {o.product && <div className="cv-row"><span className="cv-row-label">Товар</span><span>{o.product}</span></div>}
                  {o.size && <div className="cv-row"><span className="cv-row-label">Размер</span><span>{o.size}</span></div>}
                  {o.price && <div className="cv-row"><span className="cv-row-label">Цена</span><span>{o.price} р</span></div>}
                  {o.full_name && <div className="cv-row"><span className="cv-row-label">ФИО</span><span>{o.full_name}</span></div>}
                  {o.phone && <div className="cv-row"><span className="cv-row-label">Телефон</span><span>{o.phone}</span></div>}
                  {o.address && <div className="cv-row"><span className="cv-row-label">Адрес</span><span>{o.address}</span></div>}
                </div>
              )) : (
                <div className="cv-muted">Нет заказов</div>
              )}
            </div>

            <div className="cv-section">
              <button className="cv-delete-btn" onClick={deleteDialog}>
                <Trash2 size={12} /> Удалить диалог
              </button>
            </div>
          </>
        ) : (
          <div className="cv-empty">Выберите клиента</div>
        )}
      </div>
    </div>
  );
}
