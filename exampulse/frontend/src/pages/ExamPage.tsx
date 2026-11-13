// Candidate Exam Page
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { CountdownTimer } from '../components/CountdownTimer';
import { AutosaveStatus } from '../components/AutosaveStatus';
import { QuestionPalette, QuestionStatus } from '../components/QuestionPalette';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

interface ExamPageProps {
  candidate: any;
  attempt: any;
  onSubmitSuccess: (receipt: any) => void;
}

export const ExamPage: React.FC<ExamPageProps> = ({ candidate, attempt, onSubmitSuccess }) => {
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [markedQuestions, setMarkedQuestions] = useState<Set<number>>(new Set());
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Persistent Idempotency Key across double clicks and retries
  const idempotencyKeyRef = useRef<string>(`idem-${candidate.id}-${attempt.examId || 1}`);

  const { status, lastSavedTime, pendingCount, queueAnswer } = useOfflineQueue(attempt.examId || 1);

  // Fetch Paper and Restore State
  useEffect(() => {
    async function loadPaperAndAttempt() {
      try {
        const paperRes = await api.fetch(`/api/exam/${attempt.examId || 1}/paper`);
        const paperData = await paperRes.json();

        // Restore attempt if previously saved
        const attemptRes = await api.fetch(`/api/exam/${attempt.examId || 1}/attempt`);
        if (attemptRes.ok) {
          const attemptData = await attemptRes.json();
          // Restore question order
          const orderedQuestions = (attemptData.questionOrder || []).map((qid: number) => {
            return paperData.questions.find((q: any) => q.id === qid);
          }).filter(Boolean);

          setQuestions(orderedQuestions.length > 0 ? orderedQuestions : paperData.questions);

          // Restore answers
          const restoredAnswers: Record<number, string> = {};
          for (const [qid, val] of Object.entries(attemptData.answers || {})) {
            restoredAnswers[parseInt(qid, 10)] = (val as any).answer || '';
          }
          setAnswers(restoredAnswers);
        } else {
          setQuestions(paperData.questions || []);
        }
      } catch (err) {
        console.error('Failed to load exam paper', err);
      }
    }

    loadPaperAndAttempt();
  }, [attempt.examId]);

  // Telemetry: Page Visibility & Focus tracking
  useEffect(() => {
    const eventsBuffer: any[] = [];

    const handleVisibility = () => {
      const isHidden = document.visibilityState === 'hidden';
      eventsBuffer.push({
        type: isHidden ? 'TAB_HIDDEN' : 'TAB_VISIBLE',
        examId: attempt.examId || 1,
        timestamp: Date.now(),
      });
    };

    const handleBlur = () => {
      eventsBuffer.push({
        type: 'FOCUS_LOST',
        examId: attempt.examId || 1,
        timestamp: Date.now(),
      });
    };

    const handleFocus = () => {
      eventsBuffer.push({
        type: 'FOCUS_GAINED',
        examId: attempt.examId || 1,
        timestamp: Date.now(),
      });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Flush telemetry every 10 seconds
    const interval = setInterval(() => {
      if (eventsBuffer.length > 0) {
        const batch = [...eventsBuffer];
        eventsBuffer.length = 0;
        api.fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch }),
        }).catch(() => {});
      }
    }, 10000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [attempt.examId]);

  // Answer modification handler
  const handleAnswerChange = (val: string) => {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;

    setAnswers((prev) => ({ ...prev, [currentQ.id]: val }));
    queueAnswer(currentQ.id, val);
  };

  const toggleMarkForReview = () => {
    const currentQ = questions[currentIndex];
    if (!currentQ) return;

    setMarkedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(currentQ.id)) {
        next.delete(currentQ.id);
      } else {
        next.add(currentQ.id);
      }
      return next;
    });
  };

  // Keyboard navigation shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
      } else if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMarkForReview();
      }
    },
    [questions.length]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Final Submit Handler (Strict Idempotency)
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await api.fetch(`/api/exam/${attempt.examId || 1}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
        },
        body: JSON.stringify({ idempotencyKey: idempotencyKeyRef.current }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.message || 'Submission failed');
        return;
      }

      setShowSubmitModal(false);
      onSubmitSuccess(data.submission);
    } catch (err: any) {
      setSubmitError(err.message || 'Network error during submission. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const currentQ = questions[currentIndex];
  const questionStatuses: QuestionStatus[] = questions.map((q, idx) => ({
    id: q.id,
    number: idx + 1,
    isAnswered: Boolean(answers[q.id]?.trim()),
    isMarked: markedQuestions.has(q.id),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span style={{ fontWeight: 'bold' }}>{candidate.name}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({candidate.candidateNumber})</span>
        </div>

        <AutosaveStatus status={status} lastSavedTime={lastSavedTime} pendingCount={pendingCount} />

        <CountdownTimer deadlineEpochMs={attempt.deadline} onExpire={() => handleSubmit()} />
      </div>

      {/* Main Workspace */}
      <div className="container" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: '24px', flex: 1, marginTop: '16px' }}>
        {/* Left: Active Question */}
        <main role="main" aria-label="Question Content" style={{ backgroundColor: 'var(--bg-surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          {currentQ ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '1.25rem' }}>Question {currentIndex + 1} of {questions.length}</h2>
                <button
                  type="button"
                  className={`btn ${markedQuestions.has(currentQ.id) ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={toggleMarkForReview}
                  aria-pressed={markedQuestions.has(currentQ.id)}
                >
                  {markedQuestions.has(currentQ.id) ? '⚑ Marked for Review' : 'Mark for Review'}
                </button>
              </div>

              <div style={{ fontSize: '1.1rem', marginBottom: '24px', lineHeight: '1.6' }}>
                {currentQ.prompt}
              </div>

              {/* MCQ Options */}
              {currentQ.questionType === 'mcq' && currentQ.options && (
                <div role="radiogroup" aria-label={`Options for Question ${currentIndex + 1}`}>
                  {currentQ.options.map((opt: string, optIdx: number) => {
                    const isChecked = answers[currentQ.id] === opt;
                    return (
                      <label
                        key={optIdx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px',
                          marginBottom: '8px',
                          borderRadius: '8px',
                          backgroundColor: isChecked ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-primary)',
                          border: `1px solid ${isChecked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name={`q-${currentQ.id}`}
                          value={opt}
                          checked={isChecked}
                          onChange={() => handleAnswerChange(opt)}
                          style={{ width: '18px', height: '18px' }}
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Short Text Input */}
              {currentQ.questionType === 'short_text' && (
                <div>
                  <label htmlFor={`text-${currentQ.id}`} style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>
                    Type your short answer (saved automatically):
                  </label>
                  <textarea
                    id={`text-${currentQ.id}`}
                    rows={6}
                    value={answers[currentQ.id] || ''}
                    onChange={(e) => handleAnswerChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      color: 'white',
                      fontSize: '1rem',
                    }}
                    placeholder="Provide your technical answer here..."
                  />
                </div>
              )}

              {/* Navigation buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => i - 1)}
                >
                  ← Previous (Alt+P)
                </button>

                {currentIndex < questions.length - 1 ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCurrentIndex((i) => i + 1)}
                  >
                    Next Question (Alt+N) →
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setShowSubmitModal(true)}
                  >
                    Finish & Submit Exam →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p>Loading questions…</p>
          )}
        </main>

        {/* Right Sidebar: Navigator Palette */}
        <aside aria-label="Exam Progress" style={{ backgroundColor: 'var(--bg-surface)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', height: 'fit-content' }}>
          <QuestionPalette questions={questionStatuses} currentIndex={currentIndex} onSelect={setCurrentIndex} />

          <div style={{ marginTop: '32px' }}>
            <button
              type="button"
              className="btn btn-danger"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => setShowSubmitModal(true)}
            >
              Submit Examination
            </button>
          </div>
        </aside>
      </div>

      {/* Confirmation Modal */}
      {showSubmitModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-content">
            <h2 id="modal-title" style={{ marginBottom: '12px' }}>Confirm Final Submission</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              You have answered <strong>{Object.values(answers).filter((a) => a.trim()).length}</strong> of{' '}
              <strong>{questions.length}</strong> questions.
            </p>

            {submitError && (
              <div style={{ padding: '8px', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid var(--status-danger)', borderRadius: '6px', marginBottom: '12px', fontSize: '13px', color: 'var(--status-danger)' }}>
                {submitError}
              </div>
            )}

            <p style={{ fontSize: '13px', color: 'var(--status-warning)', marginBottom: '24px' }}>
              ⚠️ Once submitted, your answers will be locked and finalized. You cannot reopen the examination.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={submitting}
                onClick={() => setShowSubmitModal(false)}
              >
                Return to Exam
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={submitting}
                onClick={handleSubmit}
              >
                {submitting ? 'Finalizing…' : 'Yes, Submit Final Answers'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
