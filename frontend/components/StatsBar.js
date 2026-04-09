'use client';

import { useState, useEffect } from 'react';
import { Users, Package, MessageSquare, ShoppingBag } from 'lucide-react';
import { api } from '../lib/api';

export default function StatsBar() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (e) {}
  }

  if (!stats) return null;

  return (
    <div className="nav-stats">
      <span className="nav-stat"><Users size={13} /> {stats.users}</span>
      <span className="nav-stat"><Package size={13} /> {stats.orders}</span>
      <span className="nav-stat"><MessageSquare size={13} /> {stats.messages}</span>
      <span className="nav-stat"><ShoppingBag size={13} /> {stats.todayOrders}</span>
    </div>
  );
}
