import { Question } from '../models/question.model';
import { QuizAttempt, QuizAttemptAnswer } from '../models/quiz-attempt.model';
import { buildBatches } from './file-splitter.util';
import { toSourceLetters } from './alternative-shuffle.util';
import { ExportAttemptFilter } from '../models/export-preset.model';

/** Which questions of the chosen mock exams to export. "Wrong" is anything
 * below full marks — partial credit and unanswered questions count as wrong. */
export type AttemptQuestionFilter = ExportAttemptFilter;

/** One question pulled from one or more attempts (finished or in progress). */
export interface AttemptQuestionEntry {
  questionId: string;
  title: string;
  domain: string;
  /** Wrong (score < 1) in at least one of the chosen attempts. */
  wrong: boolean;
  /** Marked for review in at least one of the chosen attempts. */
  flagged: boolean;
  /** Every answer given to it across the chosen attempts, oldest first. */
  answers: { attemptId: string; at: number; selected: string[]; score: number }[];
}

export function isWrongScore(score: number): boolean {
  return score < 1;
}

/** 1-based question positions inside one attempt; a missing bound means no limit. */
export interface AttemptRange {
  from?: number | null;
  to?: number | null;
}

export interface CollectOptions {
  /** Per-attempt question range, keyed by attempt id. */
  ranges?: Readonly<Record<string, AttemptRange>>;
  /** Leave out questions that were not answered (nothing selected). */
  skipUnanswered?: boolean;
  /** Score of one answer. Defaults to the stored score, which an exam-mode
   * attempt still in progress has not computed yet — callers pass a grader. */
  scoreOf?: (answer: QuizAttemptAnswer, attempt: QuizAttempt) => number;
}

export function inRange(position: number, range: AttemptRange | undefined): boolean {
  if (!range) return true;
  if (range.from != null && position < range.from) return false;
  if (range.to != null && position > range.to) return false;
  return true;
}

/**
 * Merges the answers of several attempts into one entry per question, so a
 * question missed in two mock exams is exported once. Order follows the
 * attempts oldest first, then each attempt's own question order. Each
 * attempt's range is applied to its own numbering (Q1, Q2…).
 */
export function collectAttemptQuestions(attempts: readonly QuizAttempt[], options: CollectOptions = {}): AttemptQuestionEntry[] {
  const scoreOf = options.scoreOf ?? ((a: QuizAttemptAnswer) => a.score);
  const byId = new Map<string, AttemptQuestionEntry>();
  const ordered = [...attempts].sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt));
  for (const attempt of ordered) {
    const range = options.ranges?.[attempt.id];
    attempt.answers.forEach((a, index) => {
      if (!inRange(index + 1, range)) return;
      if (options.skipUnanswered && a.selected.length === 0) return;
      const score = scoreOf(a, attempt);
      let entry = byId.get(a.questionId);
      if (!entry) {
        entry = { questionId: a.questionId, title: a.title, domain: a.domain, wrong: false, flagged: false, answers: [] };
        byId.set(a.questionId, entry);
      }
      entry.wrong ||= isWrongScore(score);
      // Rows saved before the flag existed have no value: not flagged.
      entry.flagged ||= a.markedForReview === true;
      // Letters as in the bank, not as shown in a shuffled attempt.
      const selected = toSourceLetters(a.selected, a.alternativesSnapshot ?? []);
      entry.answers.push({ attemptId: attempt.id, at: attempt.finishedAt ?? attempt.startedAt, selected, score });
    });
  }
  return [...byId.values()];
}

export function matchesAttemptFilter(entry: Pick<AttemptQuestionEntry, 'wrong' | 'flagged'>, filter: AttemptQuestionFilter): boolean {
  switch (filter) {
    case 'wrong':
      return entry.wrong;
    case 'flagged':
      return entry.flagged;
    case 'wrongOrFlagged':
      return entry.wrong || entry.flagged;
    default:
      return true;
  }
}

export interface ExportSplit {
  /** Balanced batches of at most this many questions; null = no size limit. */
  maxPerFile: number | null;
  /** One file (or one set of batches) per exam domain. */
  byDomain: boolean;
}

export interface ExportFileGroup {
  /** Set only when splitting by domain. */
  domain: string | null;
  /** 1-based part inside its domain (or inside the whole export without byDomain). */
  part: number;
  totalParts: number;
  questions: Question[];
}

/**
 * Plans the output files. Domain split happens first, then each domain is cut
 * into balanced batches: 10 + 2 questions of two domains with a limit of 6
 * become three files — 5 and 5 of the first domain, 2 of the second.
 * `domainOrder` (the exam's official order) decides which domain comes first;
 * domains missing from it follow in order of appearance.
 */
export function planExportFiles(questions: readonly Question[], split: ExportSplit, domainOrder: readonly string[] = []): ExportFileGroup[] {
  if (questions.length === 0) return [];
  const groups: { domain: string | null; questions: Question[] }[] = [];
  if (split.byDomain) {
    const byDomain = new Map<string, Question[]>();
    for (const q of questions) {
      const key = q.domain || 'General';
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key)!.push(q);
    }
    const order = domainOrder.filter((d) => byDomain.has(d));
    for (const d of byDomain.keys()) if (!order.includes(d)) order.push(d);
    for (const d of order) groups.push({ domain: d, questions: byDomain.get(d)! });
  } else {
    groups.push({ domain: null, questions: [...questions] });
  }

  const files: ExportFileGroup[] = [];
  for (const g of groups) {
    const batches = split.maxPerFile && split.maxPerFile > 0 ? buildBatches(g.questions, split.maxPerFile) : [g.questions];
    batches.forEach((batch, i) => files.push({ domain: g.domain, part: i + 1, totalParts: batches.length, questions: batch }));
  }
  return files;
}

/** Characters no common file system accepts in a name. */
const INVALID_FILENAME_CHARS = /[\/\\:*?"<>|\u0000-\u001f]/g;

/** Keeps what the user typed (case included) but makes it a safe, single-token
 * file name: spaces become "-", invalid characters and stray dashes/dots go. */
export function sanitizeFilePrefix(value: string): string {
  return value
    .replace(INVALID_FILENAME_CHARS, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.md$/i, '');
}

/**
 * `<prefix>[-d<N>][-<part>-of-<total>].md` — `-d<N>` only when splitting by
 * domain (N = the domain's official number), the part suffix only when that
 * group was cut into several files. A single, unsplit export is `<prefix>.md`.
 */
export function exportFileName(prefix: string, file: Pick<ExportFileGroup, 'part' | 'totalParts'>, domainNumber: number | null): string {
  const domain = domainNumber !== null ? `-d${domainNumber}` : '';
  const part = file.totalParts > 1 ? `-${file.part}-of-${file.totalParts}` : '';
  return `${prefix}${domain}${part}.md`;
}
