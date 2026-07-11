export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatSession {
  id: string;
  packId: string;
  title: string;
  messages: ChatMessage[];
  /** Markdown summary of the conversation, generated on demand. Empty if never generated. */
  summary: string;
  /** Timestamp of the last summary generation. Null if never generated. */
  summaryUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_CHAT_TITLE = 'New conversation';
