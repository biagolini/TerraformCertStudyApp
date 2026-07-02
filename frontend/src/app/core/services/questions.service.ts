import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Question } from '../models/question.model';
import { DEFAULT_DOMAIN } from '../models/settings.model';
import { PacksService } from './packs.service';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class QuestionsService {
  private readonly storage = inject(StorageService);
  private readonly packs = inject(PacksService);

  private readonly state = signal<Question[]>([]);
  private readonly selectedIdsState = signal<ReadonlySet<string>>(new Set());

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

  updateReview(id: string, review: string): void {
    const trimmed = review.trim();
    if (!trimmed) return;
    const next = this.state().map((q) =>
      q.id === id ? { ...q, review: trimmed } : q,
    );
    this.persist(next);
  }

  setReview(id: string, review: string): void {
    const next = this.state().map((q) =>
      q.id === id ? { ...q, review } : q,
    );
    this.persist(next);
  }

  appendToReview(id: string, chunk: string): void {
    if (!chunk) return;
    const next = this.state().map((q) =>
      q.id === id ? { ...q, review: q.review + chunk } : q,
    );
    this.persist(next);
  }

  updatePartial(
    id: string,
    partial: Partial<Pick<Question, 'title' | 'domain' | 'review'>>,
  ): void {
    const next = this.state().map((q) => (q.id === id ? { ...q, ...partial } : q));
    this.persist(next);
  }

  remove(id: string): void {
    this.persist(this.state().filter((q) => q.id !== id));
    this.deselect(id);
  }

  clearActivePack(): void {
    const activeId = this.packs.activePack().id;
    const next = this.state().filter((q) => q.packId !== activeId);
    this.persist(next);
    this.selectedIdsState.set(new Set());
  }

  removeByPackId(packId: string): void {
    const toDelete = this.state().filter((q) => q.packId === packId);
    for (const q of toDelete) {
      void this.storage.deleteQuestion(q.id);
    }
    const next = this.state().filter((q) => q.packId !== packId);
    this.persist(next);
    this.selectedIdsState.set(new Set());
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

  getById(id: string): Question | undefined {
    return this.state().find((q) => q.id === id);
  }

  private persist(next: Question[]): void {
    this.state.set(next);
    this.storage.saveQuestions(next);
  }
}
