import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  DEFAULT_PACK_COLOR,
  DEFAULT_PACK_NAME,
  MAX_PACK_DOMAINS,
  Pack,
  PackDomain,
  isAcceptablePackColor,
} from '../models/pack.model';
import { SettingsService } from './settings.service';
import { StorageService } from './storage.service';

export interface PackDraft {
  name: string;
  description: string;
  version: string;
  domains: PackDomain[];
  color: string;
  exportIntroQuestions?: string;
  exportIntroTranscripts?: string;
  exportIntroChat?: string;
}

@Injectable({ providedIn: 'root' })
export class PacksService {
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsService);

  private readonly state = signal<Pack[]>([]);

  readonly packs = computed(() =>
    [...this.state()].sort((a, b) => a.createdAt - b.createdAt),
  );

  readonly activePack = computed<Pack>(() => {
    const id = this.settings.activePackId();
    const all = this.state();
    const found = all.find((p) => p.id === id);
    if (found) return found;
    const fallback = all[0];
    if (fallback) {
      this.settings.setActivePackId(fallback.id);
      return fallback;
    }
    return this.seedDefaultPack();
  });

  readonly activeName = computed(() => this.activePack().name);
  readonly activeDomains = computed(() => this.activePack().domains);
  readonly activeColor = computed(() => this.activePack().color);

  constructor() {
    // Re-bootstrap when storage becomes ready
    effect(() => {
      if (this.storage.ready()) {
        const stored = this.storage.getPacks();
        if (stored.length > 0) {
          this.state.set(stored);
        } else {
          const seed = this.makeSeedPack();
          this.state.set([seed]);
          this.storage.savePacks([seed]);
          this.settings.setActivePackId(seed.id);
        }
      }
    });
  }

  create(draft: PackDraft): Pack {
    const now = Date.now();
    const pack: Pack = {
      id: this.uuid(),
      name: draft.name.trim() || DEFAULT_PACK_NAME,
      description: draft.description.trim(),
      version: draft.version.trim(),
      domains: this.normalizeDomains(draft.domains),
      color: isAcceptablePackColor(draft.color) ? draft.color : DEFAULT_PACK_COLOR,
      createdAt: now,
      updatedAt: now,
      exportIntroQuestions: draft.exportIntroQuestions?.trim() || undefined,
      exportIntroTranscripts: draft.exportIntroTranscripts?.trim() || undefined,
      exportIntroChat: draft.exportIntroChat?.trim() || undefined,
    };
    const next = [...this.state(), pack];
    this.persist(next);
    this.settings.setActivePackId(pack.id);
    return pack;
  }

  update(id: string, draft: PackDraft): void {
    const next = this.state().map((p) =>
      p.id === id
        ? {
            ...p,
            name: draft.name.trim() || p.name,
            description: draft.description.trim(),
            version: draft.version.trim(),
            domains: this.normalizeDomains(draft.domains),
            color: isAcceptablePackColor(draft.color) ? draft.color : p.color,
            exportIntroQuestions: draft.exportIntroQuestions?.trim() || undefined,
            exportIntroTranscripts: draft.exportIntroTranscripts?.trim() || undefined,
            exportIntroChat: draft.exportIntroChat?.trim() || undefined,
            updatedAt: Date.now(),
          }
        : p,
    );
    this.persist(next);
  }

  remove(id: string): void {
    const remaining = this.state().filter((p) => p.id !== id);
    if (remaining.length === 0) {
      const replacement = this.makeSeedPack();
      this.persist([replacement]);
      this.settings.setActivePackId(replacement.id);
      return;
    }
    this.persist(remaining);
    if (this.settings.activePackId() === id) {
      this.settings.setActivePackId(remaining[0].id);
    }
  }

  setActive(id: string): void {
    if (!this.state().some((p) => p.id === id)) return;
    this.settings.setActivePackId(id);
  }

  getById(id: string): Pack | undefined {
    return this.state().find((p) => p.id === id);
  }

  private normalizeDomains(domains: PackDomain[]): PackDomain[] {
    const seen = new Set<string>();
    const result: PackDomain[] = [];
    for (const domain of domains) {
      const name = domain.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const entry: PackDomain = { name, description: domain.description.trim() };
      if (typeof domain.order === 'number') entry.order = domain.order;
      result.push(entry);
      if (result.length >= MAX_PACK_DOMAINS) break;
    }
    return result;
  }

  private seedDefaultPack(): Pack {
    const seed = this.makeSeedPack();
    this.state.set([seed]);
    this.storage.savePacks([seed]);
    this.settings.setActivePackId(seed.id);
    return seed;
  }

  private makeSeedPack(): Pack {
    const now = Date.now();
    return {
      id: this.uuid(),
      name: DEFAULT_PACK_NAME,
      description: '',
      version: '',
      domains: [],
      color: DEFAULT_PACK_COLOR,
      createdAt: now,
      updatedAt: now,
    };
  }

  private persist(packs: Pack[]): void {
    this.state.set(packs);
    this.storage.savePacks(packs);
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
