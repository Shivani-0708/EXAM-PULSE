// Backend Types & Interfaces for ExamPulse

export interface UserSession {
  candidateId: number;
  candidateNumber: string;
  name: string;
  email: string;
  role: 'candidate' | 'invigilator' | 'admin';
  sid: string;
}

export interface TokenPayload {
  candidateId: number;
  candidateNumber: string;
  name: string;
  email: string;
  role: 'candidate' | 'invigilator' | 'admin';
  sid: string;
  iat?: number;
  exp?: number;
}

export interface ExamMeta {
  id: number;
  title: string;
  description: string;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  graceMs: number;
  isActive: boolean;
}

export interface Question {
  id: number;
  examId: number;
  questionNumber: number;
  questionType: 'mcq' | 'short_text';
  prompt: string;
  options: string[] | null;
  correctAnswer?: string;
  points: number;
}

export interface CandidateAttempt {
  id?: number;
  examId: number;
  candidateId: number;
  startedAt: number; // epoch ms
  deadline: number; // epoch ms
  questionOrder: number[]; // randomized IDs
  status: 'ACTIVE' | 'SUBMITTED' | 'REJECTED_LATE' | 'EXPIRED';
}

export interface AutosaveRequest {
  answer: string;
  version: number;
  clientTs: number;
  requestId?: string;
}

export interface AutosaveResponse {
  saved: boolean;
  version: number;
  serverTs: number;
  answeredCount: number;
  error?: string;
}

export interface FinalSubmitResponse {
  status: 'SUBMITTED' | 'REJECTED_LATE';
  examId: number;
  candidateId: number;
  idempotencyKey: string;
  submittedAt: number;
  secondsTaken: number;
  snapshotHash: string;
  answeredCount: number;
}

export interface LeaderboardEntry {
  rank: number;
  candidateId: number;
  candidateNumber: string;
  name: string;
  score: number;
  secondsTaken: number;
}

export interface CandidateStatus {
  candidateId: number;
  candidateNumber?: string;
  name?: string;
  state: 'NOT_STARTED' | 'ACTIVE' | 'DISCONNECTED' | 'SUBMITTED' | 'FLAGGED';
  lastSeen: number;
  tabSwitches: number;
  answeredCount: number;
}

export interface CollusionFlag {
  id: number;
  examId: number;
  candidateId: number;
  linkedCandidates: number[];
  riskScore: number;
  reasons: Array<{
    code: string;
    description: string;
    contribution: number;
  }>;
  evidence: Record<string, any>;
  status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ESCALATED';
  reviewedBy?: number;
  reviewedAt?: string;
  createdAt: string;
}
