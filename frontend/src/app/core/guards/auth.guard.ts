import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { StorageService } from '../services/storage.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const storage = inject(StorageService);

  const valid = await auth.ensureTokenValid();
  if (!valid) return router.parseUrl('/login');

  // Wait for storage to finish loading (max 10s)
  if (!storage.ready()) {
    await waitForReady(storage, 10000);
  }
  return true;
};

function waitForReady(storage: StorageService, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (storage.ready()) { resolve(); return; }
    const start = Date.now();
    const check = setInterval(() => {
      if (storage.ready() || Date.now() - start > timeout) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}
