import { Component, inject } from '@angular/core';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export interface ConfirmDeleteData {
  title: string;
}

@Component({
  selector: 'app-confirm-delete-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule],
  template: `
    <h2 mat-dialog-title>Delete question</h2>
    <mat-dialog-content>
      <p>Are you sure you want to delete <strong>{{ data.title }}</strong>?</p>
      <p class="warn">This action cannot be undone.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (loading) {
        <mat-spinner diameter="24"></mat-spinner>
      } @else {
        <button mat-button mat-dialog-close>Cancel</button>
        <button mat-flat-button color="warn" (click)="confirm()">Delete</button>
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
    .warn { color: var(--mat-sys-error, #d32f2f); font-size: 0.85em; margin-top: 4px; }
    mat-dialog-actions { padding: 8px 24px 16px; }
    mat-spinner { margin: 0 auto; }
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
export class ConfirmDeleteDialogComponent {
  readonly data = inject<ConfirmDeleteData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ConfirmDeleteDialogComponent>);
  loading = false;

  confirm(): void {
    this.loading = true;
    this.dialogRef.disableClose = true;
    this.dialogRef.close('confirm');
  }
}
