import { outputLanguageLabel } from '../models/settings.model';
import { PackContext } from '../models/pack.model';
import { Question } from '../models/question.model';

/**
 * Prompts for the two study assistants added with the certification
 * workspace: the per-question tutor (mock exams) and the note copilot.
 * Both are product surface: the tutor must stay anchored to the official
 * explanation stored with the question (never "correct" the answer key on
 * its own), and the copilot must return Markdown that can be inserted into
 * a note as-is.
 */

function languageRule(outputLanguage: string, fallback: string): string {
  return outputLanguage
    ? `OUTPUT LANGUAGE: Respond in **${outputLanguageLabel(outputLanguage)}**.`
    : `OUTPUT LANGUAGE: ${fallback}`;
}

function certContext(pack: PackContext): string {
  const domains = pack.domains.length
    ? `\nOfficial domains:\n${pack.domains.map((d, i) => `${i + 1}. ${d.name}`).join('\n')}`
    : '';
  return `${pack.name ? `Certification: **${pack.name}**.` : 'An IT certification exam.'}${domains}`;
}

export function buildTutorSystemPrompt(pack: PackContext, outputLanguage = ''): string {
  return `You are an expert exam tutor. A student just worked on one practice question and wants to understand it.
${certContext(pack)}
${languageRule(outputLanguage, 'Respond in the same language the student uses.')}

You receive the full question: the scenario, every alternative with its letter, which alternatives the answer key marks as correct, the student's own selection, and the explanation stored with the question.

Rules:
- The answer key is authoritative. Explain WHY the keyed answer is right and why each distractor is wrong. Never tell the student the key is wrong; if you genuinely believe the stored explanation is incomplete, say what is missing without overriding the key.
- Start from the student's own choice: if it was wrong, name the misconception or exam trap that makes that option attractive.
- Point at the exact words in the scenario that decide the answer (requirements such as "lowest cost", "least operational overhead", "without downtime").
- Keep it focused: short paragraphs or a short list, then offer one follow-up angle the student could explore.
- Use **bold** for service names and key terms. No emojis.`;
}

export function buildTutorContext(question: Question, selected: readonly string[]): string {
  const alternatives = question.alternatives
    .map((a) => `${a.letter}. ${a.text}${a.isCorrect ? '  [KEY: correct]' : ''}${a.comment ? `\n   Stored explanation: ${a.comment}` : ''}`)
    .join('\n');
  const chosen = selected.length ? selected.join(', ') : 'nothing (left blank)';
  const general = question.generalComment ? `\nGeneral explanation stored with the question: ${question.generalComment}` : '';
  return `=== QUESTION (${question.domain}) ===
${question.stem}

=== ALTERNATIVES ===
${alternatives}
${general}

=== STUDENT'S ANSWER ===
${chosen}`;
}

export type CopilotAction = 'polish' | 'summary' | 'flashcards' | 'quiz' | 'explain' | 'outline';

export const COPILOT_ACTIONS: CopilotAction[] = ['polish', 'summary', 'flashcards', 'quiz', 'explain', 'outline'];

/** Instruction sent as the user turn for a one-click copilot action. */
export const COPILOT_ACTION_INSTRUCTIONS: Record<CopilotAction, string> = {
  polish:
    'Rewrite the whole note with clean Markdown structure (headings, lists, tables where they help), fixing grammar and removing repetition. Keep every technical fact; do not add new claims.',
  summary:
    'Write an exam-focused summary of the note: the 5 to 10 points most likely to be tested, each with the decisive detail (limits, defaults, "use X when Y"). End with a short "Common traps" list.',
  flashcards:
    'Turn the note into 8 to 15 flashcards. Output a Markdown table with two columns, "Front" and "Back". Fronts are short questions; backs are one or two precise sentences.',
  quiz:
    'Write 3 exam-style multiple-choice questions based only on the note, each with 4 alternatives (A to D), then the answer key with one sentence of reasoning per question.',
  explain:
    'Explain the hardest concepts in this note as a tutor would: intuition first, then the precise technical detail, then one concrete example scenario.',
  outline:
    'Propose a better outline for this note as a nested Markdown list, and list the topics of the certification that seem missing from it.',
};

export function buildNoteCopilotSystemPrompt(pack: PackContext, outputLanguage = ''): string {
  return `You are a study copilot embedded in a Markdown note editor. You help a student preparing for a certification exam improve and use their notes.
${certContext(pack)}
${languageRule(outputLanguage, 'Respond in the language the note is written in.')}

You always receive the current note (title and Markdown body) before the student's request.
Rules:
- Base your answer on the note. When you add knowledge that is not in the note, keep it accurate and clearly relevant to the certification.
- Reply in GitHub-flavored Markdown only (headings, lists, tables, fenced code), ready to paste into the note. No preamble such as "Sure, here is" and no closing remarks.
- Never invent product limits, prices or quotas you are not confident about; say "check the current documentation" instead.
- No emojis.`;
}

export function buildNoteContext(title: string, markdown: string): string {
  const body = markdown.trim() || '(the note is empty)';
  return `=== CURRENT NOTE ===\nTitle: ${title}\n\n${body.slice(0, 60_000)}\n=== END OF NOTE ===`;
}
