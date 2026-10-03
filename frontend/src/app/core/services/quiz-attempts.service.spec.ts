import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuizAttempt } from '../models/quiz-attempt.model';
import { QuizAttemptsService } from './quiz-attempts.service';
import { StorageService } from './storage.service';

function makeAttempt(overrides: Partial<QuizAttempt> = {}): QuizAttempt {
  return {
    id: 'a1',
    status: 'IN_PROGRESS',
    packId: 'pack-1',
    examSlug: 'exam',
    examName: 'Exam',
    scope: 'pack',
    mode: 'instant',
    partialCredit: false,
    settings: { scope: 'pack', mode: 'instant', domains: [], count: 10, shuffle: true, trackTime: false, useAccommodation: false },
    answers: [],
    currentIndex: 0,
    totalScore: 0,
    maxScore: 0,
    scorePercent: 0,
    startedAt: 1000,
    ...overrides,
  };
}

/** Minimal stand-in: `remote` is what GET /data/attempts returns, which may lag
 * behind the PUTs (eventually consistent Query). */
class FakeStorage {
  remote: QuizAttempt[] = [];
  saved: QuizAttempt[] = [];
  async listAttempts(): Promise<QuizAttempt[]> {
    return this.remote;
  }
  async saveAttempt(attempt: QuizAttempt): Promise<boolean> {
    this.saved.push(attempt);
    return true;
  }
  async deleteAttempt(): Promise<boolean> {
    return true;
  }
}

describe('QuizAttemptsService', () => {
  let service: QuizAttemptsService;
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    TestBed.configureTestingModule({
      providers: [QuizAttemptsService, { provide: StorageService, useValue: storage }],
    });
    service = TestBed.inject(QuizAttemptsService);
  });

  it('lists an attempt left via syncInProgress immediately, before any re-fetch', async () => {
    await service.syncInProgress(makeAttempt({ id: 'a1' }));
    expect(service.inProgressAttempts().map((a) => a.id)).toEqual(['a1']);
    expect(storage.saved).toHaveLength(1);
  });

  it('keeps several in-progress attempts of the same exam side by side', async () => {
    await service.syncInProgress(makeAttempt({ id: 'a1', startedAt: 1000 }));
    await service.syncInProgress(makeAttempt({ id: 'a2', startedAt: 2000 }));
    expect(service.inProgressAttempts().map((a) => a.id)).toEqual(['a2', 'a1']);
  });

  it('prefers this device’s own latest write over a stale server copy on load()', async () => {
    await service.syncInProgress(makeAttempt({ id: 'a1', currentIndex: 9 }));
    storage.remote = [makeAttempt({ id: 'a1', currentIndex: 2 })];
    await service.load();
    expect(service.inProgressAttempts()).toHaveLength(1);
    expect(service.inProgressAttempts()[0].currentIndex).toBe(9);
  });

  it('keeps a locally written attempt the server list does not return yet', async () => {
    storage.remote = [makeAttempt({ id: 'old', startedAt: 500 })];
    await service.syncInProgress(makeAttempt({ id: 'new', startedAt: 3000 }));
    await service.load();
    expect(service.inProgressAttempts().map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('respects the examSlug filter when merging local writes', async () => {
    await service.syncInProgress(makeAttempt({ id: 'other', examSlug: 'other-exam' }));
    await service.load('exam');
    expect(service.attempts()).toEqual([]);
  });

  it('moves an attempt out of the in-progress list once it is saved as finished', async () => {
    await service.syncInProgress(makeAttempt({ id: 'a1' }));
    await service.save(makeAttempt({ id: 'a1', status: 'FINISHED', finishedAt: 5000 }));
    expect(service.inProgressAttempts()).toEqual([]);
    expect(service.finishedAttempts().map((a) => a.id)).toEqual(['a1']);
  });

  it('does not resurrect a discarded attempt on the next load()', async () => {
    const attempt = makeAttempt({ id: 'a1' });
    await service.syncInProgress(attempt);
    await service.discard(attempt);
    storage.remote = [];
    await service.load();
    expect(service.attempts()).toEqual([]);
  });
});
