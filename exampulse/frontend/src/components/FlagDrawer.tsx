// Collusion Flag Detail Drawer for Invigilator Review
import React, { useState } from 'react';
import { api } from '../api/client';

interface FlagDrawerProps {
  flag: any | null;
  onClose: () => void;
  onStatusUpdate: (flagId: number, newStatus: string) => void;
}

export const FlagDrawer: React.FC<FlagDrawerProps> = ({ flag, onClose, onStatusUpdate }) => {
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');

  if (!flag) return null;

  const handleAction = async (action: 'REVIEWED' | 'DISMISSED' | 'ESCALATED') => {
    setSubmitting(true);
    try {
      const res = await api.fetch(`/api/dashboard/flags/${flag.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, notes }),
      });
      if (res.ok) {
        onStatusUpdate(flag.id, action);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reasons = Array.isArray(flag.reasons) ? flag.reasons : [];
  const linked = Array.isArray(flag.linked_candidates) ? flag.linked_candidates : [];

  return (
    <div className="drawer" role="dialog" aria-labelledby="flag-drawer-title" aria-modal="true">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 id="flag-drawer-title" style={{ fontSize: '1.25rem' }}>
          Collusion Review #{flag.id}
        </h2>
        <button className="btn btn-secondary" onClick={onClose} aria-label="Close drawer">
          ✕ Close
        </button>
      </div>

      <div style={{ padding: '12px', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '8px', marginBottom: '16px' }}>
        <p><strong>Candidate:</strong> {flag.name || `Candidate #${flag.candidate_id}`} ({flag.candidate_number})</p>
        <p><strong>Risk Score:</strong> <span style={{ color: 'var(--status-danger)', fontWeight: 'bold' }}>{(parseFloat(flag.risk_score || '0') * 100).toFixed(1)}%</span></p>
        <p><strong>Status:</strong> {flag.status}</p>
        <p><strong>Linked Peers:</strong> {linked.length > 0 ? linked.map((id: any) => `#${id}`).join(', ') : 'None'}</p>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '8px' }}>Explainable Evidence & Contributions</h3>
        {reasons.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No explicit risk contributors recorded.</p>
        ) : (
          reasons.map((r: any, idx: number) => (
            <div key={idx} style={{ marginBottom: '8px', padding: '8px', background: 'var(--bg-primary)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 'bold', fontSize: '13px' }}>{r.code}</span>
                <span style={{ color: 'var(--accent-primary)', fontSize: '12px' }}>+{r.contribution}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{r.description}</p>
            </div>
          ))
        )}
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="invigilator-notes" style={{ display: 'block', marginBottom: '6px', fontSize: '14px' }}>
          Invigilator Assessment Notes:
        </label>
        <textarea
          id="invigilator-notes"
          rows={3}
          style={{ width: '100%', padding: '8px', borderRadius: '6px', background: 'var(--bg-primary)', color: 'white', border: '1px solid var(--border-color)' }}
          placeholder="Document observed evidence, room checks, or rationale..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          className="btn"
          disabled={submitting}
          onClick={() => handleAction('REVIEWED')}
          style={{ backgroundColor: 'var(--status-success)' }}
        >
          ✓ Mark Reviewed (Safe)
        </button>
        <button
          className="btn btn-secondary"
          disabled={submitting}
          onClick={() => handleAction('DISMISSED')}
        >
          Dismiss False Positive
        </button>
        <button
          className="btn btn-danger"
          disabled={submitting}
          onClick={() => handleAction('ESCALATED')}
        >
          ⚠️ Escalate for Academic Audit
        </button>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '12px' }}>
        * Core Policy: AI flags are purely advisory for human invigilator review. No automatic grading penalties are ever applied.
      </p>
    </div>
  );
};
