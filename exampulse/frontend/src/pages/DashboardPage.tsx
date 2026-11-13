// Invigilator Dashboard Page
import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { VirtualTable, TableColumn } from '../components/VirtualTable';
import { FlagDrawer } from '../components/FlagDrawer';

interface DashboardPageProps {
  staffUser: any;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ staffUser, onLogout }) => {
  const [summary, setSummary] = useState<any>({
    active: 0,
    disconnected: 0,
    submitted: 0,
    flagged: 0,
    totalCandidates: 20000,
  });

  const [candidates, setCandidates] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [selectedFlag, setSelectedFlag] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isAiAvailable, setIsAiAvailable] = useState(true);

  // Fetch summary counters
  const fetchSummary = async () => {
    try {
      const res = await api.fetch('/api/dashboard/summary?examId=1');
      if (res.ok) {
        const data = await res.json();
        setSummary(data.counts);
      }
    } catch {}
  };

  // Fetch candidate roster
  const fetchCandidates = async () => {
    try {
      const res = await api.fetch(
        `/api/dashboard/candidates?examId=1&status=${statusFilter}&search=${encodeURIComponent(searchQuery)}`
      );
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates || []);
      }
    } catch {}
  };

  // Fetch collusion flags
  const fetchFlags = async () => {
    try {
      const res = await api.fetch('/api/dashboard/flags?examId=1');
      if (res.ok) {
        const data = await res.json();
        setFlags(data.flags || []);
      }
    } catch {}
  };

  // Check AI service status
  const checkAiHealth = async () => {
    try {
      const res = await fetch('/ai/health');
      setIsAiAvailable(res.ok);
    } catch {
      setIsAiAvailable(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    fetchCandidates();
    fetchFlags();
    checkAiHealth();

    const interval = setInterval(() => {
      fetchSummary();
      fetchCandidates();
      fetchFlags();
      checkAiHealth();
    }, 4000);

    return () => clearInterval(interval);
  }, [statusFilter, searchQuery]);

  // Connect to WebSocket for batched realtime updates
  useEffect(() => {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws/dashboard`;

    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsUrl);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'BATCH_UPDATE') {
            fetchSummary();
            fetchCandidates();
          }
        } catch {}
      };
    } catch {}

    return () => {
      if (socket) socket.close();
    };
  }, []);

  const columns: TableColumn<any>[] = [
    {
      key: 'candidateNumber',
      header: 'Candidate ID',
      width: '140px',
      render: (c) => <code>{c.candidateNumber}</code>,
    },
    {
      key: 'name',
      header: 'Name',
      width: '180px',
    },
    {
      key: 'state',
      header: 'Status',
      width: '140px',
      render: (c) => {
        let badgeColor = 'var(--text-muted)';
        if (c.state === 'ACTIVE') badgeColor = 'var(--status-success)';
        if (c.state === 'DISCONNECTED') badgeColor = 'var(--status-warning)';
        if (c.state === 'SUBMITTED') badgeColor = 'var(--accent-primary)';
        if (c.state === 'FLAGGED') badgeColor = 'var(--status-danger)';
        return (
          <span style={{ color: badgeColor, fontWeight: 'bold' }}>
            ● {c.state}
          </span>
        );
      },
    },
    {
      key: 'tabSwitches',
      header: 'Tab Switches',
      width: '120px',
      render: (c) => (
        <span style={{ color: c.tabSwitches > 5 ? 'var(--status-danger)' : undefined, fontWeight: c.tabSwitches > 5 ? 'bold' : 'normal' }}>
          {c.tabSwitches} {c.tabSwitches > 5 ? '⚠️' : ''}
        </span>
      ),
    },
    {
      key: 'answeredCount',
      header: 'Answered',
      width: '100px',
      render: (c) => `${c.answeredCount} / 10`,
    },
    {
      key: 'actions',
      header: 'Review Actions',
      render: (c) => {
        const flag = flags.find((f) => f.candidate_id === c.candidateId);
        if (flag) {
          return (
            <button
              className="btn btn-danger"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFlag(flag);
              }}
            >
              Inspect Collusion Flag ({(parseFloat(flag.risk_score) * 100).toFixed(0)}%)
            </button>
          );
        }
        return <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Normal</span>;
      },
    },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-primary)' }}>
      {/* Top Bar */}
      <header>
        <div>
          <h1 style={{ fontSize: '1.25rem', color: 'var(--accent-primary)' }}>ExamPulse Invigilator Console</h1>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Proctor: {staffUser.name}</span>
        </div>

        <button type="button" className="btn btn-secondary" onClick={onLogout}>
          Sign Out
        </button>
      </header>

      {/* AI Fallback Warning Banner */}
      {!isAiAvailable && (
        <div style={{ backgroundColor: '#78350f', color: '#fef3c7', padding: '10px 24px', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⚠️ AI service unavailable — rule-based collusion flags active. Realtime exams unaffected.</span>
        </div>
      )}

      <main className="container" style={{ marginTop: '20px' }}>
        {/* KPI Counter Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', borderLeft: '4px solid var(--status-success)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ACTIVE CANDIDATES</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.active.toLocaleString()}</div>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', borderLeft: '4px solid var(--status-warning)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>DISCONNECTED (&gt;15s)</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--status-warning)' }}>{summary.disconnected.toLocaleString()}</div>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', borderLeft: '4px solid var(--accent-primary)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>SUBMISSIONS RECEIVED</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{summary.submitted.toLocaleString()}</div>
          </div>

          <div style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px', borderLeft: '4px solid var(--status-danger)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>COLLUSION FLAGS</div>
            <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--status-danger)' }}>{summary.flagged.toLocaleString()}</div>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['ALL', 'ACTIVE', 'DISCONNECTED', 'SUBMITTED', 'FLAGGED'].map((st) => (
              <button
                key={st}
                className={`btn ${statusFilter === st ? '' : 'btn-secondary'}`}
                style={{ fontSize: '12px', padding: '6px 12px' }}
                onClick={() => setStatusFilter(st)}
              >
                {st}
              </button>
            ))}
          </div>

          <div>
            <input
              type="text"
              placeholder="Search Candidate ID or Name…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)', color: 'white', minWidth: '240px' }}
            />
          </div>
        </div>

        {/* Virtualized Candidate Table */}
        <VirtualTable data={candidates} columns={columns} height={520} />
      </main>

      {/* Collusion Flag Drawer */}
      <FlagDrawer
        flag={selectedFlag}
        onClose={() => setSelectedFlag(null)}
        onStatusUpdate={() => {
          fetchSummary();
          fetchFlags();
        }}
      />
    </div>
  );
};
