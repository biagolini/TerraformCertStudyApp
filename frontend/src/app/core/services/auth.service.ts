import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { environment } from '../../../environments/environment';
import { StorageService } from './storage.service';

const OFFLINE_RETRY_MS = 30 * 60 * 1000;

/** Amazon Cognito Identity JS's own Client throws exactly this message when
 * the underlying fetch itself fails (no response at all) — see
 * node_modules/amazon-cognito-identity-js/es/Client.js. That specific
 * message is the one reliable way to tell "couldn't reach Cognito" apart
 * from a real auth rejection (NotAuthorizedException, expired refresh
 * token, etc.), which always comes back with a response and a Cognito
 * error code instead. */
function isNetworkFailure(err: unknown): boolean {
  return (err instanceof Error && err.message === 'Network error') || !navigator.onLine;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  isAuthenticated = signal(false);
  /** True once login + data load is complete */
  ready = signal(false);
  /** True while attempting automatic token refresh */
  reauthenticating = signal(false);
  /** True when the last token refresh failed because Cognito couldn't be
   * reached (not because the session is actually invalid) — the app stays
   * on the current screen instead of redirecting to /login, and a
   * background retry keeps trying every 30 minutes (or immediately once
   * the browser reports `online` again). */
  readonly offline = signal(false);
  readonly nextRetryAt = signal<number | null>(null);

  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private userPool: CognitoUserPool | null = null;
  private offlineRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Lets StorageService fetch a fresh, auto-refreshed token before every
    // authenticated request instead of relying on a cached one that goes
    // stale once the id token expires (background sync, visibility refresh, etc).
    this.storage.setTokenProvider(() => this.getValidToken());

    if (environment.cognito.userPoolId && environment.cognito.clientId) {
      this.userPool = new CognitoUserPool({
        UserPoolId: environment.cognito.userPoolId,
        ClientId: environment.cognito.clientId,
      });
      // If we have a stored session, restore it
      if (this.hasToken()) {
        this.isAuthenticated.set(true);
        this.restoreSession();
      }
    }

    window.addEventListener('online', () => this.retryNow());
  }

  login(email: string, password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.userPool) { reject('Cognito not configured'); return; }
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });

      user.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          this.isAuthenticated.set(true);
          this.initStorage(session).then(() => resolve('SUCCESS'));
        },
        onFailure: (err) => reject(err.message || 'Authentication failed'),
        newPasswordRequired: () => {
          (this as any)._pendingUser = user;
          resolve('NEW_PASSWORD_REQUIRED');
        },
      });
    });
  }

  completeNewPassword(newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const user = (this as any)._pendingUser as CognitoUser;
      if (!user) { reject('No pending user'); return; }

      user.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session: CognitoUserSession) => {
          this.isAuthenticated.set(true);
          (this as any)._pendingUser = null;
          this.initStorage(session).then(() => resolve());
        },
        onFailure: (err) => reject(err.message || 'Failed to set new password'),
      });
    });
  }

  /**
   * Returns a valid id token, refreshing if necessary.
   * Shows reauthenticating overlay while refreshing (unless `background` —
   * used by the offline auto-retry so it doesn't pop the blocking overlay
   * for a check the user didn't ask for).
   * If refresh fails because the session is genuinely invalid, redirects to
   * login. If it fails because Cognito couldn't be reached, flips `offline`
   * instead and schedules a silent retry — see isNetworkFailure().
   */
  async getValidToken(background = false): Promise<string> {
    if (!this.userPool) {
      this.redirectToLogin();
      throw new Error('Session expired. Redirecting to login...');
    }

    const user = this.userPool.getCurrentUser();
    if (!user) {
      this.redirectToLogin();
      throw new Error('Session expired. Redirecting to login...');
    }

    return new Promise<string>((resolve, reject) => {
      // getSession() automatically refreshes the id token using the refresh token
      // if the current id token is expired but refresh token is still valid
      if (!background) this.reauthenticating.set(true);

      user.getSession((err: any, session: CognitoUserSession | null) => {
        if (!background) this.reauthenticating.set(false);

        if (err || !session || !session.isValid()) {
          if (err && isNetworkFailure(err)) {
            this.enterOffline();
            reject(Object.assign(new Error('Offline — will retry automatically.'), { offline: true }));
            return;
          }
          this.redirectToLogin();
          reject(new Error('Session expired. Redirecting to login...'));
          return;
        }

        const token = session.getIdToken().getJwtToken();
        this.isAuthenticated.set(true);
        this.storage.updateToken(token);
        this.exitOffline();
        resolve(token);
      });
    });
  }

  /** Forces an immediate retry (browser `online` event, or a user-facing
   * "Retry now" affordance) instead of waiting out the rest of the current
   * 30-minute backoff. */
  retryNow(): void {
    if (!this.offline()) return;
    void this.getValidToken(true);
  }

  /** Schedules the next background retry. Re-entrant by design: a retry
   * that itself fails calls enterOffline() again (from getValidToken's own
   * failure path) which reschedules — so this never needs to reschedule
   * itself from its own timeout callback, only clear the timer handle and
   * attempt the retry. */
  private enterOffline(): void {
    this.offline.set(true);
    if (this.offlineRetryTimer) return; // already scheduled
    this.nextRetryAt.set(Date.now() + OFFLINE_RETRY_MS);
    this.offlineRetryTimer = setTimeout(() => {
      this.offlineRetryTimer = null;
      if (this.offline()) void this.getValidToken(true).catch(() => {});
    }, OFFLINE_RETRY_MS);
  }

  private exitOffline(): void {
    if (!this.offline() && this.offlineRetryTimer === null) return;
    this.offline.set(false);
    this.nextRetryAt.set(null);
    if (this.offlineRetryTimer) {
      clearTimeout(this.offlineRetryTimer);
      this.offlineRetryTimer = null;
    }
  }

  ensureTokenValid(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.userPool) { resolve(false); return; }
      const user = this.userPool.getCurrentUser();
      if (!user) { this.isAuthenticated.set(false); resolve(false); return; }

      user.getSession((err: any, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          this.isAuthenticated.set(false);
          resolve(false);
        } else {
          this.isAuthenticated.set(true);
          this.storage.updateToken(session.getIdToken().getJwtToken());
          resolve(true);
        }
      });
    });
  }

  logout(): void {
    const user = this.userPool?.getCurrentUser();
    if (user) user.signOut();
    this.isAuthenticated.set(false);
    this.ready.set(false);
    this.exitOffline();
    this.router.navigate(['/login']);
  }

  getIdToken(): string | null {
    const user = this.userPool?.getCurrentUser();
    if (!user) return null;
    let token: string | null = null;
    user.getSession((err: any, session: CognitoUserSession | null) => {
      if (!err && session && session.isValid()) {
        token = session.getIdToken().getJwtToken();
      }
    });
    return token;
  }

  private redirectToLogin(): void {
    this.isAuthenticated.set(false);
    this.ready.set(false);
    this.exitOffline();
    this.router.navigate(['/login']);
  }

  private async initStorage(session: CognitoUserSession): Promise<void> {
    const token = session.getIdToken().getJwtToken();
    await this.storage.initialize(token);
    this.ready.set(true);
  }

  private async restoreSession(): Promise<void> {
    const user = this.userPool?.getCurrentUser();
    if (!user) return;

    user.getSession(async (err: any, session: CognitoUserSession | null) => {
      if (!err && session && session.isValid()) {
        await this.initStorage(session);
      } else {
        this.isAuthenticated.set(false);
      }
    });
  }

  private hasToken(): boolean {
    const user = this.userPool?.getCurrentUser();
    return !!user;
  }
}
