import { IconComponent } from '../../shared/components/icon.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CERTIFICATION_LEVELS,
  CertificationLevel,
  DEFAULT_PACK_COLOR,
  MAX_PACK_DOMAINS,
  PACK_COLORS,
  PROVIDER_CATEGORIES,
  Pack,
  PackDomain,
  ProviderCategory,
  isAcceptablePackColor,
  isValidHexColor,
} from '../../core/models/pack.model';
import { CatalogEntry, CatalogService, parseDomains } from '../../core/services/catalog.service';
import { PackDraft, PacksService } from '../../core/services/packs.service';
import { BanksService, DEFAULT_BANK_AUTHOR } from '../../core/services/banks.service';
import { ProfileService } from '../../core/services/profile.service';
import { QuestionsService } from '../../core/services/questions.service';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * Add / edit a certification as a modal. In "new" mode the top panel lists
 * catalog presets (filtered by ecosystem); picking one prefills every field,
 * which stays editable. A JSON template file can be imported the same way.
 * Advanced fields (partial credit, export intros) sit in a collapsed section.
 */
@Component({
  selector: 'app-certification-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, FormsModule],
  template: `
    <div class="ui-modal-backdrop" (click)="cancelled.emit()">
      <form class="ui-modal ui-modal-wide dialog" role="dialog" aria-modal="true" aria-labelledby="cert-dialog-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <header class="ui-modal-head">
          <div>
            <h2 id="cert-dialog-title">{{ pack() ? i18n.t('certDialog.editTitle') : i18n.t('certDialog.newTitle') }}</h2>
            <p>{{ pack() ? i18n.t('certDialog.editSubtitle') : i18n.t('certDialog.newSubtitle') }}</p>
          </div>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="cancelled.emit()" [attr.aria-label]="i18n.t('common.close')"><app-icon name="x" /></button>
        </header>

        <div class="ui-modal-body">
          @if (!pack()) {
            <section class="presets">
              <div class="presets-head">
                <strong><app-icon name="sparkles" /> {{ i18n.t('home.suggestedTitle') }}</strong>
                <button type="button" class="link" (click)="jsonInput.click()"><app-icon name="upload" /> {{ i18n.t('certDialog.importJson') }}</button>
                <input #jsonInput type="file" accept=".json,application/json" hidden (change)="onJsonFile($event)" />
              </div>
              <div class="ui-chip-row" role="group" [attr.aria-label]="i18n.t('home.ecosystem')">
                <button type="button" class="ui-chip" [class.active]="eco() === 'all'" (click)="eco.set('all')">{{ i18n.t('home.allEcosystems') }}</button>
                @for (p of ecosystems(); track p) {
                  <button type="button" class="ui-chip" [class.active]="eco() === p" (click)="eco.set(p)">{{ i18n.t('provider.' + p) }}</button>
                }
              </div>
              <div class="preset-grid" role="listbox" [attr.aria-label]="i18n.t('home.suggestedTitle')">
                @for (e of presetList(); track e.id) {
                  <button type="button" role="option" class="preset" [class.selected]="selectedId() === e.id" [attr.aria-selected]="selectedId() === e.id" (click)="pick(e)">
                    <span class="preset-top">
                      <span class="dot" [style.background]="e.color" aria-hidden="true"></span>
                      <span class="mono">{{ e.code }}</span>
                      @if (e.examDurationMinutes) {
                        <span class="ui-faint">· {{ e.examDurationMinutes }}m</span>
                      }
                      <span class="use">@if (selectedId() === e.id) { <app-icon name="check" size="14" /> } @else { {{ i18n.t('certDialog.use') }} }</span>
                    </span>
                    <span class="preset-name">{{ e.name }}</span>
                    <span class="ui-faint preset-desc">{{ i18n.t('home.domainsCount', { n: e.domainCount }) }} · {{ e.description }}</span>
                  </button>
                }
              </div>
              @if (prefilledName(); as name) {
                <div class="prefilled" role="status">
                  <span><app-icon name="check" /> {{ i18n.t('certDialog.prefilled', { name: name }) }}</span>
                  <button type="button" class="link" (click)="clearPreset()">{{ i18n.t('certDialog.clearPreset') }}</button>
                </div>
              }
              @if (message(); as m) {
                <p class="msg" [class.error]="!m.ok">{{ m.text }}</p>
              }
            </section>
          }

          <label class="ui-field">
            <span>{{ i18n.t('certDialog.name') }} *</span>
            <input class="ui-input" name="name" [(ngModel)]="name" required [placeholder]="i18n.t('packEditor.namePlaceholder')" />
          </label>

          <div class="ui-form-row">
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.examCode') }}</span>
              <input class="ui-input" name="code" [(ngModel)]="code" placeholder="SAA-C03" />
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.provider') }}</span>
              <select class="ui-input" name="provider" [(ngModel)]="provider">
                <option value="">—</option>
                @for (p of providers; track p) {
                  <option [value]="p">{{ i18n.t('provider.' + p) }}</option>
                }
              </select>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.level') }}</span>
              <select class="ui-input" name="level" [(ngModel)]="level">
                <option value="">—</option>
                @for (l of levels; track l) {
                  <option [value]="l">{{ i18n.t('level.' + l) }}</option>
                }
              </select>
            </label>
          </div>

          <div class="ui-field">
            <span>{{ i18n.t('certDialog.colorTag') }}</span>
            <div class="swatches" role="radiogroup" [attr.aria-label]="i18n.t('certDialog.colorTag')">
              @for (c of colors; track c.id) {
                <button type="button" role="radio" class="swatch" [class.on]="color().toLowerCase() === c.value.toLowerCase()" [style.background]="c.value" [attr.aria-checked]="color().toLowerCase() === c.value.toLowerCase()" [attr.aria-label]="c.name" (click)="color.set(c.value)"></button>
              }
              <label class="swatch custom" [class.on]="isCustomColor()" [style.background]="isCustomColor() ? color() : ''" [title]="i18n.t('packEditor.customColor')">
                <span aria-hidden="true">+</span>
                <input type="color" class="ui-sr-only" [value]="color()" (input)="onCustomColor($event)" [attr.aria-label]="i18n.t('packEditor.customColor')" />
              </label>
            </div>
          </div>

          <div class="timing ui-card">
            <div class="ui-form-row">
              <label class="ui-field">
                <span>{{ i18n.t('certDialog.duration') }}</span>
                <input class="ui-input" type="number" min="1" name="duration" [(ngModel)]="duration" placeholder="130" />
                <small class="ui-faint">{{ i18n.t('certDialog.durationHint') }}</small>
              </label>
              <label class="ui-field">
                <span>{{ i18n.t('certDialog.accommodation') }}</span>
                <input class="ui-input" type="number" min="0" name="accommodation" [(ngModel)]="accommodation" placeholder="30" />
                <small class="ui-faint">{{ i18n.t('certDialog.accommodationHint') }}</small>
              </label>
            </div>
            <div class="ui-form-row">
              <label class="ui-field">
                <span>{{ i18n.t('packEditor.examQuestions') }}</span>
                <input class="ui-input" type="number" min="1" name="questions" [(ngModel)]="questionCount" placeholder="65" />
              </label>
              <label class="ui-field">
                <span>{{ i18n.t('packEditor.passingScore') }}</span>
                <input class="ui-input" type="number" min="1" max="100" name="passing" [(ngModel)]="passing" placeholder="70" />
              </label>
            </div>
          </div>

          <label class="ui-field">
            <span>{{ i18n.t('certDialog.description') }}</span>
            <textarea class="ui-input" name="description" rows="3" [(ngModel)]="description" [placeholder]="i18n.t('packEditor.certDescriptionPlaceholder')"></textarea>
            <small class="ui-faint">{{ i18n.t('packEditor.certDescriptionHint') }}</small>
          </label>

          <details class="ui-card domains" [open]="!pack() && domains().length > 0">
            <summary><strong><app-icon name="layers" /> {{ i18n.t('certDialog.domains', { n: domains().length }) }}</strong></summary>
            <ol class="domain-list">
              @for (d of domains(); track $index; let i = $index) {
                <li class="domain">
                  <div class="domain-fields">
                    <input class="ui-input" [ngModel]="d.name" (ngModelChange)="editDomain(i, { name: $event })" [ngModelOptions]="{ standalone: true }" [attr.aria-label]="i18n.t('packEditor.editDomainName')" />
                    <textarea class="ui-input" rows="2" [ngModel]="d.description" (ngModelChange)="editDomain(i, { description: $event })" [ngModelOptions]="{ standalone: true }" [placeholder]="i18n.t('packEditor.domainDescPlaceholder')" [attr.aria-label]="i18n.t('packEditor.editDomainDescription')"></textarea>
                  </div>
                  <div class="domain-actions">
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" [disabled]="i === 0" (click)="moveDomain(i, -1)" [attr.aria-label]="i18n.t('settings.moveUp', { name: d.name })"><app-icon name="arrow-up" /></button>
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" [disabled]="i === domains().length - 1" (click)="moveDomain(i, 1)" [attr.aria-label]="i18n.t('settings.moveDown', { name: d.name })"><app-icon name="arrow-down" /></button>
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-icon" (click)="removeDomain(i)" [attr.aria-label]="i18n.t('common.delete') + ': ' + d.name"><app-icon name="x" /></button>
                  </div>
                </li>
              }
            </ol>
            @if (domains().length < maxDomains) {
              <button type="button" class="ui-btn ui-btn-sm" (click)="addDomain()"><app-icon name="plus" /> {{ i18n.t('certDialog.addDomain') }}</button>
            }
          </details>

          @if (!pack()) {
            <label class="check">
              <input type="checkbox" name="bank" [(ngModel)]="createBank" />
              <span>{{ i18n.t('certDialog.createBank') }}</span>
            </label>
          }

          <details class="advanced">
            <summary>{{ i18n.t('certDialog.advanced') }}</summary>
            <label class="check">
              <input type="checkbox" name="partial" [(ngModel)]="partialCredit" />
              <span>{{ i18n.t('packEditor.allowPartialCredit') }}</span>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.versionOptional') }}</span>
              <input class="ui-input" name="version" [(ngModel)]="version" [placeholder]="i18n.t('packEditor.versionPlaceholder')" />
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.officialUrl') }}</span>
              <input class="ui-input" type="url" name="url" [(ngModel)]="officialUrl" placeholder="https://" />
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.questionsExportIntro') }}</span>
              <textarea class="ui-input" name="introQ" rows="3" [(ngModel)]="introQuestions"></textarea>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.transcriptsExportIntro') }}</span>
              <textarea class="ui-input" name="introT" rows="3" [(ngModel)]="introTranscripts"></textarea>
            </label>
            <label class="ui-field">
              <span>{{ i18n.t('packEditor.chatExportIntro') }}</span>
              <textarea class="ui-input" name="introC" rows="3" [(ngModel)]="introChat"></textarea>
            </label>
          </details>

          @if (confirmDelete()) {
            <div class="danger" role="alert">
              <p>{{ i18n.t('packEditor.deletePackConfirmBody', { name: pack()?.name, count: questionsInPack() }) }}</p>
              <div class="ui-actions">
                <button type="button" class="ui-btn ui-btn-sm" (click)="confirmDelete.set(false)">{{ i18n.t('common.cancel') }}</button>
                <button type="button" class="ui-btn ui-btn-sm ui-btn-danger" (click)="remove()">{{ i18n.t('common.delete') }}</button>
              </div>
            </div>
          }
        </div>

        <footer class="ui-modal-foot">
          @if (pack()) {
            <button type="button" class="ui-btn ui-btn-danger" (click)="confirmDelete.set(true)">{{ i18n.t('certDialog.delete') }}</button>
            <span class="spacer"></span>
          }
          <button type="button" class="ui-btn ui-btn-ghost" (click)="cancelled.emit()">{{ i18n.t('common.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" [disabled]="!name.trim()">{{ pack() ? i18n.t('common.save') : i18n.t('certDialog.create') }}</button>
        </footer>
      </form>
    </div>
  `,
  styles: [
    `
      .dialog {
        width: min(860px, 100%);
      }
      .presets {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        padding: var(--space-md);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-lg);
        background: var(--bg-elevated);
      }
      .presets-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
      }
      .link {
        background: none;
        border: 0;
        padding: 0;
        color: var(--color-amber);
        font-weight: 600;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      .preset-grid {
        display: grid;
        gap: var(--space-sm);
        grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
        max-height: 228px;
        overflow-y: auto;
        padding: 2px;
      }
      .preset {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        padding: 10px 12px;
        text-align: left;
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        cursor: pointer;
      }
      .preset:hover {
        border-color: var(--text-faint);
      }
      .preset.selected {
        border-color: var(--color-amber);
        box-shadow: 0 0 0 1px var(--color-amber);
        background: rgba(225, 112, 85, 0.06);
      }
      .preset-top {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--font-size-sm);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .mono {
        font-family: var(--font-mono);
        font-weight: 700;
      }
      .use {
        margin-left: auto;
        color: var(--text-faint);
        font-size: var(--font-size-xs);
      }
      .preset.selected .use {
        color: var(--color-amber);
        font-weight: 800;
      }
      .preset-name,
      .preset-desc {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .preset-name {
        font-weight: 700;
      }
      .prefilled {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-sm);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        border: 1px solid rgba(225, 112, 85, 0.35);
        background: rgba(225, 112, 85, 0.08);
        color: var(--color-amber);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .msg {
        font-size: var(--font-size-sm);
        color: var(--color-green);
      }
      .msg.error {
        color: var(--color-red);
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .swatch {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        position: relative;
      }
      .swatch.on {
        outline: 2px solid var(--text-primary);
        outline-offset: 2px;
      }
      .swatch.custom {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px dashed var(--text-faint);
        color: var(--text-muted);
      }
      .timing {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
        background: var(--bg-elevated);
      }
      small {
        font-size: var(--font-size-xs);
      }
      .domains summary,
      .advanced summary {
        cursor: pointer;
      }
      .advanced {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .advanced[open] {
        padding-bottom: var(--space-sm);
      }
      .advanced summary {
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: var(--space-sm);
      }
      .domain-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        margin: var(--space-md) 0 var(--space-sm);
        padding-left: var(--space-lg);
      }
      .domain {
        display: flex;
        gap: var(--space-sm);
        align-items: flex-start;
      }
      .domain-fields {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .domain-fields input {
        font-weight: 600;
      }
      .domain-actions {
        display: flex;
        gap: 2px;
      }
      .check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-weight: 600;
        font-size: var(--font-size-sm);
      }
      .danger {
        padding: var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid rgba(214, 48, 49, 0.35);
        background: rgba(214, 48, 49, 0.06);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .spacer {
        flex: 1;
      }
    `,
  ],
})
export class CertificationDialogComponent implements OnInit {
  private readonly packs = inject(PacksService);
  private readonly banks = inject(BanksService);
  private readonly catalog = inject(CatalogService);
  private readonly profile = inject(ProfileService);
  private readonly questions = inject(QuestionsService);
  protected readonly i18n = inject(I18nService);

