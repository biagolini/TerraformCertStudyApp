export type QuizScope = 'pack' | 'exam' | 'all';
export type QuizMode = 'instant' | 'exam';
export type QuizPhase = 'setup' | 'running' | 'results';

export interface QuizSettings {
  scope: QuizScope;
  mode: QuizMode;
  domains: string[];
  count: number;
  shuffle: boolean;
}

export interface QuizAnswer {
  selected: string[];
  checked: boolean;
  correct: boolean;
}

export const DEFAULT_QUIZ_SETTINGS: Omit<QuizSettings, 'domains'> = {
  scope: 'pack',
  mode: 'instant',
  count: 20,
  shuffle: true,
};
