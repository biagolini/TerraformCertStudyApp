import { Injectable, computed, signal } from '@angular/core';
import { CertificationLevel, PackDomain, ProviderCategory } from '../models/pack.model';
import { PackDraft } from './packs.service';

/** One row of public/examples/index.json — see frontend/scripts/build_catalog_index.py. */
export interface CatalogEntry {
  id: string;
  file: string;
  name: string;
  code: string;
  provider: ProviderCategory;
  level: CertificationLevel;
  color: string;
  description: string;
  domainCount: number;
  examDurationMinutes: number | null;
  examTotalQuestions: number | null;
  passingScorePercent: number | null;
  accommodationMinutes: number | null;
  officialUrl: string | null;
}

interface TemplateFile {
  name?: string;
  version?: string;
  color?: string;
  description?: string;
  domains?: unknown[];
  exportIntroQuestions?: string;
  exportIntroTranscripts?: string;
  exportIntroChat?: string;
}

/** Read-only certification catalog served as static JSON next to the SPA. */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly state = signal<CatalogEntry[]>([]);
  private loading: Promise<void> | null = null;

  readonly entries = this.state.asReadonly();
  readonly loaded = signal(false);
  readonly byId = computed(() => new Map(this.state().map((e) => [e.id, e])));

  /** Idempotent: the first call fetches index.json, later calls reuse it. */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = fetch('examples/index.json')
        .then((res) => (res.ok ? (res.json() as Promise<CatalogEntry[]>) : []))
        .then((entries) => this.state.set(Array.isArray(entries) ? entries : []))
        .catch(() => this.state.set([]))
        .finally(() => this.loaded.set(true));
    }
    return this.loading;
  }

  /** Fetches the full template and merges it with the catalog metadata into a ready-to-create draft. */
  async draftFor(entry: CatalogEntry): Promise<PackDraft> {
    const res = await fetch(`examples/${entry.file}`);
    if (!res.ok) throw new Error(`Failed to load ${entry.file}`);
    const tpl = (await res.json()) as TemplateFile;
    return {
      name: tpl.name?.trim() || entry.name,
      description: tpl.description?.trim() ?? entry.description,
      version: tpl.version?.trim() ?? '',
      domains: parseDomains(tpl.domains),
      color: tpl.color || entry.color,
      exportIntroQuestions: tpl.exportIntroQuestions,
      exportIntroTranscripts: tpl.exportIntroTranscripts,
      exportIntroChat: tpl.exportIntroChat,
      examDurationMinutes: entry.examDurationMinutes ?? undefined,
      examTotalQuestions: entry.examTotalQuestions ?? undefined,
      accommodationMinutes: entry.accommodationMinutes ?? undefined,
      passingScorePercent: entry.passingScorePercent ?? undefined,
      code: entry.code,
      provider: entry.provider,
      level: entry.level,
      officialUrl: entry.officialUrl ?? undefined,
      catalogId: entry.id,
    };
  }
}

export function parseDomains(raw: unknown[] | undefined): PackDomain[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d): PackDomain | null => {
      if (typeof d === 'string' && d.trim()) return { name: d.trim(), description: '' };
      if (d && typeof d === 'object') {
        const obj = d as Record<string, unknown>;
        const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
        if (!name) return null;
        const entry: PackDomain = { name, description: typeof obj['description'] === 'string' ? obj['description'].trim() : '' };
        if (typeof obj['order'] === 'number' && obj['order'] > 0) entry.order = obj['order'];
        return entry;
      }
      return null;
    })
    .filter((d): d is PackDomain => d !== null);
}
