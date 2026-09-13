import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { ChatSession } from '../../core/models/chat.model';
import { ChatService } from '../../core/services/chat.service';
import { ViewportService } from '../../core/services/viewport.service';
import { ChatConversationComponent } from './chat-conversation.component';
import { ChatListComponent } from './chat-list.component';

/** Routed at /chat and /chat/:chatId — a direct port of app.component.ts's
 * old `@case ('chat')` block. No packId segment: chat sessions are
 * pack-scoped internally (ChatService.sessions() filters by the ambient
 * active pack, unchanged), same as today — just reached via a route now. */
@Component({
  selector: 'app-chat-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatListComponent, ChatConversationComponent],
  template: `
    @if (showLeftColumn()) {
      <section class="column column-left">
        <app-chat-list [activeId]="chatId()" (opened)="onOpenChat($event)" />
      </section>
    }
    @if (showChatConversation()) {
      <section class="column column-right">
        <app-chat-conversation
          [session]="activeChat()"
          [showBackButton]="isMobile()"
          (back)="onCloseChat()"
          (deleted)="onChatDeleted($event)"
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
export class ChatPageComponent {
  private readonly router = inject(Router);
  private readonly chatService = inject(ChatService);
  private readonly viewport = inject(ViewportService);

  readonly chatId = input<string | null>(null);
  readonly isMobile = this.viewport.isMobile;

  readonly activeChat = computed<ChatSession | null>(() => {
    const id = this.chatId();
    if (!id) return null;
    return this.chatService.sessions().find((s) => s.id === id) ?? null;
  });

  readonly showLeftColumn = computed(() => !this.isMobile() || !this.chatId());
  readonly showChatConversation = computed(() => !this.isMobile() || !!this.chatId());

  onOpenChat(session: ChatSession): void {
    this.router.navigate(['/chat', session.id]);
  }

  onCloseChat(): void {
    this.router.navigate(['/chat']);
  }

  onChatDeleted(id: string): void {
    if (this.chatId() === id) {
      this.router.navigate(['/chat']);
    }
  }
}
