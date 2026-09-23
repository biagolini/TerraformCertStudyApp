import { Injectable, inject } from '@angular/core';
import { ParsedAlternative } from '../utils/question-parse.util';
import { BedrockService } from './bedrock.service';
import { SettingsService } from './settings.service';

/**
 * Fills in the one piece of Question metadata that can't be extracted
 * deterministically from the review Markdown: which vendor services/products
 * the question is actually about. Used both for newly created questions and
 * by the one-time schema-migration script (Python port of the same prompt —
 * see backend/infrastructure/scripts/migrate_questions_v2.py).
 */
@Injectable({ providedIn: 'root' })
export class QuestionEnrichmentService {
  private readonly bedrock = inject(BedrockService);
  private readonly settings = inject(SettingsService);

  async extractRelatedServices(stem: string, alternatives: ParsedAlternative[]): Promise<string[]> {
    const controller = new AbortController();
    try {
      return await this.bedrock.extractRelatedServices(
        stem,
        alternatives,
        this.settings.defaultModel(),
        controller.signal,
      );
    } catch {
      return [];
    }
  }
}
