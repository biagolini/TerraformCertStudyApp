/** Plain-text/Markdown rendering of a quiz question for the clipboard, so a
 * student can paste it into another tool (a notes app, an AI assistant).
 *
 * Without `reveal` only the stem and the alternatives are emitted: copying a
 * question that is still being answered must never leak the answer. */
export interface CopyableQuestion {
  stem: string;
  alternatives: { letter: string; text: string; isCorrect: boolean; comment?: string }[];
  generalComment?: string | null;
}

export interface QuestionCopyLabels {
  /** `# Question` heading. */
  questionHeading: string;
  /** `# Options` heading. */
  optionsHeading: string;
  /** `# Answer key` heading. */
  answerHeading: string;
  /** `# Comments` heading. */
  commentsHeading: string;
  /** "The student chose option(s) X" — one correct answer. */
  studentChoseOne: string;
  /** "The student chose option(s) X" — several. */
  studentChoseMany: string;
  /** "Correct option(s): X" — one. */
  correctOne: string;
  /** "Correct option(s): X" — several. */
  correctMany: string;
  generalComment: string;
}

export interface QuestionCopyOptions {
  reveal: boolean;
  /** Letters the student picked; listed only when revealing. */
  selected?: readonly string[];
  labels: QuestionCopyLabels;
}

export function formatQuestionForCopy(question: CopyableQuestion, options: QuestionCopyOptions): string {
  const { labels } = options;
  const parts: string[] = [`# ${labels.questionHeading}`, '', question.stem.trim(), '', `# ${labels.optionsHeading}`];
  // Each alternative gets its own `## X` heading because option text can run
  // over several lines (or hold its own list/code), where an inline `A) …`
  // would blur the boundary between one option and the next.
  for (const alt of question.alternatives) parts.push('', `## ${alt.letter}`, '', alt.text.trim());
  if (!options.reveal) return parts.join('\n').trim() + '\n';

  const correct = question.alternatives.filter((a) => a.isCorrect).map((a) => a.letter);
  const correctList = correct.join(', ') || '-';
  parts.push('', `# ${labels.answerHeading}`, '');
  parts.push(`${correct.length > 1 ? labels.correctMany : labels.correctOne}: ${correctList}`);
  if (options.selected && options.selected.length > 0) {
    const picked = [...options.selected].sort();
    const label = picked.length > 1 ? labels.studentChoseMany : labels.studentChoseOne;
    parts.push('', `${label} ${picked.join(', ')}`);
  }

  const commented = question.alternatives.filter((a) => a.comment?.trim());
  if (commented.length > 0 || question.generalComment?.trim()) {
    parts.push('', `# ${labels.commentsHeading}`);
    for (const alt of commented) parts.push('', `## ${alt.letter}`, '', alt.comment!.trim());
    if (question.generalComment?.trim()) {
      parts.push('', `## ${labels.generalComment}`, '', question.generalComment.trim());
    }
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
