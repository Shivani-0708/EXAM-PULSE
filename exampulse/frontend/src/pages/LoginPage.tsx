// Login Page
import React, { useState } from 'react';
import { api } from '../api/client';

interface LoginPageProps {
  onLoginSuccess: (user: any) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('candidate1@exampulse.io');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReplacedNotice, setSessionReplacedNotice] = useState(false);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    setSessionReplacedNotice(false);

    try {
      const res = await api.fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, deviceInfo: navigator.userAgent }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Login failed');
        return;
      }

      api.setToken(data.token);
      if (data.replacedPreviousSession) {
        setSessionReplacedNotice(true);
      }
      onLoginSuccess(data.candidate);
    } catch (err: any) {
      setError(err.message || 'Network connection failed');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (userEmail: string) => {
    setEmail(userEmail);
    setPassword('password123');
  };

  return (
    <main className="container" style={{ maxWidth: '480px', marginTop: '60px' }}>
      <div style={{ backgroundColor: 'var(--bg-surface)', padding: '32px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '8px', color: 'var(--accent-primary)' }}>ExamPulse</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>
          Server-Authoritative Online Assessment Platform
        </p>

        {sessionReplacedNotice && (
          <div style={{ padding: '12px', backgroundColor: 'rgba(245, 158, 11, 0.2)', border: '1px solid var(--status-warning)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
            ⚠️ Notice: Active session replaced. Any prior login on another device has been signed out.
          </div>
        )}

        {error && (
          <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--status-danger)', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', color: 'var(--status-danger)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
              Institutional Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'white' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'white' }}
            />
          </div>

          <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Authenticating…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Demo Quick-Sign-In:</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => quickFill('candidate1@exampulse.io')}>
              Candidate 1
            </button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => quickFill('candidate2@exampulse.io')}>
              Candidate 2
            </button>
            <button type="button" className="btn btn-secondary" style={{ fontSize: '11px', padding: '4px 8px' }} onClick={() => quickFill('invigilator@exampulse.io')}>
              Invigilator Staff
            </button>
          </div>
        </div>
      </div>
    </main>
  );
};
