import { QuizAttempt } from '../models/quiz-attempt.model';

export interface DomainMastery {
  domain: string;
  answered: number;
  total: number;
  /** Sum of per-question scores (fractional under partial credit). */
  score: number;
  /** 0..100 over every question seen in the domain (blank counts as wrong). */
  percent: number;
  avgSeconds: number;
}

/** Aggregates every question of the given attempts by domain. */
export function domainMastery(attempts: readonly QuizAttempt[]): DomainMastery[] {
  const map = new Map<string, { answered: number; total: number; score: number; seconds: number }>();
  for (const attempt of attempts) {
    for (const a of attempt.answers) {
      const entry = map.get(a.domain) ?? { answered: 0, total: 0, score: 0, seconds: 0 };
      entry.total += 1;
      if (a.selected.length > 0) entry.answered += 1;
      entry.score += a.score;
      entry.seconds += a.timeSpentSeconds ?? 0;
      map.set(a.domain, entry);
    }
  }
  return [...map.entries()]
    .map(([domain, v]) => ({
      domain,
      answered: v.answered,
      total: v.total,
      score: v.score,
      percent: v.total ? Math.round((v.score / v.total) * 1000) / 10 : 0,
      avgSeconds: v.total ? v.seconds / v.total : 0,
    }))
    .sort((a, b) => a.percent - b.percent);
}

export function attemptDurationSeconds(attempt: QuizAttempt): number {
  return attempt.answers.reduce((sum, a) => sum + (a.timeSpentSeconds ?? 0), 0);
}

export function attemptBlankCount(attempt: QuizAttempt): number {
  return attempt.answers.filter((a) => a.selected.length === 0).length;
}

export interface ChartPoint {
  x: number;
  y: number;
  attempt: QuizAttempt;
}

/** Maps attempts (oldest first) to SVG coordinates inside a width x height box with padding. */
export function scoreChartPoints(attempts: readonly QuizAttempt[], width: number, height: number, pad: number): ChartPoint[] {
  const ordered = [...attempts].sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
  const n = ordered.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return ordered.map((attempt, i) => ({
    x: pad + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1)),
    y: pad + innerH * (1 - Math.max(0, Math.min(100, attempt.scorePercent)) / 100),
    attempt,
  }));
}
