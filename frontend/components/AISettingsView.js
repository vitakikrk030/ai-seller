'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ─── Reusable UI ──────────────────────────────────────────────────────────

function Card({ children, style }) {
  return (
    <div style={{
      padding: 20,
      background: 'var(--card-bg, var(--bg-secondary))',
      border: '1px solid var(--border)',
      borderRadius: 12,
      marginBottom: 16,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children, tooltip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
      {children}
      {tooltip && <Tooltip text={tooltip} />}
    </div>
  );
}

function Hint({ children }) {
  return <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>{children}</div>;
}

function Tooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--border)', color: 'var(--text-secondary)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default', fontWeight: 700 }}>?</span>
      {show && <div style={{ position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)', background: '#1e1e2e', color: '#fff', fontSize: 11, padding: '6px 10px', borderRadius: 7, whiteSpace: 'pre-wrap', maxWidth: 220, zIndex: 100, lineHeight: 1.5, pointerEvents: 'none' }}>{text}</div>}
    </span>
  );
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={onChange} style={{ width: 40, height: 22, borderRadius: 11, background: value ? 'var(--accent,#6366f1)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </div>
  );
}

// ─── Поведение AI ─────────────────────────────────────────────────────────

function BehaviorSection() {
  const [vals, setVals] = useState({ global_ai_enabled: 'true', auto_reply: 'true', response_delay: '0' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(data => {
      setVals({
        global_ai_enabled: data.global_ai_enabled ?? 'true',
        auto_reply: data.auto_reply ?? 'true',
        response_delay: data.response_delay ?? '0',
      });
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveSettings([
        { key: 'global_ai_enabled', value: vals.global_ai_enabled },
        { key: 'auto_reply', value: vals.auto_reply },
        { key: 'response_delay', value: vals.response_delay },
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  const on = (field) => vals[field] === 'true';
  const toggle = (field) => setVals(v => ({ ...v, [field]: on(field) ? 'false' : 'true' }));

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <Label>AI включён</Label>
            <Hint>Если выключено — AI не отвечает клиентам</Hint>
          </div>
          <Toggle value={on('global_ai_enabled')} onChange={() => toggle('global_ai_enabled')} />
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <Label>Автоответ</Label>
            <Hint>Если выключено — AI не пишет первым</Hint>
          </div>
          <Toggle value={on('auto_reply')} onChange={() => toggle('auto_reply')} />
        </div>
      </Card>

      <Card>
        <Label tooltip="0 = мгновенно, рекомендуется 1–3 сек для естественности">Задержка ответа (сек)</Label>
        <Hint>Имитирует живого человека</Hint>
        <input
          type="number" min="0" max="30"
          value={vals.response_delay}
          onChange={e => setVals(v => ({ ...v, response_delay: e.target.value }))}
          style={{ width: 80, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}
        />
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          Сохранить
        </button>
        {saved && <span style={{ fontSize: 12, color: '#22c55e' }}>Сохранено</span>}
      </div>
    </div>
  );
}

// ─── Реквизиты ────────────────────────────────────────────────────────────

function PaymentSection() {
  const [form, setForm] = useState({ payment_card_number: '', payment_name: '', payment_bank_name: '', payment_receiver_name: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(data => {
      setForm({
        payment_card_number: data.payment_card_number || '',
        payment_name: data.payment_name || '',
        payment_bank_name: data.payment_bank_name || '',
        payment_receiver_name: data.payment_receiver_name || '',
      });
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveSettings([
        { key: 'payment_card_number', value: form.payment_card_number },
        { key: 'payment_name', value: form.payment_name },
        { key: 'payment_bank_name', value: form.payment_bank_name },
        { key: 'payment_receiver_name', value: form.payment_receiver_name },
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  function Field({ label, hint, field, placeholder, type = 'text' }) {
    return (
      <Card>
        <Label>{label}</Label>
        {hint && <Hint>{hint}</Hint>}
        <input
          type={type}
          value={form[field] || ''}
          onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          placeholder={placeholder}
          style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }}
        />
      </Card>
    );
  }

  return (
    <div>
      <Field label="Номер карты" hint="Клиент увидит этот номер при оплате" field="payment_card_number" placeholder="0000 0000 0000 0000" />
      <Field label="Банк" field="payment_bank_name" placeholder="Сбербанк, Тинькофф..." />
      <Field label="Получатель" field="payment_receiver_name" placeholder="Иван И." />
      <Field label="Имя в подписи" hint="Используется в сообщении об оплате" field="payment_name" placeholder="Магазин кроссовок" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ padding: '8px 18px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          Сохранить
        </button>
        {saved && <span style={{ fontSize: 12, color: '#22c55e' }}>Сохранено</span>}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'behavior', label: 'Поведение AI' },
  { id: 'payment', label: 'Реквизиты' },
];

export default function AISettingsView() {
  const [activeSection, setActiveSection] = useState('behavior');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 192, borderRight: '1px solid var(--border)', overflowY: 'auto', flexShrink: 0, padding: '16px 0' }}>
        <div style={{ padding: '0 16px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Настройки AI
        </div>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
            padding: '9px 16px',
            background: activeSection === s.id ? 'var(--accent-bg, rgba(99,102,241,0.1))' : 'transparent',
            color: activeSection === s.id ? 'var(--accent, #6366f1)' : 'var(--text)',
            border: 'none', cursor: 'pointer', fontSize: 13,
            fontWeight: activeSection === s.id ? 600 : 400,
            borderLeft: activeSection === s.id ? '3px solid var(--accent, #6366f1)' : '3px solid transparent',
          }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 28 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
          {SECTIONS.find(s => s.id === activeSection)?.label}
        </div>
        {activeSection === 'behavior' && <BehaviorSection />}
        {activeSection === 'payment' && <PaymentSection />}
      </div>
    </div>
  );
}
