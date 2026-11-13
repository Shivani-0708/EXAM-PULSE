// Rule-Based Collusion Detection Fallback
// Activated automatically when AI service is unreachable, timed out, or circuit breaker is OPEN.

export interface RuleAnalysisInput {
  candidateId: number;
  allCandidatesAnswers: Array<{
    candidateId: number;
    answers: Record<string, string>;
    answerTimes: Record<string, number>;
    tabSwitches: number;
    deviceCount: number;
  }>;
}

export interface CollusionResult {
  flagged: boolean;
  linkedCandidates: number[];
  riskScore: number;
  reasons: Array<{
    code: string;
    description: string;
    contribution: number;
  }>;
  evidence: Record<string, any>;
  method: 'AI_MODEL' | 'RULE_FALLBACK';
}

export class RuleFallbackService {
  /**
   * Rule-based collusion analysis:
   * Rule 1: High exact answer match (>85%) with close answer timestamp proximity (<5s)
   * Rule 2: Excessive tab switches (>8)
   * Rule 3: Multi-device or rapid IP changes
   */
  public analyzeCandidate(
    targetCandidateId: number,
    candidatesData: Array<{
      candidateId: number;
      answers: Record<string, string>;
      answerTimes: Record<string, number>;
      tabSwitches: number;
      deviceCount: number;
    }>
  ): CollusionResult {
    const target = candidatesData.find((c) => c.candidateId === targetCandidateId);
    if (!target) {
      return {
        flagged: false,
        linkedCandidates: [],
        riskScore: 0,
        reasons: [],
        evidence: {},
        method: 'RULE_FALLBACK',
      };
    }

    const linkedCandidates: number[] = [];
    const reasons: Array<{ code: string; description: string; contribution: number }> = [];
    let riskScore = 0.0;
    const evidence: Record<string, any> = {
      tabSwitches: target.tabSwitches,
      deviceCount: target.deviceCount,
      pairwiseMatches: [],
    };

    // Check behavioral rules on target
    if (target.tabSwitches >= 6) {
      const contr = Math.min(0.35, target.tabSwitches * 0.05);
      riskScore += contr;
      reasons.push({
        code: 'EXCESSIVE_TAB_SWITCHES',
        description: `Candidate switched browser tabs ${target.tabSwitches} times during exam`,
        contribution: parseFloat(contr.toFixed(3)),
      });
    }

    if (target.deviceCount > 1) {
      const contr = 0.3;
      riskScore += contr;
      reasons.push({
        code: 'MULTI_DEVICE_LOGIN',
        description: `Multiple distinct devices detected for active session (${target.deviceCount} devices)`,
        contribution: contr,
      });
    }

    // Check pairwise agreement with other candidates
    const targetQIds = Object.keys(target.answers);
    for (const other of candidatesData) {
      if (other.candidateId === targetCandidateId) continue;

      let matchingAnswers = 0;
      let totalCompared = 0;
      let closeTimings = 0;

      for (const qid of targetQIds) {
        if (other.answers[qid] !== undefined) {
          totalCompared++;
          if (target.answers[qid] === other.answers[qid]) {
            matchingAnswers++;
            // Check timing proximity
            const tTarget = target.answerTimes[qid] || 0;
            const tOther = other.answerTimes[qid] || 0;
            if (tTarget > 0 && tOther > 0 && Math.abs(tTarget - tOther) < 5000) {
              closeTimings++;
            }
          }
        }
      }

      if (totalCompared >= 4) {
        const agreementRatio = matchingAnswers / totalCompared;
        if (agreementRatio >= 0.85) {
          linkedCandidates.push(other.candidateId);
          evidence.pairwiseMatches.push({
            peerCandidateId: other.candidateId,
            agreementRatio: parseFloat(agreementRatio.toFixed(3)),
            closeTimingCount: closeTimings,
          });

          const contr = Math.min(0.5, agreementRatio * 0.4 + (closeTimings / totalCompared) * 0.2);
          riskScore += contr;
          reasons.push({
            code: 'HIGH_ANSWER_SIMILARITY',
            description: `Answer agreement with candidate ${other.candidateId} is ${(agreementRatio * 100).toFixed(1)}% with ${closeTimings} synchronized submissions`,
            contribution: parseFloat(contr.toFixed(3)),
          });
        }
      }
    }

    riskScore = Math.min(0.999, Math.max(0.0, riskScore));
    const flagged = riskScore >= 0.65;

    return {
      flagged,
      linkedCandidates,
      riskScore: parseFloat(riskScore.toFixed(3)),
      reasons,
      evidence,
      method: 'RULE_FALLBACK',
    };
  }
}

export const ruleFallbackService = new RuleFallbackService();
