import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Question } from '../models/question.model';
import { DEFAULT_DOMAIN } from '../models/settings.model';
import { searchQuestions } from '../utils/search.util';
import { PacksService } from './packs.service';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class QuestionsService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<Question[]>([]);
  private readonly selectedIdsState = signal<ReadonlySet<string>>(new Set());
  private readonly searchQueryState = signal('');
  private readonly searchAllPacksState = signal(false);

  readonly allQuestions = computed(() =>
    [...this.state()].sort((a, b) => b.createdAt - a.createdAt),
  );

  readonly questions = computed(() => {
    const activeId = this.packs.activePack().id;
    return this.allQuestions().filter((q) => q.packId === activeId);
  });

  readonly count = computed(() => this.questions().length);

  readonly selectedIds = this.selectedIdsState.asReadonly();
  readonly selectedCount = computed(() => this.selectedIdsState().size);

  readonly selectedQuestions = computed(() => {
    const ids = this.selectedIdsState();
    return this.questions().filter((q) => ids.has(q.id));
  });

  readonly domainBreakdown = computed(() => {
    const counts = new Map<string, number>();
    for (const q of this.selectedQuestions()) {
      counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
    }
    return [...counts.entries()].map(([domain, total]) => ({ domain, total }));
  });

  readonly searchQuery = this.searchQueryState.asReadonly();
  readonly searchAllPacks = this.searchAllPacksState.asReadonly();

  readonly searchResults = computed(() => {
    const query = this.searchQueryState();
    if (!query.trim()) return [];
    const pool = this.searchAllPacksState() ? this.allQuestions() : this.questions();
    return searchQuestions(pool, query);
  });

  readonly isSearching = computed(() => this.searchQueryState().trim().length > 0);

  constructor() {
    // Load from storage when ready
    effect(() => {
      if (this.storage.ready()) {
        this.state.set(this.storage.getQuestions());
      }
    });

    // Reset selection on active pack change
    let lastActive: string | null = null;
    effect(() => {
      const activeId = this.packs.activePack().id;
      if (lastActive !== null && lastActive !== activeId) {
        this.selectedIdsState.set(new Set());
      }
      lastActive = activeId;
    });
  }

  add(question: Question): void {
    const next = [question, ...this.state()];
    this.persist(next);
  }

  updateDomain(id: string, domain: string): void {
    const next = this.state().map((q) =>
      q.id === id ? { ...q, domain: domain || DEFAULT_DOMAIN } : q,
    );
    this.persist(next);
  }

  updatePartial(
    id: string,
    partial: Partial<Omit<Question, 'id' | 'packId' | 'createdAt'>>,
  ): void {
    const next = this.state().map((q) =>
      q.id === id ? { ...q, ...partial, updatedAt: Date.now() } : q,
    );
    this.persist(next);
  }

  toggleStarred(id: string): void {
    const current = this.getById(id);
    this.updatePartial(id, { starred: !(current?.starred ?? false) });
  }

  remove(id: string): void {
    this.persist(this.state().filter((q) => q.id !== id));
    this.deselect(id);
  }

  async clearActivePack(): Promise<{ deleted: number; failed: number }> {
    const activeId = this.packs.activePack().id;
    return this.removeByPackId(activeId);
  }

  /** Deletes every question in a pack — awaits each backend DELETE and only
   * removes locally the ones actually confirmed deleted server-side. A
   * fire-and-forget version of this previously let a failed (or merely
   * slow) backend delete "disappear" locally only to reappear on the next
   * sync, since nothing was actually removed on the server.
   *
   * Deletes are sent in small sequential batches, not all at once — this
   * AWS account's Lambda concurrency limit is a mere 10 (shared across
   * every function), so firing e.g. 178 DELETEs in parallel via a single
   * Promise.all throttles almost all of them at the Lambda level, which
   * API Gateway surfaces as a flood of HTTP 500s rather than 429s. */
  async removeByPackId(packId: string): Promise<{ deleted: number; failed: number }> {
    const toDelete = this.state().filter((q) => q.packId === packId);
    if (toDelete.length === 0) return { deleted: 0, failed: 0 };

    const BATCH_SIZE = 4;
    const deletedIds = new Set<string>();
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = toDelete.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((q) => this.storage.deleteQuestion(q.id)));
      batch.forEach((q, idx) => {
        if (results[idx]) deletedIds.add(q.id);
      });
    }

    const next = this.state().filter((q) => !deletedIds.has(q.id));
    this.persist(next);
    this.selectedIdsState.set(new Set());

    return { deleted: deletedIds.size, failed: toDelete.length - deletedIds.size };
  }

  toggleSelected(id: string): void {
    const next = new Set(this.selectedIdsState());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIdsState.set(next);
  }

  selectAll(): void {
    this.selectedIdsState.set(new Set(this.questions().map((q) => q.id)));
  }

  deselectAll(): void {
    this.selectedIdsState.set(new Set());
  }

  deselect(id: string): void {
    if (!this.selectedIdsState().has(id)) return;
    const next = new Set(this.selectedIdsState());
    next.delete(id);
    this.selectedIdsState.set(next);
  }

  setSearchQuery(query: string): void {
    this.searchQueryState.set(query);
  }

  setSearchAllPacks(all: boolean): void {
    this.searchAllPacksState.set(all);
  }

  getById(id: string): Question | undefined {
    return this.state().find((q) => q.id === id);
  }

  private persist(next: Question[]): void {
    this.state.set(next);
    this.storage.saveQuestions(next);
  }
}
