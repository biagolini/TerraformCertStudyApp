import { Question } from '../models/question.model';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  source: string;
  domain?: string;
}

/** A question as a card: the scenario on the front; the correct alternative(s) and the explanation on the back. */
export function questionToFlashcard(q: Question, source: string): Flashcard {
  const correct = q.alternatives.filter((a) => a.isCorrect);
  const answer = correct.map((a) => `**${a.letter}.** ${a.text}`).join('\n\n');
  const why = correct.map((a) => a.comment).filter(Boolean).join('\n\n');
  const general = q.generalComment ? `\n\n${q.generalComment}` : '';
  return {
    id: `q:${q.id}`,
    front: q.stem,
    back: `${answer}${why ? `\n\n---\n\n${why}` : ''}${general}`,
    source,
    domain: q.domain,
  };
}

/** Cards from Markdown tables whose header is "Front | Back" (the note copilot's flashcard format), in any language-neutral casing. */
export function flashcardsFromMarkdown(markdown: string, source: string, idPrefix: string): Flashcard[] {
  const cards: Flashcard[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const header = cells(lines[i]);
    if (header.length < 2 || !/^\|?\s*:?-{3,}/.test(lines[i + 1].trim())) continue;
    const frontIdx = header.findIndex((h) => /^(front|frente|anverso|fronte|question|pergunta|pregunta|domanda)$/i.test(h));
    const backIdx = header.findIndex((h) => /^(back|verso|reverso|retro|answer|resposta|respuesta|risposta)$/i.test(h));
    if (frontIdx < 0 || backIdx < 0) continue;
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const row = cells(lines[j]);
      const front = row[frontIdx]?.trim();
      const back = row[backIdx]?.trim();
      if (front && back) cards.push({ id: `${idPrefix}:${j}`, front, back, source });
    }
  }
  return cards;
}

function cells(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith('|')) return [];
  return t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
