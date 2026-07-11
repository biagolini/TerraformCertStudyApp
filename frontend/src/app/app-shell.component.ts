import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    @if (auth.reauthenticating()) {
      <div class="reauth-overlay" role="alert" aria-live="assertive">
        <div class="reauth-card">
          <div class="spinner" aria-hidden="true"></div>
          <p>Refreshing session…</p>
        </div>
      </div>
    }
  `,
  styles: [`
    .reauth-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(2px);
    }
    .reauth-card {
      background: var(--color-surface, #fff);
      border-radius: 12px;
      padding: 32px 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
    }
    .reauth-card p {
      margin: 0;
      font-size: 14px;
      color: var(--color-text, #333);
      font-weight: 500;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(0, 0, 0, 0.1);
      border-top-color: var(--pack-color, #4b64ff);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class AppShellComponent {
  protected readonly auth = inject(AuthService);
}
