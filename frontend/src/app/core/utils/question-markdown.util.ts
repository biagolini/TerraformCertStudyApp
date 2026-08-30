import { Question } from '../models/question.model';

/**
 * Renders a structured Question back into the same Markdown shape
 * question-parse.util.ts parses (Question / Alternatives / Correct answer /
 * Incorrect answers headings). Used for exported study-note files and to
 * reconstruct a Markdown "current review" to send to the AI refine prompt,
 * which is re-parsed afterwards — this is the inverse of parseQuestionReview.
 */
export function renderQuestionMarkdown(question: Pick<Question, 'stem' | 'alternatives'>): string {
  const lines: string[] = ['#### Question:', question.stem, '', '#### Alternatives:'];

  for (const a of question.alternatives) {
    lines.push(`*${a.letter}. ${a.text}*`, '');
  }

  const correct = question.alternatives.filter((a) => a.isCorrect);
  lines.push('#### Correct answer and explanation:');
  for (const a of correct) {
    lines.push(`*${a.letter}. ${a.text}*`, '', a.comment || '(no explanation provided)', '');
  }

  const incorrect = question.alternatives.filter((a) => !a.isCorrect);
  if (incorrect.length > 0) {
    lines.push('#### Incorrect answers and justifications:');
    for (const a of incorrect) {
      lines.push(`*${a.letter}. ${a.text}*`, '', a.comment || '(no explanation provided)', '');
    }
  }

  return lines.join('\n').trim();
}
