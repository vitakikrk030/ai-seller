'use client';

import { useState, useEffect } from 'react';
import {
  Save, Check, AlertCircle, Zap, Bot, Globe, Sliders,
  Eye, EyeOff, RefreshCw, Link, Key, Cpu, Clock, Power,
  MessageSquare, CreditCard, Copy, User, Unplug, RotateCw,
} from 'lucide-react';
import { api } from '../lib/api';

export default function IntegrationsView() {
  const [settings, setSettings] = useState({});
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error', text }
  const [testResults, setTestResults] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [testing, setTesting] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const data = await api.getSettings();
      setSettings(data);
      setEdits(data);
    } catch (e) {
      console.error(e);
    }
  }

  function update(key, value) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSection(keys) {
    setSaving(true);
    setStatus(null);
    try {
      const entries = keys.map((key) => ({ key, value: edits[key] || '' }));
      await api.saveSettings(entries);
      setStatus({ type: 'success', text: 'Сохранено' });
      // Reload to get masked values
      await loadSettings();
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setStatus({ type: 'error', text: 'Ошибка сохранения' });
    }
    setSaving(false);
  }

  async function testTelegram() {
    setTesting((p) => ({ ...p, telegram: true }));
    try {
      const result = await api.testTelegram();
      setTestResults((p) => ({ ...p, telegram: result }));
    } catch (e) {
      setTestResults((p) => ({ ...p, telegram: { ok: false, error: e.message } }));
    }
    setTesting((p) => ({ ...p, telegram: false }));
  }

  async function testShop() {
    setTesting((p) => ({ ...p, shop: true }));
    try {
      const result = await api.testShop();
      setTestResults((p) => ({ ...p, shop: result }));
    } catch (e) {
      setTestResults((p) => ({ ...p, shop: { ok: false, error: e.message } }));
    }
    setTesting((p) => ({ ...p, shop: false }));
  }

  function toggleSecret(key) {
    setShowSecrets((p) => ({ ...p, [key]: !p[key] }));
  }

  function copyCard() {
    const num = edits.payment_card_number;
    if (!num) return;
    navigator.clipboard.writeText(num).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function changeToken() {
    const token = edits.bot_token;
    if (!token || token.includes('••••')) {
      setStatus({ type: 'error', text: 'Введите новый токен' });
      return;
    }
    setTesting((p) => ({ ...p, tokenChange: true }));
    try {
      const result = await api.changeToken(token, edits.webhook_url || '');
      if (result.ok) {
        const botName = result.bot ? `@${result.bot.username}` : '';
        const whStatus = result.webhook ? ' + webhook установлен' : '';
        setStatus({ type: 'success', text: `Токен сохранён ${botName}${whStatus}` });
        setTestResults((p) => ({ ...p, telegram: { ok: true, bot: result.bot } }));
        await loadSettings();
      } else {
        setStatus({ type: 'error', text: result.error || 'Ошибка смены токена' });
      }
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    }
    setTesting((p) => ({ ...p, tokenChange: false }));
    setTimeout(() => setStatus(null), 5000);
  }

  async function disconnectBot() {
    if (!confirm('Отключить бота? Webhook будет удалён, токен очищен.')) return;
    setTesting((p) => ({ ...p, disconnect: true }));
    try {
      const result = await api.disconnectBot();
      if (result.ok) {
        setStatus({ type: 'success', text: 'Бот отключён' });
        setTestResults((p) => ({ ...p, telegram: null }));
        await loadSettings();
      } else {
        setStatus({ type: 'error', text: result.error || 'Ошибка отключения' });
      }
    } catch (e) {
      setStatus({ type: 'error', text: e.message });
    }
    setTesting((p) => ({ ...p, disconnect: false }));
    setTimeout(() => setStatus(null), 5000);
  }

  function SecretInput({ settingKey, placeholder }) {
    return (
      <div className="secret-input-wrap">
        <input
          type={showSecrets[settingKey] ? 'text' : 'password'}
          className="settings-input"
          placeholder={placeholder}
          value={edits[settingKey] || ''}
          onChange={(e) => update(settingKey, e.target.value)}
        />
        <button
          type="button"
          className="btn-icon secret-toggle"
          onClick={() => toggleSecret(settingKey)}
          title={showSecrets[settingKey] ? 'Скрыть' : 'Показать'}
        >
          {showSecrets[settingKey] ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    );
  }

  function TestBadge({ result }) {
    if (!result) return null;
    return (
      <span className={`test-badge ${result.ok ? 'test-ok' : 'test-fail'}`}>
        {result.ok ? <Check size={12} /> : <AlertCircle size={12} />}
        {result.ok
          ? result.bot
            ? `@${result.bot.username}`
            : 'OK'
          : result.error}
      </span>
    );
  }

  return (
    <div className="settings-page">
      <h2>Интеграции</h2>

      {status && (
        <div className={`status-banner status-${status.type}`}>
          {status.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
          {status.text}
        </div>
      )}

      {/* OpenRouter */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Zap size={16} />
          <span>OpenRouter (AI)</span>
        </div>

        <div className="settings-field">
          <label><Key size={13} /> API Key</label>
          <SecretInput settingKey="openrouter_api_key" placeholder="sk-or-..." />
        </div>

        <div className="settings-field">
          <label><Cpu size={13} /> Модель</label>
          <input
            type="text"
            className="settings-input"
            placeholder="openai/gpt-4o-mini"
            value={edits.openrouter_model || ''}
            onChange={(e) => update('openrouter_model', e.target.value)}
          />
        </div>

        <button
          className="btn btn-primary btn-small"
          onClick={() => saveSection(['openrouter_api_key', 'openrouter_model'])}
          disabled={saving}
        >
          <Save size={13} /> Сохранить
        </button>
      </div>

      {/* Telegram */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Bot size={16} />
          <span>Telegram</span>
        </div>

        <div className="settings-field">
          <label><Key size={13} /> Bot Token</label>
          <SecretInput settingKey="bot_token" placeholder="123456:ABC-..." />
        </div>

        <div className="settings-field">
          <label><Link size={13} /> Webhook URL</label>
          <input
            type="text"
            className="settings-input"
            placeholder="https://example.com/api/telegram/webhook"
            value={edits.webhook_url || ''}
            onChange={(e) => update('webhook_url', e.target.value)}
          />
        </div>

        <div className="settings-field">
          <label><MessageSquare size={13} /> Owner Chat ID</label>
          <input
            type="text"
            className="settings-input"
            placeholder="ID чата владельца"
            value={edits.owner_chat_id || ''}
            onChange={(e) => update('owner_chat_id', e.target.value)}
          />
        </div>

        <div className="settings-actions">
          <button
            className="btn btn-primary btn-small"
            onClick={() => saveSection(['bot_token', 'webhook_url', 'owner_chat_id'])}
            disabled={saving}
          >
            <Save size={13} /> Сохранить
          </button>
          <button
            className="btn btn-outline btn-small"
            onClick={testTelegram}
            disabled={testing.telegram}
          >
            <RefreshCw size={13} className={testing.telegram ? 'spin' : ''} />
            Проверить
          </button>
          <TestBadge result={testResults.telegram} />
        </div>

        <div className="settings-actions" style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary btn-small"
            onClick={changeToken}
            disabled={testing.tokenChange}
          >
            <RotateCw size={13} className={testing.tokenChange ? 'spin' : ''} />
            Сменить токен + webhook
          </button>
          <button
            className="btn btn-small"
            style={{ background: '#dc2626', color: '#fff', border: 'none' }}
            onClick={disconnectBot}
            disabled={testing.disconnect}
          >
            <Unplug size={13} className={testing.disconnect ? 'spin' : ''} />
            Отключить бота
          </button>
        </div>
      </div>

      {/* Shop */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Globe size={16} />
          <span>Сайт (витрина)</span>
        </div>

        <div className="settings-field">
          <label><Link size={13} /> API URL</label>
          <input
            type="text"
            className="settings-input"
            placeholder="https://shop.example.com/api"
            value={edits.shop_api_url || ''}
            onChange={(e) => update('shop_api_url', e.target.value)}
          />
        </div>

        <div className="settings-field">
          <label><Key size={13} /> API Key</label>
          <SecretInput settingKey="shop_api_key" placeholder="Ключ API" />
        </div>

        <div className="settings-actions">
          <button
            className="btn btn-primary btn-small"
            onClick={() => saveSection(['shop_api_url', 'shop_api_key'])}
            disabled={saving}
          >
            <Save size={13} /> Сохранить
          </button>
          <button
            className="btn btn-outline btn-small"
            onClick={testShop}
            disabled={testing.shop}
          >
            <RefreshCw size={13} className={testing.shop ? 'spin' : ''} />
            Проверить
          </button>
          <TestBadge result={testResults.shop} />
        </div>
      </div>

      {/* Payment */}
      <div className="settings-section">
        <div className="settings-section-header">
          <CreditCard size={16} />
          <span>Оплата</span>
        </div>

        <div className="settings-field">
          <label><CreditCard size={13} /> Номер карты</label>
          <div className="secret-input-wrap">
            <input
              type="text"
              className="settings-input"
              placeholder="0000 0000 0000 0000"
              value={edits.payment_card_number || ''}
              onChange={(e) => update('payment_card_number', e.target.value)}
            />
            <button
              type="button"
              className="btn-icon secret-toggle"
              onClick={copyCard}
              title={copied ? 'Скопировано' : 'Скопировать'}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
          {copied && <span className="copy-tooltip">Скопировано</span>}
        </div>

        <div className="settings-field">
          <label><User size={13} /> Имя получателя</label>
          <input
            type="text"
            className="settings-input"
            placeholder="Иван Иванов"
            value={edits.payment_name || ''}
            onChange={(e) => update('payment_name', e.target.value)}
          />
        </div>

        <button
          className="btn btn-primary btn-small"
          onClick={() => saveSection(['payment_card_number', 'payment_name'])}
          disabled={saving}
        >
          <Save size={13} /> Сохранить
        </button>
      </div>

      {/* General */}
      <div className="settings-section">
        <div className="settings-section-header">
          <Sliders size={16} />
          <span>Общие настройки</span>
        </div>

        <div className="settings-field settings-field-row">
          <label><Power size={13} /> AI глобально</label>
          <div
            className={`toggle ${edits.global_ai_enabled === 'true' ? 'active' : ''}`}
            onClick={() => update('global_ai_enabled', edits.global_ai_enabled === 'true' ? 'false' : 'true')}
          />
        </div>

        <div className="settings-field">
          <label><Clock size={13} /> Задержка ответа (сек)</label>
          <input
            type="number"
            className="settings-input settings-input-short"
            min="0"
            max="30"
            value={edits.response_delay || '0'}
            onChange={(e) => update('response_delay', e.target.value)}
          />
        </div>

        <div className="settings-field settings-field-row">
          <label><MessageSquare size={13} /> Автоответ</label>
          <div
            className={`toggle ${edits.auto_reply === 'true' ? 'active' : ''}`}
            onClick={() => update('auto_reply', edits.auto_reply === 'true' ? 'false' : 'true')}
          />
        </div>

        <button
          className="btn btn-primary btn-small"
          onClick={() => saveSection(['global_ai_enabled', 'response_delay', 'auto_reply'])}
          disabled={saving}
        >
          <Save size={13} /> Сохранить
        </button>
      </div>
    </div>
  );
}
