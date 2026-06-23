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

@Injectable({ providedIn: 'root' })
export class AuthService {
  isAuthenticated = signal(false);
  /** True once login + data load is complete */
  ready = signal(false);

  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private userPool: CognitoUserPool | null = null;

  constructor() {
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
