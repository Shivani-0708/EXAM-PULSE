// Root Application Component with Accessibility Controls & Routing
import React, { useState, useEffect } from 'react';
import { api } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { InstructionsPage } from './pages/InstructionsPage';
import { ExamPage } from './pages/ExamPage';
import { ReceiptPage } from './pages/ReceiptPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { DashboardPage } from './pages/DashboardPage';

type ViewMode = 'LOGIN' | 'INSTRUCTIONS' | 'EXAM' | 'RECEIPT' | 'LEADERBOARD' | 'DASHBOARD';

export const App: React.FC = () => {
  const [view, setView] = useState<ViewMode>('LOGIN');
  const [user, setUser] = useState<any | null>(null);
  const [attempt, setAttempt] = useState<any | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [textSize, setTextSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [sessionReplacedModal, setSessionReplacedModal] = useState<boolean>(false);

  // Load accessibility settings from localStorage
  useEffect(() => {
    const savedSize = (localStorage.getItem('exampulse_text_size') as any) || 'medium';
    const savedContrast = localStorage.getItem('exampulse_high_contrast') === 'true';
    setTextSize(savedSize);
    setHighContrast(savedContrast);
    document.documentElement.setAttribute('data-text-size', savedSize);
    document.documentElement.setAttribute('data-high-contrast', String(savedContrast));

    // Handle session replacement events
    api.onSessionReplaced(() => {
      setSessionReplacedModal(true);
    });
  }, []);

  const changeTextSize = (size: 'small' | 'medium' | 'large') => {
    setTextSize(size);
    localStorage.setItem('exampulse_text_size', size);
    document.documentElement.setAttribute('data-text-size', size);
  };

  const toggleHighContrast = () => {
    const next = !highContrast;
    setHighContrast(next);
    localStorage.setItem('exampulse_high_contrast', String(next));
    document.documentElement.setAttribute('data-high-contrast', String(next));
  };

  const handleLoginSuccess = (candidate: any) => {
    setUser(candidate);
    if (candidate.role === 'invigilator' || candidate.role === 'admin') {
      setView('DASHBOARD');
    } else {
      setView('INSTRUCTIONS');
    }
  };

  const handleStartExam = (attemptData: any) => {
    setAttempt(attemptData);
    setView('EXAM');
  };

  const handleSubmitSuccess = (receiptData: any) => {
    setReceipt(receiptData);
    setView('RECEIPT');
  };

  const handleLogout = () => {
    api.setToken(null);
    setUser(null);
    setAttempt(null);
    setReceipt(null);
    setView('LOGIN');
    setSessionReplacedModal(false);
  };

  return (
    <div>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Global Top Nav with Accessibility Controls */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
            ExamPulse
          </span>
          {user && (
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Logged in as {user.name} ({user.role})
            </span>
          )}
        </div>

        <div className="accessibility-controls" aria-label="Accessibility settings">
          <div style={{ display: 'flex', gap: '4px' }} role="group" aria-label="Adjust font size">
            <button
              type="button"
              className={`btn btn-secondary ${textSize === 'small' ? 'active' : ''}`}
              style={{ padding: '4px 8px', fontSize: '12px' }}
              onClick={() => changeTextSize('small')}
              aria-label="Small font size"
            >
              A-
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${textSize === 'medium' ? 'active' : ''}`}
              style={{ padding: '4px 8px', fontSize: '14px' }}
              onClick={() => changeTextSize('medium')}
              aria-label="Default font size"
            >
              A
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${textSize === 'large' ? 'active' : ''}`}
              style={{ padding: '4px 8px', fontSize: '16px' }}
              onClick={() => changeTextSize('large')}
              aria-label="Large font size"
            >
              A+
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '6px 10px' }}
            onClick={toggleHighContrast}
            aria-pressed={highContrast}
          >
            {highContrast ? 'Normal Contrast' : 'High Contrast'}
          </button>

          {user && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '6px 10px' }}
              onClick={handleLogout}
            >
              Sign Out
            </button>
          )}
        </div>
      </header>

      {/* View Router */}
      <div id="main-content">
        {view === 'LOGIN' && <LoginPage onLoginSuccess={handleLoginSuccess} />}
        {view === 'INSTRUCTIONS' && user && (
          <InstructionsPage candidate={user} onStartExam={handleStartExam} />
        )}
        {view === 'EXAM' && user && attempt && (
          <ExamPage candidate={user} attempt={attempt} onSubmitSuccess={handleSubmitSuccess} />
        )}
        {view === 'RECEIPT' && user && receipt && (
          <ReceiptPage candidate={user} receipt={receipt} onViewLeaderboard={() => setView('LEADERBOARD')} />
        )}
        {view === 'LEADERBOARD' && user && (
          <LeaderboardPage candidate={user} onBackToExam={receipt ? undefined : () => setView('EXAM')} />
        )}
        {view === 'DASHBOARD' && user && (
          <DashboardPage staffUser={user} onLogout={handleLogout} />
        )}
      </div>

      {/* Single Active Session Replaced Alert Modal */}
      {sessionReplacedModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="session-title">
          <div className="modal-content">
            <h2 id="session-title" style={{ color: 'var(--status-danger)', marginBottom: '12px' }}>
              ⚠️ Session Terminated
            </h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px', lineHeight: '1.6' }}>
              Your active exam session was terminated because a new login was initiated from another device or browser.
              To maintain academic integrity, ExamPulse enforces strictly one active session per candidate.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-danger" onClick={handleLogout}>
                Return to Login
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
