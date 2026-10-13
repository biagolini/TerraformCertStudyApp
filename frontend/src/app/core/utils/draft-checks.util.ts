import { ImportDraftQuestion } from '../models/import-draft.model';

/** A coherence issue in an extracted draft that is not a hard failure but is
 * worth a reviewer's second look. Computed in code, no AI call. */
export type DraftWarning =
  | { kind: 'correctCount'; expected: number; found: number }
  | { kind: 'lettersRelabeled' }
  | { kind: 'duplicateAlternatives' }
  | { kind: 'emptyAlternative' };

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5,
  dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5,
  dos: 2, cuatro: 4,
  due: 2, tre: 3, quattro: 4, cinque: 5,
};

// "Select TWO", "(Choose three.)", "Selecione DUAS", "Elija dos", "Scegli le due"…
const SELECT_COUNT_RE =
  /\b(?:select|choose|pick|selecione|escolha|marque|seleccione|selecciona|elija|seleziona|selezionare|scegli|scegliere)(?:\s+(?:the|as|os|las|los|le|i))?\s+([\p{L}\d]+)/giu;

/** How many answers the stem asks for, when it says so explicitly. Every
 * match is tried: a scenario often says "choose a service" before the
 * actual "(Select TWO.)" instruction. */
export function expectedCorrectCount(stem: string | null | undefined): number | null {
  for (const match of (stem ?? '').matchAll(SELECT_COUNT_RE)) {
    const word = match[1].toLowerCase();
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word];
    if (n && n >= 2 && n <= 10) return n;
  }
  return null;
}

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

export function draftWarnings(draft: ImportDraftQuestion): DraftWarning[] {
  if (draft.extractStatus !== 'SUCCEEDED' || draft.promoted) return [];
  const warnings: DraftWarning[] = [];
  const alternatives = draft.alternatives ?? [];
  const expected = expectedCorrectCount(draft.stem);
  const found = alternatives.filter((a) => a.isCorrect).length;
  if (expected !== null && expected !== found) warnings.push({ kind: 'correctCount', expected, found });
  if (draft.lettersRelabeled) warnings.push({ kind: 'lettersRelabeled' });
  const texts = alternatives.map((a) => normalize(a.text ?? '')).filter(Boolean);
  if (new Set(texts).size < texts.length) warnings.push({ kind: 'duplicateAlternatives' });
  if (alternatives.some((a) => !normalize(a.text ?? ''))) warnings.push({ kind: 'emptyAlternative' });
  return warnings;
}
