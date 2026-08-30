const ANY_HEADING = /^#{1,6}\s+.+$/;
const OPTION_LINE = /^\*([A-Za-z])\.\s*(.+?)\*$/;
// A short italic label followed by a colon (e.g. "*Translation: ...*", "*Tradução: ...*",
// "*Traducción: ...*"). Generic on purpose: older reviews were generated with localized
// headings/labels, so we can't match on exact English words. Never overlaps OPTION_LINE,
// which requires a single letter followed by a period, not a colon.
const ANNOTATION_LINE = /^\*[^*:]{2,24}:\s*.+\*$/;
const SOURCES_APPENDIX_START = /^(-{3,}|Sources\s*:?|Fontes\s*:?|Refer[eê]ncias\s*:?)$/i;
const BULLET_LINE = /^[-*]\s+(.+)$/;

export interface ParsedAlternative {
  letter: string;
  text: string;
  isCorrect: boolean;
  comment: string;
}

export interface ParsedQuestionDraft {
  stem: string;
  alternatives: ParsedAlternative[];
  topics: string[];
}

/** Line indices of every `#`-heading in the document, in order. */
function headingIndices(lines: string[]): number[] {
  const indices: number[] = [];
  lines.forEach((line, i) => {
    if (ANY_HEADING.test(line.trim())) indices.push(i);
  });
  return indices;
}

/** Lines strictly between heading index `start` and the next heading (or EOF). */
function sectionAfter(lines: string[], start: number, allHeadings: number[]): string[] {
  const nextHeadingIdx = allHeadings.find((h) => h > start);
  const end = nextHeadingIdx ?? lines.length;
  return lines.slice(start + 1, end);
}

function stripTrailingAppendix(lines: string[]): string[] {
  const cutoff = lines.findIndex((line) => SOURCES_APPENDIX_START.test(line.trim()));
  return cutoff === -1 ? lines : lines.slice(0, cutoff);
}

/** Extracts an ordered `letter -> comment` map from a section that restates each
 * option's letter+text (`*B. text*`) followed by prose explaining it — the shape
 * both the "Correct answer" and "Incorrect answers" sections use. */
function extractLetterComments(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let currentLetter: string | null = null;
  let currentComment = '';

  const flush = () => {
    if (currentLetter) map.set(currentLetter, currentComment.trim());
  };

  for (const raw of stripTrailingAppendix(lines)) {
    const line = raw.trim();
    if (!line || ANNOTATION_LINE.test(line)) continue;
    const match = OPTION_LINE.exec(line);
    if (match) {
      flush();
      currentLetter = match[1].toUpperCase();
      currentComment = '';
    } else if (currentLetter) {
      currentComment = currentComment ? `${currentComment}\n${line}` : line;
    }
  }
  flush();
  return map;
}

/**
 * Parses a review Markdown blob (AI-streamed or manually pasted) into a structured
 * question draft — a stem, one alternative per option with its own correctness flag
 * and comment, and a topics list. Sections are located by POSITION (the last four
 * `#`-headings in the document — question / alternatives / correct / incorrect, in
 * that order) rather than by matching specific heading text, so this tolerates
 * prompt/heading wording and language changing over time. A leading heading before
 * those four (when present) is treated as the "key concepts" / topics section.
 * Returns null when the review doesn't have this shape at all — callers must not
 * save a question that fails to parse.
 */
export function parseQuestionReview(review: string): ParsedQuestionDraft | null {
  const lines = review.replace(/\r\n/g, '\n').split('\n');
  const headings = headingIndices(lines);
  if (headings.length < 4) return null;

  const [questionH, alternativesH, correctH, incorrectH] = headings.slice(-4);
  const questionLines = sectionAfter(lines, questionH, headings);
  const alternativesLines = sectionAfter(lines, alternativesH, headings);
  const correctLines = sectionAfter(lines, correctH, headings);
  const incorrectLines = sectionAfter(lines, incorrectH, headings);

  const stem = questionLines
    .filter((line) => !ANNOTATION_LINE.test(line.trim()))
    .join('\n')
    .trim();
  if (!stem) return null;

  const options: { letter: string; text: string }[] = [];
  for (const raw of alternativesLines) {
    const match = OPTION_LINE.exec(raw.trim());
    if (match) options.push({ letter: match[1].toUpperCase(), text: match[2].trim() });
  }
  if (options.length < 2) return null;

  const correctComments = extractLetterComments(correctLines);
  const incorrectComments = extractLetterComments(incorrectLines);
  if (correctComments.size === 0) return null;

  const optionLetters = new Set(options.map((o) => o.letter));
  if (![...correctComments.keys()].every((letter) => optionLetters.has(letter))) return null;

  const alternatives: ParsedAlternative[] = options.map((option) => {
    const isCorrect = correctComments.has(option.letter);
    const comment = isCorrect
      ? correctComments.get(option.letter)!
      : (incorrectComments.get(option.letter) ?? '');
    return { letter: option.letter, text: option.text, isCorrect, comment };
  });

  const leadingHeadings = headings.slice(0, headings.length - 4);
  const topics = leadingHeadings.length > 0
    ? sectionAfter(lines, leadingHeadings[0], headings)
        .map((line) => BULLET_LINE.exec(line.trim())?.[1])
        .filter((text): text is string => !!text)
        .map((text) => text.replace(/\*\*/g, '').trim())
    : [];

  return { stem, alternatives, topics };
}
