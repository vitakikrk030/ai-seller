'use client';

import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', padding: '2rem',
          color: 'var(--text)', background: 'var(--bg)',
        }}>
          <h2 style={{ marginBottom: '0.5rem' }}>Что-то пошло не так</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Произошла непредвиденная ошибка интерфейса.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '0.5rem 1.5rem', borderRadius: '8px',
              background: 'var(--accent)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: '0.9rem',
            }}
          >
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
