import { Injectable, signal } from '@angular/core';

export interface LightboxImage {
  src: string;
  alt: string;
}

/** App-wide image viewer state; LightboxComponent (in the app shell) renders it. */
@Injectable({ providedIn: 'root' })
export class LightboxService {
  readonly current = signal<LightboxImage | null>(null);

  open(src: string, alt = ''): void {
    this.current.set({ src, alt });
  }

  close(): void {
    this.current.set(null);
  }
}
