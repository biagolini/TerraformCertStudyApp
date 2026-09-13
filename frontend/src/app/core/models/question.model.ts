export interface QuestionAlternative {
  letter: string;
  text: string;
  isCorrect: boolean;
  comment: string;
}

export interface QuestionMetadata {
  topics: string[];
  relatedServices: string[];
}

export interface Question {
  id: string;
  packId: string;
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
