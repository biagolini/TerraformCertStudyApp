import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  CertificationLevel,
  DEFAULT_PACK_COLOR,
  DEFAULT_PACK_NAME,
  MAX_PACK_DOMAINS,
  Pack,
  PackDomain,
  ProviderCategory,
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
  code?: string;
  provider?: ProviderCategory;
  level?: CertificationLevel;
  officialUrl?: string;
  passingScorePercent?: number;
  catalogId?: string;
}

@Injectable({ providedIn: 'root' })
export class PacksService {
  private readonly storage = inject(StorageService);
  private readonly settings = inject(SettingsService);

  private readonly state = signal<Pack[]>([]);
  /** True once the first load from storage has happened (even if the list is empty). */
  readonly loaded = signal(false);

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
    [...this.state()].sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)),
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

        // No seeding: an empty list is a real state now (Home shows the
        // empty state and the starter kit instead of a fake "My first exam").
        this.state.set(stored);
        this.loaded.set(true);
        const found = settings.activePackId ? stored.find((p) => p.id === settings.activePackId) : null;
        if (!found && stored.length > 0) {
          this.settings.setActivePackId(stored[0].id);
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
      ...this.certificationFields(draft),
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
            ...this.certificationFields(draft),
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
    this.storage.purgePackLocal(id);
    this.persist(remaining);
    if (this.settings.activePackId() === id) {
      this.settings.setActivePackId(remaining[0]?.id ?? '');
    }
  }

  setActive(id: string): void {
    if (!this.state().some((p) => p.id === id)) return;
    this.settings.setActivePackId(id);
  }

  /** Records that the user opened this certification's workspace (Home sorts and shows "last studied" from it).
   * Throttled to once per 10 minutes so navigating between tabs doesn't rewrite the pack on every click. */
  touch(id: string): void {
    const pack = this.getById(id);
    if (!pack) return;
    const now = Date.now();
    if (pack.lastStudiedAt && now - pack.lastStudiedAt < 10 * 60_000) return;
    this.persist(this.state().map((p) => (p.id === id ? { ...p, lastStudiedAt: now } : p)));
  }

  /** Swaps this pack with the one immediately before it in drawer order. No-op if already first. */
  moveUp(id: string): void {
    this.swapWithNeighbor(id, -1);
  }

  /** Swaps this pack with the one immediately after it in drawer order. No-op if already last. */
  moveDown(id: string): void {
    this.swapWithNeighbor(id, 1);
  }

  private swapWithNeighbor(id: string, direction: -1 | 1): void {
    const ordered = this.packs();
    const index = ordered.findIndex((p) => p.id === id);
    const neighborIndex = index + direction;
    if (index === -1 || neighborIndex < 0 || neighborIndex >= ordered.length) return;

    const reordered = [...ordered];
    [reordered[index], reordered[neighborIndex]] = [reordered[neighborIndex], reordered[index]];
    // Reassign sequential order to every pack, not just the two swapped, so any
    // pack still relying on the createdAt fallback gets a real order at this point.
    const next = reordered.map((p, i) => ({ ...p, order: i }));
    this.persist(next);
    // A reorder click is discrete and infrequent, unlike per-keystroke edits —
    // don't leave it sitting in the 500ms debounce window, where a quick
    // reload/tab-switch to check the other device could drop it silently.
    void this.storage.flushPendingSync();
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

  private certificationFields(draft: PackDraft): Partial<Pack> {
    const passing = draft.passingScorePercent;
    return {
      code: draft.code?.trim() || undefined,
      provider: draft.provider,
      level: draft.level,
      officialUrl: draft.officialUrl?.trim() || undefined,
      passingScorePercent:
        typeof passing === 'number' && Number.isFinite(passing) ? Math.max(1, Math.min(100, Math.round(passing))) : undefined,
      catalogId: draft.catalogId || undefined,
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
