import { QuizMode, QuizScope } from './quiz.model';
import { TextRange } from '../utils/text-range.util';

export interface QuizAttemptAnswer {
  questionId: string;
  title: string;
  domain: string;
  selected: string[];
  correctLetters: string[];
  /** 0..1 — fractional only when the exam (`Pack.allowPartialCredit`) allows partial credit. */
  score: number;
  /** epoch ms of the last selection change. Used to approximate "what if I'd stopped at the time limit". */
  answeredAt?: number;
  /** Frozen at attempt time — highlight/strikethrough offsets are only valid against this exact text. */
  stemSnapshot: string;
  alternativesSnapshot: { letter: string; text: string }[];
  /** Keyed by block id: `'stem'` or an alternative's letter. */
  highlights: Partial<Record<string, TextRange[]>>;
  strikethroughs: Partial<Record<string, TextRange[]>>;
  note: string;
  timeSpentSeconds: number;
  markedForReview: boolean;
}

export interface QuizAttempt {
  id: string;
  /** slugify(pack.name) — groups attempts by exam in the DynamoDB sort key. */
  examSlug: string;
  examName: string;
  scope: QuizScope;
  mode: QuizMode;
  partialCredit: boolean;
  answers: QuizAttemptAnswer[];
  totalScore: number;
  maxScore: number;
  /** Rounded to 2 decimal places. */
  scorePercent: number;
  startedAt: number;
  finishedAt: number;
  /** epoch ms — set once if the exam clock ever hit zero during this attempt. */
  timeLimitReachedAt?: number;
}
