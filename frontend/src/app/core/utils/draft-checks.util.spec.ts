import { ImportDraftQuestion } from '../models/import-draft.model';
import { draftWarnings, expectedCorrectCount } from './draft-checks.util';

function draft(partial: Partial<ImportDraftQuestion>): ImportDraftQuestion {
  return {
    jobId: 'job', index: 0, packId: 'pack', extractStatus: 'SUCCEEDED', title: 't', domain: null,
    stem: 'Which option fits best?', alternatives: [], error: null, preview: null, promoted: false,
    reExtractCount: 0, lastHint: null, createdAt: 0, updatedAt: 0, ...partial,
  };
}

const alt = (letter: string, text: string, isCorrect = false) => ({ letter, text, isCorrect });

describe('expectedCorrectCount', () => {
  it('reads the count asked for in several languages', () => {
    expect(expectedCorrectCount('Which steps are needed? (Select THREE.)')).toBe(3);
    expect(expectedCorrectCount('Choose two.')).toBe(2);
    expect(expectedCorrectCount('Quais opções atendem? (Selecione DUAS)')).toBe(2);
    expect(expectedCorrectCount('Marque três alternativas.')).toBe(3);
    expect(expectedCorrectCount('Elija dos respuestas.')).toBe(2);
    expect(expectedCorrectCount('Scegli le tre opzioni corrette.')).toBe(3);
    expect(expectedCorrectCount('Select 2 answers.')).toBe(2);
  });

  it('returns null when the stem does not state a count', () => {
    expect(expectedCorrectCount('Which service should the team choose?')).toBeNull();
    expect(expectedCorrectCount('Select the best option.')).toBeNull();
    expect(expectedCorrectCount(null)).toBeNull();
  });
});

describe('draftWarnings', () => {
  it('flags a correct-answer count that differs from the stem', () => {
    const d = draft({ stem: 'Pick the steps. (Select THREE.)', alternatives: [alt('A', 'a', true), alt('B', 'b', true), alt('C', 'c')] });
    expect(draftWarnings(d)).toEqual([{ kind: 'correctCount', expected: 3, found: 2 }]);
  });

  it('flags relabeled letters, duplicates and empty alternatives', () => {
    const d = draft({ lettersRelabeled: true, alternatives: [alt('A', 'Same  text', true), alt('B', 'same text'), alt('C', ' ')] });
    expect(draftWarnings(d).map((w) => w.kind)).toEqual(['lettersRelabeled', 'duplicateAlternatives', 'emptyAlternative']);
  });

  it('stays quiet for a coherent draft and for failed or promoted ones', () => {
    const ok = draft({ stem: 'Choose two.', alternatives: [alt('A', 'a', true), alt('B', 'b', true), alt('C', 'c')] });
    expect(draftWarnings(ok)).toEqual([]);
    expect(draftWarnings({ ...ok, lettersRelabeled: true, promoted: true })).toEqual([]);
    expect(draftWarnings({ ...ok, lettersRelabeled: true, extractStatus: 'FAILED' })).toEqual([]);
  });
});
