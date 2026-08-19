import { DEFAULT_DOMAIN } from '../models/settings.model';

const MAX_TITLE_LENGTH = 80;

export function inferDomain(text: string, domains: string[]): string {
  if (domains.length === 0) return DEFAULT_DOMAIN;
  const lower = text.toLowerCase();
  for (const domain of domains) {
    if (lower.includes(domain.toLowerCase())) return domain;
  }
  return domains[0];
}

export function parseDomainFromResponse(text: string, domains: string[]): string {
  const match = text.match(/INFERRED_DOMAIN:\s*(.+)/);
  if (!match) return inferDomain(text, domains);
  const raw = match[1].trim();
  if (domains.length === 0) return DEFAULT_DOMAIN;
  const exact = domains.find((d) => d.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  return domains[0];
}

export function parseTitleFromResponse(text: string, fallback: string): string {
  const match = text.match(/INFERRED_TITLE:\s*(.+)/);
  const raw = match ? match[1].trim() : '';
  const cleaned = raw.replace(/^["'`*_]+|["'`*_]+$/g, '').trim();
  const candidate = cleaned || fallback.trim();
  if (candidate.length <= MAX_TITLE_LENGTH) return candidate;
  return `${candidate.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function stripInferredMetadata(text: string): string {
  return text
    .replace(/\n?INFERRED_DOMAIN:\s*.+/gi, '')
    .replace(/\n?INFERRED_TITLE:\s*.+/gi, '')
    .trimEnd();
}
