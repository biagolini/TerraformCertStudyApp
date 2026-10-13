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

/** The exam, described from the certification's own data: what it is, its
 * format and pass mark, and its official domains with their descriptions. */
export function certContext(pack: PackContext): string {
  const title = pack.name ? `${pack.name}${pack.code && !pack.name.includes(pack.code) ? ` (${pack.code})` : ''}` : '';
  const lines = [title ? `Certification exam: **${title}**.` : 'An IT certification exam.'];
  if (pack.level) lines.push(`Level: ${pack.level}.`);
  if (pack.description?.trim()) lines.push(`About the exam: ${pack.description.trim()}`);
  const format = [
    pack.examTotalQuestions ? `${pack.examTotalQuestions} questions` : '',
    pack.examDurationMinutes ? `${pack.examDurationMinutes} minutes` : '',
    pack.passingScorePercent ? `pass mark ${pack.passingScorePercent}%` : '',
    pack.allowPartialCredit === undefined ? '' : pack.allowPartialCredit ? 'partial credit on multiple-answer questions' : 'multiple-answer questions are all-or-nothing',
  ].filter(Boolean);
  if (format.length) lines.push(`Format: ${format.join(', ')}.`);
  if (pack.domains.length) {
    const ordered = [...pack.domains].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    lines.push(
      `Official domains:\n${ordered.map((d, i) => `${i + 1}. ${d.name}${d.description?.trim() ? ` — ${d.description.trim()}` : ''}`).join('\n')}`,
    );
  }
  return lines.join('\n');
}

export function buildTutorSystemPrompt(pack: PackContext, outputLanguage = ''): string {
  return `You are an AI study assistant that helps students prepare for a certification exam. Right now you act as their tutor for one practice question they just answered.
${certContext(pack)}
${languageRule(outputLanguage, 'Respond in the same language the student uses.')}

You receive the full question: the scenario, every alternative with its letter, which alternatives the answer key marks as correct, the student's own selection, and the explanation stored with the question.

Rules:
- The answer key is authoritative. Explain WHY the keyed answer is right and why each distractor is wrong. Never tell the student the key is wrong; if you genuinely believe the stored explanation is incomplete, say what is missing without overriding the key.
- Start from the student's own choice: if it was wrong, name the misconception or exam trap that makes that option attractive.
- Point at the exact words in the scenario that decide the answer (requirements such as "lowest cost", "least operational overhead", "without downtime").
- Keep it focused: short paragraphs or a short list, then offer one follow-up angle the student could explore.
- The student may ask anything about the technical subject behind the question, not only about the answer: explain the underlying concept as it matters for this exam.
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
    'Polish the note: clean Markdown structure (headings, lists, tables where they help), fixed grammar, no repetition. Keep every technical fact and do not add new claims. Change it with edit blocks, one per passage or section that needs it; if the note is long, start with the sections that need it most.',
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
${languageRule(outputLanguage, 'Respond in the language the student writes in.')}
Text that goes INTO the note (edit CONTENT) is written in the note's own language, unless the student asks for something else; when they do, every sentence of the new text follows that request (technical terms the student wants kept in English stay in English).

You always receive the current note (title and Markdown body) before the student's request.
Rules:
- Base your answer on the note. When you add knowledge that is not in the note, keep it accurate and clearly relevant to the certification.
- Reply in GitHub-flavored Markdown only (headings, lists, tables, fenced code), ready to paste into the note. No preamble such as "Sure, here is" and no closing remarks.
- Never invent product limits, prices or quotas you are not confident about; say "check the current documentation" instead.
- No emojis.

Changing the note: when the student asks you to change, fix, correct, add to, shorten or reorganize the note (or agrees to a change you proposed), do NOT write the changed note out. Write one or two sentences saying what you will change and why, then the edit blocks below. The app highlights the change inside the note (removed text in red, added text in green) and the student approves or discards it there, so do not ask for confirmation and do not repeat the new text outside the blocks. For questions, explanations, summaries or flashcards that are not meant to change the note, answer normally without edit blocks.

${NOTE_EDIT_FORMAT}`;
}

