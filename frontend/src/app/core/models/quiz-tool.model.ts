export type QuizToolId =
  | 'highlight'
  | 'strikethrough'
  | 'clearMarks'
  | 'note'
  | 'translate'
  | 'checkAnswer'
  | 'nextQuestion';

export interface QuizToolDef {
  id: QuizToolId;
  /** i18n key for the button label, reused by the Settings list so both stay in sync. */
  labelKey: string;
  /** Rendered only while the toolbar is pinned to the top of a phone-width
   * viewport (see QuizRunnerComponent.compactToolbar). These duplicate actions
   * that already exist at the bottom of the question, and only earn their space
   * when the user is scrolled into the middle of a long question on a phone and
   * those bottom buttons are off-screen. */
  compactOnly?: boolean;
  /** Only meaningful in instant-feedback mode — there is nothing to reveal while
   * running in exam mode, where grading happens at the end. */
  instantOnly?: boolean;
}

/** Single source of truth for the quiz annotation toolbar, rendered by
 * QuizRunnerComponent and toggled/reordered per-item in SettingsComponent —
 * see AppSettings.hiddenQuizTools / quizToolOrder / quizToolbarRows. */
export const QUIZ_TOOLS: QuizToolDef[] = [
  { id: 'highlight', labelKey: 'quizRunner.highlight' },
  { id: 'strikethrough', labelKey: 'quizRunner.strikethrough' },
  { id: 'clearMarks', labelKey: 'quizRunner.clearMarks' },
  { id: 'note', labelKey: 'quizRunner.note' },
  { id: 'translate', labelKey: 'reviewViewer.translate' },
  { id: 'checkAnswer', labelKey: 'quizRunner.checkAnswer', compactOnly: true, instantOnly: true },
  { id: 'nextQuestion', labelKey: 'importReview.next', compactOnly: true },
];

export const DEFAULT_QUIZ_TOOL_ORDER: QuizToolId[] = QUIZ_TOOLS.map((tool) => tool.id);

/** Hard cap on how many rows the toolbar may be split into. */
export const MAX_QUIZ_TOOLBAR_ROWS = 3;

export function isQuizToolId(value: unknown): value is QuizToolId {
  return typeof value === 'string' && QUIZ_TOOLS.some((tool) => tool.id === value);
}

/** Resolves a stored tool order into the actual QuizToolDef list, in that order
 * — same tolerance as resolveNavOrder: known ids first in the given order, then
 * any current tool missing from it, so a tool never disappears just because the
 * stored order predates it. */
export function resolveQuizToolOrder(order: readonly string[]): QuizToolDef[] {
  const byId = new Map(QUIZ_TOOLS.map((tool) => [tool.id, tool]));
  const ordered: QuizToolDef[] = [];
  const seen = new Set<QuizToolId>();
  for (const id of order) {
    const tool = byId.get(id as QuizToolId);
    if (tool && !seen.has(tool.id)) {
      ordered.push(tool);
      seen.add(tool.id);
    }
  }
  for (const tool of QUIZ_TOOLS) {
    if (!seen.has(tool.id)) ordered.push(tool);
  }
  return ordered;
}

/** Splits `items` into at most `requestedRows` rows, as evenly as possible with
 * the earlier rows taking the remainder. A row is only created when there is at
 * least one item to put in it, so asking for 3 rows with 2 items yields 2 rows,
 * never an empty one. */
export function splitQuizToolRows<T>(items: readonly T[], requestedRows: number): T[][] {
  if (items.length === 0) return [];
  const rows = Math.max(1, Math.min(Math.trunc(requestedRows) || 1, MAX_QUIZ_TOOLBAR_ROWS, items.length));
  const base = Math.floor(items.length / rows);
  const remainder = items.length % rows;
  const result: T[][] = [];
  let cursor = 0;
  for (let i = 0; i < rows; i++) {
    const size = base + (i < remainder ? 1 : 0);
    result.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return result;
}
