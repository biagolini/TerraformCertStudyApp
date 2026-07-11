import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { StudyMethod } from './core/models/method.model';
import { packDisplayLabel } from './core/models/pack.model';
import { Question } from './core/models/question.model';
import { Script } from './core/models/script.model';
import { PacksService } from './core/services/packs.service';
import { QuestionsService } from './core/services/questions.service';
import { ScriptsService } from './core/services/scripts.service';
import { SettingsService } from './core/services/settings.service';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { ExportComponent } from './features/export/export.component';
import { MethodsTabComponent } from './features/methods/methods-tab.component';
import { PacksDrawerComponent } from './features/packs/packs-drawer.component';
import { QuestionInputComponent } from './features/question-input/question-input.component';
import { QuestionListComponent } from './features/question-list/question-list.component';
import { ReviewViewerComponent } from './features/review-viewer/review-viewer.component';
import { SettingsComponent } from './features/settings/settings.component';
import { ScriptListComponent } from './features/transcripts/script-list.component';
import { ScriptViewerComponent } from './features/transcripts/script-viewer.component';
import { TranscriptInputComponent } from './features/transcripts/transcript-input.component';
import { ThemeToggleComponent } from './shared/components/theme-toggle.component';

type Tab = 'create' | 'methods' | 'export';

