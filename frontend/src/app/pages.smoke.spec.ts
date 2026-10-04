import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StorageService } from './core/services/storage.service';
import { SettingsService } from './core/services/settings.service';
import { PacksService } from './core/services/packs.service';
import { Pack } from './core/models/pack.model';
import { QuestionBank } from './core/models/bank.model';
import { Question } from './core/models/question.model';
import { Note } from './core/models/note.model';
import { DEFAULT_SETTINGS } from './core/models/settings.model';
import { HomePageComponent } from './features/home/home-page.component';
import { ExamWorkspaceComponent } from './features/workspace/exam-workspace.component';
import { BanksPageComponent } from './features/banks/banks-page.component';
import { QuestionsPageComponent } from './features/questions/questions-page.component';
import { NotesPageComponent } from './features/notes/notes-page.component';
import { PerformancePageComponent } from './features/performance/performance-page.component';
import { ProfilePageComponent } from './features/profile/profile-page.component';
import { QuizComponent } from './features/quiz/quiz.component';
import { SettingsPageComponent } from './features/settings/settings-page.component';

/**
 * Render smoke tests for the certification-centric pages: each page is
 * created against a seeded local store (no network) and must render
 * without throwing, showing the seeded data. Catches template/binding
 * errors that a production build does not.
 */
const NOW = 1_780_000_000_000;

const pack: Pack = {
  id: 'p1',
  name: 'AWS Certified Solutions Architect – Associate (SAA-C03)',
  code: 'SAA-C03',
  provider: 'aws',
  level: 'associate',
  description: 'Design resilient architectures.',
  version: '',
  domains: [
    { name: 'Design Secure Architectures', description: '', order: 1 },
    { name: 'Design Resilient Architectures', description: '', order: 2 },
  ],
  color: '#6c5ce7',
  createdAt: NOW,
  updatedAt: NOW,
  examDurationMinutes: 130,
  examTotalQuestions: 65,
  accommodationMinutes: 30,
  passingScorePercent: 72,
};

const bank: QuestionBank = {
  id: 'b1',
  packId: 'p1',
  author: 'Instructor A',
  version: 'Practice exam 1',
  sourceUrl: '',
  description: 'Full-length practice exam.',
  createdAt: NOW,
  updatedAt: NOW,
};

const question: Question = {
  id: 'q1',
  packId: 'p1',
  bankId: 'b1',
  title: 'Gateway endpoint for S3',
  domain: 'Design Secure Architectures',
  stem: 'Instances in private subnets must reach S3 privately. What should you do?',
  alternatives: [
    { letter: 'A', text: 'NAT gateway', isCorrect: false, comment: 'Public endpoint.' },
    { letter: 'B', text: 'Gateway VPC endpoint', isCorrect: true, comment: 'Private and free.' },
  ],
  metadata: { topics: [], relatedServices: ['Amazon S3'] },
  createdAt: NOW,
  updatedAt: NOW,
};

const note: Note = {
  id: 'n1',
  packId: 'p1',
  title: 'VPC endpoints cheat sheet',
  tags: ['networking'],
  excerpt: 'Gateway vs interface endpoints',
  wordCount: 4,
  createdAt: NOW,
  updatedAt: NOW,
};

function seedStorage(): void {
  const storage = TestBed.inject(StorageService) as unknown as Record<string, { set(v: unknown): void }>;
  storage['_packs'].set([pack]);
  storage['_banks'].set([bank]);
  storage['_questions'].set([question]);
  storage['_notes'].set([note]);
  storage['_settings'].set({ ...DEFAULT_SETTINGS, activePackId: 'p1' });
  (TestBed.inject(StorageService).ready as unknown as { set(v: boolean): void }).set(true);
}

async function render<T>(component: Type<T>, inputs: Record<string, unknown> = {}): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('page smoke tests', () => {
  beforeEach(async () => {
    // Catalog/attempt fetches fail fast instead of hitting the network.
    globalThis.fetch = (() => Promise.reject(new Error('offline in tests'))) as typeof fetch;
    await TestBed.configureTestingModule({ providers: [provideRouter([])] }).compileComponents();
    seedStorage();
    // Root services load from storage in effects; create them, then flush.
    TestBed.inject(SettingsService);
    TestBed.inject(PacksService);
    TestBed.tick();
    expect(TestBed.inject(SettingsService).activePackId()).toBe('p1');
  });

  it('Home lists the certification with its counts', async () => {
    const f = await render(HomePageComponent);
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('SAA-C03');
    expect(text).toContain('AWS Certified Solutions Architect');
  });

  it('workspace shows identity and tabs', async () => {
    const f = await render(ExamWorkspaceComponent, { packId: 'p1' });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('SAA-C03');
    expect(f.nativeElement.querySelectorAll('.ws-tab').length).toBeGreaterThan(4);
  });

  it('banks page groups banks by author with domain chips', async () => {
    const f = await render(BanksPageComponent, { packId: 'p1' });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('Practice exam 1');
    expect(text).toContain('Instructor A');
    expect(text).toContain('D1: 1');
  });

  it('question browser shows the bank header and the question', async () => {
    const f = await render(QuestionsPageComponent, { packId: 'p1', bankId: 'b1', questionId: 'q1' });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('Practice exam 1');
    expect(text).toContain('Gateway endpoint for S3');
  });

  it('notes list renders the note card', async () => {
    const f = await render(NotesPageComponent, { packId: 'p1' });
    expect(f.nativeElement.textContent).toContain('VPC endpoints cheat sheet');
  });

  it('performance page renders its empty state without attempts', async () => {
    const f = await render(PerformancePageComponent, { packId: 'p1' });
    expect(f.nativeElement.querySelector('.ui-page')).toBeTruthy();
  });

  it('profile page renders the tracker with the hand-made certification', async () => {
    const f = await render(ProfilePageComponent);
    expect(f.nativeElement.textContent).toContain('SAA-C03');
  });

  it('mock exam setup lists the bank', async () => {
    const f = await render(QuizComponent);
    expect(f.nativeElement.textContent).toContain('Practice exam 1');
  });

  it('settings page renders', async () => {
    const f = await render(SettingsPageComponent);
    expect(f.nativeElement.querySelector('app-settings')).toBeTruthy();
  });
});
