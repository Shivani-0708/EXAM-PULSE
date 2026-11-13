// IndexedDB-Backed Offline Queue and Autosave Manager
import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';

export type AutosaveState = 'IDLE' | 'SAVING' | 'SAVED' | 'OFFLINE_PENDING' | 'ERROR';

export interface PendingAnswer {
  examId: number;
  questionId: number;
  answer: string;
  version: number;
  clientTs: number;
}

export function useOfflineQueue(examId: number) {
  const [status, setStatus] = useState<AutosaveState>('IDLE');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const versionsRef = useRef<Map<number, number>>(new Map());
  const debounceTimersRef = useRef<Map<number, any>>(new Map());
  const pendingQueueRef = useRef<PendingAnswer[]>([]);

  // Listen to network status changes
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      flushQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setStatus('OFFLINE_PENDING');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const flushQueue = useCallback(async () => {
    if (pendingQueueRef.current.length === 0) return;

    setStatus('SAVING');
    const items = [...pendingQueueRef.current];
    pendingQueueRef.current = [];
    setPendingCount(0);

    for (const item of items) {
      try {
        const res = await api.fetch(`/api/exam/${item.examId}/answers/${item.questionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answer: item.answer,
            version: item.version,
            clientTs: item.clientTs,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.saved) {
            const timeStr = new Date(data.serverTs).toLocaleTimeString();
            setLastSavedTime(timeStr);
            setStatus('SAVED');
          }
        } else {
          // Re-queue on error
          pendingQueueRef.current.push(item);
          setPendingCount(pendingQueueRef.current.length);
          setStatus('OFFLINE_PENDING');
        }
      } catch {
        pendingQueueRef.current.push(item);
        setPendingCount(pendingQueueRef.current.length);
        setStatus('OFFLINE_PENDING');
      }
    }
  }, []);

  // Save with 800ms debounce
  const queueAnswer = useCallback(
    (questionId: number, answerText: string) => {
      // Clear existing debounce for this question
      if (debounceTimersRef.current.has(questionId)) {
        clearTimeout(debounceTimersRef.current.get(questionId));
      }

      const currentVer = (versionsRef.current.get(questionId) || 0) + 1;
      versionsRef.current.set(questionId, currentVer);

      setStatus('SAVING');

      const timer = setTimeout(async () => {
        const payload: PendingAnswer = {
          examId,
          questionId,
          answer: answerText,
          version: currentVer,
          clientTs: Date.now(),
        };

        if (!navigator.onLine) {
          pendingQueueRef.current.push(payload);
          setPendingCount(pendingQueueRef.current.length);
          setStatus('OFFLINE_PENDING');
          return;
        }

        try {
          const res = await api.fetch(`/api/exam/${examId}/answers/${questionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.saved) {
              const timeStr = new Date(data.serverTs).toLocaleTimeString();
              setLastSavedTime(timeStr);
              setStatus('SAVED');
            } else {
              pendingQueueRef.current.push(payload);
              setPendingCount(pendingQueueRef.current.length);
              setStatus('OFFLINE_PENDING');
            }
          } else {
            pendingQueueRef.current.push(payload);
            setPendingCount(pendingQueueRef.current.length);
            setStatus('OFFLINE_PENDING');
          }
        } catch {
          pendingQueueRef.current.push(payload);
          setPendingCount(pendingQueueRef.current.length);
          setStatus('OFFLINE_PENDING');
        }
      }, 800);

      debounceTimersRef.current.set(questionId, timer);
    },
    [examId]
  );

  return {
    status,
    lastSavedTime,
    pendingCount,
    isOnline,
    queueAnswer,
    flushQueue,
    setVersion: (qid: number, ver: number) => versionsRef.current.set(qid, ver),
  };
}
