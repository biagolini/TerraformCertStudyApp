import { Question } from '../models/question.model';

export function buildBatches(questions: Question[], maxPerFile: number): Question[][] {
  const total = questions.length;
  if (total === 0 || maxPerFile <= 0) return [];
  if (total <= maxPerFile) return [questions.slice()];

  const numFiles = Math.ceil(total / maxPerFile);
  const base = Math.floor(total / numFiles);
  const extra = total % numFiles;

  const batches: Question[][] = [];
  let cursor = 0;
  for (let i = 0; i < numFiles; i++) {
    const size = i < extra ? base + 1 : base;
    batches.push(questions.slice(cursor, cursor + size));
    cursor += size;
  }
  return batches;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
