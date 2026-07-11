import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ChatSession } from '../../core/models/chat.model';
import { ChatService } from '../../core/services/chat.service';
import { PacksService } from '../../core/services/packs.service';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { TruncatePipe } from '../../shared/pipes/truncate.pipe';

@Component({
  selector: 'app-chat-list',
  standalone: true,
  imports: [TruncatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="list-card">
      <header class="card-header">
        <div class="title-row">
          <h2>Open chat</h2>
          <span class="count">{{ count() }}</span>
        </div>
        @if (count() > 0) {
          <button type="button" class="link danger" (click)="onDeleteAll()">Delete all</button>
        }
      </header>

      <button type="button" class="new-btn" (click)="onNewConversation()">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14"/>
        </svg>
        <span>New conversation</span>
      </button>

      @if (count() === 0) {
        <div class="empty">
          <p class="empty-title">No conversations yet.</p>
          <p class="empty-body">Start a new conversation to chat freely about this certification's topics.</p>
        </div>
      } @else {
        <ul class="card-grid">
          @for (session of sessions(); track session.id) {
            <li>
              <div class="chat-card" [class.active]="activeId() === session.id">
                <button type="button" class="chat-card-main" (click)="opened.emit(session)">
                  <div class="chat-card-header">
                    <span class="chat-title">{{ session.title | truncate: 60 }}</span>
                    @if (session.summary) {
                      <span class="badge">Summary ready</span>
                    }
                  </div>
                  <p class="chat-preview">{{ previewText(session) | truncate: 100 }}</p>
                  <span class="chat-meta">{{ session.messages.length }} message{{ session.messages.length === 1 ? '' : 's' }}</span>
                </button>
                <button
                  type="button"
                  class="chat-delete"
                  (click)="onDeleteOne(session)"
                  aria-label="Delete conversation"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
                  </svg>
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .list-card {
        display: flex; flex-direction: column; gap: var(--space-md);
        padding: var(--space-lg);
        background: var(--bg-surface);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-sm);
      }
      .card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
      .title-row { display: flex; align-items: center; gap: var(--space-sm); }
      .title-row h2 { font-size: var(--font-size-xl); }
      .count {
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 28px; padding: 0 var(--space-sm); height: 22px;
        border-radius: var(--radius-pill);
        background: var(--bg-elevated);
        color: var(--text-secondary);
        font-size: var(--font-size-sm); font-weight: 600;
      }
      .link {
        color: var(--color-blue);
        background: none;
        padding: 0;
        min-height: auto;
        font-weight: 500;
        font-size: var(--font-size-sm);
      }
      .link:hover { text-decoration: underline; }
      .link.danger { color: var(--color-red); }
      .new-btn {
        display: flex; align-items: center; justify-content: center; gap: var(--space-xs);
        padding: var(--space-sm) var(--space-md);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
        background: var(--bg-elevated);
        color: var(--text-primary);
        font-weight: 500;
        min-height: var(--touch-min);
        transition: border-color var(--transition-fast), background var(--transition-fast);
      }
      .new-btn:hover { border-color: var(--color-purple); background: var(--bg-subtle); }
      .empty {
        padding: var(--space-xl); text-align: center;
        color: var(--text-muted);
        background: var(--bg-elevated);
        border-radius: var(--radius-md);
        border: 1px dashed var(--bg-border);
      }
      .empty-title { font-size: var(--font-size-base); color: var(--text-secondary); margin-bottom: var(--space-xs); }
      .empty-body { font-size: var(--font-size-sm); }
      .card-grid { display: flex; flex-direction: column; gap: var(--space-sm); }
      .chat-card {
        display: flex;
        align-items: stretch;
        gap: var(--space-xs);
        background: var(--bg-surface);
        border-radius: var(--radius-md);
        border: 1px solid var(--bg-border);
        transition: border-color var(--transition-fast), background var(--transition-fast);
      }
      .chat-card:hover { border-color: var(--color-purple); background: var(--bg-elevated); }
      .chat-card.active { border-color: var(--color-purple); background: var(--bg-elevated); }
      .chat-card-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
        text-align: left;
        padding: var(--space-sm) var(--space-md);
      }
      .chat-card-header {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-width: 0;
      }
      .chat-title {
        font-size: var(--font-size-base);
        font-weight: 600;
        color: var(--text-primary);
        word-break: break-word;
      }
      .badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        padding: 2px var(--space-sm);
        border-radius: var(--radius-pill);
        background: var(--color-green);
        color: #ffffff;
        font-size: var(--font-size-xs);
        font-weight: 600;
      }
      .chat-preview {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
      }
      .chat-meta {
        font-size: var(--font-size-xs);
        color: var(--text-faint);
      }
      .chat-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-min);
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .chat-delete:hover { color: var(--color-red); }
    `,
  ],
})
export class ChatListComponent {
  private readonly chatService = inject(ChatService);
  private readonly packs = inject(PacksService);
  private readonly dialog = inject(MatDialog);

  readonly sessions = this.chatService.sessions;
  readonly count = this.chatService.count;
  readonly activeId = input<string | null>(null);
  readonly opened = output<ChatSession>();

  previewText(session: ChatSession): string {
    if (session.messages.length === 0) return 'No messages yet.';
    const last = session.messages[session.messages.length - 1];
    return last.content || '...';
  }

  onNewConversation(): void {
    const session = this.chatService.create(this.packs.activePack().id);
    this.opened.emit(session);
  }

  onDeleteOne(session: ChatSession): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: session.title },
      width: '400px',
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'confirm') return;
      this.chatService.remove(session.id);
    });
  }

  onDeleteAll(): void {
    const dialogRef = this.dialog.open(ConfirmDeleteDialogComponent, {
      data: { title: `all ${this.count()} conversations` },
      width: '400px',
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result !== 'confirm') return;
      this.chatService.clearActivePack();
    });
  }
}
