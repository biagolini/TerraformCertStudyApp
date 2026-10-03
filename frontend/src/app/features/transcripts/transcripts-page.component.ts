import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Script } from '../../core/models/script.model';
import { ScriptsService } from '../../core/services/scripts.service';
import { ViewportService } from '../../core/services/viewport.service';
import { ScriptListComponent } from './script-list.component';
import { ScriptViewerComponent } from './script-viewer.component';
import { TranscriptInputComponent } from './transcript-input.component';

/** Routed at /transcripts and /transcripts/:scriptId — a direct port of
 * app.component.ts's old `@case ('transcript')` block. No packId: scripts
 * aren't pack-scoped (ScriptsService/Script have no notion of a pack). */
@Component({
  selector: 'app-transcripts-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranscriptInputComponent, ScriptListComponent, ScriptViewerComponent],
  template: `
    @if (showLeftColumn()) {
      <section class="column column-left">
        <div class="stack">
          @if (showInputForm()) {
            <app-transcript-input (generated)="onScriptGenerated($event)" />
          }
          @if (showScriptList()) {
            <app-script-list [activeId]="scriptId()" (opened)="onOpenScript($event)" />
          }
        </div>
      </section>
    }
    @if (showScriptViewer()) {
      <section class="column column-right">
        <app-script-viewer
          [script]="activeScript()"
          [showBackButton]="isMobile()"
          (back)="onCloseScript()"
          (deleted)="onScriptDeleted($event)"
        />
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class TranscriptsPageComponent {
  private readonly router = inject(Router);
  private readonly scriptsService = inject(ScriptsService);
  private readonly viewport = inject(ViewportService);

  readonly scriptId = input<string | null>(null);
  readonly isMobile = this.viewport.isMobile;

  readonly activeScript = computed<Script | null>(() => {
    const id = this.scriptId();
    if (!id) return null;
    return this.scriptsService.scripts().find((s) => s.id === id) ?? null;
  });

  readonly showInputForm = computed(() => !(this.isMobile() && this.scriptId()));
  readonly showScriptList = computed(() => !this.isMobile() || !this.scriptId());
  readonly showScriptViewer = computed(() => !this.isMobile() || !!this.scriptId());
  readonly showLeftColumn = computed(() => this.showInputForm() || this.showScriptList());

  onScriptGenerated(script: Script): void {
    this.router.navigate(['/transcripts', script.id]);
  }

  onOpenScript(script: Script): void {
    this.router.navigate(['/transcripts', script.id]);
  }

  onCloseScript(): void {
    this.router.navigate(['/transcripts']);
  }

  onScriptDeleted(id: string): void {
    if (this.scriptId() === id) {
      this.router.navigate(['/transcripts']);
    }
  }
}
