// Server-Synchronized Accessible Countdown Timer Component
import React from 'react';
import { useTimer } from '../hooks/useTimer';

interface CountdownTimerProps {
  deadlineEpochMs: number;
  onExpire?: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ deadlineEpochMs, onExpire }) => {
  const { formattedTime, isUrgent, isExpired, announcement } = useTimer(deadlineEpochMs, onExpire);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      {/* Screen-reader announcement container */}
      <div aria-live="polite" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        {announcement}
      </div>

      <div
        className={`timer-box ${isUrgent ? 'timer-urgent' : ''}`}
        role="timer"
        aria-label={`Time remaining: ${formattedTime}`}
      >
        <span aria-hidden="true">{isUrgent ? '⚠️ ⏳' : '⏱️'}</span>
        <span>{formattedTime}</span>
      </div>

      {isUrgent && !isExpired && (
        <span style={{ fontSize: '11px', color: 'var(--status-danger)', fontWeight: 'bold', marginTop: '4px' }}>
          ⚠️ FINAL 5 MINUTES - SUBMIT SOON
        </span>
      )}

      {isExpired && (
        <span style={{ fontSize: '11px', color: 'var(--status-danger)', fontWeight: 'bold', marginTop: '4px' }}>
          ⛔ EXAM PERIOD CONCLUDED
        </span>
      )}
    </div>
  );
};
