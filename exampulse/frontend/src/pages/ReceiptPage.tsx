// Submission Receipt Page
import React from 'react';

interface ReceiptPageProps {
  receipt: any;
  candidate: any;
  onViewLeaderboard: () => void;
}

export const ReceiptPage: React.FC<ReceiptPageProps> = ({ receipt, candidate, onViewLeaderboard }) => {
  return (
    <main className="container" style={{ maxWidth: '650px', marginTop: '60px' }}>
      <div style={{ backgroundColor: 'var(--bg-surface)', padding: '36px', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {receipt.status === 'SUBMITTED' ? '🎉' : '⚠️'}
        </div>

        <h1 style={{ fontSize: '1.75rem', marginBottom: '8px' }}>
          {receipt.status === 'SUBMITTED' ? 'Submission Acknowledged' : 'Submission Rejected Late'}
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          Official server-verified assessment receipt
        </p>

        <div style={{ backgroundColor: 'var(--bg-primary)', padding: '20px', borderRadius: '8px', textAlign: 'left', marginBottom: '24px', fontSize: '14px', lineHeight: '1.8' }}>
          <p><strong>Candidate:</strong> {candidate.name} ({candidate.candidateNumber})</p>
          <p><strong>Outcome Status:</strong> <span style={{ color: receipt.status === 'SUBMITTED' ? 'var(--status-success)' : 'var(--status-danger)', fontWeight: 'bold' }}>{receipt.status}</span></p>
          <p><strong>Server Timestamp:</strong> {new Date(receipt.submittedAt).toUTCString()} ({receipt.submittedAt})</p>
          <p><strong>Duration Taken:</strong> {Math.floor((receipt.secondsTaken || 0) / 60)}m {(receipt.secondsTaken || 0) % 60}s</p>
          <p><strong>Answer Snapshot Hash:</strong> <code style={{ color: 'var(--accent-primary)', fontSize: '12px' }}>{receipt.snapshotHash}</code></p>
          <p><strong>Idempotency Key:</strong> <code style={{ fontSize: '12px' }}>{receipt.idempotencyKey}</code></p>
          <p><strong>Answers Recorded:</strong> {receipt.answeredCount || 0}</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
          <button type="button" className="btn" onClick={onViewLeaderboard}>
            View Live Leaderboard →
          </button>
        </div>
      </div>
    </main>
  );
};
