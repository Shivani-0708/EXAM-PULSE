// Accessible Autosave Status Indicator Component
import React from 'react';
import { AutosaveState } from '../hooks/useOfflineQueue';

interface AutosaveStatusProps {
  status: AutosaveState;
  lastSavedTime: string | null;
  pendingCount: number;
}

export const AutosaveStatus: React.FC<AutosaveStatusProps> = ({ status, lastSavedTime, pendingCount }) => {
  let content = null;
  let statusClass = 'autosave-saved';

  switch (status) {
    case 'SAVING':
      statusClass = 'autosave-saving';
      content = (
        <>
          <span aria-hidden="true">🔄</span>
          <span>Saving answers to server…</span>
        </>
      );
      break;

    case 'OFFLINE_PENDING':
      statusClass = 'autosave-offline';
      content = (
        <>
          <span aria-hidden="true">⚠️</span>
          <span>Offline: {pendingCount} change{pendingCount === 1 ? '' : 's'} buffered locally (Not Saved to Server)</span>
        </>
      );
      break;

    case 'SAVED':
      statusClass = 'autosave-saved';
      content = (
        <>
          <span aria-hidden="true">✓</span>
          <span>All answers acknowledged on server {lastSavedTime ? `at ${lastSavedTime}` : ''}</span>
        </>
      );
      break;

    default:
      content = <span>Ready</span>;
  }

  return (
    <div
      className={`autosave-status ${statusClass}`}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      {content}
    </div>
  );
};