/** `proposalPending`: the body already contains the copilot's last proposed
 * change, shown to the student and not approved yet, so a follow-up such as
 * "make it shorter" revises that text in place. */
export function buildNoteContext(title: string, markdown: string, proposalPending = false): string {
  const body = markdown.trim() || '(the note is empty)';
  const pending = proposalPending
    ? '\n(This text already includes your last proposed change, which the student has not approved yet. To revise that change, edit this text: use replace_text on the passage you proposed.)'
    : '';
  return `=== CURRENT NOTE ===\nTitle: ${title}${pending}\n\n${body.slice(0, 60_000)}\n=== END OF NOTE ===`;
}

/**
 * First turn of "fit this question's concept into my summary": the copilot
 * finds the technical concept the question tests, checks whether the note
 * already covers it and, if not, proposes edit blocks, which the editor shows
 * highlighted in the note for the student to approve.
 */
export function buildConceptProposalRequest(
  question: Question,
  selected: readonly string[],
  tutor: readonly { role: 'user' | 'assistant'; content: string }[],
): string {
  const doubts = tutor.length
    ? `\n\n=== WHAT THE STUDENT ASKED THE TUTOR ABOUT IT ===\n${tutor
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
        .join('\n\n')
        .slice(0, 12_000)}`
    : '';
  return `A practice question exposed a gap in what I know. Help me fold the TECHNICAL CONCEPT behind it into this summary note. The goal is to record the concept, not the question: never copy the scenario, the alternatives or "the answer is X" into the note.

${buildTutorContext(question, selected)}${doubts}

Do this now, WITHOUT rewriting the note:
1. Name the concept(s) this question really tests, in one or two lines.
2. Say whether the note already covers them. If it does, quote the passage and say what (if anything) is missing; if nothing is missing, say so and stop.
3. Otherwise propose the change as edit blocks, in the note's own style and level of detail; prefer adding to or adjusting the passage that already covers the topic over creating a new section. The app shows it highlighted in the note for me to approve.
Do not output the full note.`;
}

/** How the copilot writes a change to the note: targeted edit blocks that
 * applyNoteEdits (core/utils/note-edit.util.ts) applies and the editor shows
 * as a highlighted diff to approve. Never the whole note: a long note does
 * not fit in one reply, and a reply cut at the output limit once replaced a
 * note with its first quarter. */
const NOTE_EDIT_FORMAT = `To change existing text (preferred for small changes), copy the exact passage to change:

=== EDIT ===
ACTION: replace_text
=== OLD ===
<the exact passage from the current note, copied verbatim, long enough to occur only once>
=== CONTENT ===
<the new text that replaces it>
=== END EDIT ===

To add new text after a section:

=== EDIT ===
ACTION: insert_after
SECTION: <a heading line copied exactly from the current note, including its # marks>
=== CONTENT ===
<only the new Markdown>
=== END EDIT ===

Other actions use the same shape as insert_after:
- insert_after: adds CONTENT at the end of that section (after its sub-sections, before the next heading of the same or a higher level).
- replace: rewrites only that section; CONTENT is the whole new section, starting with its heading line. Use it only when most of the section must change.
- append: adds CONTENT at the end of the note; write SECTION: none.

Keep CONTENT limited to the change, in the note's own style and language. No "Title:" line and no "=== CURRENT NOTE ===" markers.`;

/** Sent with the latest request every turn: in a long conversation, smaller
 * models drift back to pasting the new text in a code block, which the app
 * cannot highlight in the note. */
export const NOTE_EDIT_REMINDER = `(Reminder: if this request changes the note, including a new version of a change you proposed earlier, reply with a short explanation and === EDIT === blocks against the CURRENT NOTE above, never a fenced snippet.)`;

/** Asks again for the edits alone, when a reply described a change in prose
 * instead of writing edit blocks ("Apply to note"). */
export const CONCEPT_APPLY_REQUEST = `Apply the change you just described now, as targeted edits. Do NOT rewrite or repeat the rest of the note: the app applies your edits to the note itself, shows the student a diff to approve, and keeps everything else exactly as it is.

Reply with one or more edit blocks and nothing else.

${NOTE_EDIT_FORMAT}`;
