// Server-Synchronized Countdown Timer Hook
import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

export function useTimer(deadlineEpochMs: number, onExpire?: () => void) {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    return Math.max(0, deadlineEpochMs - api.getAuthoritativeNow());
  });

  const [announcement, setAnnouncement] = useState<string>('');
  const announcedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!deadlineEpochMs) return;

    // Resync NTP clock on mount and every 30 seconds
    api.syncServerTime(3);
    const syncInterval = setInterval(() => {
      api.syncServerTime(2);
    }, 30000);

    const timer = setInterval(() => {
      const now = api.getAuthoritativeNow();
      const diff = Math.max(0, deadlineEpochMs - now);
      setRemainingMs(diff);

      // Key thresholds for screen-reader announcements
      const minutesLeft = Math.floor(diff / 60000);
      if ([15, 10, 5, 1].includes(minutesLeft) && !announcedRef.current.has(minutesLeft)) {
        announcedRef.current.add(minutesLeft);
        setAnnouncement(`Notice: ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} remaining.`);
      }

      if (diff <= 0) {
        clearInterval(timer);
        if (onExpire) onExpire();
      }
    }, 500);

    return () => {
      clearInterval(syncInterval);
      clearInterval(timer);
    };
  }, [deadlineEpochMs, onExpire]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const isUrgent = remainingMs <= 5 * 60 * 1000 && remainingMs > 0;
  const isExpired = remainingMs <= 0;

  const formattedTime = [
    hours > 0 ? String(hours).padStart(2, '0') : null,
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ]
    .filter(Boolean)
    .join(':');

  return {
    remainingMs,
    formattedTime,
    isUrgent,
    isExpired,
    announcement,
  };
}
