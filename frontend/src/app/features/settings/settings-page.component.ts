import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SettingsComponent } from './settings.component';

/** /settings: the settings panel as a full page. The header gear opens and closes it. */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SettingsComponent],
  template: `<div class="ui-page settings-page"><app-settings /></div>`,
  styles: [':host { display: block; } .settings-page { max-width: 860px; }'],
})
export class SettingsPageComponent {}
