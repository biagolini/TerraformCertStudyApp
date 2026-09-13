import { Injectable, computed, signal } from '@angular/core';

/** Tracks viewport width for the mobile/desktop layout breakpoint used
 * across the routed page components (questions/transcripts/chat) — a
 * root-provided singleton since all three need the same `isMobile` check
 * that used to live directly on `AppComponent`. */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly width = signal<number>(typeof window !== 'undefined' ? window.innerWidth : 1024);

  readonly isMobile = computed(() => this.width() < 768);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.width.set(window.innerWidth));
    }
  }
}