  /** Certification being edited; null = create. */
  readonly pack = input<Pack | null>(null);
  /** Catalog entry to preselect when creating. */
  readonly preset = input<CatalogEntry | null>(null);
  readonly cancelled = output<void>();
  readonly saved = output<{ pack: Pack; created: boolean }>();
  readonly deleted = output<string>();

  protected readonly colors = PACK_COLORS;
  protected readonly providers = PROVIDER_CATEGORIES;
  protected readonly levels = CERTIFICATION_LEVELS;
  protected readonly maxDomains = MAX_PACK_DOMAINS;

  readonly eco = signal<ProviderCategory | 'all'>('all');
  readonly selectedId = signal<string | null>(null);
  readonly prefilledName = signal<string | null>(null);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);
  readonly confirmDelete = signal(false);
  readonly color = signal(DEFAULT_PACK_COLOR);
  readonly domains = signal<PackDomain[]>([]);

  protected name = '';
  protected code = '';
  protected provider: ProviderCategory | '' = '';
  protected level: CertificationLevel | '' = '';
  protected description = '';
  protected version = '';
  protected officialUrl = '';
  protected duration: number | null = null;
  protected accommodation: number | null = null;
  protected questionCount: number | null = null;
  protected passing: number | null = null;
  protected partialCredit = false;
  protected introQuestions = '';
  protected introTranscripts = '';
  protected introChat = '';
  protected createBank = true;
  private catalogId = '';

  readonly isCustomColor = computed(() => !PACK_COLORS.some((c) => c.value.toLowerCase() === this.color().toLowerCase()));

  /** Catalog minus certifications already in the workspace, interest matches first. */
  private readonly available = computed(() => {
    const taken = new Set(this.packs.packs().map((p) => p.catalogId).filter(Boolean));
    const interests = this.profile.interests();
    return this.catalog
      .entries()
      .filter((e) => !taken.has(e.id) || e.id === this.selectedId())
      .sort((a, b) => Number(interests.has(b.provider)) - Number(interests.has(a.provider)));
  });
  readonly ecosystems = computed(() => PROVIDER_CATEGORIES.filter((p) => this.available().some((e) => e.provider === p)));
  readonly presetList = computed(() => {
    const eco = this.eco();
    return this.available().filter((e) => eco === 'all' || e.provider === eco);
  });
  readonly questionsInPack = computed(() => {
    const id = this.pack()?.id;
    return id ? this.questions.allQuestions().filter((q) => q.packId === id).length : 0;
  });

  ngOnInit(): void {
    void this.catalog.load();
    const p = this.pack();
    if (p) {
      this.fill({
        name: p.name,
        description: p.description,
        version: p.version,
        domains: p.domains,
        color: p.color,
        exportIntroQuestions: p.exportIntroQuestions,
        exportIntroTranscripts: p.exportIntroTranscripts,
        exportIntroChat: p.exportIntroChat,
        allowPartialCredit: p.allowPartialCredit,
        examTotalQuestions: p.examTotalQuestions,
        examDurationMinutes: p.examDurationMinutes,
        accommodationMinutes: p.accommodationMinutes,
        code: p.code,
        provider: p.provider,
        level: p.level,
        officialUrl: p.officialUrl,
        passingScorePercent: p.passingScorePercent,
        catalogId: p.catalogId,
      });
    } else {
      const preset = this.preset();
      if (preset) void this.pick(preset);
    }
  }

  async pick(entry: CatalogEntry): Promise<void> {
    this.message.set(null);
    try {
      this.fill(await this.catalog.draftFor(entry));
      this.selectedId.set(entry.id);
      this.prefilledName.set(entry.name);
    } catch {
      this.message.set({ ok: false, text: this.i18n.t('packEditor.failedToLoadTemplate') });
    }
  }

  clearPreset(): void {
    this.selectedId.set(null);
    this.prefilledName.set(null);
    this.fill({ name: '', description: '', version: '', domains: [], color: DEFAULT_PACK_COLOR });
  }

  onJsonFile(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result)) as Record<string, unknown>;
        const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
        const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : undefined);
        this.fill({
          name: str('name') ?? '',
          description: str('description') ?? '',
          version: str('version') ?? '',
          domains: parseDomains(Array.isArray(raw['domains']) ? (raw['domains'] as unknown[]) : []),
          color: str('color') ?? DEFAULT_PACK_COLOR,
          exportIntroQuestions: str('exportIntroQuestions'),
          exportIntroTranscripts: str('exportIntroTranscripts'),
          exportIntroChat: str('exportIntroChat'),
          examDurationMinutes: num('examDurationMinutes'),
          examTotalQuestions: num('examTotalQuestions'),
          accommodationMinutes: num('accommodationMinutes'),
          passingScorePercent: num('passingScorePercent'),
          code: str('code'),
        });
        this.selectedId.set(null);
        this.prefilledName.set(str('name') ?? file.name);
      } catch {
        this.message.set({ ok: false, text: this.i18n.t('packEditor.couldNotParseJson') });
      }
    };
    reader.readAsText(file);
  }

  onCustomColor(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    if (isValidHexColor(v)) this.color.set(v);
  }

  editDomain(i: number, patch: Partial<PackDomain>): void {
    this.domains.update((list) => list.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  addDomain(): void {
    this.domains.update((list) => [...list, { name: '', description: '', order: list.length + 1 }]);
  }

  removeDomain(i: number): void {
    this.domains.update((list) => list.filter((_, idx) => idx !== i));
  }

  moveDomain(i: number, dir: -1 | 1): void {
    this.domains.update((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  save(): void {
    if (!this.name.trim()) return;
    // Domain order follows the list order; empty rows are dropped.
    const domains = this.domains()
      .filter((d) => d.name.trim())
      .map((d, i) => ({ name: d.name.trim(), description: d.description.trim(), order: i + 1 }));
    const draft: PackDraft = {
      name: this.name,
      description: this.description,
      version: this.version,
      domains,
      color: isAcceptablePackColor(this.color()) ? this.color() : DEFAULT_PACK_COLOR,
      exportIntroQuestions: this.introQuestions,
      exportIntroTranscripts: this.introTranscripts,
      exportIntroChat: this.introChat,
      allowPartialCredit: this.partialCredit,
      examDurationMinutes: positive(this.duration),
      accommodationMinutes: nonNegative(this.accommodation),
      examTotalQuestions: positive(this.questionCount),
      passingScorePercent: positive(this.passing),
      code: this.code,
      provider: this.provider || undefined,
      level: this.level || undefined,
      officialUrl: this.officialUrl,
      catalogId: this.catalogId,
    };
    const existing = this.pack();
    if (existing) {
      this.packs.update(existing.id, draft);
      this.saved.emit({ pack: this.packs.getById(existing.id) ?? existing, created: false });
      return;
    }
    const created = this.packs.create(draft);
    if (this.createBank) {
      this.banks.create(created.id, { author: DEFAULT_BANK_AUTHOR, version: '', sourceUrl: '', description: '' });
    }
    this.saved.emit({ pack: created, created: true });
  }

  remove(): void {
    const p = this.pack();
    if (!p) return;
    this.packs.remove(p.id);
    this.deleted.emit(p.id);
  }

  private fill(d: Partial<PackDraft> & Pick<PackDraft, 'name' | 'description' | 'version' | 'domains' | 'color'>): void {
    this.name = d.name;
    this.description = d.description;
    this.version = d.version;
    this.domains.set(d.domains.map((x) => ({ ...x })));
    this.color.set(d.color && isAcceptablePackColor(d.color) ? d.color : DEFAULT_PACK_COLOR);
    this.introQuestions = d.exportIntroQuestions ?? '';
    this.introTranscripts = d.exportIntroTranscripts ?? '';
    this.introChat = d.exportIntroChat ?? '';
    this.partialCredit = d.allowPartialCredit ?? false;
    this.duration = d.examDurationMinutes ?? null;
    this.accommodation = d.accommodationMinutes ?? null;
    this.questionCount = d.examTotalQuestions ?? null;
    this.passing = d.passingScorePercent ?? null;
    this.code = d.code ?? '';
    this.provider = d.provider ?? '';
    this.level = d.level ?? '';
    this.officialUrl = d.officialUrl ?? '';
    this.catalogId = d.catalogId ?? '';
  }
}

function positive(v: number | null): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
}

function nonNegative(v: number | null): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}
