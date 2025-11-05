import { prisma } from '../utils/database';
import { logger } from '../utils/logger';

export interface ConversationState {
  userId: bigint;
  chatId: number;
  step: string;
  data: Record<string, any>;
  createdAt: Date;
}

class ConversationManager {
  private conversations: Map<string, ConversationState> = new Map();
  private readonly TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes timeout

  createConversation(userId: bigint, chatId: number, step: string): ConversationState {
    const key = this.getKey(userId, chatId);
    const state: ConversationState = {
      userId,
      chatId,
      step,
      data: {},
      createdAt: new Date(),
    };
    this.conversations.set(key, state);
    return state;
  }

  getConversation(userId: bigint, chatId: number): ConversationState | null {
    const key = this.getKey(userId, chatId);
    const state = this.conversations.get(key);
    if (!state) return null;

    // Check timeout
    if (Date.now() - state.createdAt.getTime() > this.TIMEOUT_MS) {
      this.conversations.delete(key);
      return null;
    }

    return state;
  }

  updateConversation(userId: bigint, chatId: number, updates: Partial<ConversationState>): void {
    const key = this.getKey(userId, chatId);
    const state = this.conversations.get(key);
    if (!state) return;

    Object.assign(state, updates);
    this.conversations.set(key, state);
  }

  deleteConversation(userId: bigint, chatId: number): void {
    const key = this.getKey(userId, chatId);
    this.conversations.delete(key);
  }

  private getKey(userId: bigint, chatId: number): string {
    return `${userId}:${chatId}`;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, state] of this.conversations.entries()) {
      if (now - state.createdAt.getTime() > this.TIMEOUT_MS) {
        this.conversations.delete(key);
      }
    }
  }
}

export const conversationManager = new ConversationManager();

// Cleanup old conversations every 5 minutes
setInterval(() => {
  conversationManager.cleanup();
}, 5 * 60 * 1000);

