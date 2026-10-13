import { Injectable, signal } from '@angular/core';
import { Question } from '../models/question.model';
import { TutorMessage } from '../models/quiz-attempt.model';

/** A mock-exam question whose technical concept the student wants fitted into a summary note. */
export interface ConceptRequest {
  noteId: string;
  packId: string;
  question: Question;
  /** Letters the student picked, as shown in the attempt. */
  selected: readonly string[];
  /** The tutor conversation about the question, if any — what the student was unsure about. */
  tutor: readonly TutorMessage[];
  /** Came from a running mock exam, so the notes page offers the way back. */
  fromQuiz: boolean;
}

/**
 * Hands a "fit this concept into my note" request from the mock exam to the
 * note editor across the route change. In memory only: the request is
 * consumed once by the editor of that note.
 */
@Injectable({ providedIn: 'root' })
export class NoteIntegrationService {
  private readonly pending = signal<ConceptRequest | null>(null);

  request(value: ConceptRequest): void {
    this.pending.set(value);
  }

  /** The pending request for this note, cleared once taken. */
  take(noteId: string): ConceptRequest | null {
    const value = this.pending();
    if (!value || value.noteId !== noteId) return null;
    this.pending.set(null);
    return value;
  }
}
