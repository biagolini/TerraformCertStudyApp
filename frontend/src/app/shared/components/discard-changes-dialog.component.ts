import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

/** Gates navigating away from an in-progress edit (see
 * import-review-page.component.ts's tryNavigate) — a lighter-weight sibling
 * to ConfirmDeleteDialogComponent for a reversible, local-only loss (an
 * unsaved textarea edit) rather than a destructive backend action. */
@Component({
  selector: 'app-discard-changes-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Discard unsaved changes?</h2>
    <mat-dialog-content>
      <p>You're editing this question. Switching to another one without clicking <strong>Save</strong> will discard your changes.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Keep editing</button>
      <button mat-flat-button color="warn" (click)="discard()">Discard changes</button>
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
    mat-dialog-actions { padding: 8px 24px 16px; }
    button[mat-button] {
      color: var(--text-secondary);
      border: 1px solid var(--bg-border);
    }
    button[mat-flat-button] {
      background: var(--mat-sys-error, #d32f2f);
      color: #ffffff;
    }
  `],
})
export class DiscardChangesDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DiscardChangesDialogComponent>);

  discard(): void {
    this.dialogRef.close('discard');
  }
}
