import { Question, QuestionAlternative } from '../models/question.model';

/** One alternative as frozen in an attempt: the letter shown, its text and,
 * when the attempt shuffled it, the letter it has in the question bank. */
export interface AlternativeSnapshot {
  letter: string;
  text: string;
  sourceLetter?: string;
}

/** Options whose meaning depends on where the others sit ("All of the above",
 * "Both A and B", "None of the above"). Shuffling such a question would make
 * them wrong, so it keeps its original order. */
const POSITIONAL = [
  /\b(all|none|both|neither) of the (above|previous|options|answers)\b/i,
  /\b(todas|nenhuma|ambas) (as|das) (anteriores|alternativas|opç(ões|oes)|respostas)\b/i,
  /\b(todas|ninguna|ambas) (las )?(anteriores|opciones|respuestas)\b/i,
  /\b(tutte|nessuna|entrambe) (le )?(precedenti|opzioni|risposte)\b/i,
  /\b(options?|alternatives?|answers?|alternativas?|opç(ões|oes)|opciones|opzioni)\s+[A-H]\s*(and|or|e|ou|y|o)\s+[A-H]\b/i,
  /^\s*[A-H]\s*(and|or|e|ou|y|o|&)\s*[A-H]\s*\.?\s*$/i,
];

export function hasPositionalAlternatives(question: Pick<Question, 'alternatives'>): boolean {
  return question.alternatives.some((a) => POSITIONAL.some((re) => re.test(a.text)));
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A copy of the question with its alternatives in a random order and
 * relabeled A, B, C… by position, so the letters the student sees, answers
 * with and talks to the tutor about all match. `sourceLetter` keeps the
 * bank's letter. Positional questions come back unchanged.
 */
export function shuffleAlternatives(question: Question, random: () => number = Math.random): Question {
  if (question.alternatives.length < 2 || hasPositionalAlternatives(question)) return question;
  const order = [...question.alternatives];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...question, alternatives: order.map((a, i) => relabel(a, LETTERS[i])) };
}

/**
 * Rebuilds an attempt's view of a question from the bank row and the frozen
 * order, so a resumed or reviewed attempt shows the same order and letters it
 * was taken with. Snapshots without `sourceLetter` (not shuffled, or saved
 * before shuffling existed) keep the bank's order.
 */
export function applyAlternativeOrder(question: Question, snapshot: readonly AlternativeSnapshot[]): Question {
  if (!snapshot.some((s) => s.sourceLetter)) return question;
  // Match each shown alternative to the bank row by its text first (it survives
  // a letter repair), then by the bank letter; every row is used at most once.
  const pool = [...question.alternatives];
  const take = (s: AlternativeSnapshot): QuestionAlternative | undefined => {
    const i = pool.findIndex((a) => a.text.trim() === s.text.trim());
    const j = i >= 0 ? i : pool.findIndex((a) => a.letter === (s.sourceLetter ?? s.letter));
    return j >= 0 ? pool.splice(j, 1)[0] : undefined;
  };
  const matched = snapshot.map(take);
  // The order no longer fits the question (edited since, or a snapshot that
  // repeats an alternative): show the question as it is in the bank.
  if (matched.some((a) => !a) || pool.length > 0) return question;
  return { ...question, alternatives: matched.map((a, i) => relabel(a!, snapshot[i].letter)) };
}

/** Letters an attempt recorded (as shown) translated to the bank's letters. */
export function toSourceLetters(letters: readonly string[], snapshot: readonly AlternativeSnapshot[]): string[] {
  return letters.map((l) => snapshot.find((s) => s.letter === l)?.sourceLetter ?? l);
}

function relabel(alternative: QuestionAlternative, letter: string): QuestionAlternative {
  return { ...alternative, letter, sourceLetter: alternative.sourceLetter ?? alternative.letter };
}
