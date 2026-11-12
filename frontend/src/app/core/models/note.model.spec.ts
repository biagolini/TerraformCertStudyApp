import { describe, expect, it } from 'vitest';
import { Note, sortNotes } from './note.model';

const note = (id: string, title: string, wordCount: number, createdAt: number, updatedAt: number): Note => ({
  id,
  packId: 'p',
  title,
  tags: [],
  excerpt: '',
  wordCount,
  createdAt,
  updatedAt,
});

const NOTES = [note('a', 'beta', 50, 3, 10), note('b', 'Álgebra', 200, 1, 30), note('c', 'gamma', 10, 2, 20)];
const ids = (list: Note[]) => list.map((n) => n.id).join('');

describe('sortNotes', () => {
  it('orders by last modified, created and word count in both directions', () => {
    expect(ids(sortNotes(NOTES, { field: 'updatedAt', dir: 'desc' }, 'en'))).toBe('bca');
    expect(ids(sortNotes(NOTES, { field: 'updatedAt', dir: 'asc' }, 'en'))).toBe('acb');
    expect(ids(sortNotes(NOTES, { field: 'createdAt', dir: 'asc' }, 'en'))).toBe('bca');
    expect(ids(sortNotes(NOTES, { field: 'wordCount', dir: 'desc' }, 'en'))).toBe('bac');
  });

  it('orders titles ignoring case and accents', () => {
    expect(ids(sortNotes(NOTES, { field: 'title', dir: 'asc' }, 'pt'))).toBe('bac');
    expect(ids(sortNotes(NOTES, { field: 'title', dir: 'desc' }, 'pt'))).toBe('cab');
  });

  it('does not change the input array', () => {
    sortNotes(NOTES, { field: 'title', dir: 'asc' }, 'en');
    expect(ids(NOTES)).toBe('abc');
  });
});
