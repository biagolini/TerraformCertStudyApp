import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-page">
      <div class="login-card">
        <h1>Cert Study Assistant</h1>
        <p class="subtitle">AI-powered certification exam preparation</p>

        @if (error()) {
          <div class="error">{{ error() }}</div>
        }

        @if (!needsNewPassword()) {
          <form (ngSubmit)="onLogin()" action="." method="post">
            <input type="email" [(ngModel)]="email" name="email"
              placeholder="Email" autocomplete="username" required />
            <input type="password" [(ngModel)]="password" name="password"
              placeholder="Password" autocomplete="current-password" required />
            <button type="submit" [disabled]="loading()">
              {{ loading() ? 'Signing in...' : 'Sign In' }}
            </button>
          </form>
        } @else {
          <p class="info">Please set a new password</p>
          <form (ngSubmit)="onNewPassword()">
            <input type="password" [(ngModel)]="newPassword" name="newPassword"
              placeholder="New password" autocomplete="new-password" required />
            <input type="password" [(ngModel)]="confirmPassword" name="confirmPassword"
              placeholder="Confirm password" autocomplete="new-password" required />
            <button type="submit" [disabled]="loading()">
              {{ loading() ? 'Setting...' : 'Set Password' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #1a1a2e;
    }
    .login-card {
      background: #fff; border-radius: 16px; padding: 48px 40px;
      width: 400px; max-width: 90vw; text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    h1 { margin: 0 0 8px; font-size: 24px; color: #1a1a2e; }
    .subtitle { color: #666; font-size: 14px; margin: 0 0 24px; }
    .info { color: #333; font-size: 14px; margin: 0 0 16px; }
    .error {
      background: #fee; color: #c00; padding: 10px; border-radius: 8px;
      font-size: 13px; margin-bottom: 16px;
    }
    form { display: flex; flex-direction: column; gap: 12px; }
    input {
      padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px;
      font-size: 15px; outline: none;
    }
    input:focus { border-color: #4b64ff; }
    button {
      padding: 12px; font-size: 16px; font-weight: 600;
      background: #4b64ff; color: #fff; border: none; border-radius: 8px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: #3a50d9; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
  `],
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

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
      this.error.set('Passwords do not match');
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
