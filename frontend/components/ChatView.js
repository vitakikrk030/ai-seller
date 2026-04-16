'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  User, Bot, ShieldCheck, ChevronLeft, Send,
  Hash, Trash2, Search, Clock, Star, Copy, MoreHorizontal,
} from 'lucide-react';
import { api } from '../lib/api';

// ── Constants ──

const TZ = 'Europe/Moscow';

const STATE_LABELS = {
  NEW: 'Новый',
  COLLECTING: 'Оформление',
  PAYMENT_REVIEW: 'Проверка оплаты',
  PAYMENT_PENDING: 'Ожидание оплаты',
  PAYMENT_CLAIMED: 'Чек отправлен',
  PAID: 'Оплачено',
  DONE: 'Готово',
};

const STATE_COLORS = {
  NEW: 'var(--c-neutral)',
  COLLECTING: 'var(--c-thinking)',
  PAYMENT_REVIEW: 'var(--c-warning)',
  PAYMENT_PENDING: 'var(--c-warning)',
  PAYMENT_CLAIMED: 'var(--c-warning)',
  PAID: 'var(--c-active)',
  DONE: 'var(--c-active)',
};

const DELIVERY_LABELS = {
  pending: 'В очереди',
  sent: 'Отправка',
  delivered: 'Доставлено',
  failed: 'Ошибка',
};

// Heat pill colors
const HEAT_LABELS = { hot: 'Горячий', warm: 'Тёплый', cold: 'Холодный' };
const HEAT_COLORS = { hot: 'var(--c-warning,#f59e0b)', warm: 'var(--c-thinking,#8b5cf6)', cold: 'var(--c-neutral,#94a3b8)' };

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
  const isPayment = ['PAYMENT_REVIEW', 'PAYMENT_PENDING', 'PAYMENT_CLAIMED'].includes(user.state);
  const isActive = user.state === 'COLLECTING';

  if (isPayment && hoursSince < 24) return 'hot';
  if (isPayment) return 'warm';
  if (isActive && hoursSince < 2) return 'hot';
  if (isActive && hoursSince < 12) return 'warm';
  if (hoursSince < 1 && user.message_count > 3) return 'hot';
  if (hoursSince < 6) return 'warm';
  return 'cold';
}

// ── Status bar info ──

function getStatusBar(user, latestOrder) {
  if (!user) return null;
  const parts = [];
  const sl = STATE_LABELS[user.state] || user.state;
  if (sl) parts.push(sl);
  if (latestOrder?.product) parts.push(latestOrder.product.length > 20 ? latestOrder.product.slice(0, 18) + '..' : latestOrder.product);
  if (latestOrder?.price) parts.push(latestOrder.price + ' р');
  return parts.join(' · ') || null;
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

// ── Mode badge ──

function TypingIndicator({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', animation: 'fadeIn 0.2s ease' }}>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block', animation: `typingDot 1.2s ${i * 0.2}s infinite ease-in-out` }} />
        ))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic' }}>{label}</span>
    </div>
  );
}

function ModeBadge({ mode, aiEnabled }) {
  if (!aiEnabled) return <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', background: 'rgba(148,163,184,0.12)', borderRadius: 999, padding: '3px 9px' }}>AI выкл</span>;
  const isAI = (mode || 'ai') === 'ai';
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: isAI ? 'var(--accent,#6366f1)' : '#f59e0b', background: isAI ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)', borderRadius: 999, padding: '3px 9px' }}>
      {isAI ? 'AI ведёт' : 'Менеджер ведёт'}
    </span>
  );
}

// ── Sidebar filter tabs ──

const FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'attention', label: 'Внимание' },
  { key: 'unread', label: 'Ждёт' },
  { key: 'order', label: 'Заказ' },
  { key: 'done', label: 'Готово' },
];

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 260;

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
  const [showProfile, setShowProfile] = useState(false);
  const [typingState, setTypingState] = useState({}); // userId → { client: bool, ai: bool }
  const typingTimers = useRef({});
  const [msgMenu, setMsgMenu] = useState(null); // { id, x, y, text }
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cv_sidebar_width');
      return saved ? parseInt(saved) : SIDEBAR_DEFAULT;
    }
    return SIDEBAR_DEFAULT;
  });
  const dragging = useRef(false);
  const dragStart = useRef(0);
  const dragWidth = useRef(SIDEBAR_DEFAULT);
  const [editingMsg, setEditingMsg] = useState(null); // { id, text }
  const [confirmAction, setConfirmAction] = useState(null); // { type, label, onConfirm }
  const [msgSearch, setMsgSearch] = useState('');
  const [msgSearchResults, setMsgSearchResults] = useState(null); // null = not searching
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unreadSince, setUnreadSince] = useState(null); // message id before which are "read"
  const messagesEnd = useRef(null);
  const messagesTop = useRef(null);
  const inputRef = useRef(null);
  const sseRef = useRef(null);
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

  // Load users (polling for list — SSE handles messages)
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
    const interval = setInterval(loadUsers, 8000);
    return () => clearInterval(interval);
  }, [loadUsers]);

  // SSE — real-time messages
  useEffect(() => {
    const es = new EventSource('/api/sse');
    sseRef.current = es;
    es.addEventListener('message', (e) => {
      try {
        const { userId, message } = JSON.parse(e.data);
        if (selectedRef.current?.id === userId) {
          setMessages(prev => {
            const idx = prev.findIndex((m) => m.id === message.id);
            if (idx === -1) return [...prev, message];
            const next = [...prev];
            next[idx] = { ...next[idx], ...message };
            return next;
          });
          // clear typing when message arrives
          setTypingState(prev => ({ ...prev, [userId]: { client: false, ai: false } }));
        }
        loadUsers();
      } catch {}
    });

    es.addEventListener('typing', (e) => {
      try {
        const { userId, typing } = JSON.parse(e.data);
        setTypingState(prev => ({ ...prev, [userId]: { ...prev[userId], client: typing, ai: false } }));
        if (typing) {
          // auto-clear after 4s
          clearTimeout(typingTimers.current[`c_${userId}`]);
          typingTimers.current[`c_${userId}`] = setTimeout(() => {
            setTypingState(prev => ({ ...prev, [userId]: { ...prev[userId], client: false } }));
          }, 4000);
        }
      } catch {}
    });

    es.addEventListener('ai_typing', (e) => {
      try {
        const { userId, typing } = JSON.parse(e.data);
        setTypingState(prev => ({ ...prev, [userId]: { client: false, ai: typing } }));
        if (typing) {
          // safety timeout — clear after 15s if no response
          clearTimeout(typingTimers.current[`a_${userId}`]);
          typingTimers.current[`a_${userId}`] = setTimeout(() => {
            setTypingState(prev => ({ ...prev, [userId]: { ...prev[userId], ai: false } }));
          }, 15000);
        }
      } catch {}
    });

    es.addEventListener('user_update', () => {
      // refresh user list when attention/pin changes
      loadUsers();
    });

    es.onerror = () => {};
    return () => es.close();
  }, [loadUsers]);

  // Load messages paginated on chat open
  useEffect(() => {
    if (!selected) return;
    setLoadingMessages(true);
    setMessages([]);
    setHasMore(false);
    setMsgSearch('');
    setMsgSearchResults(null);

    const loadInitial = async () => {
      try {
        const data = await api.getMessagesPaginated(selected.id, 50);
        setMessages(data);
        setHasMore(data.length === 50);
        // mark unread separator
        if (selected.last_read_at) {
          const firstUnread = data.find(m => new Date(m.created_at) > new Date(selected.last_read_at) && m.role === 'user');
          setUnreadSince(firstUnread?.id || null);
        }
      } catch {}
      setLoadingMessages(false);
    };

    const loadOrd = async () => { try { setOrders(await api.getUserOrders(selected.id)); } catch {} };
    const loadQR = async () => { try { setQuickReplies(await api.getQuickReplies(selected.id)); } catch {} };
    const loadMem = async () => { try { setCustomerMemory(await api.getMemory(selected.id)); } catch {} };

    loadInitial();
    loadOrd();
    loadQR();
    loadMem();
  }, [selected?.id]);

  // Load more (scroll up)
  async function loadMoreMessages() {
    if (!selected || loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0]?.id;
      const data = await api.getMessagesPaginated(selected.id, 50, oldest);
      setMessages(prev => [...data, ...prev]);
      setHasMore(data.length === 50);
    } catch {}
    setLoadingMore(false);
  }

  // Message search
  useEffect(() => {
    if (!msgSearch.trim() || !selected) { setMsgSearchResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const data = await api.searchMessages(selected.id, msgSearch);
        setMsgSearchResults(data);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [msgSearch, selected?.id]);

  // Auto-scroll to bottom on new messages (only if near bottom)
  useEffect(() => {
    const c = messagesEnd.current?.parentElement;
    if (!c) return;
    const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
    if (nearBottom || messages[messages.length - 1]?.role !== 'user') {
      c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    if (selected && mobilePanel === 'chat') inputRef.current?.focus();
  }, [selected, mobilePanel]);

  // ── Actions ──

  async function sendMessage(e) {
    e?.preventDefault();
    if (!input.trim() || !selected || sending) return;
    const text = input.trim();
    setInput('');

    setSending(true);
    try {
      const saved = await api.sendMessage(selected.id, text);
      if (saved?.id) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === saved.id);
          if (idx === -1) return [...prev, saved];
          const next = [...prev];
          next[idx] = { ...next[idx], ...saved };
          return next;
        });
      }
      try { setQuickReplies(await api.getQuickReplies(selected.id)); } catch {}
    } catch (err) {
      try {
        const refreshed = await api.getMessagesPaginated(selected.id, 50);
        setMessages(refreshed);
      } catch {}
      setInput(text);
      console.error('sendMessage failed:', err.message);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  async function sendQuickReply(text) {
    if (!selected || sending) return;
    setSending(true);
    try {
      const saved = await api.sendMessage(selected.id, text);
      if (saved?.id) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === saved.id);
          if (idx === -1) return [...prev, saved];
          const next = [...prev];
          next[idx] = { ...next[idx], ...saved };
          return next;
        });
      }
      try { setQuickReplies(await api.getQuickReplies(selected.id)); } catch {}
    } catch (err) {
      try {
        const refreshed = await api.getMessagesPaginated(selected.id, 50);
        setMessages(refreshed);
      } catch {}
      console.error('sendQuickReply failed:', err.message);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  async function deleteMsg(id) {
    setMessages(prev => prev.filter(m => m.id !== id));
    setMsgMenu(null);
    try { await api.deleteMessage(id); } catch {
      // restore on error — refetch
      try { setMessages(await api.getMessagesPaginated(selected.id, 50)); } catch {}
    }
  }

  async function saveEdit(id, text) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, text, edited: true } : m));
    setEditingMsg(null);
    try { await api.editMessage(id, text); } catch {}
  }

  function confirmClearHistory() {
    setConfirmAction({
      label: 'Очистить историю сообщений?',
      onConfirm: async () => {
        setConfirmAction(null);
        await api.clearMessages(selected.id);
        setMessages([]);
      },
    });
  }

  function confirmDeleteDialog() {
    setConfirmAction({
      label: `Удалить диалог с ${selected.name || 'клиентом'}?`,
      onConfirm: async () => {
        setConfirmAction(null);
        await api.deleteUser(selected.id);
        setSelected(null);
        setMessages([]);
        setOrders([]);
      },
    });
  }

  async function toggleAI() {
    if (!selected) return;
    try {
      await api.toggleAI(selected.id, !selected.ai_enabled);
      setSelected({ ...selected, ai_enabled: !selected.ai_enabled });
      loadUsers();
    } catch {}
  }

  async function toggleMode() {
    if (!selected) return;
    const newMode = (selected.mode || 'ai') === 'ai' ? 'manager' : 'ai';
    try {
      const updated = await api.setMode(selected.id, newMode);
      setSelected({ ...selected, ...updated, mode: newMode });
      loadUsers();
    } catch {}
  }

  async function togglePin(u) {
    const pinned = !u.pinned;
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, pinned } : x));
    try { await api.pinUser(u.id, pinned); } catch {}
  }

  async function deleteDialog() {
    if (!selected) return;
    confirmDeleteDialog();
    // legacy kept for profile button
    return;
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

  function getDeliveryInfo(message) {
    if (!message || message.role === 'user') return null;
    const status = (message.delivery_status || '').toLowerCase();
    if (!status || !DELIVERY_LABELS[status]) return null;
    return {
      status,
      text: DELIVERY_LABELS[status],
    };
  }

  // Group messages by day + unread separator
  const groupedMessages = useMemo(() => {
    const src = msgSearchResults !== null ? msgSearchResults : messages;
    const groups = [];
    let lastDay = null;
    let unreadInserted = false;
    for (const m of src) {
      const dk = dayKey(m.created_at);
      if (dk !== lastDay) {
        groups.push({ type: 'separator', label: dayLabel(m.created_at), key: 'sep-' + dk });
        lastDay = dk;
      }
      if (!unreadInserted && unreadSince && m.id === unreadSince) {
        groups.push({ type: 'unread', key: 'unread-sep' });
        unreadInserted = true;
      }
      groups.push({ type: 'message', data: m, key: 'msg-' + m.id });
    }
    return groups;
  }, [messages, msgSearchResults, unreadSince]);

  // Latest order
  const latestOrder = orders.length > 0 ? orders[0] : null;

  // Status bar
  const statusBar = useMemo(
    () => getStatusBar(selected, latestOrder),
    [selected, latestOrder]
  );

  // Filtered + sorted users
  const filteredUsers = useMemo(() => {
    let list = users;
    if (filter === 'attention') list = list.filter(u => u.needs_attention);
    if (filter === 'unread') list = list.filter(u => u.unread);
    if (filter === 'order') list = list.filter(u => u.order_product);
    if (filter === 'done') list = list.filter(u => u.state === 'DONE');
    // Sort: pinned > needs_attention > priority (from server) > last_seen
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (a.needs_attention !== b.needs_attention) return (b.needs_attention ? 1 : 0) - (a.needs_attention ? 1 : 0);
      return (b.computed_priority || 0) - (a.computed_priority || 0);
    });
  }, [users, filter]);

  // Counts for filter badges
  const attentionCount = useMemo(() => users.filter(u => u.needs_attention).length, [users]);
  const unreadCount = useMemo(() => users.filter(u => u.unread).length, [users]);

  const stateLabel = (s) => STATE_LABELS[s] || s || '?';
  const stateColor = (s) => STATE_COLORS[s] || 'var(--c-neutral)';

  // ── Drag handlers ──

  function onDividerMouseDown(e) {
    dragging.current = true;
    dragStart.current = e.clientX;
    dragWidth.current = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(ev) {
      if (!dragging.current) return;
      const delta = ev.clientX - dragStart.current;
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragWidth.current + delta));
      setSidebarWidth(next);
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(prev => {
        localStorage.setItem('cv_sidebar_width', String(prev));
        return prev;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onDividerDblClick() {
    setSidebarWidth(SIDEBAR_DEFAULT);
    localStorage.setItem('cv_sidebar_width', String(SIDEBAR_DEFAULT));
  }

  // ── Render ──

  return (
    <div className="cv-root">
      {/* LEFT: Chat List */}
      <div className={`cv-sidebar ${mobilePanel !== 'list' ? 'cv-hidden-mobile' : ''}`} style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}>
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
              {f.key === 'attention' && attentionCount > 0 && (
                <span className="cv-filter-count cv-filter-count-red">{attentionCount}</span>
              )}
              {f.key === 'unread' && unreadCount > 0 && (
                <span className="cv-filter-count">{unreadCount}</span>
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
            const isAI = (u.mode || 'ai') === 'ai' && u.ai_enabled;
            return (
              <div
                key={u.id}
                className={`cv-list-item ${selected?.id === u.id ? 'cv-list-active' : ''} ${u.unread ? 'cv-list-unread' : ''} ${u.pinned ? 'cv-list-pinned' : ''} ${u.needs_attention ? 'cv-list-attention' : ''}`}
                onClick={() => selectUser(u)}
              >
                <div className={`cv-heat cv-heat-${heat}`} />
                <div className="cv-list-content">
                  <div className="cv-list-row1">
                    <span className={`cv-list-name ${u.unread ? 'cv-bold' : ''}`}>
                      {u.needs_attention && <span style={{ fontSize: 9, color: '#ef4444', marginRight: 4, fontWeight: 700 }}>!</span>}
                      {u.pinned && <span style={{ fontSize: 9, color: 'var(--accent,#6366f1)', marginRight: 4, fontWeight: 700 }}>●</span>}
                      {u.name || 'Без имени'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="cv-list-time">{u.last_message_at ? timeAgo(u.last_message_at) : ''}</span>
                      <button
                        className="cv-pin-btn"
                        onClick={(e) => { e.stopPropagation(); togglePin(u); }}
                        title={u.pinned ? 'Открепить' : 'Закрепить'}
                      >
                        {u.pinned ? '−' : '+'}
                      </button>
                    </div>
                  </div>
                  {u.needs_attention && u.attention_reason && (
                    <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 2, fontWeight: 500 }}>{u.attention_reason}</div>
                  )}
                  <div className="cv-list-row2">
                    <span className={`cv-list-preview ${u.unread ? 'cv-bold' : ''}`}>
                      {u.last_message || 'Нет сообщений'}
                    </span>
                    {u.unread && <span className="cv-unread-dot" />}
                  </div>
                  <div className="cv-list-chips">
                    <Chip color={stateColor(u.state)}>{stateLabel(u.state)}</Chip>
                    {heat !== 'cold' && <Chip variant={heat}>{HEAT_LABELS[heat]}</Chip>}
                    <Chip variant={isAI ? 'ai-active' : 'manager'}>{isAI ? 'AI' : 'М'}</Chip>
                    {u.order_price && <Chip>{u.order_price} р</Chip>}
                    {waitStr && u.unread && <Chip variant="wait"><Clock size={9} /> {waitStr}</Chip>}
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

      {/* Draggable divider */}
      <div
        className="cv-divider"
        onMouseDown={onDividerMouseDown}
        onDoubleClick={onDividerDblClick}
        title="Потяни чтобы изменить ширину · Двойной клик — сброс"
      />

      {/* CENTER: Dialog */}
      <div className={`cv-chat ${mobilePanel !== 'chat' ? 'cv-hidden-mobile' : ''}`} onClick={() => msgMenu && setMsgMenu(null)}>
        {selected ? (
          <>
            {/* Header */}
            <div className="cv-chat-header">
              <button className="cv-back" onClick={() => setMobilePanel('list')}>
                <ChevronLeft size={18} />
              </button>
              <div className="cv-chat-header-info">
                <span className="cv-chat-name">{selected.name || 'Без имени'}</span>
                {selected.username && <span className="cv-chat-username">@{selected.username}</span>}
              </div>
              <div className="cv-chat-header-right">
                <ModeBadge mode={selected.mode} aiEnabled={selected.ai_enabled} />
                {selected.wait_minutes > 0 && selected.unread && (
                  <span className={`cv-wait-badge ${selected.wait_minutes > 30 ? 'cv-wait-danger' : 'cv-wait-warn'}`}>
                    <Clock size={10} /> {fmtWait(selected.wait_minutes)}
                  </span>
                )}
                <button className="cv-info-btn" onClick={() => setShowProfile(p => !p)} style={{ background: showProfile ? 'var(--accent-bg,rgba(99,102,241,0.1))' : undefined, color: showProfile ? 'var(--accent,#6366f1)' : undefined }}>
                  Профиль
                </button>
              </div>
            </div>

            {/* Status bar */}
            {statusBar && (
              <div className="cv-status-bar">
                <span className="cv-status-text">{statusBar}</span>
                {heatLevel(selected) !== 'cold' && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: HEAT_COLORS[heatLevel(selected)], background: 'rgba(0,0,0,0.04)', borderRadius: 999, padding: '2px 7px' }}>
                    {HEAT_LABELS[heatLevel(selected)]}
                  </span>
                )}
              </div>
            )}

            {/* AI suggestion */}
            {customerMemory?._next_action && (selected.mode || 'ai') === 'manager' && (
              <div className="cv-ai-hint">
                <Bot size={11} />
                <span>{customerMemory._next_action}</span>
              </div>
            )}

            {/* Message search bar */}
            <div className="cv-msg-search-bar">
              <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
              <input
                value={msgSearch}
                onChange={e => setMsgSearch(e.target.value)}
                placeholder="Поиск в диалоге..."
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'var(--text)' }}
              />
              {msgSearch && <button onClick={() => { setMsgSearch(''); setMsgSearchResults(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', fontSize: 14, padding: 0 }}>×</button>}
              {msgSearchResults !== null && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{msgSearchResults.length} найдено</span>}
            </div>

            {/* Inline confirm */}
            {confirmAction && (
              <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#dc2626' }}>{confirmAction.label}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={confirmAction.onConfirm} style={{ padding: '5px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Да</button>
                  <button onClick={() => setConfirmAction(null)} style={{ padding: '5px 12px', background: 'none', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', fontSize: 12 }}>Отмена</button>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="cv-messages" ref={messagesTop} onScroll={(e) => { if (e.target.scrollTop < 60 && hasMore && !loadingMore) loadMoreMessages(); }}>
              {loadingMore && <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 11, color: 'var(--text-dim)' }}>Загрузка...</div>}
              {hasMore && !loadingMore && (
                <button onClick={loadMoreMessages} style={{ display: 'block', margin: '8px auto', fontSize: 11, color: 'var(--accent,#6366f1)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  Загрузить ещё
                </button>
              )}
              {loadingMessages && messages.length === 0 && (
                <div className="cv-msg-loading">Загрузка...</div>
              )}
              {groupedMessages.map((item) => {
                if (item.type === 'separator') {
                  return <div key={item.key} className="cv-day-sep"><span>{item.label}</span></div>;
                }
                if (item.type === 'unread') {
                  return <div key={item.key} className="cv-unread-sep"><span>Новые сообщения</span></div>;
                }
                const m = item.data;
                const isEditing = editingMsg?.id === m.id;
                const delivery = getDeliveryInfo(m);
                const isPendingDelivery = !!delivery && ['pending', 'sent'].includes(delivery.status);
                return (
                  <div key={item.key} className={`cv-msg-wrap cv-msg-wrap-${m.role}`}>
                    <div
                      className={`cv-msg cv-msg-${m.role} ${isPendingDelivery ? 'cv-msg-pending' : ''} ${delivery?.status === 'failed' ? 'cv-msg-failed' : ''}`}
                      onContextMenu={(e) => { e.preventDefault(); setMsgMenu({ id: m.id, text: m.text, role: m.role, x: e.clientX, y: e.clientY }); }}
                    >
                      {isEditing ? (
                        <form onSubmit={(e) => { e.preventDefault(); saveEdit(m.id, e.target.text.value); }}>
                          <input name="text" defaultValue={m.text} autoFocus style={{ width: '100%', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: 'inherit', outline: 'none' }} />
                          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <button type="submit" style={{ fontSize: 11, padding: '2px 8px', background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 5, cursor: 'pointer', color: 'inherit' }}>Сохранить</button>
                            <button type="button" onClick={() => setEditingMsg(null)} style={{ fontSize: 11, padding: '2px 8px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.7 }}>Отмена</button>
                          </div>
                        </form>
                      ) : (
                        <div className="cv-msg-text">{m.text}{m.edited && <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 4 }}>ред.</span>}</div>
                      )}
                      <div className="cv-msg-footer">
                        <span className="cv-msg-role-label">
                          {m.role === 'user' ? 'Клиент' : m.role === 'ai' ? 'AI' : 'Менеджер'}
                        </span>
                        <span className="cv-msg-time">{fmtTime(m.created_at)}</span>
                        {delivery && (
                          <span className={`cv-msg-delivery cv-msg-delivery-${delivery.status}`}>
                            {delivery.text}
                          </span>
                        )}
                        <button className="cv-msg-menu-btn" onClick={(e) => { e.stopPropagation(); setMsgMenu({ id: m.id, text: m.text, role: m.role, x: e.clientX, y: e.clientY }); }}>
                          <MoreHorizontal size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {/* Typing indicator */}
              {(() => {
                const ts = typingState[selected?.id] || {};
                if (ts.ai) return <TypingIndicator label="AI печатает" />;
                if (ts.client) return <TypingIndicator label="Клиент печатает" />;
                return null;
              })()}
              <div ref={messagesEnd} />
            </div>

            {/* Message context menu */}
            {msgMenu && (
              <div style={{ position: 'fixed', top: msgMenu.y, left: msgMenu.x, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 200, minWidth: 160, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                <button onClick={() => { navigator.clipboard?.writeText(msgMenu.text); setMsgMenu(null); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', textAlign: 'left' }}>
                  <Copy size={13} /> Копировать
                </button>
                <button onClick={() => { setInput(msgMenu.text); setMsgMenu(null); inputRef.current?.focus(); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', textAlign: 'left' }}>
                  <Send size={13} /> Ответить
                </button>
                {(msgMenu.role === 'admin' || msgMenu.role === 'ai') && (
                  <button onClick={() => { setEditingMsg({ id: msgMenu.id, text: msgMenu.text }); setMsgMenu(null); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', textAlign: 'left' }}>
                    <Hash size={13} /> Редактировать
                  </button>
                )}
                <button onClick={() => { deleteMsg(msgMenu.id); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444', textAlign: 'left' }}>
                  <Trash2 size={13} /> Удалить
                </button>
              </div>
            )}

            {/* Smart suggestion — only in manager mode, one at a time */}
            {(selected.mode || 'ai') === 'manager' && quickReplies.length > 0 && (
              <div className="cv-suggestion-bar">
                <span className="cv-suggestion-label">Рекомендуем</span>
                <span className="cv-suggestion-text">{quickReplies[0]}</span>
                <button
                  className="cv-suggestion-use"
                  onClick={() => sendQuickReply(quickReplies[0])}
                  disabled={sending}
                >
                  Использовать
                </button>
              </div>
            )}

            {/* Mode switch + Input */}
            <div className="cv-bottom">
              {(selected.mode || 'ai') === 'ai' ? (
                <div className="cv-ai-mode-bar">
                  <span className="cv-ai-mode-text">AI ведёт диалог</span>
                  <button className="cv-take-btn" onClick={toggleMode}>Взять диалог</button>
                </div>
              ) : (
                <form className="cv-input-area" onSubmit={sendMessage}>
                  <input
                    ref={inputRef}
                    type="text"
                    className="cv-input"
                    placeholder="Написать клиенту..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <button type="submit" className="cv-send" disabled={sending || !input.trim()}>
                    <Send size={14} />
                  </button>
                  <button type="button" className="cv-return-ai-btn" onClick={toggleMode} title="Передать AI">
                    <Bot size={14} />
                  </button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="cv-empty">Выберите чат</div>
        )}
      </div>

      {/* RIGHT: Client Profile — slides in */}
      {showProfile && selected && (
        <div className="cv-profile">
          <div className="cv-profile-header">
            <span className="cv-profile-title">Профиль</span>
            <button className="cv-back" onClick={() => setShowProfile(false)} style={{ marginLeft: 'auto' }}>
              <ChevronLeft size={18} style={{ transform: 'rotate(180deg)' }} />
            </button>
          </div>

          <div className="cv-section">
            <div className="cv-section-label">Клиент</div>
            <div className="cv-row"><span className="cv-row-label">Имя</span><span>{selected.name || '—'}</span></div>
            {selected.username && <div className="cv-row"><span className="cv-row-label">Ник</span><span>@{selected.username}</span></div>}
            <div className="cv-row"><span className="cv-row-label">Активность</span><span>{fmtDate(selected.last_seen)}</span></div>
            <div className="cv-row">
              <span className="cv-row-label">Этап</span>
              <Chip color={stateColor(selected.state)}>{stateLabel(selected.state)}</Chip>
            </div>
            <div className="cv-row">
              <span className="cv-row-label">Активность</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: HEAT_COLORS[heatLevel(selected)] }}>{HEAT_LABELS[heatLevel(selected)]}</span>
            </div>
            {latestOrder?.price && <div className="cv-row"><span className="cv-row-label">Сумма</span><span className="cv-row-price">{latestOrder.price} р</span></div>}
            {((customerMemory?.order_count || 0) >= 2 || (customerMemory?.total_spent || 0) >= 10000) && (
              <div className="cv-row"><span className="cv-row-label">Статус</span><Chip variant="vip"><Star size={9} /> VIP</Chip></div>
            )}
          </div>

          {customerMemory && Object.keys(customerMemory).filter(k => !k.startsWith('_')).length > 0 && (
            <div className="cv-section">
              <div className="cv-section-label">Память</div>
              {customerMemory.full_name && <div className="cv-row"><span className="cv-row-label">ФИО</span><span>{customerMemory.full_name}</span></div>}
              {customerMemory.phone && <div className="cv-row"><span className="cv-row-label">Телефон</span><span>{customerMemory.phone}</span></div>}
              {customerMemory.city && <div className="cv-row"><span className="cv-row-label">Город</span><span>{customerMemory.city}</span></div>}
              {customerMemory.address && <div className="cv-row"><span className="cv-row-label">Адрес</span><span>{customerMemory.address}</span></div>}
              {customerMemory.shoe_size && <div className="cv-row"><span className="cv-row-label">Размер</span><span>{customerMemory.shoe_size}</span></div>}
              {customerMemory.preferred_brand && <div className="cv-row"><span className="cv-row-label">Бренд</span><span>{customerMemory.preferred_brand}</span></div>}
              {customerMemory.order_count > 0 && <div className="cv-row"><span className="cv-row-label">Заказов</span><span>{customerMemory.order_count}</span></div>}
              {customerMemory.total_spent > 0 && <div className="cv-row"><span className="cv-row-label">Потрачено</span><span>{customerMemory.total_spent} р</span></div>}
            </div>
          )}

          <div className="cv-section">
            <div className="cv-section-label">Управление</div>
            <div className="cv-mode-toggle-wrap">
              <span className={`cv-mode-label ${(selected.mode || 'ai') === 'ai' ? 'cv-mode-label-active' : ''}`}>AI</span>
              <div className={`cv-mode-toggle ${(selected.mode || 'ai') === 'manager' ? 'cv-mode-toggle-on' : ''}`} onClick={toggleMode} role="switch" aria-checked={(selected.mode || 'ai') === 'manager'} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMode(); } }} />
              <span className={`cv-mode-label ${(selected.mode || 'ai') === 'manager' ? 'cv-mode-label-active' : ''}`}>Менеджер</span>
            </div>
            <div style={{ marginTop: 12 }}>
              {selected.needs_attention ? (
                <div>
                  <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6, fontWeight: 500 }}>
                    {selected.attention_reason || 'Требует внимания'}
                  </div>
                  <button onClick={async () => { await api.clearAttention(selected.id); loadUsers(); }} style={{ fontSize: 12, padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', color: 'var(--text-dim)' }}>
                    Снять флаг
                  </button>
                </div>
              ) : (
                <button onClick={async () => { await api.setAttention(selected.id, true, 'Отмечено менеджером'); loadUsers(); }} style={{ fontSize: 12, padding: '5px 12px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 7, cursor: 'pointer', color: '#ef4444' }}>
                  Требует внимания
                </button>
              )}
            </div>
          </div>

          {orders.length > 0 && (
            <div className="cv-section">
              <div className="cv-section-label">Заказы</div>
              {orders.map((o) => (
                <div key={o.id} className="cv-order">
                  <div className="cv-order-head">
                    <Hash size={11} />
                    <span>Заказ {o.id}</span>
                    <Chip color={stateColor(o.status)}>{o.status}</Chip>
                  </div>
                  {o.product && <div className="cv-row"><span className="cv-row-label">Товар</span><span>{o.product}</span></div>}
                  {o.price && <div className="cv-row"><span className="cv-row-label">Цена</span><span>{o.price} р</span></div>}
                  {o.size && <div className="cv-row"><span className="cv-row-label">Размер</span><span>{o.size}</span></div>}
                </div>
              ))}
            </div>
          )}

          <div className="cv-section">
            <button className="cv-delete-btn" style={{ marginBottom: 8, background: 'rgba(148,163,184,0.1)', color: 'var(--text-dim)', border: '1px solid var(--border)' }} onClick={confirmClearHistory}>
              Очистить историю
            </button>
            <button className="cv-delete-btn" onClick={confirmDeleteDialog}>
              <Trash2 size={12} /> Удалить диалог
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
