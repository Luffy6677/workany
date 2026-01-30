/**
 * Session Store Service
 *
 * Provides persistent storage for chat sessions, enabling multi-device sync.
 * Sessions are stored as JSON files in ~/.workany/sessions/
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { getSessionsDir } from '@/shared/utils/paths';

// ============================================================================
// Types
// ============================================================================

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  title: string;
  status: 'idle' | 'running';
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: 'idle' | 'running';
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Session Store
// ============================================================================

class SessionStore {
  private sessionsDir: string;
  private initialized = false;

  constructor() {
    this.sessionsDir = getSessionsDir();
  }

  /**
   * Ensure sessions directory exists
   */
  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.sessionsDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Get session file path
   */
  private getSessionPath(id: string): string {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  /**
   * Generate a new session ID
   */
  generateId(): string {
    return `session-${Date.now()}`;
  }

  /**
   * Generate title from first user message
   */
  generateTitle(content: string): string {
    // Take first 50 chars, remove newlines
    const title = content.replace(/\n/g, ' ').trim();
    return title.length > 50 ? title.substring(0, 47) + '...' : title;
  }

  /**
   * Create a new session
   */
  async create(firstMessage?: string): Promise<Session> {
    await this.ensureDir();

    const now = new Date().toISOString();
    const session: Session = {
      id: this.generateId(),
      title: firstMessage ? this.generateTitle(firstMessage) : 'New Session',
      status: 'idle',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.save(session);
    return session;
  }

  /**
   * Get a session by ID
   */
  async get(id: string): Promise<Session | null> {
    await this.ensureDir();

    try {
      const filePath = this.getSessionPath(id);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as Session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Save a session
   */
  async save(session: Session): Promise<void> {
    await this.ensureDir();

    session.updatedAt = new Date().toISOString();
    const filePath = this.getSessionPath(session.id);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Delete a session
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureDir();

    try {
      const filePath = this.getSessionPath(id);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all sessions (sorted by updatedAt, newest first)
   */
  async list(): Promise<SessionSummary[]> {
    await this.ensureDir();

    const files = await fs.readdir(this.sessionsDir);
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const filePath = path.join(this.sessionsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const session = JSON.parse(content) as Session;

        sessions.push({
          id: session.id,
          title: session.title,
          status: session.status,
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      } catch (error) {
        // Skip invalid files
        console.warn(`[SessionStore] Failed to read session file: ${file}`, error);
      }
    }

    // Sort by updatedAt, newest first
    sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return sessions;
  }

  /**
   * Add a message to a session
   */
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<Session> {
    await this.ensureDir();
    let session = await this.get(sessionId);

    if (!session) {
      // Create new session with provided ID (don't use create() to avoid duplicate)
      const now = new Date().toISOString();
      session = {
        id: sessionId,
        title: role === 'user' ? this.generateTitle(content) : 'New Session',
        status: 'idle',
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    const message: Message = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };

    session.messages.push(message);

    // Update title from first user message if still default
    if (session.title === 'New Session' && role === 'user') {
      session.title = this.generateTitle(content);
    }

    await this.save(session);
    return session;
  }

  /**
   * Update session status
   */
  async setStatus(sessionId: string, status: 'idle' | 'running'): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;

    session.status = status;
    await this.save(session);
    return session;
  }

  /**
   * Get conversation history for agent
   */
  async getConversation(sessionId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const session = await this.get(sessionId);
    if (!session) return [];

    return session.messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
  }
}

// Export singleton instance
export const sessionStore = new SessionStore();

// Export types
export type { SessionStore };
