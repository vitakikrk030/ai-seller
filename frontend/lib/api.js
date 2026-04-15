const API_BASE = '/api';

function getAuthHeader() {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

let _refreshing = null;

async function tryRefresh() {
  if (_refreshing) return _refreshing;
  _refreshing = (async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      localStorage.setItem('auth_token', data.token);
      if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

export async function fetchAPI(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    // Try refresh before giving up
    const refreshed = await tryRefresh();
    if (refreshed) {
      // Retry with new token
      const retry = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...options.headers },
        ...options,
      });
      if (retry.ok) return retry.json();
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  // Users
  getUsers: (search) =>
    fetchAPI(`/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getUser: (id) => fetchAPI(`/users/${id}`),
  toggleAI: (id, enabled) =>
    fetchAPI(`/users/${id}/ai`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  setAiMode: (id, mode) =>
    fetchAPI(`/users/${id}/ai-mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  setMode: (id, mode) =>
    fetchAPI(`/users/${id}/mode`, {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  updateState: (id, state) =>
    fetchAPI(`/users/${id}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }),
  deleteUser: (id) =>
    fetchAPI(`/users/${id}`, { method: 'DELETE' }),
  markRead: (id) =>
    fetchAPI(`/users/${id}/read`, { method: 'POST' }),
  getQuickReplies: (id) =>
    fetchAPI(`/users/${id}/quick-replies`),
  getMemory: (id) =>
    fetchAPI(`/users/${id}/memory`),
  updateMemory: (id, data) =>
    fetchAPI(`/users/${id}/memory`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Messages
  getMessages: (userId) => fetchAPI(`/users/${userId}/messages`),
  getMessagesPaginated: (userId, limit = 50, before = null) =>
    fetchAPI(`/users/${userId}/messages/paginated?limit=${limit}${before ? `&before=${before}` : ''}`),
  searchMessages: (userId, q) =>
    fetchAPI(`/users/${userId}/messages/search?q=${encodeURIComponent(q)}`),
  sendMessage: (userId, text) =>
    fetchAPI(`/users/${userId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  deleteMessage: (id) =>
    fetchAPI(`/messages/${id}`, { method: 'DELETE' }),
  editMessage: (id, text) =>
    fetchAPI(`/messages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    }),
  clearMessages: (userId) =>
    fetchAPI(`/users/${userId}/messages`, { method: 'DELETE' }),
  pinUser: (id, pinned) =>
    fetchAPI(`/users/${id}/pin`, {
      method: 'POST',
      body: JSON.stringify({ pinned }),
    }),
  setAttention: (id, needs_attention, reason) =>
    fetchAPI(`/users/${id}/attention`, {
      method: 'PATCH',
      body: JSON.stringify({ needs_attention, reason }),
    }),
  clearAttention: (id) =>
    fetchAPI(`/users/${id}/attention`, { method: 'DELETE' }),

  // Orders
  getUserOrders: (userId) => fetchAPI(`/users/${userId}/orders`),

  // Stats
  getStats: () => fetchAPI('/stats'),

  // Settings (integrations)
  getSettings: () => fetchAPI('/settings'),
  saveSettings: (entries) =>
    fetchAPI('/settings', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),
  testTelegram: () =>
    fetchAPI('/settings/test-telegram', { method: 'POST' }),
  testShop: () =>
    fetchAPI('/settings/test-shop', { method: 'POST' }),
  changeToken: (token, webhook_url) =>
    fetchAPI('/settings/change-token', {
      method: 'POST',
      body: JSON.stringify({ token, webhook_url }),
    }),
  disconnectBot: () =>
    fetchAPI('/settings/disconnect-bot', { method: 'POST' }),

  // Monitoring
  getMonitoringSummary: () => fetchAPI('/monitoring/summary'),

  // AI Settings
  getAiSettings: () => fetchAPI('/ai-settings'),
  updateAiSetting: (key, data) =>
    fetchAPI(`/ai-settings/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  bulkUpdateAiSettings: (entries) =>
    fetchAPI('/ai-settings/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries }),
    }),

  // AI Preview
  previewAiResponse: (message, scenario, userState) =>
    fetchAPI('/ai-settings/preview', {
      method: 'POST',
      body: JSON.stringify({ message, scenario, userState }),
    }),

  // Integrations status
  getIntegrationsStatus: () => fetchAPI('/integrations/status'),

  // Reset integration
  resetIntegration: (type) =>
    fetchAPI('/integrations/reset', {
      method: 'POST',
      body: JSON.stringify({ type }),
    }),

  // AI Usage
  getAiUsage: (days = 30) => fetchAPI(`/ai/usage?days=${days}`),

  // AI Provider test
  testAiProvider: (base_url, api_key) =>
    fetchAPI('/ai/test-provider', {
      method: 'POST',
      body: JSON.stringify({ base_url, api_key }),
    }),
};
