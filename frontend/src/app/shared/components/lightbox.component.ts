import { ChangeDetectionStrategy, Component, HostListener, effect, inject, signal } from '@angular/core';
import { LightboxService } from '../../core/services/lightbox.service';
import { I18nService } from '../../core/i18n/i18n.service';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

/** Full-screen image viewer with wheel/button zoom and drag-to-pan. Opened through LightboxService. */
@Component({
  selector: 'app-lightbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lightbox.current(); as img) {
      <div class="lb" role="dialog" aria-modal="true" [attr.aria-label]="img.alt || i18n.t('lightbox.image')" (click)="lightbox.close()">
        <div class="lb-toolbar" (click)="$event.stopPropagation()">
          <button type="button" class="lb-btn" (click)="zoomBy(-0.5)" [attr.aria-label]="i18n.t('lightbox.zoomOut')">−</button>
          <span class="lb-zoom">{{ (zoom() * 100).toFixed(0) }}%</span>
          <button type="button" class="lb-btn" (click)="zoomBy(0.5)" [attr.aria-label]="i18n.t('lightbox.zoomIn')">+</button>
          <button type="button" class="lb-btn" (click)="reset()" [attr.aria-label]="i18n.t('lightbox.reset')">1:1</button>
          <button type="button" class="lb-btn" (click)="lightbox.close()" [attr.aria-label]="i18n.t('common.close')">✕</button>
        </div>
        <img
          class="lb-img"
          [src]="img.src"
          [alt]="img.alt"
          draggable="false"
          [style.transform]="'translate(' + panX() + 'px,' + panY() + 'px) scale(' + zoom() + ')'"
          [class.grab]="zoom() > 1"
          (click)="$event.stopPropagation()"
          (wheel)="onWheel($event)"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="dragging = false"
          (pointercancel)="dragging = false"
          (dblclick)="zoom() > 1 ? reset() : zoomBy(1)"
        />
        @if (img.alt) {
          <p class="lb-caption" (click)="$event.stopPropagation()">{{ img.alt }}</p>
        }
      </div>
    }
  `,
  styles: [
    `
      .lb {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: rgba(0, 0, 0, 0.88);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        touch-action: none;
      }
      .lb-img {
        max-width: 92vw;
        max-height: 84vh;
        transition: transform 80ms linear;
        user-select: none;
        cursor: zoom-in;
      }
      .lb-img.grab {
        cursor: grab;
      }
      .lb-toolbar {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 1;
      }
      .lb-btn {
        min-width: 40px;
        height: 40px;
        border-radius: var(--radius-md);
        background: rgba(255, 255, 255, 0.14);
        color: #fff;
        font-weight: 700;
        font-size: 16px;
      }
      .lb-btn:hover {
        background: rgba(255, 255, 255, 0.26);
      }
      .lb-zoom {
        color: #fff;
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        min-width: 48px;
        text-align: center;
      }
      .lb-caption {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        color: #e2e8f0;
        font-size: var(--font-size-sm);
        max-width: 80vw;
        text-align: center;
      }
    `,
  ],
})
export class LightboxComponent {
  protected readonly lightbox = inject(LightboxService);
  protected readonly i18n = inject(I18nService);

  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  protected dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor() {
    effect(() => {
      if (this.lightbox.current()) this.reset();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lightbox.current()) this.lightbox.close();
  }

  zoomBy(delta: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom() + delta));
    this.zoom.set(next);
    if (next === 1) {
      this.panX.set(0);
      this.panY.set(0);
    }
  }

  reset(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 0.25 : -0.25);
  }

  onPointerDown(event: PointerEvent): void {
    if (this.zoom() <= 1) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.panX.update((v) => v + event.clientX - this.lastX);
    this.panY.update((v) => v + event.clientY - this.lastY);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }
}
