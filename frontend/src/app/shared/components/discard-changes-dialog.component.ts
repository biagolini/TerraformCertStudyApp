import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { I18nService } from '../../core/i18n/i18n.service';

/** Gates navigating away from an in-progress edit (see
 * import-review-page.component.ts's tryNavigate) — a lighter-weight sibling
 * to ConfirmDeleteDialogComponent for a reversible, local-only loss (an
 * unsaved textarea edit) rather than a destructive backend action. */
@Component({
  selector: 'app-discard-changes-dialog',
  standalone: true,
  imports: [MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('discardChanges.title') }}</h2>
    <mat-dialog-content>
      <p>{{ i18n.t('discardChanges.bodyPrefix') }} <strong>{{ i18n.t('common.save') }}</strong> {{ i18n.t('discardChanges.bodySuffix') }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button type="button" class="ui-btn" mat-dialog-close>{{ i18n.t('discardChanges.keepEditing') }}</button>
      <button type="button" class="ui-btn ui-btn-danger" (click)="discard()">{{ i18n.t('discardChanges.discard') }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      background: var(--bg-surface);
      color: var(--text-primary);
      border-radius: var(--radius-lg);
    }
    h2[mat-dialog-title] { color: var(--text-primary); }
    mat-dialog-content p { color: var(--text-secondary); }
    mat-dialog-actions { gap: var(--space-sm); padding: var(--space-sm) var(--space-lg) var(--space-md); }
  `],
})
export class DiscardChangesDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DiscardChangesDialogComponent>);
  protected readonly i18n = inject(I18nService);

  discard(): void {
    this.dialogRef.close('discard');
  }
}
