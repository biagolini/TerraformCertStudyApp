import { QuizMode, QuizScope, QuizSettings } from './quiz.model';
import { TextRange } from '../utils/text-range.util';

export type QuizAttemptStatus = 'IN_PROGRESS' | 'FINISHED';

/** How many IN_PROGRESS attempts a user may keep open at once (across every
 * exam), so a student can interleave sessions ("10 questions here, then that
 * other one") without the setup screen turning into an unbounded backlog of
 * abandoned attempts. Enforced client-side at quiz start. */
export const MAX_IN_PROGRESS_ATTEMPTS = 5;

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
  /** Whether this question was explicitly graded (instant-mode "Check answer" already
   * clicked). Exam-mode answers are never checked until finish(). Needed on resume to
   * know whether the runner should render this question as already-submitted
   * (locked options + feedback shown) vs. still open. */
  checked: boolean;
  /** Frozen at attempt time — highlight/strikethrough offsets are only valid against this exact text. */
  stemSnapshot: string;
  alternativesSnapshot: { letter: string; text: string }[];
  /** Keyed by block id: `'stem'` or an alternative's letter. */
  highlights: Partial<Record<string, TextRange[]>>;
  strikethroughs: Partial<Record<string, TextRange[]>>;
  note: string;
  timeSpentSeconds: number;
  markedForReview: boolean;
  /** Tutor Q&A about this question during or after the attempt (see TutorDialogComponent). */
  tutor?: TutorMessage[];
}

export interface TutorMessage {
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

export interface QuizAttempt {
  id: string;
  /** `IN_PROGRESS` while the session can still be resumed, `FINISHED` once graded.
   * Legacy rows saved before this field existed have no status at all — treat as
   * FINISHED, since they can only ever have been finished attempts. */
  status: QuizAttemptStatus;
  /** The specific pack active when the quiz started/resumed — `examSlug`/`examName`
   * alone can't distinguish between two packs sharing the same exam name (e.g. two
   * different "sets" of the same certification). */
  packId: string;
  /** slugify(pack.name) — groups attempts by exam in the DynamoDB sort key. */
  examSlug: string;
  examName: string;
  scope: QuizScope;
  mode: QuizMode;
  partialCredit: boolean;
  /** Full settings snapshot from quiz start — needed to reconstruct the exact same
   * session (domains/count/shuffle/trackTime/useAccommodation) on resume. */
  settings: QuizSettings;
  answers: QuizAttemptAnswer[];
  /** Persisted navigation position — which question the runner should reopen on. */
  currentIndex: number;
  /** Always computed from whatever is in `answers` right now — "score so far" while
   * IN_PROGRESS, final score once FINISHED. Never optional, so existing readers
   * (History, time-limit re-scoring) don't need null-guards. */
  totalScore: number;
  maxScore: number;
  /** Rounded to 2 decimal places. */
  scorePercent: number;
  startedAt: number;
  /** Only present once status is FINISHED. */
  finishedAt?: number;
  /** epoch ms — set once if the exam clock ever hit zero during this attempt. */
  timeLimitReachedAt?: number;
  /** Pass mark (0..100) in force when the attempt started — the verdict stays stable if the certification's mark is edited later. */
  passingScorePercent?: number;
  /** Banks the questions were drawn from (empty = all banks). */
  bankIds?: string[];
}

/** Pass/fail against the attempt's own snapshot of the pass mark. */
export function attemptPassed(attempt: Pick<QuizAttempt, 'scorePercent' | 'passingScorePercent'>, fallbackPercent: number): boolean {
  return attempt.scorePercent >= (attempt.passingScorePercent ?? fallbackPercent);
}
