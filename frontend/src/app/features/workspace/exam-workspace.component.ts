import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PacksService } from '../../core/services/packs.service';
import { BanksService } from '../../core/services/banks.service';
import { QuestionsService } from '../../core/services/questions.service';
import { NotesService } from '../../core/services/notes.service';
import { SettingsService } from '../../core/services/settings.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NavTabId } from '../../core/models/nav-item.model';
import { examPath } from '../../core/utils/routes.util';

/**
 * /exam/:packId — the certification workspace. Header with the
 * certification's identity and a switcher, a tab bar (user-configurable in
 * Settings), and the routed tab page. The route resolver has already made
 * this pack the active one before this renders.
 */
@Component({
  selector: 'app-exam-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    @if (pack(); as p) {
      <section class="ws-head">
        <div class="ws-head-row">
          <a routerLink="/" class="ui-btn ui-btn-sm back">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15 6l-6 6 6 6"/></svg>
            {{ i18n.t('workspace.allCertifications') }}
          </a>
          <div class="ws-identity">
            <span class="ws-icon" [style.background]="p.color" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 15a6 6 0 100-12 6 6 0 000 12zm-3.5 4.5L12 15l3.5 4.5M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5"/></svg>
            </span>
            @if (p.code) {
              <span class="ui-code" [style.--chip-color]="p.color">{{ p.code }}</span>
            }
            <label class="switcher">
              <span class="ui-sr-only">{{ i18n.t('workspace.switchCertification') }}</span>
              <select [value]="p.id" (change)="switchTo($any($event.target).value)">
                @for (other of packs.packs(); track other.id) {
                  <option [value]="other.id">{{ other.name }}</option>
                }
              </select>
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 9l6 6 6-6"/></svg>
            </label>
          </div>
          <div class="ws-meta">
            @if (p.examDurationMinutes) {
              <span class="ui-chip">
                {{ i18n.t('workspace.minutes', { n: p.examDurationMinutes }) }}
                @if (p.accommodationMinutes) {
                  <span class="extra">+{{ p.accommodationMinutes }}</span>
                }
              </span>
            }
            <span class="ui-faint">{{ i18n.t('workspace.questionsAcrossBanks', { q: questionCount(), b: bankCount() }) }}</span>
          </div>
        </div>
        <nav class="ws-tabs" [attr.aria-label]="i18n.t('workspace.sections')">
          @for (tab of tabs(); track tab.id) {
            <a [routerLink]="tab.path" routerLinkActive="active" class="ws-tab">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" [attr.d]="tab.icon"/>
              </svg>
              <span>{{ i18n.t('nav.' + tab.id) }}</span>
              @if (badge(tab.id); as n) {
                <span class="count">{{ n }}</span>
              }
            </a>
          }
        </nav>
      </section>
      <div class="ws-body">
        <router-outlet />
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        max-width: 1280px;
        margin: 0 auto;
      }
      .ws-head {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        margin-bottom: var(--space-lg);
      }
      .ws-head-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-md);
      }
      .ws-identity {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-width: 0;
        flex: 1 1 320px;
      }
      .ws-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: var(--radius-md);
        flex-shrink: 0;
      }
      .switcher {
        position: relative;
        display: inline-flex;
        align-items: center;
        min-width: 0;
        flex: 1;
      }
      .switcher select {
        appearance: none;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 18px;
        font-weight: 800;
        letter-spacing: -0.01em;
        padding-right: 20px;
        cursor: pointer;
        text-overflow: ellipsis;
      }
      .switcher svg {
        position: absolute;
        right: 0;
        pointer-events: none;
        color: var(--text-muted);
      }
      .ws-meta {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
      }
      .extra {
        color: var(--color-amber);
      }
      .ws-tabs {
        position: sticky;
        top: var(--header-height);
        z-index: 10;
        display: flex;
        gap: 2px;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid var(--bg-border);
        background: var(--bg-base);
      }
      .ws-tab {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        color: var(--text-muted);
        text-decoration: none;
        font-weight: 600;
        white-space: nowrap;
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
      }
      .ws-tab:hover {
        color: var(--text-primary);
      }
      .ws-tab.active {
        color: var(--pack-color, var(--color-purple));
        border-bottom-color: var(--pack-color, var(--color-purple));
      }
      .count {
        min-width: 20px;
        padding: 0 6px;
        border-radius: var(--radius-pill);
        background: var(--bg-subtle);
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
        text-align: center;
      }
      /* Same two-column grid the older pages (questions, chat, transcripts)
         were written against: their :host is display: contents and their
         sections become the grid items. Full-width pages span both columns. */
      .ws-body {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--space-md);
        min-width: 0;
      }
      .ws-body router-outlet {
        display: none;
      }
      @media (min-width: 768px) {
        .ws-body {
          grid-template-columns: minmax(320px, 380px) 1fr;
          gap: var(--space-lg);
        }
      }
    `,
  ],
})
export class ExamWorkspaceComponent {
  protected readonly packs = inject(PacksService);
  private readonly banks = inject(BanksService);
  private readonly questions = inject(QuestionsService);
  private readonly notes = inject(NotesService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  readonly packId = input.required<string>();

  readonly pack = computed(() => this.packs.getById(this.packId()) ?? null);
  readonly questionCount = computed(() => this.questions.count());
  readonly bankCount = computed(() => this.banks.banks().length);

  readonly tabs = computed(() => {
    const hidden = this.settings.hiddenNavTabs();
    return this.settings.orderedNavItems().filter((item) => !hidden.includes(item.id));
  });

  badge(id: NavTabId): number | null {
    switch (id) {
      case 'banks':
        return this.bankCount() || null;
      case 'notes':
        return this.notes.notes().length || null;
      case 'export':
        return this.questions.selectedCount() || null;
      default:
        return null;
    }
  }

  switchTo(id: string): void {
    if (id && id !== this.packId()) void this.router.navigate(examPath(id));
  }
}
