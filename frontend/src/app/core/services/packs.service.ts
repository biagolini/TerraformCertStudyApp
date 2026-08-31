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
  allowPartialCredit?: boolean;
  examTotalQuestions?: number;
  examDurationMinutes?: number;
  accommodationMinutes?: number;
}

@Injectable({ providedIn: 'root' })
export class PacksService {
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsService);

  private readonly state = signal<Pack[]>([]);

  /** Stable placeholder returned when no packs exist yet (before storage is ready). */
  private readonly placeholder: Pack = {
    id: '__placeholder__',
    name: DEFAULT_PACK_NAME,
    description: '',
    version: '',
    domains: [],
    color: DEFAULT_PACK_COLOR,
    createdAt: 0,
    updatedAt: 0,
  };

  readonly packs = computed(() =>
    [...this.state()].sort((a, b) => a.createdAt - b.createdAt),
  );

  readonly activePack = computed<Pack>(() => {
    const id = this.settings.activePackId();
    const all = this.state();
    const found = all.find((p) => p.id === id);
    if (found) return found;
    const fallback = all[0];
    if (fallback) return fallback;
    return this.placeholder;
  });

  readonly activeName = computed(() => this.activePack().name);
  readonly activeDomains = computed(() => this.activePack().domains);
  readonly activeColor = computed(() => this.activePack().color);

  constructor() {
    // Bootstrap when storage becomes ready.
    // This effect handles both pack loading AND activePackId validation
    // in a single pass, avoiding race conditions with SettingsService.
    effect(() => {
      if (this.storage.ready()) {
        const stored = this.storage.getPacks();
        const settings = this.storage.getSettings();
        console.debug('[PacksService] storage ready, stored packs:', stored.length, 'activePackId from storage:', settings.activePackId);

        if (stored.length > 0) {
          this.state.set(stored);
          // Validate that activePackId references an existing pack
          const found = settings.activePackId ? stored.find((p) => p.id === settings.activePackId) : null;
          if (!found) {
            console.debug('[PacksService] activePackId not found in packs, setting to first pack:', stored[0].id);
            this.settings.setActivePackId(stored[0].id);
          }
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
      allowPartialCredit: draft.allowPartialCredit ?? false,
      examTotalQuestions: draft.examTotalQuestions,
      examDurationMinutes: draft.examDurationMinutes,
      accommodationMinutes: draft.accommodationMinutes,
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
            allowPartialCredit: draft.allowPartialCredit ?? false,
            examTotalQuestions: draft.examTotalQuestions,
            examDurationMinutes: draft.examDurationMinutes,
            accommodationMinutes: draft.accommodationMinutes,
            updatedAt: Date.now(),
          }
        : p,
    );
    this.persist(next);
  }

  remove(id: string): void {
    // Delete from backend immediately
    void this.storage.deletePack(id);

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
