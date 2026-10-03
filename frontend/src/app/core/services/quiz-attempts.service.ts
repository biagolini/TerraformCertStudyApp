import { Injectable, computed, inject, signal } from '@angular/core';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class QuizAttemptsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<QuizAttempt[]>([]);
  private readonly loadingState = signal(false);
  /** Latest copy of every attempt this device wrote during the current session.
   * GET /data/attempts is an eventually consistent Query, so a list fetched right
   * after "Save and exit" can still return the previous version of that attempt
   * (or miss a brand-new one). This device's own writes are the freshest data it
   * can have, so load() lays them over whatever the server returned. */
  private readonly localWrites = new Map<string, QuizAttempt>();

  readonly attempts = this.state.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  /** Legacy rows saved before `status` existed have none at all — they can only
   * ever have been finished attempts, so a missing status reads as FINISHED. */
  readonly inProgressAttempts = computed(() => this.state().filter((a) => a.status === 'IN_PROGRESS'));
  readonly finishedAttempts = computed(() => this.state().filter((a) => (a.status ?? 'FINISHED') === 'FINISHED'));

  async load(examSlug?: string): Promise<void> {
    this.loadingState.set(true);
    try {
      const remote = await this.storage.listAttempts(examSlug);
      this.state.set(this.mergeLocalWrites(remote, examSlug));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Optimistically adds/replaces an attempt in local state without a re-fetch —
   * replaces any existing entry with the same id so a finish() right after a
   * resumed session doesn't leave a stale IN_PROGRESS duplicate around. */
  add(attempt: QuizAttempt): void {
    this.localWrites.set(attempt.id, attempt);
    this.state.update((prev) => [attempt, ...prev.filter((a) => a.id !== attempt.id)]);
  }

  async save(attempt: QuizAttempt): Promise<boolean> {
    const success = await this.storage.saveAttempt(attempt);
    if (success) this.add(attempt);
    return success;
  }

  /** Fire-and-forget incremental save for an in-progress session. Unlike save(),
   * local state is updated before the network call and regardless of its result:
   * with several sessions open at once, the setup screen's "in progress" list has
   * to reflect the one the user just left immediately, not after a round trip
   * (History is unaffected, it only reads finishedAttempts). */
  async syncInProgress(attempt: QuizAttempt): Promise<boolean> {
    this.add(attempt);
    return this.storage.saveAttempt(attempt);
  }

  /** Explicit discard of an in-progress session (setup-screen "Discard" action). */
  async discard(attempt: QuizAttempt): Promise<boolean> {
    const ok = await this.storage.deleteAttempt(attempt);
    if (ok) {
      this.localWrites.delete(attempt.id);
      this.state.update((prev) => prev.filter((a) => a.id !== attempt.id));
    }
    return ok;
  }

  private mergeLocalWrites(remote: QuizAttempt[], examSlug?: string): QuizAttempt[] {
    if (this.localWrites.size === 0) return remote;
    const merged = remote.map((a) => this.localWrites.get(a.id) ?? a);
    const seen = new Set(merged.map((a) => a.id));
    for (const local of this.localWrites.values()) {
      if (seen.has(local.id)) continue;
      if (examSlug && local.examSlug !== examSlug) continue;
      merged.push(local);
    }
    // Newest first, same order the server returns.
    return merged.sort((a, b) => b.startedAt - a.startedAt);
  }
}
