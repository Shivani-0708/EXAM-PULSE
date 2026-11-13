// Instructions Page
import React, { useState } from 'react';
import { api } from '../api/client';

interface InstructionsPageProps {
  candidate: any;
  onStartExam: (attemptData: any) => void;
}

export const InstructionsPage: React.FC<InstructionsPageProps> = ({ candidate, onStartExam }) => {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setStarting(true);
    setError(null);

    try {
      // First ensure NTP clock is synced
      await api.syncServerTime(3);

      const res = await api.fetch('/api/exam/1/start', {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setError(`Traffic rate limit active. Please retry in ${Math.ceil((data.retryAfterMs || 1000) / 1000)} seconds.`);
        } else {
          setError(data.message || 'Failed to start exam');
        }
        return;
      }

      onStartExam(data);
    } catch (err: any) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="container" style={{ maxWidth: '800px', marginTop: '40px' }}>
      <div style={{ backgroundColor: 'var(--bg-surface)', padding: '32px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '8px' }}>
          CS401: Distributed Systems Final Examination
        </h1>
        <p style={{ color: 'var(--accent-primary)', marginBottom: '24px', fontWeight: 'bold' }}>
          Candidate: {candidate.name} ({candidate.candidateNumber})
        </p>

        {error && (
          <div style={{ padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--status-danger)', borderRadius: '6px', marginBottom: '16px', color: 'var(--status-danger)' }}>
            {error}
          </div>
        )}

        <section aria-labelledby="rules-heading" style={{ marginBottom: '24px' }}>
          <h2 id="rules-heading" style={{ fontSize: '1.2rem', marginBottom: '12px' }}>Examination Protocols</h2>
          <ul style={{ paddingLeft: '20px', lineHeight: '1.8', color: 'var(--text-muted)' }}>
            <li><strong>Authoritative Timer:</strong> The examination countdown is enforced strictly on the server via Redis TIME. Modifying local device clocks has no effect.</li>
            <li><strong>Single Active Session:</strong> You may only access this examination from one device. Logging in elsewhere will immediately invalidate this session.</li>
            <li><strong>Autosave & Durability:</strong> Answers are automatically synchronized to Redis and acknowledged with replica confirmation. Status shows "Saved" only after server confirmation.</li>
            <li><strong>Final Submission:</strong> Final submission is strictly idempotent. Once submitted, your answers cannot be altered.</li>
            <li><strong>Keyboard Accessibility:</strong> Use <kbd>Alt + N</kbd> for Next question, <kbd>Alt + P</kbd> for Previous question, and <kbd>Alt + M</kbd> to Mark for Review.</li>
          </ul>
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            type="button"
            className="btn"
            style={{ padding: '12px 28px', fontSize: '16px' }}
            disabled={starting}
            onClick={handleStart}
          >
            {starting ? 'Initializing Attempt…' : 'I Understand, Begin Exam →'}
          </button>
        </div>
      </div>
    </main>
  );
};
