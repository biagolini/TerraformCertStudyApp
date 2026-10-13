export interface QuestionAlternative {
  letter: string;
  text: string;
  isCorrect: boolean;
  comment: string;
  /** Only on a mock exam's shuffled copy: the letter this alternative has in
   * the bank (see alternative-shuffle.util.ts). Never stored on a question. */
  sourceLetter?: string;
}

export interface QuestionMetadata {
  topics: string[];
  relatedServices: string[];
}

export interface Question {
  id: string;
  packId: string;
  /** The question bank (source) inside the certification — see bank.model.ts. */
  bankId: string;
  title: string;
  domain: string;
  stem: string;
  alternatives: QuestionAlternative[];
  metadata: QuestionMetadata;
  createdAt: number;
  updatedAt: number;
  /** Persistent "revisit this later" flag — independent of any per-attempt quiz state. */
  starred?: boolean;
  /** Overall explanation for the question as a whole, distinct from any one
   * alternative's own comment — e.g. a unifying insight or context that
   * doesn't belong to a single option. Shown alongside the alternatives'
   * comments (review viewer) or gated behind the same reveal-after-answering
   * state (quiz runner) — never shown before the alternatives themselves,
   * since source material sometimes puts answer-revealing content here. */
  generalComment?: string;
  /** ISO 639-1 code of the language the question itself (stem/alternatives)
   * was written in — detected during import extraction (see
   * lambda/import_extract/app.py). Missing on older/manually-created
   * questions; treat as `'en'` wherever read, since that's true for
   * everything imported before this field existed. Drives the "Translate
   * with AI" button's default target language (see
   * translate-prompt.util.ts's resolveTranslationTarget). */
  language?: string;
}

/**
 * The app identifies an alternative by its letter, so letters must be unique
 * capitals in order. Questions imported with bullets ("-") or lowercase
 * letters get relabeled A, B, C… by position; valid ones come back unchanged.
 */
export function withValidLetters(question: Question): Question {
  const letters = question.alternatives.map((a) => a.letter);
  const valid = letters.every((l) => /^[A-Z]$/.test(l)) && new Set(letters).size === letters.length;
  if (valid) return question;
  return { ...question, alternatives: question.alternatives.map((a, i) => ({ ...a, letter: String.fromCharCode(65 + i) })) };
}

export function correctLetters(question: Pick<Question, 'alternatives'>): string[] {
  return question.alternatives.filter((a) => a.isCorrect).map((a) => a.letter);
}

export function isMultipleChoice(question: Pick<Question, 'alternatives'>): boolean {
  return correctLetters(question).length > 1;
}

export function isStarred(question: Pick<Question, 'starred'>): boolean {
  return question.starred ?? false;
}
