import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_PACK_COLOR,
  MAX_PACK_DOMAINS,
  PACK_COLORS,
  Pack,
  PackDomain,
  isAcceptablePackColor,
  isValidHexColor,
  isValidPackColor,
  packDisplayLabel,
} from '../../core/models/pack.model';
import { PacksService } from '../../core/services/packs.service';
import { QuestionsService } from '../../core/services/questions.service';
import { ChatService } from '../../core/services/chat.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-pack-editor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="pack-editor-title">
      <div class="card">
        <header class="card-header">
          <h2 id="pack-editor-title">
            {{ isEditMode() ? i18n.t('packEditor.editPack') : i18n.t('packEditor.newPack') }}
          </h2>
          <button
            type="button"
            class="close-btn"
            (click)="cancelled.emit()"
            [attr.aria-label]="i18n.t('packEditor.closeEditor')"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                d="M5 5l14 14M19 5L5 19"
              />
            </svg>
          </button>
        </header>

        <div class="card-body">
          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.quickStart') }}</span>
            <span class="field-hint">{{ i18n.t('packEditor.quickStartHint') }}</span>
            <div class="autofill-grid">
              <button type="button" class="btn-import-json" (click)="triggerJsonImport()" [attr.aria-label]="i18n.t('packEditor.importFromJsonFile')">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
                </svg>
                {{ i18n.t('packEditor.importFile') }}
              </button>
              <button type="button" class="btn-import-json" (click)="toggleJsonPaste()" [attr.aria-label]="i18n.t('packEditor.pasteJsonText')">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/>
                </svg>
                {{ i18n.t('packEditor.pasteJson') }}
              </button>
              <button type="button" class="btn-import-json btn-templates" (click)="toggleTemplates()" [attr.aria-label]="i18n.t('packEditor.loadFromTemplates')">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
                </svg>
                {{ i18n.t('packEditor.templates') }}
              </button>
              <button type="button" class="btn-import-json btn-templates" (click)="toggleCopyFromPack()" [attr.aria-label]="i18n.t('packEditor.copyFromPackAriaLabel')">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M8 8H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3M8 8h8v8"/>
                </svg>
                {{ i18n.t('packEditor.copyFromPack') }}
              </button>
              <input
                #jsonFileInput
                type="file"
                accept=".json,application/json"
                class="file-input-hidden"
                aria-hidden="true"
                (change)="onJsonFileSelected($event)"
              />
            </div>
            @if (jsonPasteOpen()) {
              <div class="json-paste-area">
                <textarea
                  class="text-input textarea json-paste-textarea"
                  [(ngModel)]="jsonPasteDraft"
                  [placeholder]="i18n.t('packEditor.pasteJsonPlaceholder')"
                  [attr.aria-label]="i18n.t('packEditor.pasteJsonContent')"
                  rows="6"
                ></textarea>
                <div class="json-paste-actions">
                  <button type="button" class="btn btn-primary btn-sm" (click)="applyJsonPaste()">{{ i18n.t('packEditor.apply') }}</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="toggleJsonPaste()">{{ i18n.t('common.cancel') }}</button>
                </div>
              </div>
            }
            @if (templatesOpen()) {
              <div class="templates-panel">
                <p class="templates-title">{{ i18n.t('packEditor.predefinedExamPacks') }}</p>
                <ul class="templates-list">
                  @for (tpl of templates; track tpl.file) {
                    <li>
                      <button type="button" class="template-item" (click)="loadTemplate(tpl.file)">
                        {{ tpl.label }}
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
            @if (copyFromPackOpen()) {
              <div class="templates-panel">
                <p class="templates-title">{{ i18n.t('packEditor.yourPacks') }}</p>
                @if (copyablePacks().length === 0) {
                  <p class="templates-empty">{{ i18n.t('packEditor.noOtherPacks') }}</p>
                } @else {
                  <ul class="templates-list">
                    @for (p of copyablePacks(); track p.id) {
                      <li>
                        <button type="button" class="template-item template-item-pack" (click)="copyFromPack(p)">
                          <span class="template-item-swatch" [style.background]="p.color"></span>
                          {{ packLabel(p) }}
                        </button>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
            @if (jsonImportMessage()) {
              <p class="import-msg" [class.import-ok]="jsonImportOk()" [class.import-err]="!jsonImportOk()">
                {{ jsonImportMessage() }}
              </p>
            }
          </div>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.name') }}</span>
            <input
              class="text-input"
              type="text"
              [(ngModel)]="nameDraft"
              [placeholder]="i18n.t('packEditor.namePlaceholder')"
              [attr.aria-label]="i18n.t('packEditor.packName')"
            />
          </label>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.versionOptional') }}</span>
            <input
              class="text-input"
              type="text"
              [(ngModel)]="versionDraft"
              [placeholder]="i18n.t('packEditor.versionPlaceholder')"
              [attr.aria-label]="i18n.t('packEditor.packVersion')"
            />
            <span class="field-hint">{{ i18n.t('packEditor.versionHint') }}</span>
          </label>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.certDescriptionOptional') }}</span>
            <textarea
              class="text-input textarea"
              [(ngModel)]="descriptionDraft"
              [placeholder]="i18n.t('packEditor.certDescriptionPlaceholder')"
              [attr.aria-label]="i18n.t('packEditor.certDescriptionOptional')"
              rows="4"
            ></textarea>
            <span class="field-hint">{{ i18n.t('packEditor.certDescriptionHint') }}</span>
          </label>

          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.color') }}</span>
            <div class="color-grid" role="radiogroup" [attr.aria-label]="i18n.t('packEditor.packColor')">
              @for (color of colors; track color.id) {
                <button
                  type="button"
                  class="color-swatch"
                  role="radio"
                  [attr.aria-checked]="colorDraft() === color.value"
                  [attr.aria-label]="i18n.t('color.' + color.id)"
                  [class.selected]="colorDraft() === color.value"
                  [style.background]="color.value"
                  (click)="setColor(color.value)"
                ></button>
              }
              <button
                type="button"
                class="color-swatch custom-swatch"
                role="radio"
                [attr.aria-checked]="isCustomColor()"
                [attr.aria-label]="i18n.t('packEditor.customColor')"
                [class.selected]="isCustomColor()"
                [class.has-custom]="isCustomColor()"
                [style.background]="isCustomColor() ? colorDraft() : null"
                (click)="openColorPicker()"
              >
                @if (!isCustomColor()) {
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
                  </svg>
                }
              </button>
              <input
                #colorPickerInput
                type="color"
                class="color-picker-hidden"
                [value]="isCustomColor() ? colorDraft() : defaultCustomColor"
                (input)="onCustomColorInput($event)"
                [attr.aria-label]="i18n.t('packEditor.pickCustomColor')"
                tabindex="-1"
              />
            </div>
            @if (isCustomColor()) {
              <span class="custom-hint">{{ i18n.t('packEditor.customColorHint', { color: colorDraft() }) }}</span>
            }
          </div>

          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.knowledgeDomains') }}</span>
            <span class="field-hint">{{ i18n.t('packEditor.knowledgeDomainsHint') }}</span>
            <div class="domain-add-group">
              <div class="domain-input">
                <input
                  class="text-input order-input"
                  type="number"
                  [(ngModel)]="domainOrderDraft"
                  placeholder="#"
                  [disabled]="domains().length >= maxDomains"
                  [attr.aria-label]="i18n.t('packEditor.domainNumberOptional')"
                  min="1"
                />
                <input
                  class="text-input"
                  type="text"
                  [(ngModel)]="domainDraft"
                  (keyup.enter)="onAddDomain()"
                  [placeholder]="i18n.t('packEditor.domainNamePlaceholder')"
                  [disabled]="domains().length >= maxDomains"
                  [attr.aria-label]="i18n.t('packEditor.newDomainName')"
                />
                <button
                  type="button"
                  class="btn btn-secondary"
                  (click)="onAddDomain()"
                  [disabled]="!domainDraft.trim() || domains().length >= maxDomains"
                >
                  {{ i18n.t('packEditor.add') }}
                </button>
              </div>
              <textarea
                class="text-input textarea domain-desc-input"
                [(ngModel)]="domainDescDraft"
                [placeholder]="i18n.t('packEditor.domainDescPlaceholder')"
                [attr.aria-label]="i18n.t('packEditor.newDomainDescription')"
                rows="2"
                [disabled]="domains().length >= maxDomains"
              ></textarea>
            </div>
            @if (domainError()) {
              <p class="error">{{ domainError() }}</p>
            }
            <p class="count">{{ i18n.t('packEditor.domainsCount', { count: domains().length, max: maxDomains }) }}</p>
            @if (domains().length > 0) {
              <ul class="domain-list">
                @for (domain of domains(); track domain.name) {
                  <li class="domain-item">
                    @if (editingDomain() === domain.name) {
                      <div class="domain-edit-form">
                        <div class="domain-edit-row">
                          <input
                            class="text-input order-input"
                            type="number"
                            [(ngModel)]="editOrderDraft"
                            placeholder="#"
                            [attr.aria-label]="i18n.t('packEditor.domainNumberOptional')"
                            min="1"
                          />
                          <input
                            class="text-input"
                            type="text"
                            [(ngModel)]="editNameDraft"
                            [attr.aria-label]="i18n.t('packEditor.editDomainName')"
                            (keyup.enter)="saveEditDomain(domain.name)"
                            (keyup.escape)="cancelEditDomain()"
                          />
                        </div>
                        <textarea
                          class="text-input textarea domain-desc-input"
                          [(ngModel)]="editDescDraft"
                          [attr.aria-label]="i18n.t('packEditor.editDomainDescription')"
                          rows="3"
                        ></textarea>
                        <div class="domain-edit-actions">
                          <button type="button" class="btn btn-primary btn-sm" (click)="saveEditDomain(domain.name)">{{ i18n.t('common.save') }}</button>
                          <button type="button" class="btn btn-ghost btn-sm" (click)="cancelEditDomain()">{{ i18n.t('common.cancel') }}</button>
                        </div>
                      </div>
                    } @else {
                      <div class="domain-item-header">
                        @if (domain.order !== undefined) {
                          <span class="domain-order">{{ domain.order }}</span>
                        }
                        <span class="domain-item-name">{{ domain.name }}</span>
                        <div class="domain-item-actions">
                          <button
                            type="button"
                            class="domain-action-btn"
                            (click)="moveDomain($index, -1)"
                            [disabled]="$index === 0"
                            [attr.aria-label]="i18n.t('settings.moveUp', { name: domain.name })"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="domain-action-btn"
                            (click)="moveDomain($index, 1)"
                            [disabled]="$index === domains().length - 1"
                            [attr.aria-label]="i18n.t('settings.moveDown', { name: domain.name })"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12l7 7 7-7"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="domain-action-btn"
                            (click)="startEditDomain(domain.name, domain.description, domain.order)"
                            [attr.aria-label]="i18n.t('packs.editName', { name: domain.name })"
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                              <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            class="chip-remove"
                            (click)="removeDomain(domain.name)"
                            [attr.aria-label]="i18n.t('packEditor.removeName', { name: domain.name })"
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                              <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 5l14 14M19 5L5 19"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      @if (domain.description) {
                        <p class="domain-item-desc">{{ domain.description }}</p>
                      }
                    }
                  </li>
                }
              </ul>
            }
          </div>

          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.scoring') }}</span>
            <span class="field-hint">{{ i18n.t('packEditor.scoringHint') }}</span>
            <label class="switch-row">
              <button
                type="button"
                class="switch"
                [class.on]="allowPartialCreditDraft()"
                (click)="allowPartialCreditDraft.set(!allowPartialCreditDraft())"
                role="switch"
                [attr.aria-checked]="allowPartialCreditDraft()"
                [attr.aria-label]="i18n.t('packEditor.allowPartialCredit')"
              ><span class="thumb"></span></button>
              <span>{{ i18n.t('packEditor.allowPartialCredit') }}</span>
            </label>
          </div>

          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.timingOptional') }}</span>
            <span class="field-hint">{{ i18n.t('packEditor.timingHint') }}</span>
            <div class="timing-row">
              <label class="timing-field">
                <span class="timing-label">{{ i18n.t('packEditor.examQuestions') }}</span>
                <input class="text-input" type="number" min="1" step="1" [(ngModel)]="examTotalQuestionsDraft" placeholder="e.g. 65" [attr.aria-label]="i18n.t('packEditor.officialExamQuestionCount')" />
              </label>
              <label class="timing-field">
                <span class="timing-label">{{ i18n.t('packEditor.durationMin') }}</span>
                <input class="text-input" type="number" min="1" step="1" [(ngModel)]="examDurationMinutesDraft" placeholder="e.g. 130" [attr.aria-label]="i18n.t('packEditor.officialExamDuration')" />
              </label>
              <label class="timing-field">
                <span class="timing-label">{{ i18n.t('packEditor.accommodationMin') }}</span>
                <input class="text-input" type="number" min="0" step="1" [(ngModel)]="accommodationMinutesDraft" placeholder="e.g. 30" [attr.aria-label]="i18n.t('packEditor.accommodationExtraTime')" />
              </label>
            </div>
          </div>

          <div class="field">
            <span class="field-label">{{ i18n.t('packEditor.exportIntroBlocks') }}</span>
            <span class="field-hint">{{ i18n.t('packEditor.exportIntroBlocksHint') }}</span>
          </div>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.questionsExportIntro') }}</span>
            <textarea
              class="text-input textarea intro-textarea"
              [(ngModel)]="exportIntroQuestionsDraft"
              rows="6"
              placeholder="## Sobre este documento&#10;&#10;Este documento contém questões de simulado..."
              [attr.aria-label]="i18n.t('packEditor.questionsExportIntro')"
            ></textarea>
          </label>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.transcriptsExportIntro') }}</span>
            <textarea
              class="text-input textarea intro-textarea"
              [(ngModel)]="exportIntroTranscriptsDraft"
              rows="6"
              placeholder="## Sobre este documento&#10;&#10;Este documento contém resumos técnicos..."
              [attr.aria-label]="i18n.t('packEditor.transcriptsExportIntro')"
            ></textarea>
          </label>

          <label class="field">
            <span class="field-label">{{ i18n.t('packEditor.chatExportIntro') }}</span>
            <textarea
              class="text-input textarea intro-textarea"
              [(ngModel)]="exportIntroChatDraft"
              rows="6"
              placeholder="## Sobre este documento&#10;&#10;Este documento contém conversas de estudo..."
              [attr.aria-label]="i18n.t('packEditor.chatExportIntro')"
            ></textarea>
          </label>
        </div>

        <footer class="card-footer">
          @if (isEditMode()) {
            <button type="button" class="btn btn-danger" (click)="onDeleteRequested()">
              {{ i18n.t('packEditor.deletePack') }}
            </button>
          }
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">{{ i18n.t('common.cancel') }}</button>
          <button
            type="button"
            class="btn btn-primary"
            (click)="onSave()"
            [disabled]="!nameDraft.trim()"
          >
            {{ i18n.t('common.save') }}
          </button>
        </footer>

        @if (confirmingDelete()) {
          <div class="confirm-overlay" role="dialog" aria-modal="true">
            <div class="confirm">
              <h3>{{ i18n.t('packEditor.deletePackConfirmTitle') }}</h3>
              <p>{{ i18n.t('packEditor.deletePackConfirmBody', { name: nameDraft || i18n.t('packEditor.thisPack'), count: questionsInPack() }) }}</p>
              <div class="confirm-actions">
                <button type="button" class="btn btn-ghost" (click)="onCancelDelete()">{{ i18n.t('common.cancel') }}</button>
                <button type="button" class="btn btn-danger" (click)="onConfirmDelete()">{{ i18n.t('common.delete') }}</button>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 60;
        background: var(--overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-md);
      }
      .card {
        position: relative;
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        width: min(480px, 100%);
        max-height: 90dvh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        padding: var(--space-md) var(--space-lg);
        border-bottom: 1px solid var(--bg-border);
      }
      .card-header h2 {
        font-size: var(--font-size-xl);
      }
      .close-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        height: var(--touch-min);
        border-radius: var(--radius-md);
        color: var(--text-muted);
      }
      .close-btn:hover {
        background: var(--bg-subtle);
        color: var(--text-primary);
      }
      .card-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .field-label {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-primary);
      }
      .field-hint {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .timing-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-md);
      }
      .timing-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 120px;
      }
      .timing-label {
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }
      .switch-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .switch {
        width: 38px;
        height: 22px;
        border-radius: 999px;
        background: var(--bg-border);
        position: relative;
        border: none;
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
      }
      .switch.on {
        background: var(--color-purple);
      }
      .switch .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        transition: left var(--transition-fast);
      }
      .switch.on .thumb {
        left: 18px;
      }
      .text-input {
        height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: var(--font-size-base);
        width: 100%;
      }
      .text-input:focus-visible {
        outline: none;
        border-color: var(--color-purple);
      }
      .intro-textarea {
        min-height: 120px;
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
      }
      .color-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: var(--space-xs);
        max-width: 320px;
      }
      .color-swatch {
        width: 100%;
        aspect-ratio: 1;
        border-radius: var(--radius-md);
        border: 2px solid transparent;
        cursor: pointer;
        transition: transform var(--transition-fast), border-color var(--transition-fast);
      }
      .color-swatch:hover {
        transform: scale(1.05);
      }
      .color-swatch.selected {
        border-color: var(--text-primary);
        transform: scale(1.05);
        box-shadow: 0 0 0 2px var(--bg-surface), 0 0 0 4px var(--text-primary);
      }
      .custom-swatch {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-elevated);
        border: 1px dashed var(--bg-border);
        color: var(--text-muted);
      }
      .custom-swatch.has-custom {
        border-style: solid;
      }
      .custom-swatch:hover {
        border-color: var(--color-purple);
        color: var(--color-purple);
      }
      .color-picker-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        opacity: 0;
        pointer-events: none;
      }
      .custom-hint {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        font-family: var(--font-mono);
      }
      .autofill-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-xs);
      }
      .btn-import-json {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: var(--touch-min);
        padding: var(--space-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        font-weight: 500;
        cursor: pointer;
        transition: border-color var(--transition-fast), color var(--transition-fast);
        white-space: nowrap;
      }
      .btn-import-json:hover {
        border-color: var(--color-purple);
        color: var(--color-purple);
      }
      .btn-templates {
        border-color: var(--color-purple);
        color: var(--color-purple);
        background: rgba(108, 92, 231, 0.06);
      }
      .templates-panel {
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        padding: var(--space-sm);
      }
      .templates-title {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: var(--space-xs);
      }
      .templates-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 240px;
        overflow-y: auto;
      }
      .template-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-sm);
        border: none;
        background: transparent;
        color: var(--text-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: background var(--transition-fast);
      }
      .template-item:hover {
        background: rgba(108, 92, 231, 0.1);
        color: var(--color-purple);
      }
      .template-item-pack {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }
      .template-item-swatch {
        width: 12px;
        height: 12px;
        border-radius: var(--radius-sm);
        flex-shrink: 0;
      }
      .templates-empty {
        font-size: var(--font-size-sm);
        color: var(--text-faint);
        padding: var(--space-xs) var(--space-sm);
      }
      .file-input-hidden {
        display: none;
      }
      .json-paste-area {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .json-paste-textarea {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        line-height: 1.5;
      }
      .json-paste-actions {
        display: flex;
        gap: var(--space-xs);
      }
      .import-msg {
        font-size: var(--font-size-sm);
        padding: var(--space-xs) var(--space-sm);
        border-radius: var(--radius-md);
      }
      .import-ok {
        color: var(--color-green);
        background: rgba(0, 184, 148, 0.08);
      }
      .import-err {
        color: var(--color-red);
        background: rgba(214, 48, 49, 0.08);
      }
      .textarea {
        height: auto;
        padding: var(--space-sm) var(--space-md);
        resize: vertical;
        font-family: inherit;
        line-height: 1.45;
      }
      .domain-add-group {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .domain-desc-input {
        font-size: var(--font-size-sm);
      }
      .domain-input {
        display: flex;
        gap: var(--space-sm);
      }
      .domain-input .text-input {
        flex: 1;
      }
      .domain-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .domain-item {
        list-style: none;
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        border-radius: var(--radius-md);
        padding: var(--space-xs) var(--space-sm);
      }
      .domain-item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-xs);
      }
      .domain-order {
        font-size: var(--font-size-xs);
        font-weight: 600;
        color: var(--text-faint);
        min-width: 16px;
        flex-shrink: 0;
      }
      .domain-item-name {
        font-size: var(--font-size-sm);
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
      }
      .order-input {
        width: 52px;
        flex-shrink: 0;
        padding: 0 var(--space-sm);
        text-align: center;
      }
      .domain-edit-row {
        display: flex;
        gap: var(--space-xs);
      }
      .domain-edit-row .text-input:not(.order-input) {
        flex: 1;
      }
      .domain-item-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
      }
      .domain-action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--radius-sm);
        color: var(--text-faint);
      }
      .domain-action-btn:hover {
        color: var(--color-blue);
        background: var(--bg-subtle);
      }
      .domain-item-desc {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        line-height: 1.4;
        margin-top: 2px;
        white-space: pre-wrap;
      }
      .domain-edit-form {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .domain-edit-actions {
        display: flex;
        gap: var(--space-xs);
      }
      .btn-sm {
        min-height: 32px;
        padding: 0 var(--space-sm);
        font-size: var(--font-size-sm);
      }
      .btn {
        min-height: var(--touch-min);
        padding: 0 var(--space-md);
        border-radius: var(--radius-md);
        font-weight: 600;
        font-size: var(--font-size-base);
        white-space: nowrap;
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-primary {
        background: var(--color-purple);
        color: #ffffff;
      }
      .btn-primary:hover:not(:disabled) {
        background: var(--color-blue);
      }
      .btn-secondary {
        background: var(--bg-elevated);
        color: var(--text-primary);
        border: 1px solid var(--bg-border);
      }
      .btn-secondary:hover:not(:disabled) {
        background: var(--bg-subtle);
      }
      .btn-ghost {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--bg-border);
      }
      .btn-ghost:hover:not(:disabled) {
        background: var(--bg-subtle);
      }
      .btn-danger {
        background: transparent;
        color: var(--color-red);
        border: 1px solid var(--color-red);
      }
      .btn-danger:hover:not(:disabled) {
        background: var(--color-red);
        color: #ffffff;
      }
      .count {
        font-size: var(--font-size-sm);
        color: var(--text-faint);
      }
      .error {
        font-size: var(--font-size-sm);
        color: var(--color-red);
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        padding: 4px var(--space-sm);
        padding-right: var(--space-xs);
        border-radius: var(--radius-pill);
        background: var(--bg-elevated);
        border: 1px solid var(--bg-border);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .chip-remove {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--radius-pill);
        color: var(--text-muted);
      }
      .chip-remove:hover {
        background: var(--color-red);
        color: #ffffff;
      }
      .card-footer {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md) var(--space-lg);
        border-top: 1px solid var(--bg-border);
      }
      .spacer {
        flex: 1;
      }
      .confirm-overlay {
        position: absolute;
        inset: 0;
        background: var(--overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-lg);
      }
      .confirm {
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        padding: var(--space-lg);
        box-shadow: var(--shadow-lg);
        max-width: 360px;
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }
      .confirm h3 {
        font-size: var(--font-size-lg);
      }
      .confirm p {
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-sm);
      }
    `,
  ],
})
export class PackEditorComponent {
  private readonly packs = inject(PacksService);
  private readonly questionsService = inject(QuestionsService);
  private readonly chatService = inject(ChatService);
  protected readonly i18n = inject(I18nService);

  readonly pack = input<Pack | null>(null);
  readonly cancelled = output<void>();
  readonly saved = output<Pack>();
  readonly deleted = output<string>();

  protected readonly colors = PACK_COLORS;
  protected readonly maxDomains = MAX_PACK_DOMAINS;

  protected nameDraft = '';
  protected descriptionDraft = '';
  protected versionDraft = '';
  protected exportIntroQuestionsDraft = '';
  protected exportIntroTranscriptsDraft = '';
  protected exportIntroChatDraft = '';
  protected readonly allowPartialCreditDraft = signal(false);
  protected examTotalQuestionsDraft: number | null = null;
  protected examDurationMinutesDraft: number | null = null;
  protected accommodationMinutesDraft: number | null = null;
  protected domainDraft = '';
  protected domainDescDraft = '';
  protected domainOrderDraft: number | null = null;
  protected readonly colorDraft = signal<string>(DEFAULT_PACK_COLOR);
  protected readonly domainsDraft = signal<PackDomain[]>([]);
  protected readonly domainError = signal<string | null>(null);
  protected readonly confirmingDelete = signal(false);
  protected readonly jsonImportMessage = signal<string | null>(null);
  protected readonly jsonImportOk = signal(false);
  protected readonly jsonPasteOpen = signal(false);
  protected readonly templatesOpen = signal(false);
  protected readonly copyFromPackOpen = signal(false);
  protected jsonPasteDraft = '';
  protected readonly editingDomain = signal<string | null>(null);
  protected editNameDraft = '';
  protected editDescDraft = '';
  protected editOrderDraft: number | null = null;
  protected readonly defaultCustomColor = '#D97757';

  @ViewChild('jsonFileInput') private jsonFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('colorPickerInput') private colorPickerInput!: ElementRef<HTMLInputElement>;

  readonly isEditMode = computed(() => !!this.pack());
  readonly isCustomColor = computed(() => !isValidPackColor(this.colorDraft()));
  readonly domains = this.domainsDraft.asReadonly();
  readonly questionsInPack = computed(() => {
    const p = this.pack();
    return p ? this.questionsService.allQuestions().filter((q) => q.packId === p.id).length : 0;
  });
  /** Every other pack in the account — excludes the one currently being
   * edited (copying a pack onto itself is meaningless), never the "new
   * pack" case since there's no self to exclude then. */
  readonly copyablePacks = computed(() => {
    const currentId = this.pack()?.id;
    return this.packs.packs().filter((p) => p.id !== currentId);
  });

  constructor() {
    // Sync drafts whenever the input pack changes.
    const sync = () => {
      const p = this.pack();
      this.nameDraft = p?.name ?? '';
      this.descriptionDraft = p?.description ?? '';
      this.versionDraft = p?.version ?? '';
      this.exportIntroQuestionsDraft = p?.exportIntroQuestions ?? '';
      this.exportIntroTranscriptsDraft = p?.exportIntroTranscripts ?? '';
      this.exportIntroChatDraft = p?.exportIntroChat ?? '';
      this.allowPartialCreditDraft.set(p?.allowPartialCredit ?? false);
      this.examTotalQuestionsDraft = p?.examTotalQuestions ?? null;
      this.examDurationMinutesDraft = p?.examDurationMinutes ?? null;
      this.accommodationMinutesDraft = p?.accommodationMinutes ?? null;
      this.colorDraft.set(p?.color ?? DEFAULT_PACK_COLOR);
      this.domainsDraft.set(p ? [...p.domains] : []);
      this.domainDraft = '';
      this.domainDescDraft = '';
      this.domainOrderDraft = null;
      this.domainError.set(null);
      this.confirmingDelete.set(false);
    };
    // Run sync once on construction.
    queueMicrotask(sync);
  }

  triggerJsonImport(): void {
    this.jsonFileInput.nativeElement.value = '';
    this.jsonFileInput.nativeElement.click();
  }

  toggleJsonPaste(): void {
    this.jsonPasteOpen.update((v) => !v);
    if (!this.jsonPasteOpen()) this.jsonPasteDraft = '';
    if (this.jsonPasteOpen()) {
      this.templatesOpen.set(false);
      this.copyFromPackOpen.set(false);
    }
  }

  toggleTemplates(): void {
    this.templatesOpen.update((v) => !v);
    if (this.templatesOpen()) {
      this.jsonPasteOpen.set(false);
      this.copyFromPackOpen.set(false);
    }
  }

  toggleCopyFromPack(): void {
    this.copyFromPackOpen.update((v) => !v);
    if (this.copyFromPackOpen()) {
      this.jsonPasteOpen.set(false);
      this.templatesOpen.set(false);
    }
  }

  packLabel(pack: Pack): string {
    return packDisplayLabel(pack);
  }

  /** Copies every field this dialog actually edits from another pack in
   * the account — a superset of what applyJsonText can cover, since it
   * reads the real Pack object directly rather than round-tripping
   * through JSON (so timing/partial-credit fields come along too, not
   * just the subset a hand-authored JSON file would include). */
  copyFromPack(source: Pack): void {
    this.nameDraft = source.name;
    this.versionDraft = source.version ?? '';
    this.descriptionDraft = source.description ?? '';
    this.colorDraft.set(source.color);
    this.domainsDraft.set([...source.domains]);
    this.exportIntroQuestionsDraft = source.exportIntroQuestions ?? '';
    this.exportIntroTranscriptsDraft = source.exportIntroTranscripts ?? '';
    this.exportIntroChatDraft = source.exportIntroChat ?? '';
    this.allowPartialCreditDraft.set(source.allowPartialCredit ?? false);
    this.examTotalQuestionsDraft = source.examTotalQuestions ?? null;
    this.examDurationMinutesDraft = source.examDurationMinutes ?? null;
    this.accommodationMinutesDraft = source.accommodationMinutes ?? null;
    this.copyFromPackOpen.set(false);
    this.jsonImportOk.set(true);
    this.jsonImportMessage.set(this.i18n.t('packEditor.copiedFromPack', { name: packDisplayLabel(source) }));
  }

  async loadTemplate(file: string): Promise<void> {
    try {
      const res = await fetch(`examples/${file}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load');
      const raw = await res.text();
      this.applyJsonText(raw);
      this.templatesOpen.set(false);
    } catch {
      this.jsonImportOk.set(false);
      this.jsonImportMessage.set(this.i18n.t('packEditor.failedToLoadTemplate'));
    }
  }

  readonly templates = [
    { label: 'AWS Advanced Networking Specialty (ANS-C01)', file: 'aws-ans-c01-pack.json' },
    { label: 'AWS AI Business Strategist (AIB-C01)', file: 'aws-aib-c01-pack.json' },
    { label: 'AWS AI Practitioner (AIF-C01)', file: 'aws-aif-c01-pack.json' },
    { label: 'AWS Cloud Practitioner (CLF-C02)', file: 'aws-clf-c02-pack.json' },
    { label: 'AWS CloudOps Engineer Associate (SOA-C03)', file: 'aws-soa-c03-pack.json' },
    { label: 'AWS Data Engineer Associate (DEA-C01)', file: 'aws-dea-c01-pack.json' },
    { label: 'AWS Developer Associate (DVA-C02)', file: 'aws-dva-c02-pack.json' },
    { label: 'AWS DevOps Engineer Professional (DOP-C02)', file: 'aws-dop-c02-pack.json' },
    { label: 'AWS GenAI Developer Professional (AIP-C01)', file: 'aws-aip-c01-pack.json' },
    { label: 'AWS ML Engineer Associate (MLA-C01)', file: 'aws-mla-c01-pack.json' },
    { label: 'AWS Security Specialty (SCS-C03)', file: 'aws-scs-c03-pack.json' },
    { label: 'AWS Solutions Architect Associate (SAA-C03)', file: 'aws-saa-c03-pack.json' },
    { label: 'AWS Solutions Architect Professional (SAP-C02)', file: 'aws-sap-c02-pack.json' },
    { label: 'Claude Certified Architect Foundations (CCAF)', file: 'ccaf-pack.json' },
    { label: 'Claude Certified Architect Professional (CCAR-P)', file: 'claude-ccar-p-pack.json' },
    { label: 'Claude Certified Associate Foundations (CCAO-F)', file: 'claude-ccao-f-pack.json' },
    { label: 'Claude Certified Developer Foundations (CCDV-F)', file: 'claude-ccdv-f-pack.json' },
    { label: 'HashiCorp Terraform Associate (004)', file: 'hashicorp-terraform-associate-004-pack.json' },
    { label: 'HashiCorp Terraform Authoring and Operations Advanced', file: 'hashicorp-terraform-advanced-pack.json' },
    { label: 'MongoDB Associate Atlas Administrator', file: 'mongodb-associate-atlas-admin-pack.json' },
    { label: 'MongoDB Associate Data Modeler', file: 'mongodb-associate-data-modeler-pack.json' },
    { label: 'MongoDB Associate Database Administrator', file: 'mongodb-associate-dba-pack.json' },
    { label: 'MongoDB Associate Developer (Python)', file: 'mongodb-associate-developer-pack.json' },
  ];

  applyJsonPaste(): void {
    this.applyJsonText(this.jsonPasteDraft);
    this.jsonPasteDraft = '';
    this.jsonPasteOpen.set(false);
  }

  onJsonFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : '';
      this.applyJsonText(raw);
    };
    reader.readAsText(file);
  }

  private applyJsonText(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as Partial<{
        name: string;
        version: string;
        color: string;
        description: string;
        domains: unknown[];
        exportIntroQuestions: string;
        exportIntroTranscripts: string;
        exportIntroChat: string;
      }>;
      const applied: string[] = [];

      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        this.nameDraft = parsed.name.trim();
        applied.push('name');
      }
      if (typeof parsed.version === 'string') {
        this.versionDraft = parsed.version.trim();
        applied.push('version');
      }
      if (typeof parsed.color === 'string' && isAcceptablePackColor(parsed.color.trim())) {
        this.colorDraft.set(parsed.color.trim());
        applied.push('color');
      }
      if (typeof parsed.description === 'string') {
        this.descriptionDraft = parsed.description.trim();
        applied.push('description');
      }
      if (Array.isArray(parsed.domains)) {
        const domains: PackDomain[] = parsed.domains
          .map((d) => {
            if (typeof d === 'string' && d.trim()) return { name: d.trim(), description: '' };
            if (d && typeof d === 'object') {
              const obj = d as Record<string, unknown>;
              const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
              if (!name) return null;
              const entry: PackDomain = { name, description: typeof obj['description'] === 'string' ? obj['description'].trim() : '' };
              if (typeof obj['order'] === 'number' && (obj['order'] as number) > 0) entry.order = obj['order'] as number;
              return entry;
            }
            return null;
          })
          .filter((d): d is PackDomain => d !== null)
          .slice(0, MAX_PACK_DOMAINS);
        this.domainsDraft.set(domains);
        applied.push(`${domains.length} domain(s)`);
      }

      if (typeof parsed.exportIntroQuestions === 'string') {
        this.exportIntroQuestionsDraft = parsed.exportIntroQuestions.trim();
        applied.push('exportIntroQuestions');
      }
      if (typeof parsed.exportIntroTranscripts === 'string') {
        this.exportIntroTranscriptsDraft = parsed.exportIntroTranscripts.trim();
        applied.push('exportIntroTranscripts');
      }
      if (typeof parsed.exportIntroChat === 'string') {
        this.exportIntroChatDraft = parsed.exportIntroChat.trim();
        applied.push('exportIntroChat');
      }

      if (applied.length > 0) {
        this.jsonImportOk.set(true);
        this.jsonImportMessage.set(this.i18n.t('packEditor.imported', { fields: applied.join(', ') }));
      } else {
        this.jsonImportOk.set(false);
        this.jsonImportMessage.set(this.i18n.t('packEditor.noRecognizedFields'));
      }
    } catch {
      this.jsonImportOk.set(false);
      this.jsonImportMessage.set(this.i18n.t('packEditor.couldNotParseJson'));
    }
  }

  setColor(value: string): void {
    this.colorDraft.set(value);
  }

  openColorPicker(): void {
    this.colorPickerInput.nativeElement.click();
  }

  onCustomColorInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (isValidHexColor(value)) {
      this.colorDraft.set(value);
    }
  }

  onAddDomain(): void {
    const name = this.domainDraft.trim();
    if (!name) {
      this.domainError.set(this.i18n.t('packEditor.domainNameEmpty'));
      return;
    }
    const current = this.domainsDraft();
    if (current.some((d) => d.name.toLowerCase() === name.toLowerCase())) {
      this.domainError.set(this.i18n.t('packEditor.domainAlreadyExists'));
      return;
    }
    if (current.length >= MAX_PACK_DOMAINS) {
      this.domainError.set(this.i18n.t('packEditor.maxDomainsReached', { max: MAX_PACK_DOMAINS }));
      return;
    }
    const entry: PackDomain = { name, description: this.domainDescDraft.trim() };
    if (this.domainOrderDraft !== null && this.domainOrderDraft > 0) entry.order = this.domainOrderDraft;
    this.domainsDraft.set([...current, entry]);
    this.domainDraft = '';
    this.domainDescDraft = '';
    this.domainOrderDraft = null;
    this.domainError.set(null);
  }

  removeDomain(name: string): void {
    this.domainsDraft.set(this.domainsDraft().filter((d) => d.name !== name));
  }

  moveDomain(index: number, direction: -1 | 1): void {
    const current = this.domainsDraft();
    const target = index + direction;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    this.domainsDraft.set(next);
  }

  startEditDomain(name: string, description: string, order?: number): void {
    this.editingDomain.set(name);
    this.editNameDraft = name;
    this.editDescDraft = description;
    this.editOrderDraft = order ?? null;
  }

  cancelEditDomain(): void {
    this.editingDomain.set(null);
    this.editNameDraft = '';
    this.editDescDraft = '';
    this.editOrderDraft = null;
  }

  saveEditDomain(originalName: string): void {
    const newName = this.editNameDraft.trim();
    if (!newName) return;
    const current = this.domainsDraft();
    const conflict = current.some(
      (d) => d.name !== originalName && d.name.toLowerCase() === newName.toLowerCase(),
    );
    if (conflict) return;
    this.domainsDraft.set(
      current.map((d) => {
        if (d.name !== originalName) return d;
        const updated: PackDomain = { name: newName, description: this.editDescDraft.trim() };
        if (this.editOrderDraft !== null && this.editOrderDraft > 0) updated.order = this.editOrderDraft;
        return updated;
      }),
    );
    this.cancelEditDomain();
  }

  onSave(): void {
    const draft = {
      name: this.nameDraft.trim(),
      description: this.descriptionDraft.trim(),
      version: this.versionDraft.trim(),
      domains: this.domainsDraft(),
      color: this.colorDraft(),
      exportIntroQuestions: this.exportIntroQuestionsDraft.trim() || undefined,
      exportIntroTranscripts: this.exportIntroTranscriptsDraft.trim() || undefined,
      exportIntroChat: this.exportIntroChatDraft.trim() || undefined,
      allowPartialCredit: this.allowPartialCreditDraft(),
      examTotalQuestions: this.examTotalQuestionsDraft ?? undefined,
      examDurationMinutes: this.examDurationMinutesDraft ?? undefined,
      accommodationMinutes: this.accommodationMinutesDraft ?? undefined,
    };
    if (!draft.name) return;
    const existing = this.pack();
    if (existing) {
      this.packs.update(existing.id, draft);
      const updated = this.packs.getById(existing.id);
      if (updated) this.saved.emit(updated);
    } else {
      const created = this.packs.create(draft);
      this.saved.emit(created);
    }
  }

  onDeleteRequested(): void {
    this.confirmingDelete.set(true);
  }

  onCancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  onConfirmDelete(): void {
    const target = this.pack();
    if (!target) return;
    void this.questionsService.removeByPackId(target.id);
    this.chatService.removeByPackId(target.id);
    this.packs.remove(target.id);
    this.confirmingDelete.set(false);
    this.deleted.emit(target.id);
  }
}
