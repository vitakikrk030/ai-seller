'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Save, Check, AlertCircle, RefreshCw, Eye, EyeOff,
  Key, Link, Cpu, RotateCw, Unplug, MessageSquare,
} from 'lucide-react';
import { api } from '../lib/api';

// ─── Status dot ───────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const colors = { ok: '#22c55e', error: '#ef4444', checking: '#f59e0b', unknown: '#94a3b8' };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status] || colors.unknown,
      boxShadow: status === 'ok' ? '0 0 0 3px rgba(34,197,94,0.15)' : status === 'error' ? '0 0 0 3px rgba(239,68,68,0.15)' : 'none',
      flexShrink: 0,
    }} />
  );
}

// ─── Integration card ──────────────────────────────────────────────────────

function IntegrationCard({ title, icon, status, statusText, meta, error, children, onCheck, checking }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--bg-secondary)', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <StatusDot status={status} />
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{icon} {title}</span>
        {statusText && (
          <span style={{ fontSize: 12, color: status === 'ok' ? '#22c55e' : status === 'error' ? '#ef4444' : 'var(--text-secondary)' }}>
            {statusText}
          </span>
        )}
        {meta && <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{meta}</span>}
        {onCheck && (
          <button
            onClick={(e) => { e.stopPropagation(); onCheck(); }}
            disabled={checking}
            style={{ fontSize: 11, padding: '3px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: checking ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <RefreshCw size={11} className={checking ? 'spin' : ''} />
            Проверить
          </button>
        )}
        <span style={{ fontSize: 14, color: 'var(--text-secondary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 18px', background: 'rgba(239,68,68,0.06)', borderTop: '1px solid rgba(239,68,68,0.15)', fontSize: 12, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Settings (collapsible) */}
      {open && (
        <div style={{ padding: '16px 18px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Secret input ──────────────────────────────────────────────────────────

function SecretInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, padding: '7px 10px', background: 'none', border: 'none', outline: 'none', fontSize: 13, color: 'var(--text)' }}
      />
      <button type="button" onClick={() => setShow(s => !s)} style={{ padding: '0 10px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
  );
}

function SaveBtn({ onClick, saving }) {
  return (
    <button onClick={onClick} disabled={saving} style={{ padding: '7px 16px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: saving ? 0.7 : 1 }}>
      <Save size={13} /> Сохранить
    </button>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────

export default function IntegrationsView() {
  const [settings, setSettings] = useState({});
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [intStatus, setIntStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState({});
  const [aiUsage, setAiUsage] = useState(null);
  // AI provider test state
  const [aiModels, setAiModels] = useState(null);
  const [aiTestResult, setAiTestResult] = useState(null);
  const [aiTesting, setAiTesting] = useState(false);
  // Inline confirm state: null | 'telegram' | 'ai' | 'shop'
  const [confirmReset, setConfirmReset] = useState(null);
  const [resetting, setResetting] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setSettings(data);
      setEdits(data);
    } catch {}
  }, []);

  const loadAiUsage = useCallback(async () => {
    try {
      const data = await api.getAiUsage(30);
      setAiUsage(data);
    } catch {}
  }, []);

  async function testAiProvider() {
    const baseUrl = (edits.ai_base_url || '').trim() || 'https://openrouter.ai/api/v1';
    const apiKey = (edits.ai_api_key || edits.openrouter_api_key || '').trim();
    if (!apiKey) {
      setAiTestResult({ success: false, error: 'Введите API Key' });
      return;
    }
    setAiTesting(true);
    setAiTestResult(null);
    setAiModels(null);
    try {
      const result = await api.testAiProvider(baseUrl, apiKey);
      setAiTestResult(result);
      if (result.success) {
        setAiModels(result.models || []);
        // Auto-select first model if none selected
        if (!edits.ai_model && !edits.openrouter_model && result.models?.length > 0) {
          update('ai_model', result.models[0]);
        }
      }
    } catch (e) {
      setAiTestResult({ success: false, error: e.message });
    }
    setAiTesting(false);
  }

  async function resetIntegration(type) {
    setResetting(true);
    setConfirmReset(null);
    try {
      await api.resetIntegration(type);
      // Optimistic clear of local state
      const clearKeys = {
        telegram: ['bot_token', 'webhook_url', 'webhook_secret', 'owner_chat_id'],
        ai: ['ai_base_url', 'ai_api_key', 'ai_model', 'openrouter_api_key', 'openrouter_model'],
        shop: ['shop_api_url', 'shop_api_key'],
      }[type] || [];
      setEdits(prev => {
        const next = { ...prev };
        clearKeys.forEach(k => { next[k] = ''; });
        return next;
      });
      setSettings(prev => {
        const next = { ...prev };
        clearKeys.forEach(k => { next[k] = ''; });
        return next;
      });
      if (type === 'ai') { setAiModels(null); setAiTestResult(null); setAiUsage(null); }
      setIntStatus(prev => prev ? { ...prev, [type]: { ok: false, configured: false } } : prev);
      setStatus({ type: 'success', text: 'Интеграция отключена' });
      setTimeout(() => setStatus(null), 4000);
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    }
    setResetting(false);
  }

  const checkAll = useCallback(async () => {
    setChecking(true);
    try {
      const data = await api.getIntegrationsStatus();
      setIntStatus(data);
    } catch {}
    setChecking(false);
  }, []);

  useEffect(() => {
    loadSettings();
    checkAll();
    loadAiUsage();
  }, [loadSettings, checkAll, loadAiUsage]);

  function update(key, value) {
    setEdits(prev => ({ ...prev, [key]: value }));
  }

  async function saveSection(keys) {
    setSaving(true);
    setStatus(null);
    try {
      const entries = keys.map(key => ({ key, value: edits[key] || '' }));
      await api.saveSettings(entries);
      setStatus({ type: 'success', text: 'Сохранено' });
      await loadSettings();
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus({ type: 'error', text: 'Ошибка сохранения' });
    }
    setSaving(false);
  }

  async function changeToken() {
    const token = edits.bot_token;
    if (!token || token.includes('••••')) {
      setStatus({ type: 'error', text: 'Введите новый токен' });
      return;
    }
    setTesting(p => ({ ...p, tokenChange: true }));
    try {
      const result = await api.changeToken(token, edits.webhook_url || '');
      if (result.ok) {
        const botName = result.bot ? `@${result.bot.username}` : '';
        setStatus({ type: 'success', text: `Токен сохранён ${botName}` });
        await loadSettings();
        await checkAll();
      } else {
        setStatus({ type: 'error', text: result.error || 'Ошибка' });
      }
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    }
    setTesting(p => ({ ...p, tokenChange: false }));
    setTimeout(() => setStatus(null), 5000);
  }

  async function disconnectBot() {
    setTesting(p => ({ ...p, disconnect: true }));
    try {
      const result = await api.disconnectBot();
      if (result.ok) {
        setStatus({ type: 'success', text: 'Бот отключён' });
        await loadSettings();
        await checkAll();
      } else {
        setStatus({ type: 'error', text: result.error || 'Ошибка' });
      }
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    }
    setTesting(p => ({ ...p, disconnect: false }));
    setTimeout(() => setStatus(null), 5000);
  }

  // Derive status for each card
  function cardStatus(key) {
    if (!intStatus) return 'unknown';
    const s = intStatus[key];
    if (!s) return 'unknown';
    if (!s.configured) return 'unknown';
    return s.ok ? 'ok' : 'error';
  }

  function cardText(key) {
    if (!intStatus) return checking ? 'Проверяется...' : '';
    const s = intStatus[key];
    if (!s) return '';
    if (!s.configured) return 'Не подключено';
    if (s.ok) {
      if (key === 'telegram') return s.bot ? `@${s.bot.username}` : 'Работает';
      if (key === 'ai') return `${s.model || ''} · ${s.latency}ms`;
      if (key === 'shop') return `${s.count} товаров`;
    }
    return 'Ошибка';
  }

  function cardError(key) {
    if (!intStatus) return null;
    const s = intStatus[key];
    if (!s || s.ok) return null;
    return s.error || null;
  }

  return (
    <div style={{ padding: 28, maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Интеграции</div>
        <button onClick={checkAll} disabled={checking} style={{ fontSize: 12, padding: '6px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: checking ? 'not-allowed' : 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={12} className={checking ? 'spin' : ''} />
          Проверить всё
        </button>
      </div>

      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, background: status.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: status.type === 'success' ? '#16a34a' : '#ef4444' }}>
          {status.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.text}
        </div>
      )}

      {/* Telegram */}
      <IntegrationCard
        title="Telegram"
        icon={<MessageSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />}
        status={cardStatus('telegram')}
        statusText={cardText('telegram')}
        error={cardError('telegram')}
        onCheck={checkAll}
        checking={checking}
      >
        <Field label="Bot Token">
          <SecretInput value={edits.bot_token} onChange={v => update('bot_token', v)} placeholder="123456:ABC-..." />
        </Field>
        <Field label="Webhook URL">
          <TextInput value={edits.webhook_url} onChange={v => update('webhook_url', v)} placeholder="https://example.com/api/telegram/webhook" />
        </Field>
        <Field label="Owner Chat ID">
          <TextInput value={edits.owner_chat_id} onChange={v => update('owner_chat_id', v)} placeholder="ID чата для уведомлений" />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={changeToken} disabled={testing.tokenChange} style={{ padding: '7px 14px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
            <RotateCw size={12} className={testing.tokenChange ? 'spin' : ''} /> Сохранить + webhook
          </button>
          {confirmReset === 'telegram' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Удалить?</span>
              <button onClick={() => resetIntegration('telegram')} disabled={resetting} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Удалить</button>
              <button onClick={() => setConfirmReset(null)} style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>Отмена</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset('telegram')} style={{ padding: '7px 12px', background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Unplug size={12} /> Отключить
            </button>
          )}
        </div>
      </IntegrationCard>

      {/* AI */}
      <IntegrationCard
        title="AI Provider"
        icon={<Cpu size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />}
        status={cardStatus('ai')}
        statusText={cardText('ai')}
        error={cardError('ai')}
        onCheck={checkAll}
        checking={checking}
      >
        <Field label="Base URL">
          <TextInput
            value={edits.ai_base_url || ''}
            onChange={v => { update('ai_base_url', v); setAiModels(null); setAiTestResult(null); }}
            placeholder="https://openrouter.ai/api/v1"
          />
        </Field>
        <Field label="API Key">
          <SecretInput
            value={edits.ai_api_key || edits.openrouter_api_key || ''}
            onChange={v => { update('ai_api_key', v); update('openrouter_api_key', v); setAiModels(null); setAiTestResult(null); }}
            placeholder="sk-or-... / sk-..."
          />
        </Field>
        <Field label="Модель">
          {aiModels && aiModels.length > 0 ? (
            <select
              value={edits.ai_model || edits.openrouter_model || ''}
              onChange={e => { update('ai_model', e.target.value); update('openrouter_model', e.target.value); }}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
            >
              {aiModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <TextInput
              value={edits.ai_model || edits.openrouter_model || ''}
              onChange={v => { update('ai_model', v); update('openrouter_model', v); }}
              placeholder={aiModels !== null ? 'Введите модель вручную' : 'openai/gpt-4o-mini'}
            />
          )}
        </Field>
        {aiTestResult && (
          <div style={{ fontSize: 12, padding: '6px 10px', borderRadius: 7, marginBottom: 8,
            background: aiTestResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: aiTestResult.success ? '#16a34a' : '#ef4444' }}>
            {aiTestResult.success
              ? `✓ Подключено · ${aiTestResult.latency}ms${aiModels?.length ? ` · ${aiModels.length} моделей` : ' · список моделей недоступен'}`
              : `✗ ${aiTestResult.error === 'invalid_api_key' ? 'Неверный API Key' : aiTestResult.error === 'connection_failed' ? 'Нет соединения' : aiTestResult.error}`}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={testAiProvider} disabled={aiTesting} style={{ padding: '7px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: aiTesting ? 'not-allowed' : 'pointer', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <RefreshCw size={12} className={aiTesting ? 'spin' : ''} /> Проверить
          </button>
          <SaveBtn onClick={() => saveSection(['ai_base_url', 'ai_api_key', 'ai_model', 'openrouter_api_key', 'openrouter_model'])} saving={saving} />
          {confirmReset === 'ai' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Удалить?</span>
              <button onClick={() => resetIntegration('ai')} disabled={resetting} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Удалить</button>
              <button onClick={() => setConfirmReset(null)} style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>Отмена</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset('ai')} style={{ padding: '7px 12px', background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Unplug size={12} /> Отключить
            </button>
          )}
        </div>

        {/* Usage block */}
        {aiUsage && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-secondary,rgba(0,0,0,0.04))', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Использование токенов (30 дней)</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{aiUsage.requests} запросов</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{
                height: '100%',
                width: `${aiUsage.percent}%`,
                borderRadius: 4,
                background: aiUsage.percent >= 90 ? '#ef4444' : aiUsage.percent >= 70 ? '#f59e0b' : '#22c55e',
                transition: 'width 0.4s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
              <span>Использовано: <b style={{ color: 'var(--text)' }}>{Number(aiUsage.used).toLocaleString()}</b></span>
              <span>Лимит: <b style={{ color: 'var(--text)' }}>{Number(aiUsage.limit).toLocaleString()}</b></span>
              <span style={{ color: aiUsage.percent >= 90 ? '#ef4444' : aiUsage.percent >= 70 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{aiUsage.percent}%</span>
            </div>
          </div>
        )}
      </IntegrationCard>

      {/* Shop */}
      <IntegrationCard
        title="Сайт / Каталог"
        icon={<Link size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />}
        status={cardStatus('shop')}
        statusText={cardText('shop')}
        error={cardError('shop')}
        onCheck={checkAll}
        checking={checking}
      >
        <Field label="API URL">
          <TextInput value={edits.shop_api_url} onChange={v => update('shop_api_url', v)} placeholder="https://shop.example.com/api" />
        </Field>
        <Field label="API Key">
          <SecretInput value={edits.shop_api_key} onChange={v => update('shop_api_key', v)} placeholder="Ключ API" />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <SaveBtn onClick={() => saveSection(['shop_api_url', 'shop_api_key'])} saving={saving} />
          {confirmReset === 'shop' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Удалить?</span>
              <button onClick={() => resetIntegration('shop')} disabled={resetting} style={{ padding: '4px 10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Удалить</button>
              <button onClick={() => setConfirmReset(null)} style={{ padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>Отмена</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset('shop')} style={{ padding: '7px 12px', background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Unplug size={12} /> Отключить
            </button>
          )}
        </div>
      </IntegrationCard>

    </div>
  );
}
