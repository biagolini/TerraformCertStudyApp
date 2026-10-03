const TITLE_HEADING = /^#{2,3}\s*T[ií]tulo\s*:?$/i;
const DOMAIN_HEADING = /^#{2,3}\s*Dom[ií]nio da prova\s*:?$/i;
const BODY_START_HEADING = /^#{2,3}\s*Conceitos-chave relacionados.*$/i;
const ANY_HEADING = /^#{1,6}\s/;

/** Content of the first section under a heading line matching `pattern`, up to the next heading. */
function extractSection(lines: string[], pattern: RegExp): string | null {
  const start = lines.findIndex((line) => pattern.test(line.trim()));
  if (start === -1) return null;
  const content: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i].trim())) break;
    content.push(lines[i]);
  }
  const joined = content.join('\n').trim();
  return joined || null;
}

export interface ReadyMadeParseResult {
  title: string | null;
  domain: string | null;
  remainder: string;
}

/**
 * Pulls "### Título:" / "### Domínio da prova:" out of a pasted ready-made review
 * (see CLAUDE.md example format) and returns the text trimmed to start at
 * "### Conceitos-chave relacionados à pergunta:", the actual expected review body.
 */
export function parseReadyMadePaste(text: string, domains: string[]): ReadyMadeParseResult {
  const lines = text.split('\n');

  const rawTitle = extractSection(lines, TITLE_HEADING);
  const title = rawTitle ? rawTitle.replace(/\s+/g, ' ').trim() : null;

  const rawDomain = extractSection(lines, DOMAIN_HEADING);
  let domain: string | null = null;
  if (rawDomain) {
    const cleaned = rawDomain.replace(/\s+/g, ' ').trim();
    domain =
      domains.find((d) => d.toLowerCase() === cleaned.toLowerCase()) ??
      domains.find(
        (d) => cleaned.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(cleaned.toLowerCase()),
      ) ??
      null;
  }

  const bodyStart = lines.findIndex((line) => BODY_START_HEADING.test(line.trim()));
  const remainder = bodyStart === -1 ? text : lines.slice(bodyStart).join('\n').trimStart();

  return { title, domain, remainder };
}
