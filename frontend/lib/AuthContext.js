'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext({ token: null, login: () => {}, logout: () => {}, loading: true });

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('auth_token');
    if (saved) {
      // Verify token is still valid
      fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${saved}` },
      })
        .then((res) => {
          if (res.ok) {
            setToken(saved);
          } else {
            localStorage.removeItem('auth_token');
          }
        })
        .catch(() => {
          localStorage.removeItem('auth_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  function login(newToken, newRefreshToken) {
    localStorage.setItem('auth_token', newToken);
    if (newRefreshToken) localStorage.setItem('refresh_token', newRefreshToken);
    setToken(newToken);
  }

  function logout() {
    // Best-effort server-side revocation
    const t = localStorage.getItem('auth_token');
    const rt = localStorage.getItem('refresh_token');
    if (t) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ refreshToken: rt || undefined }),
      }).catch(() => {});
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    setToken(null);
  }

  return (
    <AuthContext.Provider value={{ token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
