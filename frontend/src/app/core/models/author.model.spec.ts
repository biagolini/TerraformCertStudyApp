import { sameAuthorName } from './author.model';
import { groupByAuthor } from '../services/banks.service';

describe('bank authors', () => {
  it('matches names trimmed and case-insensitively', () => {
    expect(sameAuthorName(' Me ', 'me')).toBe(true);
    expect(sameAuthorName('Instructor A', 'Instructor B')).toBe(false);
  });

  it('keeps grouping banks by the name they store', () => {
    const bank = (id: string, author: string) => ({ id, packId: 'p', author, version: '', sourceUrl: '', description: '', createdAt: 0, updatedAt: 0 });
    expect(groupByAuthor([bank('1', 'Instructor A'), bank('2', 'Instructor A'), bank('3', '')]).map((g) => [g.author, g.banks.length])).toEqual([
      ['Instructor A', 2],
      ['', 1],
    ]);
  });
});
