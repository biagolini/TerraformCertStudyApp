import { flashcardsFromMarkdown, questionToFlashcard } from './flashcard.util';
import { domainMastery, scoreChartPoints } from './performance.util';
import { parseMarkdown } from '../../features/review-viewer/markdown-renderer.component';
import { groupByAuthor } from '../services/banks.service';
import { QuizAttempt, attemptPassed } from '../models/quiz-attempt.model';
import { Question } from '../models/question.model';
import { QuestionBank } from '../models/bank.model';
import { noteExcerpt, countWords } from '../models/note.model';

const q: Question = {
  id: 'q1',
  packId: 'p',
  bankId: 'b',
  title: 't',
  domain: 'D1',
  stem: 'Stem?',
  alternatives: [
    { letter: 'A', text: 'Wrong', isCorrect: false, comment: 'no' },
    { letter: 'B', text: 'Right', isCorrect: true, comment: 'because' },
  ],
  metadata: { topics: [], relatedServices: [] },
  createdAt: 0,
  updatedAt: 0,
};

function attempt(id: string, score: number, finishedAt: number, answers: Partial<QuizAttempt['answers'][number]>[]): QuizAttempt {
  return {
    id,
    status: 'FINISHED',
    packId: 'p',
    examSlug: 'p',
    examName: 'P',
    scope: 'pack',
    mode: 'exam',
    partialCredit: false,
    settings: { scope: 'pack', mode: 'exam', domains: [], count: 2, shuffle: false, trackTime: false, useAccommodation: false },
    answers: answers.map((a, i) => ({
      questionId: `q${i}`,
      title: '',
      domain: 'D1',
      selected: [],
      correctLetters: ['A'],
      score: 0,
      checked: true,
      stemSnapshot: '',
      alternativesSnapshot: [],
      highlights: {},
      strikethroughs: {},
      note: '',
      timeSpentSeconds: 0,
      markedForReview: false,
      ...a,
    })),
    currentIndex: 0,
    totalScore: 0,
    maxScore: answers.length,
    scorePercent: score,
    startedAt: finishedAt - 1000,
    finishedAt,
  };
}

describe('flashcards', () => {
  it('turns a question into a card with the correct answer on the back', () => {
    const card = questionToFlashcard(q, 'Bank');
    expect(card.front).toBe('Stem?');
    expect(card.back).toContain('**B.** Right');
    expect(card.back).toContain('because');
    expect(card.back).not.toContain('Wrong');
  });

  it('reads Front | Back tables (any supported language) from Markdown', () => {
    const md = 'Intro\n\n| Frente | Verso |\n|---|---|\n| What is S3? | Object storage |\n| Bad row | |\n\ntext';
    const cards = flashcardsFromMarkdown(md, 'Note', 'n1');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ front: 'What is S3?', back: 'Object storage', source: 'Note' });
  });

  it('ignores tables without front/back headers', () => {
    expect(flashcardsFromMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', 'N', 'n')).toEqual([]);
  });
});

describe('performance', () => {
  it('aggregates domain mastery with blanks counted as wrong, weakest first', () => {
    const a = attempt('a', 50, 2000, [
      { domain: 'D1', selected: ['A'], score: 1, timeSpentSeconds: 30 },
      { domain: 'D1', selected: [], score: 0, timeSpentSeconds: 10 },
      { domain: 'D2', selected: ['A'], score: 1, timeSpentSeconds: 20 },
    ]);
    const m = domainMastery([a]);
    expect(m[0]).toMatchObject({ domain: 'D1', answered: 1, total: 2, percent: 50, avgSeconds: 20 });
    expect(m[1]).toMatchObject({ domain: 'D2', percent: 100 });
  });

  it('plots attempts oldest first inside the padded box', () => {
    const pts = scoreChartPoints([attempt('new', 100, 3000, []), attempt('old', 0, 1000, [])], 200, 100, 10);
    expect(pts.map((p) => p.attempt.id)).toEqual(['old', 'new']);
    expect(pts[0]).toMatchObject({ x: 10, y: 90 });
    expect(pts[1]).toMatchObject({ x: 190, y: 10 });
  });

  it('uses the attempt snapshot pass mark before the fallback', () => {
    expect(attemptPassed({ scorePercent: 71, passingScorePercent: 72 }, 70)).toBe(false);
    expect(attemptPassed({ scorePercent: 71 }, 70)).toBe(true);
  });
});

describe('markdown renderer parser', () => {
  it('parses tables, ordered lists, task lists, quotes and code fences', () => {
    const blocks = parseMarkdown(
      '| A | B |\n|---|---|\n| 1 | 2 |\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo\n\n> quote\n\n```\ncode here\n```',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['table', 'ol', 'ul', 'quote', 'code']);
    const tasks = blocks[2] as { items: { checked: boolean | null }[] };
    expect(tasks.items.map((i) => i.checked)).toEqual([true, false]);
  });

  it('only turns http(s) links into anchors', () => {
    const [p] = parseMarkdown('[ok](https://example.com) and [bad](javascript:alert(1))');
    const inline = (p as { inline: { kind: string }[] }).inline;
    expect(inline.filter((s) => s.kind === 'link')).toHaveLength(1);
  });
});

describe('banks and notes helpers', () => {
  it('groups banks by author with unnamed authors last', () => {
    const b = (id: string, author: string) => ({ id, author }) as QuestionBank;
    const groups = groupByAuthor([b('1', ''), b('2', 'Zed'), b('3', 'Amy'), b('4', 'Amy')]);
    expect(groups.map((g) => [g.author, g.banks.length])).toEqual([['Amy', 2], ['Zed', 1], ['', 1]]);
  });

  it('builds plain-text excerpts and word counts from Markdown', () => {
    expect(noteExcerpt('# Title\n\n![img](note/x/y.png) **bold** text')).toBe('Title bold text');
    expect(countWords('one two\nthree')).toBe(3);
  });
});
