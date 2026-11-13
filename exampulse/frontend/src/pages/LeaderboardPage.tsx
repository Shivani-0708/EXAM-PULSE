// Real-time Leaderboard Page
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface LeaderboardPageProps {
  candidate: any;
  onBackToExam?: () => void;
}

export const LeaderboardPage: React.FC<LeaderboardPageProps> = ({ candidate, onBackToExam }) => {
  const [entries, setEntries] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = async () => {
    try {
      const [topRes, myRes] = await Promise.all([
        api.fetch('/api/leaderboard?top=50'),
        api.fetch('/api/leaderboard/me'),
      ]);

      if (topRes.ok) {
        const topData = await topRes.json();
        setEntries(topData.entries || []);
      }

      if (myRes.ok) {
        const myData = await myRes.json();
        if (myData.ranked) {
          setMyRank(myData);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="container" style={{ maxWidth: '900px', marginTop: '40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem' }}>ExamPulse Leaderboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Live ranking based on score and submission speed (sub-50ms Redis queries)
          </p>
        </div>
        {onBackToExam && (
          <button type="button" className="btn btn-secondary" onClick={onBackToExam}>
            ← Back
          </button>
        )}
      </div>

      {myRank && (
        <div style={{ padding: '16px', backgroundColor: 'rgba(56, 189, 248, 0.15)', border: '1px solid var(--accent-primary)', borderRadius: '8px', marginBottom: '24px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>YOUR RANK</span>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>#{myRank.rank}</div>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>SCORE</span>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{myRank.score} pts</div>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>TIME TAKEN</span>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{Math.floor(myRank.secondsTaken / 60)}m {myRank.secondsTaken % 60}s</div>
          </div>
        </div>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: '80px' }}>Rank</th>
              <th>Candidate</th>
              <th>Student ID</th>
              <th style={{ textAlign: 'right' }}>Score</th>
              <th style={{ textAlign: 'right' }}>Time Taken</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                  {loading ? 'Fetching leaderboard…' : 'No submitted exams yet.'}
                </td>
              </tr>
            ) : (
              entries.map((item) => {
                const isMe = item.candidateId === candidate.id;
                return (
                  <tr key={item.candidateId} style={{ backgroundColor: isMe ? 'rgba(56, 189, 248, 0.1)' : undefined }}>
                    <td style={{ fontWeight: 'bold' }}>#{item.rank}</td>
                    <td>{item.name} {isMe && <span style={{ color: 'var(--accent-primary)', fontSize: '11px' }}>(You)</span>}</td>
                    <td><code>{item.candidateNumber}</code></td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{item.score}</td>
                    <td style={{ textAlign: 'right' }}>{Math.floor(item.secondsTaken / 60)}m {item.secondsTaken % 60}s</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
};
