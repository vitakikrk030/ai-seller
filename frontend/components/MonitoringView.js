'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtMoney(n) {
  return n.toLocaleString('ru-RU') + ' ₽';
}

function trend(today, yesterday) {
  if (yesterday === 0) return null;
  const diff = today - yesterday;
  const pct = Math.round(Math.abs(diff / yesterday) * 100);
  if (diff === 0) return null;
  return { up: diff > 0, pct, yesterday };
}

function TrendBadge({ today, yesterday, invertColors }) {
  const t = trend(today, yesterday);
  if (!t) return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>вчера: {yesterday}</span>;
  const isGood = invertColors ? !t.up : t.up;
  return (
    <span style={{ fontSize: 11, color: isGood ? '#22c55e' : '#ef4444', fontWeight: 500 }}>
      вчера: {yesterday} {t.up ? '↑' : '↓'} {t.pct}%
    </span>
  );
}

// ─── Status dot ────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const map = { ok: '#22c55e', degraded: '#f59e0b', down: '#ef4444', unknown: '#94a3b8' };
  const color = map[status?.toLowerCase()] || map.unknown;
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color,
      boxShadow: status === 'ok' ? '0 0 0 3px rgba(34,197,94,0.15)' : status === 'down' ? '0 0 0 3px rgba(239,68,68,0.15)' : 'none',
      flexShrink: 0,
    }} />
  );
}

// ─── Metric card ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, alert, trendEl, lossHint }) {
  return (
    <div style={{
      padding: '20px 22px',
      background: alert ? 'rgba(239,68,68,0.04)' : 'var(--bg-secondary)',
      border: `1px solid ${alert ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: alert ? '#ef4444' : 'var(--text)', lineHeight: 1.1 }}>{value}</div>
      {lossHint && <div style={{ fontSize: 12, color: '#ef4444', fontWeight: 500 }}>{lossHint}</div>}
      {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div>}
      {trendEl}
    </div>
  );
}

// ─── System status card ────────────────────────────────────────────────────

function SystemCard({ status }) {
  const items = [
    { key: 'ai', label: 'AI' },
    { key: 'telegram', label: 'Telegram' },
    { key: 'db', label: 'База данных' },
  ];
  const allOk = items.every(i => (status?.[i.key] || 'unknown') === 'ok');
  return (
    <div style={{
      padding: '20px 22px',
      background: allOk ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)',
      border: `1px solid ${allOk ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.35)'}`,
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Статус системы</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: allOk ? '#22c55e' : '#ef4444', lineHeight: 1.1 }}>
        {allOk ? 'Всё работает' : 'Есть проблемы'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
        {items.map(({ key, label }) => {
          const s = (status?.[key] || 'unknown').toLowerCase();
          const labels = { ok: 'Работает', degraded: 'Деградация', down: 'Сбой', unknown: 'Неизвестно' };
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <StatusDot status={s} />
              <span style={{ color: 'var(--text-secondary)', minWidth: 90 }}>{label}</span>
              <span style={{ color: s === 'ok' ? '#22c55e' : s === 'down' ? '#ef4444' : '#f59e0b', fontWeight: 500 }}>{labels[s]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function MonitoringView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await api.getMonitoringSummary();
      setData(result);
      setUpdatedAt(new Date());
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  function fmtTime(d) {
    if (!d) return '';
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'только что';
    return `${Math.floor(diff / 60000)} мин назад`;
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>Загрузка...</div>;
  }

  const {
    revenue_today = 0,
    revenue_yesterday = 0,
    conversion = 0,
    conversion_yesterday = 0,
    missed_clients = 0,
    ai_errors = 0,
    ai_errors_yesterday = 0,
    avg_check = 0,
    system_status = {},
    lost_clients = 0,
  } = data || {};

  // Global alert condition
  const aiDown = system_status?.ai === 'down';
  const criticalMissed = missed_clients > 5;
  const showAlert = aiDown || criticalMissed;
  const alertText = aiDown
    ? 'AI не отвечает — клиенты не получают ответы'
    : `${missed_clients} клиентов ждут ответа более 5 минут`;

  // Loss estimates
  const missedLoss = avg_check > 0 && missed_clients > 0
    ? `~${fmtMoney(missed_clients * avg_check)}`
    : null;
  const lostLoss = avg_check > 0 && lost_clients > 0
    ? `~${fmtMoney(lost_clients * avg_check)}`
    : null;

  return (
    <div style={{ padding: 28, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAlert ? 16 : 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Пульс бизнеса</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {updatedAt && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Обновлено {fmtTime(updatedAt)}</span>}
          <button
            onClick={() => { setRefreshing(true); load(); }}
            disabled={refreshing}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: refreshing ? 'not-allowed' : 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'spin' : ''} />
            Обновить
          </button>
        </div>
      </div>

      {/* Global alert banner */}
      {showAlert && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderLeft: '3px solid #ef4444', borderRadius: 8, marginBottom: 20, fontSize: 13, color: '#dc2626', fontWeight: 500 }}>
          {alertText}
        </div>
      )}

      {/* 6 cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        <MetricCard
          label="Выручка сегодня"
          value={fmtMoney(revenue_today)}
          sub="Оплаченные заказы за 24 ч"
          trendEl={<TrendBadge today={revenue_today} yesterday={revenue_yesterday} />}
        />
        <MetricCard
          label="Конверсия"
          value={`${conversion}%`}
          sub="Диалоги → оплата за 24 ч"
          alert={conversion < 5 && data !== null}
          trendEl={<TrendBadge today={conversion} yesterday={conversion_yesterday} />}
        />
        <MetricCard
          label="Без ответа"
          value={missed_clients}
          sub="Клиенты ждут > 5 мин"
          alert={missed_clients > 0}
          lossHint={missedLoss ? `Потери: ${missedLoss}` : undefined}
        />
        <MetricCard
          label="Ошибки AI"
          value={ai_errors}
          sub="За последние 24 ч"
          alert={ai_errors > 10}
          trendEl={<TrendBadge today={ai_errors} yesterday={ai_errors_yesterday} invertColors />}
        />
        <SystemCard status={system_status} />
        <MetricCard
          label="Потерянные клиенты"
          value={lost_clients}
          sub="Нет активности 48 ч+"
          alert={lost_clients > 5}
          lossHint={lostLoss ? `Потери: ${lostLoss}` : undefined}
        />
      </div>
    </div>
  );
}
