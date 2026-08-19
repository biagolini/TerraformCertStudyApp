import { Question } from '../models/question.model';

/**
 * Normalize text for search: lowercase, remove diacritics/accents.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface SearchResult {
  question: Question;
  /** Higher score = better match. 3 = exact phrase, 2 = all terms, 1 = partial. */
  score: number;
}

/**
 * Search questions by query. Returns matched questions ranked by relevance.
 *
 * Ranking:
 * - Score 3: exact phrase match (all terms adjacent in order)
 * - Score 2: all terms present (any order)
 * - Score 1: at least one term present
 *
 * Searches across: title + domain + review (concatenated, normalized).
 */
export function searchQuestions(questions: Question[], query: string): SearchResult[] {
  const normalizedQuery = normalizeText(query.trim());
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];

  for (const question of questions) {
    const haystack = normalizeText(
      `${question.title} ${question.domain} ${question.review}`,
    );

    const score = computeScore(haystack, normalizedQuery, terms);
    if (score > 0) {
      results.push({ question, score });
    }
  }

  // Sort by score desc, then by createdAt desc (newest first within same score)
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.question.createdAt - a.question.createdAt;
  });

  return results;
}

function computeScore(haystack: string, fullPhrase: string, terms: string[]): number {
  // Score 3: exact phrase found
  if (haystack.includes(fullPhrase)) {
    return 3;
  }

  // Count how many terms are present
  const matched = terms.filter((term) => haystack.includes(term));

  // Score 2: all terms present (any order)
  if (matched.length === terms.length) {
    return 2;
  }

  // Score 1: at least one term present
  if (matched.length > 0) {
    return 1;
  }

  return 0;
}
