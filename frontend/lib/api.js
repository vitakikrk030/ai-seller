const API_BASE = '/api';

function getAuthHeader() {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export async function fetchAPI(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
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
  updateState: (id, state) =>
    fetchAPI(`/users/${id}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }),

  // Messages
  getMessages: (userId) => fetchAPI(`/users/${userId}/messages`),
  sendMessage: (userId, text) =>
    fetchAPI(`/users/${userId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // Orders
  getOrders: () => fetchAPI('/orders'),
  getUserOrders: (userId) => fetchAPI(`/users/${userId}/orders`),
  updateOrderStatus: (id, status) =>
    fetchAPI(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Prompts
  getPrompts: () => fetchAPI('/prompts'),
  updatePrompt: (key, value) =>
    fetchAPI(`/prompts/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

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
};
