const API_BASE = '/api';

async function fetchAPI(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    let payload = null;
    try { payload = await res.json(); } catch {}
    throw new Error(payload?.error || `API error: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getUsers: () => fetchAPI('/users'),
  getMessages: (userId) => fetchAPI(`/users/${userId}/messages`),
};