@Component({
  selector: 'app-main',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    QuestionInputComponent,
    QuestionListComponent,
    ReviewViewerComponent,
    ExportComponent,
    SettingsComponent,
    PacksDrawerComponent,
    ThemeToggleComponent,
    MethodsTabComponent,
    TranscriptInputComponent,
    ScriptListComponent,
    ScriptViewerComponent,
  ],
  styleUrl: './app.component.scss',
  template: `
    <div
      class="shell"
      [style.--pack-color]="activePackColor()"
      [style.--pack-color-soft]="activePackColorSoft()"
    >
      <header class="app-header">
        <button type="button" class="brand" (click)="openPacks()" aria-label="Open pack switcher">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand-text">
            <span class="brand-title">{{ activePackName() }}</span>
            @if (activePackVersion()) {
              <span class="brand-version">{{ activePackVersion() }}</span>
            } @else {
              <span class="brand-subtitle">Tap to switch pack</span>
            }
          </span>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="brand-chev">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/>
          </svg>
        </button>
        <div class="header-actions">
          <app-theme-toggle />
          <button type="button" class="icon-btn" (click)="openSettings()" aria-label="Open settings">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M19.4 13.5l1.6 1-2 3.4-1.9-.6a7.6 7.6 0 01-2 1.2l-.5 2H10.4l-.5-2a7.6 7.6 0 01-2-1.2l-1.9.6-2-3.4 1.6-1A7.6 7.6 0 014.5 12c0-.5.1-1 .2-1.5l-1.6-1 2-3.4 1.9.6a7.6 7.6 0 012-1.2l.5-2h4.2l.5 2c.7.3 1.4.7 2 1.2l1.9-.6 2 3.4-1.6 1c.1.5.2 1 .2 1.5s-.1 1-.2 1.5z"/>
            </svg>
          </button>
          <button type="button" class="icon-btn" (click)="onLogout()" aria-label="Sign out">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M15 12H4m0 0l3.5-3.5M4 12l3.5 3.5M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/>
            </svg>
          </button>
        </div>
      </header>

      <main class="app-main" [class.mode-export]="activeTab() === 'export'" [class.mode-methods]="activeTab() === 'methods'">
        @switch (activeTab()) {
          @case ('create') {
            @switch (activeMethod()) {
              @case ('question') {
                @if (showLeftColumnQ()) {
                  <section class="column column-left">
                    <div class="stack">
                      @if (showInputForm()) {
                        <app-question-input (generated)="onGenerated($event)" />
                      }
                      @if (showListPanel()) {
                        <app-question-list
                          [activeId]="activeQuestionId()"
                          (opened)="onOpenQuestion($event)"
                        />
                      }
                    </div>
                  </section>
                }
                @if (showViewerPanel()) {
                  <section class="column column-right">
                    <app-review-viewer
                      [question]="activeQuestion()"
                      [showBackButton]="isMobile()"
                      (back)="onCloseViewer()"
                      (newQuestion)="onNewQuestion()"
                      (deleted)="onQuestionDeleted($event)"
                    />
                  </section>
                }
              }
              @case ('transcript') {
                @if (showLeftColumnT()) {
                  <section class="column column-left">
                    <div class="stack">
                      @if (showInputForm()) {
                        <app-transcript-input (generated)="onScriptGenerated($event)" />
                      }
                      @if (showScriptList()) {
                        <app-script-list [activeId]="activeScriptId()" (opened)="onOpenScript($event)" />
                      }
                    </div>
                  </section>
                }
                @if (showScriptViewer()) {
                  <section class="column column-right">
                    <app-script-viewer
                      [script]="activeScript()"
                      [showBackButton]="isMobile()"
                      (back)="onCloseScript()"
                      (deleted)="onScriptDeleted($event)"
                    />
                  </section>
                }
              }
              @case ('chat') {
                <section class="column column-left chat-placeholder">
                  <div class="placeholder-card">
                    <h2>Open chat — coming next</h2>
                    <p>
                      The Methods tab already lists this option. The full chat flow (persisted sessions, edit/fork, generate summary) will be wired in the next iteration.
                    </p>
                  </div>
                </section>
              }
            }
          }
          @case ('methods') {
            <section class="column column-full">
              <app-methods-tab (chosen)="onMethodChosen($event)" />
            </section>
          }
          @case ('export') {
            <section class="column column-export">
              <app-export />
            </section>
          }
        }
      </main>

      <nav class="tabbar" aria-label="Primary">
        <button type="button" class="tab" [class.active]="activeTab() === 'create'" (click)="setTab('create')">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
          </svg>
          <span>Create</span>
        </button>
        <button type="button" class="tab" [class.active]="activeTab() === 'methods'" (click)="setTab('methods')">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 6h6v6H4zM14 6h6v6h-6zM4 16h6v4H4zM14 16h6v4h-6z"/>
          </svg>
          <span>Methods</span>
        </button>
        <button type="button" class="tab" [class.active]="activeTab() === 'export'" (click)="setTab('export')">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 4v12M7 11l5 5 5-5M4 20h16"/>
          </svg>
          <span>Export</span>
          @if (selectedCount() > 0) {
            <span class="badge">{{ selectedCount() }}</span>
          }
        </button>
      </nav>

      @if (packsOpen()) {
        <div class="overlay" (click)="closePacks()" aria-hidden="true"></div>
        <aside class="drawer-host drawer-host-left" role="dialog" aria-label="Exam packs">
          <app-packs-drawer (closed)="closePacks()" />
        </aside>
      }

      @if (settingsOpen()) {
        <div class="overlay" (click)="closeSettings()" aria-hidden="true"></div>
        <aside class="drawer-host" role="dialog" aria-label="Settings">
          <app-settings (closed)="closeSettings()" />
        </aside>
      }
    </div>
  `,
})
export class AppComponent {
  private readonly packs = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);
  private readonly scriptsService = inject(ScriptsService);
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);
  protected readonly themeService = inject(ThemeService);

  protected readonly activeTab = signal<Tab>('create');
  protected readonly activeQuestionId = signal<string | null>(null);
  protected readonly activeScriptId = signal<string | null>(null);
  protected readonly settingsOpen = signal(false);
  protected readonly packsOpen = signal(false);
  private readonly viewportWidth = signal<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );

  readonly activeMethod = this.settings.activeMethod;
  readonly activePackName = computed(() => this.packs.activePack().name);
  readonly activePackVersion = computed(() => this.packs.activePack().version);
  readonly activePackColor = computed(() => this.packs.activeColor());
  readonly activePackColorSoft = computed(() => withAlpha(this.activePackColor(), 0.16));

  readonly selectedCount = this.questionsService.selectedCount;
  readonly isMobile = computed(() => this.viewportWidth() < 768);

  readonly activeQuestion = computed(() => {
    const id = this.activeQuestionId();
    if (!id) return null;
    return this.questionsService.questions().find((q) => q.id === id) ?? null;
  });

  readonly activeScript = computed(() => {
    const id = this.activeScriptId();
    if (!id) return null;
    return this.scriptsService.scripts().find((s) => s.id === id) ?? null;
  });

  readonly showInputForm = computed(() => {
    if (this.isMobile()) {
      // On mobile, when a viewer is open, hide input.
      if (this.activeMethod() === 'question' && this.activeQuestionId()) return false;
      if (this.activeMethod() === 'transcript' && this.activeScriptId()) return false;
    }
    return true;
  });

  readonly showListPanel = computed(() => {
    if (this.isMobile()) {
      return this.activeMethod() === 'question' && !this.activeQuestionId();
    }
    return true;
  });

  readonly showViewerPanel = computed(() => {
    if (this.activeMethod() !== 'question') return false;
    if (this.isMobile()) return !!this.activeQuestionId();
    return true;
  });

  readonly showLeftColumnQ = computed(
    () => this.activeMethod() === 'question' && (this.showInputForm() || this.showListPanel()),
  );

  readonly showScriptList = computed(() => {
    if (this.isMobile()) {
      return this.activeMethod() === 'transcript' && !this.activeScriptId();
    }
    return true;
  });

  readonly showScriptViewer = computed(() => {
    if (this.activeMethod() !== 'transcript') return false;
    if (this.isMobile()) return !!this.activeScriptId();
    return true;
  });

  readonly showLeftColumnT = computed(
    () => this.activeMethod() === 'transcript' && (this.showInputForm() || this.showScriptList()),
  );

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.viewportWidth.set(window.innerWidth));
    }
    effect(() => {
      const anyOpen = this.settingsOpen() || this.packsOpen();
      if (typeof document === 'undefined') return;
      document.body.style.overflow = anyOpen ? 'hidden' : '';
    });
    let lastPackId: string | null = null;
    effect(() => {
      const id = this.packs.activePack().id;
      if (lastPackId !== null && lastPackId !== id) {
        this.activeQuestionId.set(null);
      }
      lastPackId = id;
    });
    // Reset viewer state when method changes.
    let lastMethod: StudyMethod | null = null;
    effect(() => {
      const m = this.activeMethod();
      if (lastMethod !== null && lastMethod !== m) {
        this.activeQuestionId.set(null);
        this.activeScriptId.set(null);
      }
      lastMethod = m;
    });
  }

  setTab(tab: Tab): void {
    if (tab === 'create' && this.isMobile()) {
      // On mobile, tapping "Create" in the bottom bar returns to the input form
      // for a new item, closing any open viewer. This avoids having to scroll up
      // and use the back arrow to start a new question/transcript.
      this.activeQuestionId.set(null);
      this.activeScriptId.set(null);
    }
    this.activeTab.set(tab);
  }

  openSettings(): void { this.settingsOpen.set(true); }
  closeSettings(): void { this.settingsOpen.set(false); }
  onLogout(): void { this.auth.logout(); }
  openPacks(): void { this.packsOpen.set(true); }
  closePacks(): void { this.packsOpen.set(false); }

  onMethodChosen(_method: StudyMethod): void {
    this.activeTab.set('create');
  }

  onGenerated(question: Question): void {
    this.activeQuestionId.set(question.id);
  }

  onOpenQuestion(question: Question): void {
    this.activeQuestionId.set(question.id);
  }

  onCloseViewer(): void {
    this.activeQuestionId.set(null);
  }

  onNewQuestion(): void {
    // Close the current viewer so the input form is shown (mobile) / focused
    // (desktop), and scroll back to the top where the form lives.
    this.activeQuestionId.set(null);
    // Wait for DOM re-render before scrolling (Angular conditionally hides/shows panels)
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  onQuestionDeleted(id: string): void {
    if (this.activeQuestionId() === id) this.activeQuestionId.set(null);
  }

  onScriptGenerated(script: Script): void {
    this.activeScriptId.set(script.id);
  }

  onOpenScript(script: Script): void {
    this.activeScriptId.set(script.id);
  }

  onCloseScript(): void {
    this.activeScriptId.set(null);
  }

  onScriptDeleted(id: string): void {
    if (this.activeScriptId() === id) this.activeScriptId.set(null);
  }
}

function withAlpha(hexColor: string, alpha: number): string {
  const match = /^#?([a-f\d]{6})$/i.exec(hexColor.trim());
  if (!match) return hexColor;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
