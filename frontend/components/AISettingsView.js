'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

// ─── Presets 2.0 ───────────────────────────────────────────────────────────

const PRESETS = {
  closer: {
    label: '🔥 Closer (Продажа без трения)',
    description: 'AI всегда подтверждает наличие и ведёт к оплате. Максимальная конверсия для перекупа.',
    changes: ['Стиль → Closer', 'Дожим → Вкл', 'Напоминания → Вкл', 'Длина → Коротко'],
    keys: {
      sales_style_preset: 'closer',
      seller_msg_length: 'коротко',
      toggle_pushdown: true,
      toggle_reminders: true,
      toggle_upsell: false,
      toggle_anti_repeat: true,
      closer_mode_enabled: true,
    },
  },
  max_sales: {
    label: 'Максимум продаж',
    description: 'Агрессивный дожим, напоминания, upsell. Лучше для товаров до 3000 руб.',
    changes: ['Стиль → Напористый', 'Дожим → Вкл', 'Напоминания → Вкл', 'Upsell → Вкл', 'Длина → Коротко'],
    keys: {
      sales_style_preset: 'aggressive',
      seller_msg_length: 'коротко',
      toggle_pushdown: true,
      toggle_reminders: true,
      toggle_upsell: true,
      toggle_anti_repeat: true,
      closer_mode_enabled: false,
    },
  },
  soft_seller: {
    label: 'Мягкий продавец',
    description: 'Помогает выбрать, не давит. Подходит для сложных или дорогих товаров.',
    changes: ['Стиль → Дружелюбный', 'Дожим → Выкл', 'Напоминания → Вкл', 'Upsell → Выкл', 'Длина → Средне'],
    keys: {
      sales_style_preset: 'friendly',
      seller_msg_length: 'средне',
      toggle_pushdown: false,
      toggle_reminders: true,
      toggle_upsell: false,
      toggle_anti_repeat: true,
      closer_mode_enabled: false,
    },
  },
  premium: {
    label: 'Премиум',
    description: 'Эксклюзивный стиль, VIP обращение. Для люксовых товаров.',
    changes: ['Стиль → Премиум', 'Дожим → Выкл', 'Напоминания → Выкл', 'Upsell → Вкл', 'Длина → Средне'],
    keys: {
      sales_style_preset: 'premium',
      seller_msg_length: 'средне',
      toggle_pushdown: false,
      toggle_reminders: false,
      toggle_upsell: true,
      toggle_anti_repeat: true,
      closer_mode_enabled: false,
    },
  },
};

// ─── Conflict rules (6+) ───────────────────────────────────────────────────

const CONFLICTS = [
  {
    check: (v) => v['sales_style_preset'] === 'aggressive' && v['seller_msg_length'] === 'подробно',
    message: 'Агрессивный дожим + длинные сообщения снижают конверсию.',
    fix: 'Установить длину "коротко"',
    fixKey: 'seller_msg_length', fixVal: 'коротко',
  },
  {
    check: (v) => v['toggle_memory'] === 'false' && v['sales_style_preset'] === 'premium',
    message: 'Память выключена — персонализация VIP-клиентов не работает.',
    fix: 'Включить память',
    fixKey: 'toggle_memory', fixVal: true, fixField: 'enabled',
  },
  {
    check: (v) => v['sales_style_preset'] === 'aggressive' && v['toggle_pushdown'] === 'false',
    message: 'Агрессивный стиль без дожима — стратегия неполная.',
    fix: 'Включить дожим',
    fixKey: 'toggle_pushdown', fixVal: true, fixField: 'enabled',
  },
  {
    check: (v) => v['toggle_upsell'] === 'true' && v['sales_style_preset'] === 'friendly',
    message: 'Upsell при мягком стиле может отпугнуть клиента.',
    fix: null,
  },
  {
    check: (v) => v['toggle_reminders'] === 'true' && v['toggle_anti_repeat'] === 'false',
    message: 'Напоминания без защиты от повторов — клиент получит одинаковые сообщения.',
    fix: 'Включить защиту от повторов',
    fixKey: 'toggle_anti_repeat', fixVal: true, fixField: 'enabled',
  },
];

// ─── Protected template variables ─────────────────────────────────────────

const PROTECTED_VARS = ['{{size}}', '{{product}}', '{{price}}', '{{name}}', '{{address}}', '{{amount}}'];

