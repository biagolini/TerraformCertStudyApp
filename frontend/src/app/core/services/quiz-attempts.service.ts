import { Injectable, inject, signal } from '@angular/core';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { StorageService } from './storage.service';

@Injectable({ providedIn: 'root' })
export class QuizAttemptsService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<QuizAttempt[]>([]);
  private readonly loadingState = signal(false);

  readonly attempts = this.state.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  async load(examSlug?: string): Promise<void> {
    this.loadingState.set(true);
    try {
      this.state.set(await this.storage.listAttempts(examSlug));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Optimistically adds a just-saved attempt to local state without a re-fetch. */
  add(attempt: QuizAttempt): void {
    this.state.update((prev) => [attempt, ...prev]);
  }

  async save(attempt: QuizAttempt): Promise<boolean> {
    const success = await this.storage.saveAttempt(attempt);
    if (success) this.add(attempt);
    return success;
  }
}
