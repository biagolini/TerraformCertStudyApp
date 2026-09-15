import { Injectable, computed, inject, signal } from '@angular/core';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class QuizAttemptsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<QuizAttempt[]>([]);
  private readonly loadingState = signal(false);

  readonly attempts = this.state.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  /** Legacy rows saved before `status` existed have none at all — they can only
   * ever have been finished attempts, so a missing status reads as FINISHED. */
  readonly inProgressAttempts = computed(() => this.state().filter((a) => a.status === 'IN_PROGRESS'));
  readonly finishedAttempts = computed(() => this.state().filter((a) => (a.status ?? 'FINISHED') === 'FINISHED'));

  async load(examSlug?: string): Promise<void> {
    this.loadingState.set(true);
    try {
      this.state.set(await this.storage.listAttempts(examSlug));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Optimistically adds/replaces a just-saved attempt in local state without a
   * re-fetch — replaces any existing entry with the same id so a finish() right
   * after a resumed session doesn't leave a stale IN_PROGRESS duplicate around. */
  add(attempt: QuizAttempt): void {
    this.state.update((prev) => [attempt, ...prev.filter((a) => a.id !== attempt.id)]);
  }

  async save(attempt: QuizAttempt): Promise<boolean> {
    const success = await this.storage.saveAttempt(attempt);
    if (success) this.add(attempt);
    return success;
  }

  /** Fire-and-forget incremental save for an in-progress session — same PUT route/
   * body shape as save(), but deliberately does NOT touch local state: an
   * in-progress record has no business in the reactive list backing History's
   * optimistic prepend, it's only ever surfaced via `inProgressAttempts` after an
   * explicit load(). */
  async syncInProgress(attempt: QuizAttempt): Promise<boolean> {
    return this.storage.saveAttempt(attempt);
  }

  /** Explicit discard of an in-progress session (setup-screen "Discard" action). */
  async discard(attempt: QuizAttempt): Promise<boolean> {
    const ok = await this.storage.deleteAttempt(attempt);
    if (ok) this.state.update((prev) => prev.filter((a) => a.id !== attempt.id));
    return ok;
  }
}
