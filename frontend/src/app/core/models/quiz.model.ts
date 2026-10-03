export type QuizScope = 'pack' | 'exam' | 'all';
export type QuizMode = 'instant' | 'exam';
export type QuizPhase = 'setup' | 'running' | 'results' | 'history';

export interface QuizSettings {
  scope: QuizScope;
  mode: QuizMode;
  domains: string[];
  count: number;
  shuffle: boolean;
  trackTime: boolean;
  useAccommodation: boolean;
}

export interface QuizAnswer {
  selected: string[];
  checked: boolean;
  /** Exact-match only — true iff score === 1. Drives the green/red option styling. */
  correct: boolean;
  /** 0..1. Fractional only when the exam (Pack.allowPartialCredit) allows partial credit. */
  score: number;
  /** epoch ms of the last selection change — powers the "score if stopped at time limit" replay. */
  answeredAt?: number;
}

export const DEFAULT_QUIZ_SETTINGS: Omit<QuizSettings, 'domains'> = {
  scope: 'pack',
  mode: 'instant',
  count: 20,
  shuffle: true,
  trackTime: false,
  useAccommodation: false,
};
