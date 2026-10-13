import { groupByAuthorWithRegistered } from './banks.service';
import { QuestionBank } from '../models/bank.model';

function bank(id: string, author: string): QuestionBank {
  return { id, packId: 'p', author, version: '', sourceUrl: '', description: '', createdAt: 0, updatedAt: 0 };
}

describe('groupByAuthorWithRegistered', () => {
  it('adds an empty group for a registered author without banks, sorted, unnamed last', () => {
    const groups = groupByAuthorWithRegistered([bank('1', 'Instructor B'), bank('2', '')], ['Instructor A']);
    expect(groups.map((g) => [g.author, g.banks.length])).toEqual([
      ['Instructor A', 0],
      ['Instructor B', 1],
      ['', 1],
    ]);
  });

  it('matches registered names case-insensitively', () => {
    const groups = groupByAuthorWithRegistered([bank('1', 'instructor a')], ['Instructor A']);
    expect(groups).toHaveLength(1);
    expect(groups[0].banks).toHaveLength(1);
  });
});
