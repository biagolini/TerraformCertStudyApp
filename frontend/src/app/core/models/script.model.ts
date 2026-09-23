export interface Script {
  id: string;
  title: string;
  content: string;
  sources: string[];
  createdAt: number;
}

export const SCRIPT_TITLE_PREFIX = 'Resumo técnico';

export function fullScriptTitle(title: string): string {
  const cleaned = (title || '').trim();
  if (!cleaned) return SCRIPT_TITLE_PREFIX;
  if (cleaned.toLowerCase().startsWith(SCRIPT_TITLE_PREFIX.toLowerCase())) return cleaned;
  return `${SCRIPT_TITLE_PREFIX}: ${cleaned}`;
}
