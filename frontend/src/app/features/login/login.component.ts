import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-page">
      <div class="login-card">
        <h1>Cert Study Assistant</h1>
        <p class="subtitle">{{ i18n.t('login.subtitle') }}</p>

        @if (error()) {
          <div class="error">{{ error() }}</div>
        }

        @if (!needsNewPassword()) {
          <form (ngSubmit)="onLogin()" action="." method="post">
            <input type="email" [(ngModel)]="email" name="email"
              [placeholder]="i18n.t('login.email')" autocomplete="username" required />
            <input type="password" [(ngModel)]="password" name="password"
              [placeholder]="i18n.t('login.password')" autocomplete="current-password" required />
            <button type="submit" [disabled]="loading()">
              {{ loading() ? i18n.t('login.signingIn') : i18n.t('login.signIn') }}
            </button>
          </form>
        } @else {
          <p class="info">{{ i18n.t('login.setNewPassword') }}</p>
          <form (ngSubmit)="onNewPassword()">
            <input type="password" [(ngModel)]="newPassword" name="newPassword"
              [placeholder]="i18n.t('login.newPassword')" autocomplete="new-password" required />
            <input type="password" [(ngModel)]="confirmPassword" name="confirmPassword"
              [placeholder]="i18n.t('login.confirmPassword')" autocomplete="new-password" required />
            <button type="submit" [disabled]="loading()">
              {{ loading() ? i18n.t('login.settingPassword') : i18n.t('login.setPassword') }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: var(--bg-base);
    }
    .login-card {
      background: var(--bg-surface); border-radius: var(--radius-lg); padding: 48px 40px;
      width: 400px; max-width: 90vw; text-align: center;
      box-shadow: var(--shadow-lg);
    }
    h1 { margin: 0 0 8px; font-size: 24px; color: var(--text-primary); }
    .subtitle { color: var(--text-muted); font-size: var(--font-size-base); margin: 0 0 24px; }
    .info { color: var(--text-secondary); font-size: var(--font-size-base); margin: 0 0 16px; }
    .error {
      background: rgba(214, 48, 49, 0.1); color: var(--color-red); padding: var(--space-sm);
      border-radius: var(--radius-md); font-size: var(--font-size-sm); margin-bottom: var(--space-md);
    }
    form { display: flex; flex-direction: column; gap: var(--space-sm); }
    input {
      padding: var(--space-sm) var(--space-md); border: 1px solid var(--bg-border);
      border-radius: var(--radius-md); background: var(--bg-input); color: var(--text-primary);
      font-size: var(--font-size-lg); outline: none;
    }
    input:focus { border-color: var(--color-blue); }
    button {
      padding: var(--space-sm); font-size: var(--font-size-lg); font-weight: 600;
      background: var(--color-blue); color: #fff; border: none; border-radius: var(--radius-md);
      cursor: pointer; min-height: var(--touch-min);
    }
    button:hover:not(:disabled) { filter: brightness(0.92); }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  protected readonly i18n = inject(I18nService);

  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  error = signal('');
  loading = signal(false);
  needsNewPassword = signal(false);

  async onLogin(): Promise<void> {
    this.error.set('');
    this.loading.set(true);
    try {
      const result = await this.auth.login(this.email, this.password);
      if (result === 'NEW_PASSWORD_REQUIRED') {
        this.needsNewPassword.set(true);
      } else {
        // Small delay so browser detects successful login and prompts to save credentials
        setTimeout(() => this.router.navigate(['/']), 100);
      }
    } catch (e: any) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  async onNewPassword(): Promise<void> {
    if (this.newPassword !== this.confirmPassword) {
      this.error.set(this.i18n.t('login.passwordsDoNotMatch'));
      return;
    }
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.completeNewPassword(this.newPassword);
      this.router.navigate(['/']);
    } catch (e: any) {
      this.error.set(e);
    } finally {
      this.loading.set(false);
    }
  }
}
