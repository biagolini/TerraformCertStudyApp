import { Component, inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { I18nService } from '../../core/i18n/i18n.service';

export interface ConfirmDeleteData {
  title: string;
}

@Component({
  selector: 'app-confirm-delete-dialog',
  standalone: true,
  imports: [MatDialogModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>{{ i18n.t('confirmDelete.title') }}</h2>
    <mat-dialog-content>
      <p>{{ i18n.t('confirmDelete.bodyPrefix') }} <strong>{{ data.title }}</strong>{{ i18n.t('confirmDelete.bodySuffix') }}</p>
      <p class="warn">{{ i18n.t('confirmDelete.cannotUndo') }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (loading) {
        <mat-spinner diameter="24"></mat-spinner>
      } @else {
        <button type="button" class="ui-btn" mat-dialog-close>{{ i18n.t('common.cancel') }}</button>
        <button type="button" class="ui-btn ui-btn-danger" (click)="confirm()">{{ i18n.t('common.delete') }}</button>
      }
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
    mat-dialog-content { color: var(--text-secondary); }
    .warn { color: var(--color-red); font-size: var(--font-size-sm); margin-top: var(--space-xs); }
    mat-dialog-actions { gap: var(--space-sm); padding: var(--space-sm) var(--space-lg) var(--space-md); }
    mat-spinner { margin: 0 auto; }
  `],
})
export class ConfirmDeleteDialogComponent {
  readonly data = inject<ConfirmDeleteData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ConfirmDeleteDialogComponent>);
  protected readonly i18n = inject(I18nService);
  loading = false;

  confirm(): void {
    this.loading = true;
    this.dialogRef.disableClose = true;
    this.dialogRef.close('confirm');
  }
}
