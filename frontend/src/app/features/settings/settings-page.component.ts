import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { SettingsComponent } from './settings.component';

/** /settings — the settings panel as a full page. */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsComponent],
  template: `<div class="ui-page settings-page"><app-settings (closed)="back()" /></div>`,
  styles: [':host { display: block; } .settings-page { max-width: 860px; }'],
})
export class SettingsPageComponent {
  private readonly location = inject(Location);

  back(): void {
    this.location.back();
  }
}