function highlightVars(text) {
  if (!text) return null;
  const parts = text.split(/({{[^}]+}})/g);
  return parts.map((p, i) =>
    PROTECTED_VARS.includes(p)
      ? <mark key={i} style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent,#6366f1)', borderRadius: 3, padding: '0 2px', fontFamily: 'monospace', fontSize: 12 }}>{p}</mark>
      : p
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export default function AISettingsView() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [fieldStatus, setFieldStatus] = useState({}); // key → 'saving'|'saved'|'error'
  const [conflicts, setConflicts] = useState([]);
  const [history, setHistory] = useState([]); // undo stack, max 5
  const [presetConfirm, setPresetConfirm] = useState(null); // presetKey pending confirm
  const [activeSection, setActiveSection] = useState('persona');
  const debounceRef = useRef({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getAiSettings();
      setSettings(data);
      _detectConflicts(data);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function _flatSettings(data) {
    const flat = {};
    for (const cat of Object.values(data)) {
      for (const item of (cat || [])) {
        flat[item.key] = item.enabled === false ? 'false' : (item.value ?? '');
      }
    }
    return flat;
  }

  function _detectConflicts(data) {
    const flat = _flatSettings(data);
    setConflicts(CONFLICTS.filter(c => c.check(flat)));
  }

  function getVal(key) {
    for (const cat of Object.values(settings)) {
      const item = (cat || []).find(i => i.key === key);
      if (item) return item;
    }
    return null;
  }

  function getValue(key) { return getVal(key)?.value ?? null; }

  function getEnabled(key) {
    const item = getVal(key);
    if (!item) return false;
    return item.enabled !== false && item.value !== 'false';
  }

  function _applyToState(prev, key, field, value) {
    const updated = { ...prev };
    for (const cat of Object.keys(updated)) {
      updated[cat] = (updated[cat] || []).map(item =>
        item.key === key ? { ...item, [field]: value } : item
      );
    }
    return updated;
  }

  async function saveKey(key, field, value) {
    // push undo snapshot before first change
    setHistory(h => {
      const snap = JSON.parse(JSON.stringify(settings));
      const next = [snap, ...h].slice(0, 5);
      return next;
    });

    // optimistic update
    setSettings(prev => {
      const updated = _applyToState(prev, key, field, value);
      _detectConflicts(updated);
      return updated;
    });

    setFieldStatus(s => ({ ...s, [key]: 'saving' }));
    try {
      await api.updateAiSetting(key, { [field]: value });
      setFieldStatus(s => ({ ...s, [key]: 'saved' }));
      setTimeout(() => setFieldStatus(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
    } catch (e) {
      setFieldStatus(s => ({ ...s, [key]: 'error' }));
      // rollback
      setSettings(prev => _applyToState(prev, key, field, field === 'enabled' ? !value : getVal(key)?.value));
    }
  }

  function saveKeyDebounced(key, field, value, delay = 600) {
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    // optimistic local update immediately
    setSettings(prev => {
      const updated = _applyToState(prev, key, field, value);
      _detectConflicts(updated);
      return updated;
    });
    setFieldStatus(s => ({ ...s, [key]: 'saving' }));
    debounceRef.current[key] = setTimeout(async () => {
      try {
        await api.updateAiSetting(key, { [field]: value });
        setFieldStatus(s => ({ ...s, [key]: 'saved' }));
        setTimeout(() => setFieldStatus(s => { const n = { ...s }; delete n[key]; return n; }), 2000);
      } catch {
        setFieldStatus(s => ({ ...s, [key]: 'error' }));
      }
    }, delay);
  }

  function undo() {
    if (!history.length) return;
    const [prev, ...rest] = history;
    setHistory(rest);
    setSettings(prev);
    _detectConflicts(prev);
    // bulk save rollback
    const entries = [];
    for (const cat of Object.values(prev)) {
      for (const item of (cat || [])) entries.push({ key: item.key, value: item.value, enabled: item.enabled });
    }
    api.bulkUpdateAiSettings(entries).catch(() => {});
  }

  async function applyPreset(presetKey) {
    const preset = PRESETS[presetKey];
    // push undo snapshot
    setHistory(h => [JSON.parse(JSON.stringify(settings)), ...h].slice(0, 5));
    setPresetConfirm(null);
    try {
      const entries = Object.entries(preset.keys).map(([key, value]) =>
        typeof value === 'boolean' ? { key, enabled: value } : { key, value }
      );
      await api.bulkUpdateAiSettings(entries);
      await load();
    } catch (e) {
      // silent
    }
  }

  const SECTIONS = [
    { id: 'behavior', label: 'Поведение AI' },
    { id: 'persona', label: 'Персона' },
    { id: 'sales', label: 'Продажи' },
    { id: 'automation', label: 'Автоматика' },
    { id: 'schedule', label: 'Расписание' },
    { id: 'payment', label: 'Реквизиты' },
    { id: 'advanced', label: 'Продвинуто' },
  ];

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>Загрузка...</div>;
  }

  // Preset context — which keys belong to the active preset
  const currentStyle = getValue('sales_style_preset');
  const activePresetKey = Object.entries(PRESETS).find(([, p]) => p.keys.sales_style_preset === currentStyle)?.[0] ?? null;
  const presetContext = activePresetKey
    ? { key: activePresetKey, label: PRESETS[activePresetKey].label, keys: new Set(Object.keys(PRESETS[activePresetKey].keys)) }
    : null;

  const sharedProps = { getValue, getEnabled, saveKey, saveKeyDebounced, fieldStatus, presetContext };

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
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            {SECTIONS.find(s => s.id === activeSection)?.label}
          </div>
          {history.length > 0 && (
            <button onClick={undo} style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              Отменить изменения ({history.length})
            </button>
          )}
        </div>

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {conflicts.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: 12, color: '#92400e', marginBottom: 6 }}>
                <span>{c.message}</span>
                {c.fix && (
                  <button onClick={() => saveKey(c.fixKey, c.fixField || 'value', c.fixVal)} style={{ marginLeft: 12, fontSize: 11, color: 'var(--accent,#6366f1)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {c.fix}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Preset confirm modal */}
        {presetConfirm && (
          <PresetConfirmModal
            preset={PRESETS[presetConfirm]}
            onConfirm={() => applyPreset(presetConfirm)}
            onCancel={() => setPresetConfirm(null)}
          />
        )}

        {activeSection === 'behavior' && <BehaviorSection />}
        {activeSection === 'persona' && <PersonaSection {...sharedProps} onPreset={setPresetConfirm} />}
        {activeSection === 'sales' && <SalesSection {...sharedProps} />}
        {activeSection === 'automation' && <AutomationSection {...sharedProps} />}
        {activeSection === 'schedule' && <ScheduleSection {...sharedProps} />}
        {activeSection === 'payment' && <PaymentSection />}
        {activeSection === 'advanced' && <AdvancedSection settings={settings} {...sharedProps} />}
      </div>
    </div>
  );
}

// ─── Preset confirm modal ──────────────────────────────────────────────────

function PresetConfirmModal({ preset, onConfirm, onCancel }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, maxWidth: 400, width: '90%' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Применить пресет «{preset.label}»?</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>{preset.description}</div>
        <div style={{ marginBottom: 20 }}>
          {preset.changes.map((ch, i) => (
            <div key={i} style={{ fontSize: 12, padding: '3px 0', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent,#6366f1)', display: 'inline-block', flexShrink: 0 }} />
              {ch}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onConfirm} style={{ flex: 1, padding: '9px 0', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Применить</button>
          <button onClick={onCancel} style={{ flex: 1, padding: '9px 0', background: 'none', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}


// ─── Reusable UI ──────────────────────────────────────────────────────────

// ─── PresetBadge — shown on fields owned by active preset ─────────────────

function PresetBadge({ presetContext, fieldKey }) {
  const [show, setShow] = useState(false);
  if (!presetContext || !presetContext.keys.has(fieldKey)) return null;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 6 }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--accent,#6366f1)', background: 'rgba(99,102,241,0.1)', borderRadius: 999, padding: '2px 7px', cursor: 'default' }}>
        <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Пресет
      </span>
      {show && (
        <div style={{ position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)', background: '#1e1e2e', color: '#fff', fontSize: 11, padding: '5px 9px', borderRadius: 7, whiteSpace: 'nowrap', zIndex: 100, pointerEvents: 'none' }}>
          Изменено пресетом «{presetContext.label}»
        </div>
      )}
    </span>
  );
}

function Card({ children, style, presetKey, presetContext }) {
  const isPreset = presetKey && presetContext?.keys.has(presetKey);
  return (
    <div style={{
      padding: 20,
      background: 'var(--card-bg, var(--bg-secondary))',
      border: isPreset ? '1px solid rgba(99,102,241,0.35)' : '1px solid var(--border)',
      borderLeft: isPreset ? '3px solid var(--accent,#6366f1)' : '1px solid var(--border)',
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

function FieldStatus({ status }) {
  if (!status) return null;
  const map = { saving: ['Сохраняется...', '#94a3b8'], saved: ['Сохранено', '#22c55e'], error: ['Ошибка', '#ef4444'] };
  const [label, color] = map[status] || [];
  return <span style={{ fontSize: 11, color, marginLeft: 6 }}>{label}</span>;
}

function Pill({ label, color = 'neutral' }) {
  const colors = { neutral: ['rgba(148,163,184,0.15)', '#64748b'], blue: ['rgba(99,102,241,0.12)', 'var(--accent,#6366f1)'], green: ['rgba(34,197,94,0.12)', '#16a34a'], yellow: ['rgba(245,158,11,0.12)', '#b45309'], red: ['rgba(239,68,68,0.12)', '#dc2626'] };
  const [bg, text] = colors[color] || colors.neutral;
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: bg, color: text }}>{label}</span>;
}

function Toggle({ value, onChange, label, fieldKey, fieldStatus }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div onClick={onChange} style={{ width: 40, height: 22, borderRadius: 11, background: value ? 'var(--accent,#6366f1)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
      </div>
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
      {fieldKey && <FieldStatus status={fieldStatus?.[fieldKey]} />}
    </label>
  );
}

function Select({ value, onChange, options, fieldKey, fieldStatus }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select value={value || ''} onChange={e => onChange(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', flex: 1 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {fieldKey && <FieldStatus status={fieldStatus?.[fieldKey]} />}
    </div>
  );
}

function TextInput({ value, onChange, onBlur, placeholder, fieldKey, fieldStatus }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} onBlur={e => onBlur && onBlur(e.target.value)} placeholder={placeholder} style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
      {fieldKey && <FieldStatus status={fieldStatus?.[fieldKey]} />}
    </div>
  );
}

function Textarea({ value, onChange, onBlur, rows = 3, fieldKey, fieldStatus, showVars }) {
  const hasVars = showVars && value && PROTECTED_VARS.some(v => value.includes(v));
  return (
    <div>
      <textarea value={value || ''} onChange={e => onChange(e.target.value)} onBlur={e => onBlur && onBlur(e.target.value)} rows={rows} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
        {hasVars && <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Переменные: {PROTECTED_VARS.filter(v => value.includes(v)).map((v, i) => <mark key={i} style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent,#6366f1)', borderRadius: 3, padding: '0 3px', fontFamily: 'monospace', marginLeft: 3 }}>{v}</mark>)}</div>}
        {fieldKey && <FieldStatus status={fieldStatus?.[fieldKey]} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// 1. ПЕРСОНА
// ═══════════════════════════════════════

// ─── 0. Поведение AI ───────────────────────────────────────────────────────

function BehaviorSection() {
  const [vals, setVals] = useState({ global_ai_enabled: 'true', auto_reply: 'true', response_delay: '0' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    import('../lib/api').then(({ api }) => {
      api.getSettings().then(data => {
        setVals({
          global_ai_enabled: data.global_ai_enabled ?? 'true',
          auto_reply: data.auto_reply ?? 'true',
          response_delay: data.response_delay ?? '0',
        });
      }).catch(() => {});
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const { api } = await import('../lib/api');
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

  function ToggleRow({ label, hint, field }) {
    const on = vals[field] === 'true';
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <Label>{label}</Label>
            <Hint>{hint}</Hint>
          </div>
          <div onClick={() => setVals(v => ({ ...v, [field]: on ? 'false' : 'true' }))}
            style={{ width: 40, height: 22, borderRadius: 11, background: on ? 'var(--accent,#6366f1)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div>
      <ToggleRow label="AI включён" hint="Если выключено — AI не отвечает клиентам" field="global_ai_enabled" />
      <ToggleRow label="Автоответ" hint="Если выключено — AI не пишет первым" field="auto_reply" />
      <Card>
        <Label tooltip="0 = мгновенно, рекомендуется 1–3 сек для естественности">Задержка ответа (сек)</Label>
        <Hint>Имитирует живого человека</Hint>
        <input type="number" min="0" max="30" value={vals.response_delay}
          onChange={e => setVals(v => ({ ...v, response_delay: e.target.value }))}
          style={{ width: 80, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }} />
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

function PersonaSection({ getValue, saveKey, saveKeyDebounced, fieldStatus, onPreset, presetContext }) {
  const [localName, setLocalName] = useState(getValue('seller_name') || '');
  const [hoveredPreset, setHoveredPreset] = useState(null);
  useEffect(() => { setLocalName(getValue('seller_name') || ''); }, [getValue('seller_name')]);

  const currentStyle = getValue('sales_style_preset');
  const activePresetKey = Object.entries(PRESETS).find(([, p]) => p.keys.sales_style_preset === currentStyle)?.[0] ?? null;

  return (
    <div>
      <Card>
        <Label tooltip="Один клик — все настройки применятся сразу. Можно отменить кнопкой вверху.">Быстрый старт</Label>
        <Hint>Выбери готовый стиль продавца</Hint>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(PRESETS).map(([key, preset]) => {
            const isActive = activePresetKey === key;
            const isHover = hoveredPreset === key;
            return (
              <button
                key={key}
                onClick={() => onPreset(key)}
                onMouseEnter={() => setHoveredPreset(key)}
                onMouseLeave={() => setHoveredPreset(null)}
                style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: isActive ? '2px solid var(--accent,#6366f1)' : isHover ? '2px solid rgba(99,102,241,0.4)' : '2px solid var(--border)',
                  background: isActive ? 'rgba(99,102,241,0.07)' : isHover ? 'rgba(99,102,241,0.03)' : 'var(--bg)',
                  boxShadow: isActive ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  textAlign: 'left',
                  minWidth: 140,
                  transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, color: isActive ? 'var(--accent,#6366f1)' : 'var(--text)' }}>{preset.label}</span>
                  {isActive && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: 'var(--accent,#6366f1)', background: 'rgba(99,102,241,0.12)', borderRadius: 999, padding: '2px 7px' }}>
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Активно
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{preset.description}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <Label tooltip="Имя используется в подписи и в промпте AI">Имя продавца</Label>
        <Hint>Пример: Анна, Алексей, Менеджер</Hint>
        <TextInput value={localName} onChange={setLocalName} onBlur={v => saveKeyDebounced('seller_name', 'value', v, 400)} placeholder="Введите имя" fieldKey="seller_name" fieldStatus={fieldStatus} />
      </Card>

      <Card>
        <Label>Пол</Label>
        <Select value={getValue('seller_gender')} onChange={v => saveKey('seller_gender', 'value', v)} options={[{ value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }, { value: 'neutral', label: 'Нейтральный' }]} fieldKey="seller_gender" fieldStatus={fieldStatus} />
      </Card>

      <Card>
        <Label tooltip="Влияет на все сообщения AI клиенту">Обращение к клиенту</Label>
        <div style={{ display: 'flex', gap: 10 }}>
          {[{ value: 'ты', label: 'На ты', hint: 'Неформально' }, { value: 'вы', label: 'На вы', hint: 'Официально' }].map(opt => {
            const active = getValue('seller_address_format') === opt.value;
            return (
              <button key={opt.value} onClick={() => saveKey('seller_address_format', 'value', opt.value)} style={{ flex: 1, padding: '12px 16px', borderRadius: 10, border: `2px solid ${active ? 'var(--accent,#6366f1)' : 'var(--border)'}`, background: active ? 'rgba(99,102,241,0.08)' : 'var(--bg)', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent,#6366f1)' : 'var(--text)' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{opt.hint}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card presetKey="sales_style_preset" presetContext={presetContext}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Label tooltip="Определяет общий тон всех сообщений AI">Стиль общения</Label>
          <PresetBadge presetContext={presetContext} fieldKey="sales_style_preset" />
        </div>
        <Select value={getValue('sales_style_preset')} onChange={v => saveKey('sales_style_preset', 'value', v)} options={[{ value: 'friendly', label: 'Дружелюбный' }, { value: 'confident', label: 'Уверенный' }, { value: 'aggressive', label: 'Напористый' }, { value: 'premium', label: 'Премиум' }, { value: 'closer', label: 'Closer (Продажа без трения)' }]} fieldKey="sales_style_preset" fieldStatus={fieldStatus} />
      </Card>
    </div>
  );
}

// ─── 2. Продажи ────────────────────────────────────────────────────────────

function SalesSection({ getValue, getEnabled, saveKey, saveKeyDebounced, fieldStatus, presetContext }) {
  const [pushText, setPushText] = useState(getValue('speech_pushdown') || '');
  const [upsellText, setUpsellText] = useState(getValue('upsell_hint') || '');
  useEffect(() => { setPushText(getValue('speech_pushdown') || ''); }, [getValue('speech_pushdown')]);
  useEffect(() => { setUpsellText(getValue('upsell_hint') || ''); }, [getValue('upsell_hint')]);

  return (
    <div>
      <Card presetKey="toggle_pushdown" presetContext={presetContext}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div>
              <Label tooltip="AI отправит фразу дожима если клиент долго не отвечает на предложение">Дожим клиента</Label>
              <Hint>Напоминает о незавершённом заказе</Hint>
            </div>
            <PresetBadge presetContext={presetContext} fieldKey="toggle_pushdown" />
          </div>
          <Toggle value={getEnabled('toggle_pushdown')} onChange={() => saveKey('toggle_pushdown', 'enabled', !getEnabled('toggle_pushdown'))} fieldKey="toggle_pushdown" fieldStatus={fieldStatus} />
        </div>
        {getEnabled('toggle_pushdown') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Фраза дожима <span style={{ color: 'var(--accent,#6366f1)', fontFamily: 'monospace', fontSize: 10 }}>{'{{product}}'}, {'{{price}}'}</span></div>
            <Textarea value={pushText} onChange={setPushText} onBlur={v => saveKeyDebounced('speech_pushdown', 'value', v)} rows={2} fieldKey="speech_pushdown" fieldStatus={fieldStatus} showVars />
          </div>
        )}
      </Card>

      <Card presetKey="toggle_reminders" presetContext={presetContext}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div>
              <Label tooltip="Отправляет напоминания через 1ч, 24ч и 3 дня если клиент замолчал">Автонапоминания</Label>
              <Hint>Пишет сам если клиент не отвечает</Hint>
            </div>
            <PresetBadge presetContext={presetContext} fieldKey="toggle_reminders" />
          </div>
          <Toggle value={getEnabled('toggle_reminders')} onChange={() => saveKey('toggle_reminders', 'enabled', !getEnabled('toggle_reminders'))} fieldKey="toggle_reminders" fieldStatus={fieldStatus} />
        </div>
        {getEnabled('toggle_reminders') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {[['nudge_payment_1h', 'Ждёт оплаты — 1 час'], ['nudge_form_1h', 'Ждёт данных — 1 час'], ['nudge_size_1h', 'Ждёт размера — 1 час']].map(([key, label]) => (
              <div key={key}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
                <Textarea value={getValue(key)} onChange={() => {}} onBlur={v => saveKeyDebounced(key, 'value', v)} rows={2} fieldKey={key} fieldStatus={fieldStatus} showVars />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card presetKey="toggle_upsell" presetContext={presetContext}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div>
              <Label tooltip="Если клиент смотрит дешёвый товар — AI предложит более дорогой вариант">Предлагать дороже (Upsell)</Label>
              <Hint>Увеличивает средний чек</Hint>
            </div>
            <PresetBadge presetContext={presetContext} fieldKey="toggle_upsell" />
          </div>
          <Toggle value={getEnabled('toggle_upsell')} onChange={() => saveKey('toggle_upsell', 'enabled', !getEnabled('toggle_upsell'))} fieldKey="toggle_upsell" fieldStatus={fieldStatus} />
        </div>
        {getEnabled('toggle_upsell') && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Фраза предложения</div>
            <Textarea value={upsellText} onChange={setUpsellText} onBlur={v => saveKeyDebounced('upsell_hint', 'value', v)} rows={2} fieldKey="upsell_hint" fieldStatus={fieldStatus} showVars />
          </div>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <Label tooltip="AI напишет клиентам которые не покупали более 30 дней">Возвращать старых клиентов</Label>
            <Hint>Реактивация неактивных покупателей</Hint>
          </div>
          <Toggle value={getEnabled('toggle_repeat_sales')} onChange={() => saveKey('toggle_repeat_sales', 'enabled', !getEnabled('toggle_repeat_sales'))} fieldKey="toggle_repeat_sales" fieldStatus={fieldStatus} />
        </div>
      </Card>
    </div>
  );
}

// ─── 3. Автоматика ─────────────────────────────────────────────────────────

function AutomationSection({ getValue, getEnabled, saveKey, saveKeyDebounced, fieldStatus, presetContext }) {
  const [keywords, setKeywords] = useState(getValue('manager_threshold_keywords') || '');
  useEffect(() => { setKeywords(getValue('manager_threshold_keywords') || ''); }, [getValue('manager_threshold_keywords')]);

  return (
    <div>
      <Card>
        <Label tooltip="AI запоминает размер, адрес, предпочтения — не переспрашивает при следующем заказе">Память о клиенте</Label>
        <Hint>Не спрашивает одно и то же дважды</Hint>
        <Toggle value={getEnabled('toggle_memory')} onChange={() => saveKey('toggle_memory', 'enabled', !getEnabled('toggle_memory'))} label={getEnabled('toggle_memory') ? 'Включено' : 'Выключено'} fieldKey="toggle_memory" fieldStatus={fieldStatus} />
      </Card>

      <Card>
        <Label tooltip="При жалобе, возврате или ключевых словах — AI передаёт диалог менеджеру">Передача менеджеру</Label>
        <Hint>Срабатывает при жалобах и сложных вопросах</Hint>
        <Toggle value={getEnabled('rule_low_confidence_fallback')} onChange={() => saveKey('rule_low_confidence_fallback', 'enabled', !getEnabled('rule_low_confidence_fallback'))} label={getEnabled('rule_low_confidence_fallback') ? 'Включено' : 'Выключено'} fieldKey="rule_low_confidence_fallback" fieldStatus={fieldStatus} />
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Ключевые слова (через запятую)</div>
          <Textarea value={keywords} onChange={setKeywords} onBlur={v => saveKeyDebounced('manager_threshold_keywords', 'value', v)} rows={2} fieldKey="manager_threshold_keywords" fieldStatus={fieldStatus} />
        </div>
      </Card>

      <Card presetKey="toggle_anti_repeat" presetContext={presetContext}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Label tooltip="Сравнивает новый ответ с предыдущими — блокирует если слишком похожи">Защита от повторов</Label>
          <PresetBadge presetContext={presetContext} fieldKey="toggle_anti_repeat" />
        </div>
        <Hint>AI не пишет одно и то же дважды подряд</Hint>
        <Toggle value={getEnabled('toggle_anti_repeat')} onChange={() => saveKey('toggle_anti_repeat', 'enabled', !getEnabled('toggle_anti_repeat'))} label={getEnabled('toggle_anti_repeat') ? 'Включено' : 'Выключено'} fieldKey="toggle_anti_repeat" fieldStatus={fieldStatus} />
      </Card>

      <Card>
        <Label tooltip="Перед отправкой AI проверяет ответ на шаблонные фразы и технические слова">Проверка перед отправкой</Label>
        <Hint>Блокирует шаблонные и технические ответы</Hint>
        <Toggle value={getEnabled('toggle_self_check')} onChange={() => saveKey('toggle_self_check', 'enabled', !getEnabled('toggle_self_check'))} label={getEnabled('toggle_self_check') ? 'Включено' : 'Выключено'} fieldKey="toggle_self_check" fieldStatus={fieldStatus} />
      </Card>
    </div>
  );
}

// ─── 4. Расписание ─────────────────────────────────────────────────────────

// ─── Payment Section ────────────────────────────────────────────────────────

function PaymentSection() {
  const [form, setForm] = useState({ payment_card_number: '', payment_name: '', payment_bank_name: '', payment_receiver_name: '' });
  const [showCard, setShowCard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getSettings().then(data => {
      setForm({
        payment_card_number: data.payment_card_number || '',
        payment_name: data.payment_name || '',
        payment_bank_name: data.payment_bank_name || '',
        payment_receiver_name: data.payment_receiver_name || '',
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function save() {
    if (!form.payment_card_number) {
      setStatus({ type: 'error', text: 'Номер карты обязателен' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await api.saveSettings([
        { key: 'payment_card_number', value: form.payment_card_number },
        { key: 'payment_name', value: form.payment_name },
        { key: 'payment_bank_name', value: form.payment_bank_name },
        { key: 'payment_receiver_name', value: form.payment_receiver_name },
      ]);
      setStatus({ type: 'success', text: 'Сохранено' });
      setTimeout(() => setStatus(null), 3000);
    } catch (e) {
      setStatus({ type: 'error', text: 'Ошибка сохранения' });
    }
    setSaving(false);
  }

  function maskCard(num) {
    const clean = (num || '').replace(/\s/g, '');
    if (clean.length < 4) return clean || '•••• •••• •••• ••••';
    return '•••• •••• •••• ' + clean.slice(-4);
  }

  function copyCard() {
    navigator.clipboard.writeText(form.payment_card_number).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!loaded) return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>Загрузка...</div>;

  return (
    <div>
      <Card>
        <Label tooltip="Номер карты для приёма оплаты от клиентов">Номер карты</Label>
        <Hint>Обязательное поле — без него AI не отправит реквизиты</Hint>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type={showCard ? 'text' : 'password'}
              value={form.payment_card_number}
              onChange={e => setForm(f => ({ ...f, payment_card_number: e.target.value }))}
              placeholder="0000 0000 0000 0000"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'monospace' }}
            />
          </div>
          <button onClick={() => setShowCard(v => !v)} title={showCard ? 'Скрыть' : 'Показать'} style={{ padding: '7px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
            {showCard ? '🙈' : '👁'}
          </button>
          <button onClick={copyCard} title="Копировать" style={{ padding: '7px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, color: copied ? '#22c55e' : 'var(--text-secondary)' }}>
            {copied ? '✓' : '📋'}
          </button>
        </div>
        {!showCard && form.payment_card_number && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'monospace' }}>{maskCard(form.payment_card_number)}</div>
        )}
      </Card>

      <Card>
        <Label tooltip="Название банка (необязательно)">Банк</Label>
        <TextInput value={form.payment_bank_name} onChange={v => setForm(f => ({ ...f, payment_bank_name: v }))} placeholder="Сбербанк / Тинькофф / ВТБ" />
      </Card>

      <Card>
        <Label tooltip="Имя получателя платежа">Получатель</Label>
        <TextInput value={form.payment_receiver_name} onChange={v => setForm(f => ({ ...f, payment_receiver_name: v }))} placeholder="Иван И." />
      </Card>

      {status && (
        <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 8, fontSize: 13,
          background: status.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          color: status.type === 'success' ? '#16a34a' : '#ef4444' }}>
          {status.text}
        </div>
      )}

      <button onClick={save} disabled={saving} style={{ padding: '8px 20px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>

      <Card style={{ marginTop: 16, background: 'transparent', border: '1px dashed var(--border)' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          <b>Как работает:</b> когда клиент доходит до оплаты, AI автоматически отправляет реквизиты. Если карта не заполнена — AI попросит связаться с менеджером.
        </div>
      </Card>
    </div>
  );
}

function ScheduleSection({ getValue, getEnabled, saveKey, saveKeyDebounced, fieldStatus }) {
  const [fallback, setFallback] = useState(getValue('ai_schedule_fallback') || '');
  useEffect(() => { setFallback(getValue('ai_schedule_fallback') || ''); }, [getValue('ai_schedule_fallback')]);

  const scheduleOn = getEnabled('ai_schedule_enabled');
  const start = getValue('ai_schedule_start') || '09:00';
  const end = getValue('ai_schedule_end') || '22:00';

  // Compute current Moscow status (client-side approximation, UTC+3)
  function getMoscowStatus() {
    if (!scheduleOn) return 'off';
    const now = new Date();
    const moscowOffset = 3 * 60; // UTC+3
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const moscowMin = (utcMin + moscowOffset) % (24 * 60);
    const parseHHMM = (t) => { const [h, m] = (t || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    const s = parseHHMM(start), e = parseHHMM(end);
    const inRange = s <= e ? (moscowMin >= s && moscowMin < e) : (moscowMin >= s || moscowMin < e);
    return inRange ? 'active' : 'inactive';
  }

  const moscowStatus = getMoscowStatus();

  const statusBadge = {
    off:      { text: 'AI работает круглосуточно', color: 'var(--text-secondary)', bg: 'transparent', border: '1px dashed var(--border)' },
    active:   { text: `Сейчас рабочее время (${start}–${end})`, color: '#16a34a', bg: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' },
    inactive: { text: `AI вне рабочего времени (${start}–${end})`, color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' },
  }[moscowStatus];

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <Label tooltip="AI будет отвечать только в указанные часы. Вне расписания — отправит сообщение ниже.">Ограничить время работы</Label>
            <Hint>AI отвечает только в рабочие часы (по Москве, UTC+3)</Hint>
          </div>
          <Toggle value={scheduleOn} onChange={() => saveKey('ai_schedule_enabled', 'enabled', !scheduleOn)} fieldKey="ai_schedule_enabled" fieldStatus={fieldStatus} />
        </div>
        {scheduleOn && (
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Начало работы</div>
              <TextInput value={start} onChange={() => {}} onBlur={v => saveKey('ai_schedule_start', 'value', v)} placeholder="09:00" fieldKey="ai_schedule_start" fieldStatus={fieldStatus} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Конец работы</div>
              <TextInput value={end} onChange={() => {}} onBlur={v => saveKey('ai_schedule_end', 'value', v)} placeholder="22:00" fieldKey="ai_schedule_end" fieldStatus={fieldStatus} />
            </div>
          </div>
        )}
      </Card>

      {/* Status badge — 3 clear states */}
      <Card style={{ background: statusBadge.bg, border: statusBadge.border }}>
        <div style={{ textAlign: 'center', color: statusBadge.color, fontSize: 13, padding: '6px 0', fontWeight: 500 }}>
          {statusBadge.text}
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
          Все время указано по Москве (UTC+3)
        </div>
        {scheduleOn && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
            Напоминания отправляются независимо от расписания
          </div>
        )}
      </Card>

      {scheduleOn && (
        <Card>
          <Label tooltip="Клиент получит это сообщение если напишет вне рабочего времени">Сообщение вне расписания</Label>
          <Hint>Пример: Мы работаем с 9 до 22. Напишем утром!</Hint>
          <Textarea value={fallback} onChange={setFallback} onBlur={v => saveKeyDebounced('ai_schedule_fallback', 'value', v)} rows={3} fieldKey="ai_schedule_fallback" fieldStatus={fieldStatus} />
        </Card>
      )}
    </div>
  );
}

// ─── 5. Продвинуто ─────────────────────────────────────────────────────────

function AdvancedSection({ settings, getValue, getEnabled, saveKey, saveKeyDebounced, fieldStatus }) {
  const [openGroup, setOpenGroup] = useState(null);
  const [search, setSearch] = useState('');

  const groups = [
    { id: 'prompts', label: 'Промпты AI', keys: ['prompt_core_prompt', 'prompt_sales_prompt', 'prompt_followup_prompt'], hint: 'Системные инструкции' },
    { id: 'scenarios', label: 'Сценарии речи', keys: ['speech_greeting', 'speech_ask_size', 'speech_ask_address', 'speech_payment_request', 'speech_payment_confirm', 'speech_pushdown', 'speech_repeat_sale'], hint: 'Тексты для ситуаций' },
    { id: 'fallback', label: 'Запасные ответы', keys: ['fallback_general_1', 'fallback_general_2', 'fallback_blocked_1', 'fallback_ai_down_1'], hint: 'Если AI не справился' },
    { id: 'ab_tests', label: 'A/B тесты', keys: ['ab_pushdown_a', 'ab_pushdown_b', 'ab_greeting_a', 'ab_greeting_b', 'ab_upsell_a', 'ab_upsell_b'], hint: 'Варианты фраз' },
    { id: 'heat', label: 'Активность клиента', keys: ['heat_hot_hint', 'heat_warm_hint', 'heat_cold_hint'], hint: 'По активности' },
    { id: 'segments', label: 'Сегменты', keys: ['segment_new_hint', 'segment_returning_hint', 'segment_vip_hint', 'segment_returning_greeting', 'segment_vip_greeting'], hint: 'Новые / VIP' },
  ];

  function getAllItems() {
    const result = [];
    for (const cat of Object.values(settings)) {
      for (const item of (cat || [])) result.push(item);
    }
    return result;
  }

  function getItemsByKeys(keys) {
    const all = getAllItems();
    return keys.map(k => all.find(i => i.key === k)).filter(Boolean);
  }

  const searchLower = search.toLowerCase();
  const filteredGroups = search
    ? groups.map(g => ({ ...g, items: getItemsByKeys(g.keys).filter(i => i.key.includes(searchLower) || (i.label || '').toLowerCase().includes(searchLower) || (i.value || '').toLowerCase().includes(searchLower)) })).filter(g => g.items.length > 0)
    : groups.map(g => ({ ...g, items: getItemsByKeys(g.keys) }));

  function renderItem(item) {
    return (
      <div key={item.key}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label || item.key}</span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{item.key}</span>
        </div>
        {item.description && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{item.description}</div>}
        {(item.type === 'textarea' || !item.type) && item.value !== undefined && (
          <Textarea value={item.value} onChange={() => {}} onBlur={v => saveKeyDebounced(item.key, 'value', v)} rows={item.key.includes('prompt') ? 8 : 3} fieldKey={item.key} fieldStatus={fieldStatus} showVars />
        )}
        {item.type === 'text' && (
          <TextInput value={item.value} onChange={() => {}} onBlur={v => saveKeyDebounced(item.key, 'value', v)} fieldKey={item.key} fieldStatus={fieldStatus} />
        )}
        {item.type === 'toggle' && (
          <Toggle value={item.enabled !== false} onChange={() => saveKey(item.key, 'enabled', item.enabled === false)} label={item.enabled !== false ? 'Включено' : 'Выключено'} fieldKey={item.key} fieldStatus={fieldStatus} />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск настройки..." style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
      </div>

      {search && filteredGroups.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, padding: 20 }}>Ничего не найдено</div>
      )}

      {search ? (
        filteredGroups.map(g => (
          <Card key={g.id}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{g.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{g.items.map(renderItem)}</div>
          </Card>
        ))
      ) : (
        filteredGroups.map(group => (
          <div key={group.id} style={{ marginBottom: 8 }}>
            <button onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--card-bg, var(--bg-secondary))', border: '1px solid var(--border)', borderRadius: openGroup === group.id ? '10px 10px 0 0' : 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              <span>{group.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>{group.hint}</span>
                <span style={{ fontSize: 16, color: 'var(--text-secondary)', transform: openGroup === group.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
              </div>
            </button>
            {openGroup === group.id && (
              <div style={{ padding: 16, background: 'var(--card-bg, var(--bg-secondary))', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 10px 10px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {group.id === 'ab_tests' ? <ABTestsPanel items={group.items} saveKeyDebounced={saveKeyDebounced} fieldStatus={fieldStatus} /> : group.items.map(renderItem)}
              </div>
            )}
          </div>
        ))
      )}

      <div style={{ marginTop: 20 }}>
        <PreviewPanel />
      </div>
    </div>
  );
}

// ─── A/B Tests panel ───────────────────────────────────────────────────────

function ABTestsPanel({ items, saveKeyDebounced, fieldStatus }) {
  const pairs = [
    { label: 'Дожим', a: 'ab_pushdown_a', b: 'ab_pushdown_b' },
    { label: 'Приветствие', a: 'ab_greeting_a', b: 'ab_greeting_b' },
    { label: 'Upsell', a: 'ab_upsell_a', b: 'ab_upsell_b' },
  ];
  function getItem(key) { return items.find(i => i.key === key); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '6px 10px', background: 'rgba(99,102,241,0.06)', borderRadius: 6 }}>
        AI автоматически тестирует варианты A и B. Победитель выбирается по конверсии (разница от 5%, от 50 показов).
      </div>
      {pairs.map(pair => (
        <div key={pair.label}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{pair.label}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[{ key: pair.a, tag: 'A' }, { key: pair.b, tag: 'B' }].map(({ key, tag }) => {
              const item = getItem(key);
              return (
                <div key={key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Pill label={`Вариант ${tag}`} color={tag === 'A' ? 'blue' : 'green'} />
                  </div>
                  <Textarea value={item?.value || ''} onChange={() => {}} onBlur={v => saveKeyDebounced(key, 'value', v)} rows={3} fieldKey={key} fieldStatus={fieldStatus} showVars />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Real Preview Panel ────────────────────────────────────────────────────

function PreviewPanel() {
  const [message, setMessage] = useState('');
  const [userState, setUserState] = useState('NEW');
  const [segment, setSegment] = useState('new');
  const [heat, setHeat] = useState('warm');
  const [history, setHistory] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function run() {
    if (!message.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const data = await api.previewAiResponse(message, null, userState, { segment, heat, history: history.trim() ? history.split('\n').filter(Boolean) : [] });
      setResult(data);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  const sel = (val, onChange, opts) => (
    <select value={val} onChange={e => onChange(e.target.value)} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, flex: 1 }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <Card>
      <Label tooltip="Тест максимально близок к реальному ответу — учитывает этап, сегмент и активность клиента">Тест ответа AI</Label>
      <Hint>Введи сообщение и контекст — AI ответит как в реальном диалоге</Hint>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>Этап</div>
          {sel(userState, setUserState, [['NEW','Новый'],['WAITING_SIZE','Размер'],['WAITING_FORM','Данные'],['WAITING_PAYMENT','Оплата'],['PAID','Оплачено'],['DONE','Завершён']])}
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>Сегмент</div>
          {sel(segment, setSegment, [['new','Новый'],['returning','Повторный'],['vip','VIP']])}
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>Активность</div>
          {sel(heat, setHeat, [['hot','Горячий'],['warm','Тёплый'],['cold','Холодный']])}
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>История (по одному сообщению на строку, необязательно)</div>
        <textarea value={history} onChange={e => setHistory(e.target.value)} rows={2} placeholder="Клиент: хочу заказать&#10;AI: отлично, какой размер?" style={{ width: '100%', padding: '6px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>Сообщение клиента</div>
        <Textarea value={message} onChange={setMessage} rows={2} />
      </div>
      <button onClick={run} disabled={loading || !message.trim()} style={{ padding: '8px 18px', background: 'var(--accent,#6366f1)', color: '#fff', border: 'none', borderRadius: 8, cursor: loading || !message.trim() ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, opacity: loading || !message.trim() ? 0.6 : 1 }}>
        {loading ? 'Думаю...' : 'Как ответит AI'}
      </button>
      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444' }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Ответ AI</span>
            {result.passed === false && <Pill label="Safety gate" color="yellow" />}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.response}</div>
        </div>
      )}
    </Card>
  );
}
