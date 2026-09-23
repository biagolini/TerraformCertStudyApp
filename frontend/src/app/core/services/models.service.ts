import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { SettingsService } from './settings.service';

export type ModelTier = 'fast' | 'balanced' | 'deep' | 'other';

export interface ModelOption {
  id: string;
  displayName: string;
  tier: ModelTier;
  /** Whether the model supports extended reasoning (Converse reasoningConfig). */
  reasoning: boolean;
  /** Provider name (e.g. "Amazon", "Anthropic"). Optional for static fallback. */
  provider?: string;
}

export const DEFAULT_MODEL_ID = 'amazon.nova-lite-v1:0';

/** Static fallback list used until the dynamic list loads, or if it fails. */
const NOVA_MODELS: ModelOption[] = [
  { id: 'amazon.nova-micro-v1:0', displayName: 'Nova Micro', tier: 'fast', reasoning: false, provider: 'Amazon' },
  { id: 'amazon.nova-lite-v1:0', displayName: 'Nova Lite', tier: 'balanced', reasoning: false, provider: 'Amazon' },
  { id: 'amazon.nova-pro-v1:0', displayName: 'Nova Pro', tier: 'deep', reasoning: false, provider: 'Amazon' },
];

/** Shape returned by GET /data/models. */
interface ApiModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
}

/** Heuristic tier for known Amazon Nova ids; everything else is "other". */
function inferTier(id: string): ModelTier {
  if (id.includes('micro')) return 'fast';
  if (id.includes('lite')) return 'balanced';
  if (id.includes('pro') || id.includes('premier')) return 'deep';
  return 'other';
}

function toModelOption(m: ApiModel): ModelOption {
  return {
    id: m.id,
    displayName: m.name || m.id,
    tier: inferTier(m.id),
    reasoning: !!m.reasoning,
    provider: m.provider || undefined,
  };
}

@Injectable({ providedIn: 'root' })
export class ModelsService {
  private readonly settings = inject(SettingsService);
  private readonly auth = inject(AuthService);

  private readonly state = signal<ModelOption[]>(NOVA_MODELS);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private loaded = false;

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

  constructor() {
    // Load the dynamic model list once the user is authenticated.
    effect(() => {
      if (this.auth.ready() && !this.loaded) {
        this.loaded = true;
        void this.load();
      }
    });
  }

  /** Fetch the usable-models list from the backend. Keeps the static list on failure. */
  async load(): Promise<void> {
    const token = this.auth.getIdToken();
    if (!token) return;
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      const res = await fetch(`${environment.apiUrl}/data/models`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { models?: ApiModel[] };
      if (Array.isArray(data.models) && data.models.length > 0) {
        this.state.set(data.models.map(toModelOption));
      }
    } catch {
      this.errorState.set('Could not load the model list; using defaults.');
      // Keep the static fallback already in state.
    } finally {
      this.loadingState.set(false);
    }
  }

  resolveModel(preferred: string): string {
    const available = this.availableIds();
    if (preferred && available.includes(preferred)) return preferred;
    const settingsDefault = this.settings.defaultModel();
    if (settingsDefault && available.includes(settingsDefault)) return settingsDefault;
    return available.includes(DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : available[0] ?? DEFAULT_MODEL_ID;
  }
}
