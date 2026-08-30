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
}

export function correctLetters(question: Pick<Question, 'alternatives'>): string[] {
  return question.alternatives.filter((a) => a.isCorrect).map((a) => a.letter);
}

export function isMultipleChoice(question: Pick<Question, 'alternatives'>): boolean {
  return correctLetters(question).length > 1;
}
