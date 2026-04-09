'use client';

import { useState, useEffect } from 'react';
import { Check, Save } from 'lucide-react';
import { api } from '../lib/api';

export default function SettingsView() {
  const [prompts, setPrompts] = useState([]);
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    loadPrompts();
  }, []);

  async function loadPrompts() {
    try {
      const data = await api.getPrompts();
      setPrompts(data);
    } catch (e) {
      console.error(e);
    }
  }

  async function savePrompt(key, value) {
    setSaving(key);
    try {
      await api.updatePrompt(key, value);
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      console.error(e);
    }
    setSaving(null);
  }

  function updateLocal(key, value) {
    setPrompts((prev) =>
      prev.map((p) => (p.key === key ? { ...p, value } : p))
    );
  }

  const promptLabels = {
    core_prompt: 'Основной промпт (личность AI)',
    sales_prompt: 'Промпт продаж (логика продаж)',
    followup_prompt: 'Промпт реактивации (возврат клиентов)',
  };

  return (
    <div className="settings-page">
      <h2>Настройки AI</h2>

      {prompts.map((p) => (
        <div key={p.key} className="prompt-editor">
          <label>{promptLabels[p.key] || p.key}</label>
          <textarea
            value={p.value}
            onChange={(e) => updateLocal(p.key, e.target.value)}
          />
          <div className="prompt-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={() => savePrompt(p.key, p.value)}
              disabled={saving === p.key}
            >
              <Save size={13} />
              {saving === p.key ? 'Сохраняю...' : 'Сохранить'}
            </button>
            {saved === p.key && (
              <span className="saved-indicator"><Check size={14} /> Сохранено</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
