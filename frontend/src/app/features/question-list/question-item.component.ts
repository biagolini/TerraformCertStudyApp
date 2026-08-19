import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Question } from '../../core/models/question.model';
import { PacksService } from '../../core/services/packs.service';
import { DEFAULT_DOMAIN } from '../../core/models/settings.model';
import { DomainBadgeComponent } from '../../shared/components/domain-badge.component';
import { TruncatePipe } from '../../shared/pipes/truncate.pipe';

@Component({
  selector: 'app-question-item',
  standalone: true,
  imports: [DomainBadgeComponent, TruncatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" [class.active]="active()">
      <label class="check" [attr.aria-label]="checkboxLabel()">
        <input
          type="checkbox"
          [checked]="selected()"
          (change)="selectionToggled.emit()"
        />
        <span class="check-box" aria-hidden="true"></span>
      </label>

      <div class="content">
        <button
          type="button"
          class="title-btn"
          (click)="opened.emit()"
          [attr.aria-label]="'Open review for ' + question().title"
        >
          <span class="title">{{ question().title | truncate: 120 }}</span>
        </button>

        <div class="domain-control" (click)="$event.stopPropagation()">
          @if (showPicker()) {
            <select
              class="domain-select"
              [value]="question().domain"
              (change)="onPickDomain($event)"
              (blur)="closePicker()"
              aria-label="Change domain"
            >
              @for (option of domainOptions(); track option) {
                <option [value]="option" [selected]="option === question().domain">{{ option }}</option>
              }
            </select>
          } @else {
            <button
              type="button"
              class="badge-btn"
              (click)="openPicker()"
              aria-label="Change domain"
            >
              <app-domain-badge [domain]="question().domain" />
            </button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: start;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-surface);
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        transition: background var(--transition-fast), border-color var(--transition-fast);
      }
      .row:hover {
        background: var(--bg-elevated);
      }
      .row.active {
        border-color: var(--color-purple);
        background: var(--bg-elevated);
      }
      .content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        padding: var(--space-xs) 0;
      }
      .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        cursor: pointer;
        position: relative;
      }
      .check input {
        position: absolute;
        opacity: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        cursor: pointer;
      }
      .check-box {
        width: 20px;
        height: 20px;
        border-radius: var(--radius-sm);
        border: 1.5px solid var(--bg-border);
        background: var(--bg-input);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background var(--transition-fast), border-color var(--transition-fast);
      }
      .check input:checked + .check-box {
        background: var(--color-purple);
        border-color: var(--color-purple);
      }
      .check input:checked + .check-box::after {
        content: '';
        width: 10px;
        height: 6px;
        border-left: 2px solid #ffffff;
        border-bottom: 2px solid #ffffff;
        transform: rotate(-45deg) translate(0, -2px);
      }
      .title-btn {
        text-align: left;
        background: none;
        padding: 0;
        color: var(--text-primary);
        font-size: var(--font-size-base);
        font-weight: 500;
        line-height: 1.35;
        min-width: 0;
        width: 100%;
      }
      .title {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
      }
      .domain-control {
        display: inline-flex;
        max-width: 100%;
      }
      .badge-btn {
        display: inline-flex;
        align-items: center;
        padding: 0;
        background: none;
        max-width: 100%;
      }
      .badge-btn app-domain-badge {
        max-width: 100%;
        min-width: 0;
      }
      .domain-select {
        height: 32px;
        max-width: 100%;
        padding: 0 var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-sm);
      }
    `,
  ],
})
export class QuestionItemComponent {
  private readonly packs = inject(PacksService);

  readonly question = input.required<Question>();
  readonly selected = input.required<boolean>();
  readonly active = input<boolean>(false);

  readonly opened = output<void>();
  readonly selectionToggled = output<void>();
  readonly domainChanged = output<string>();

  protected readonly pickerOpen = signal(false);
  readonly showPicker = computed(() => this.pickerOpen());

  readonly domainOptions = computed(() => {
    const defined = this.packs.activeDomains().map((d) => d.name);
    const current = this.question().domain;
    const merged = defined.length > 0 ? [...defined] : [DEFAULT_DOMAIN];
    if (current && !merged.includes(current)) merged.unshift(current);
    return merged;
  });

  readonly checkboxLabel = computed(() =>
    this.selected() ? `Deselect ${this.question().title}` : `Select ${this.question().title}`,
  );

  openPicker(): void {
    this.pickerOpen.set(true);
  }

  closePicker(): void {
    this.pickerOpen.set(false);
  }

  onPickDomain(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.domainChanged.emit(value);
    this.pickerOpen.set(false);
  }
}
