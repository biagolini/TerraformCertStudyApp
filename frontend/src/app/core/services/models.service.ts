import { Injectable, computed, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

export type ModelTier = 'fast' | 'balanced' | 'deep' | 'other';

export interface ModelOption {
  id: string;
  displayName: string;
  tier: ModelTier;
}

export const DEFAULT_MODEL_ID = 'amazon.nova-lite-v1:0';

/** Static list of Amazon Nova models exposed by the backend allowlist. */
const NOVA_MODELS: ModelOption[] = [
  { id: 'amazon.nova-micro-v1:0', displayName: 'Nova Micro', tier: 'fast' },
  { id: 'amazon.nova-lite-v1:0', displayName: 'Nova Lite', tier: 'balanced' },
  { id: 'amazon.nova-pro-v1:0', displayName: 'Nova Pro', tier: 'deep' },
];

@Injectable({ providedIn: 'root' })
export class ModelsService {
  private readonly settings = inject(SettingsService);

  private readonly state = signal<ModelOption[]>(NOVA_MODELS);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly models = this.state.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly tierLabel: Record<ModelTier, string> = {
    fast: 'fast',
    balanced: 'balanced',
    deep: 'deep',
    other: 'other',
  };

  readonly availableIds = computed(() => this.state().map((m) => m.id));

  resolveModel(preferred: string): string {
    const available = this.availableIds();
    if (preferred && available.includes(preferred)) return preferred;
    const settingsDefault = this.settings.defaultModel();
    if (settingsDefault && available.includes(settingsDefault)) return settingsDefault;
    return available.includes(DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : available[0] ?? DEFAULT_MODEL_ID;
  }
}
