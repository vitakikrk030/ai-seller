'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

const STATUS_CLASS = {
  OK: 'mon-ok',
  DEGRADED: 'mon-degraded',
  DOWN: 'mon-down',
  UNKNOWN: 'mon-unknown',
};

const STATUS_LABEL = {
  OK: 'Работает',
  DEGRADED: 'Деградация',
  DOWN: 'Сбой',
  UNKNOWN: 'Неизвестно',
};

const SEVERITY_LABEL = {
  critical: 'Критический',
  warning: 'Предупреждение',
  info: 'Инфо',
};

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'только что';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} мин назад`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)} ч назад`;
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function MonitoringView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [incFilter, setIncFilter] = useState({ source: '', resolved: '' });
  const [filteredIncidents, setFilteredIncidents] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyComp, setHistoryComp] = useState('');
  const [historyHours, setHistoryHours] = useState(24);
  const [showHistory, setShowHistory] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [showMetrics, setShowMetrics] = useState(true);
  const intervalRef = useRef(null);

  const load = useCallback(async (force = false) => {
    try {
      const result = force
        ? await api.monitoringCheck()
        : await api.getMonitoring();
      setData(result);
      setError(null);
      // Load business metrics alongside
      try {
        const m = await api.getBusinessMetrics();
        if (m) setMetrics(m);
      } catch (_) {}
    } catch (e) {
      setError('Не удалось загрузить данные мониторинга');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => load(), 15000);
    return () => clearInterval(intervalRef.current);
  }, [load]);

  function handleRefresh() {
    setRefreshing(true);
    load(true);
  }

  async function loadFilteredIncidents() {
    try {
      const params = new URLSearchParams();
      if (incFilter.source) params.set('source', incFilter.source);
      if (incFilter.resolved !== '') params.set('resolved', incFilter.resolved);
      params.set('limit', '50');
      const result = await api.getMonitoringIncidents(params.toString());
      setFilteredIncidents(result);
    } catch (e) {
      // fallback — keep current
    }
  }

  async function loadHistory() {
    try {
      const params = new URLSearchParams();
      if (historyComp) params.set('component', historyComp);
      params.set('hours', historyHours);
      const result = await api.getMonitoringHistory(params.toString());
      setHistory(result);
    } catch (e) {
      setHistory([]);
    }
  }

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, historyComp, historyHours]);

  if (loading) {
    return (
      <div className="mon-page">
        <div className="mon-loading">Загрузка данных мониторинга...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mon-page">
        <div className="mon-error">
          <div className="mon-error-title">Мониторинг недоступен</div>
          <div className="mon-error-text">{error}</div>
          <button className="btn" onClick={() => { setLoading(true); load(); }}>Повторить</button>
        </div>
      </div>
    );
  }

  const { overall, components, incidents, checkedAt } = data || {};
  const selectedComp = selected ? components?.find((c) => c.name === selected) : null;
  const displayIncidents = filteredIncidents || incidents;
  const uniqueSources = [...new Set((incidents || []).map(i => i.source))];

  return (
    <div className="mon-page">
      {/* Заголовок */}
      <div className="mon-header">
        <div className="mon-header-left">
          <h2 className="mon-title">Состояние системы</h2>
          <span className={`mon-overall ${STATUS_CLASS[overall] || 'mon-unknown'}`}>
            {overall === 'OK' ? 'Все системы работают' :
             overall === 'DEGRADED' ? 'Частичная деградация' :
             overall === 'DOWN' ? 'Критический сбой' : 'Проверка...'}
          </span>
        </div>
        <div className="mon-header-right">
          <span className="mon-checked">Обновлено {formatTime(checkedAt)}</span>
          <button
            className="btn btn-small mon-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Обновить статус"
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> Проверить
          </button>
        </div>
      </div>

      {/* Сетка статусов */}
      <div className="mon-grid">
        {(components || []).map((c) => (
          <button
            key={c.name}
            className={`mon-card ${STATUS_CLASS[c.status]} ${selected === c.name ? 'mon-card-selected' : ''}`}
            onClick={() => setSelected(selected === c.name ? null : c.name)}
          >
            <div className="mon-card-header">
              <span className="mon-card-label">{c.label}</span>
              <span className={`mon-badge ${STATUS_CLASS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
            </div>
            <div className="mon-card-meta">
              {c.status === 'OK' && c.latencyMs != null && (
                <span className="mon-latency">{c.latencyMs} мс</span>
              )}
              {c.status !== 'OK' && c.message && (
                <span className="mon-card-msg">{c.message}</span>
              )}
              <span className="mon-card-time">{formatTime(c.lastCheck)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Бизнес-метрики */}
      <div className="mon-history">
        <button
          className="mon-history-toggle"
          onClick={() => setShowMetrics(!showMetrics)}
        >
          <h3 className="mon-incidents-title">Бизнес-метрики</h3>
          <span>{showMetrics ? '▲' : '▼'}</span>
        </button>
        {showMetrics && metrics && (
          <div className="mon-grid" style={{ marginTop: 8 }}>
            <div className="mon-card mon-ok">
              <div className="mon-card-header"><span className="mon-card-label">Диалоги</span></div>
              <div className="mon-card-meta"><span className="mon-latency">{metrics.dialogs} всего / {metrics.todayDialogs} за 24ч</span></div>
            </div>
            <div className="mon-card mon-ok">
              <div className="mon-card-header"><span className="mon-card-label">Заказы</span></div>
              <div className="mon-card-meta"><span className="mon-latency">{metrics.orders} всего / {metrics.todayOrders} за 24ч</span></div>
            </div>
            <div className="mon-card mon-ok">
              <div className="mon-card-header"><span className="mon-card-label">Конверсия</span></div>
              <div className="mon-card-meta"><span className="mon-latency">{metrics.conversion}% всего / {metrics.todayConversion}% за 24ч</span></div>
            </div>
            <div className="mon-card mon-ok">
              <div className="mon-card-header"><span className="mon-card-label">Выручка</span></div>
              <div className="mon-card-meta"><span className="mon-latency">{metrics.revenue.toLocaleString('ru-RU')} ₽</span></div>
            </div>
            <div className={`mon-card ${metrics.aiErrorRate > 5 ? 'mon-degraded' : 'mon-ok'}`}>
              <div className="mon-card-header"><span className="mon-card-label">AI</span></div>
              <div className="mon-card-meta"><span className="mon-latency">Ошибки: {metrics.aiErrorRate}% / Задержка: {metrics.avgAiLatency} мс</span></div>
            </div>
            <div className={`mon-card ${metrics.lostClients > 0 ? 'mon-degraded' : 'mon-ok'}`}>
              <div className="mon-card-header"><span className="mon-card-label">Потерянные клиенты</span></div>
              <div className="mon-card-meta"><span className="mon-latency">{metrics.lostClients} (7д без активности)</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Панель деталей */}
      {selectedComp && (
        <div className="mon-detail">
          <div className="mon-detail-header">
            <h3>{selectedComp.label}</h3>
            <span className={`mon-badge ${STATUS_CLASS[selectedComp.status]}`}>{STATUS_LABEL[selectedComp.status]}</span>
          </div>
          <div className="mon-detail-rows">
            <div className="mon-detail-row">
              <span className="mon-detail-label">Статус</span>
              <span>{STATUS_LABEL[selectedComp.status]}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Серьёзность</span>
              <span>{SEVERITY_LABEL[selectedComp.severity] || selectedComp.severity}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Критичный</span>
              <span>{selectedComp.critical ? 'Да' : 'Нет'}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Последний ОК</span>
              <span>{formatTimeFull(selectedComp.lastOk)}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Последняя ошибка</span>
              <span>{formatTimeFull(selectedComp.lastError)}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Последняя проверка</span>
              <span>{formatTimeFull(selectedComp.lastCheck)}</span>
            </div>
            {selectedComp.latencyMs != null && (
              <div className="mon-detail-row">
                <span className="mon-detail-label">Задержка</span>
                <span>{selectedComp.latencyMs} мс</span>
              </div>
            )}
            {selectedComp.message && (
              <div className="mon-detail-row">
                <span className="mon-detail-label">Сообщение</span>
                <span className="mon-detail-msg">{selectedComp.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Инциденты */}
      <div className="mon-incidents">
        <div className="mon-incidents-head">
          <h3 className="mon-incidents-title">Инциденты</h3>
          <div className="mon-filter-row">
            <select
              value={incFilter.source}
              onChange={(e) => setIncFilter(f => ({ ...f, source: e.target.value }))}
              className="mon-filter-select"
            >
              <option value="">Все источники</option>
              {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={incFilter.resolved}
              onChange={(e) => setIncFilter(f => ({ ...f, resolved: e.target.value }))}
              className="mon-filter-select"
            >
              <option value="">Все</option>
              <option value="false">Открытые</option>
              <option value="true">Решённые</option>
            </select>
            <button className="btn btn-small" onClick={loadFilteredIncidents}>Фильтр</button>
            {filteredIncidents && (
              <button className="btn btn-small" onClick={() => setFilteredIncidents(null)}>Сброс</button>
            )}
          </div>
        </div>
        {(!displayIncidents || displayIncidents.length === 0) ? (
          <div className="mon-empty">Инцидентов не зафиксировано</div>
        ) : (
          <div className="mon-incident-list">
            {displayIncidents.map((inc) => (
              <div key={inc.id} className={`mon-incident ${inc.resolved ? 'mon-incident-resolved' : ''}`}>
                <div className="mon-incident-header">
                  <span className={`mon-severity mon-severity-${inc.severity}`}>
                    {SEVERITY_LABEL[inc.severity] || inc.severity}
                  </span>
                  <span className="mon-incident-source">{inc.source}</span>
                  <span className="mon-incident-time">{formatTimeFull(inc.time)}</span>
                  {inc.resolved && <span className="mon-incident-status">Решён</span>}
                </div>
                <div className="mon-incident-msg">{inc.message}</div>
                {inc.resolvedAt && (
                  <div className="mon-incident-resolved-at">Решён в {formatTimeFull(inc.resolvedAt)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* История */}
      <div className="mon-history">
        <button
          className="mon-history-toggle"
          onClick={() => setShowHistory(!showHistory)}
        >
          <h3 className="mon-incidents-title">История</h3>
          <span>{showHistory ? '▲' : '▼'}</span>
        </button>
        {showHistory && (
          <>
            <div className="mon-filter-row" style={{ marginBottom: 10 }}>
              <select
                value={historyComp}
                onChange={(e) => setHistoryComp(e.target.value)}
                className="mon-filter-select"
              >
                <option value="">Все компоненты</option>
                {(components || []).map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
              </select>
              <select
                value={historyHours}
                onChange={(e) => setHistoryHours(Number(e.target.value))}
                className="mon-filter-select"
              >
                <option value={1}>1 час</option>
                <option value={6}>6 часов</option>
                <option value={24}>24 часа</option>
                <option value={72}>3 дня</option>
                <option value={168}>7 дней</option>
              </select>
            </div>
            {!history ? (
              <div className="mon-loading">Загрузка истории...</div>
            ) : history.length === 0 ? (
              <div className="mon-empty">Нет данных за выбранный период</div>
            ) : (
              <div className="mon-history-table">
                <div className="mon-history-row mon-history-head">
                  <span>Время</span>
                  <span>Компонент</span>
                  <span>Статус</span>
                  <span>Задержка</span>
                </div>
                {history.slice(0, 100).map((h, i) => (
                  <div key={i} className="mon-history-row">
                    <span>{formatTimeFull(h.time)}</span>
                    <span>{h.component}</span>
                    <span className={`mon-badge ${STATUS_CLASS[h.status]}`}>{STATUS_LABEL[h.status]}</span>
                    <span>{h.latencyMs != null ? `${h.latencyMs} мс` : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
