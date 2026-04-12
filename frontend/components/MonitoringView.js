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
  OK: 'OK',
  DEGRADED: 'Degraded',
  DOWN: 'Down',
  UNKNOWN: 'Unknown',
};

const SEVERITY_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function MonitoringView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(null);
  const intervalRef = useRef(null);

  const load = useCallback(async (force = false) => {
    try {
      const result = force
        ? await api.monitoringCheck()
        : await api.getMonitoring();
      setData(result);
      setError(null);
    } catch (e) {
      setError('Failed to load monitoring data');
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

  if (loading) {
    return (
      <div className="mon-page">
        <div className="mon-loading">Loading monitoring data...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mon-page">
        <div className="mon-error">
          <div className="mon-error-title">Monitoring unavailable</div>
          <div className="mon-error-text">{error}</div>
          <button className="btn" onClick={() => { setLoading(true); load(); }}>Retry</button>
        </div>
      </div>
    );
  }

  const { overall, components, incidents, checkedAt } = data || {};
  const selectedComp = selected ? components?.find((c) => c.name === selected) : null;

  return (
    <div className="mon-page">
      {/* Header */}
      <div className="mon-header">
        <div className="mon-header-left">
          <h2 className="mon-title">System Status</h2>
          <span className={`mon-overall ${STATUS_CLASS[overall] || 'mon-unknown'}`}>
            {overall === 'OK' ? 'All Systems Operational' :
             overall === 'DEGRADED' ? 'Partial Degradation' :
             overall === 'DOWN' ? 'Major Outage' : 'Checking...'}
          </span>
        </div>
        <div className="mon-header-right">
          <span className="mon-checked">Updated {formatTime(checkedAt)}</span>
          <button
            className="btn btn-small mon-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh status"
          >
            <RefreshCw size={13} className={refreshing ? 'spin' : ''} /> Check now
          </button>
        </div>
      </div>

      {/* Status grid */}
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
                <span className="mon-latency">{c.latencyMs}ms</span>
              )}
              {c.status !== 'OK' && c.message && (
                <span className="mon-card-msg">{c.message}</span>
              )}
              <span className="mon-card-time">{formatTime(c.lastCheck)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {selectedComp && (
        <div className="mon-detail">
          <div className="mon-detail-header">
            <h3>{selectedComp.label}</h3>
            <span className={`mon-badge ${STATUS_CLASS[selectedComp.status]}`}>{STATUS_LABEL[selectedComp.status]}</span>
          </div>
          <div className="mon-detail-rows">
            <div className="mon-detail-row">
              <span className="mon-detail-label">Status</span>
              <span>{STATUS_LABEL[selectedComp.status]}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Severity</span>
              <span>{SEVERITY_LABEL[selectedComp.severity] || selectedComp.severity}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Critical</span>
              <span>{selectedComp.critical ? 'Yes' : 'No'}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Last OK</span>
              <span>{formatTimeFull(selectedComp.lastOk)}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Last Error</span>
              <span>{formatTimeFull(selectedComp.lastError)}</span>
            </div>
            <div className="mon-detail-row">
              <span className="mon-detail-label">Last Check</span>
              <span>{formatTimeFull(selectedComp.lastCheck)}</span>
            </div>
            {selectedComp.latencyMs != null && (
              <div className="mon-detail-row">
                <span className="mon-detail-label">Latency</span>
                <span>{selectedComp.latencyMs}ms</span>
              </div>
            )}
            {selectedComp.message && (
              <div className="mon-detail-row">
                <span className="mon-detail-label">Message</span>
                <span className="mon-detail-msg">{selectedComp.message}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Incidents */}
      <div className="mon-incidents">
        <h3 className="mon-incidents-title">Incidents</h3>
        {(!incidents || incidents.length === 0) ? (
          <div className="mon-empty">No incidents recorded</div>
        ) : (
          <div className="mon-incident-list">
            {incidents.map((inc) => (
              <div key={inc.id} className={`mon-incident ${inc.resolved ? 'mon-incident-resolved' : ''}`}>
                <div className="mon-incident-header">
                  <span className={`mon-severity mon-severity-${inc.severity}`}>
                    {SEVERITY_LABEL[inc.severity] || inc.severity}
                  </span>
                  <span className="mon-incident-source">{inc.source}</span>
                  <span className="mon-incident-time">{formatTimeFull(inc.time)}</span>
                  {inc.resolved && <span className="mon-incident-status">Resolved</span>}
                </div>
                <div className="mon-incident-msg">{inc.message}</div>
                {inc.resolvedAt && (
                  <div className="mon-incident-resolved-at">Resolved at {formatTimeFull(inc.resolvedAt)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
