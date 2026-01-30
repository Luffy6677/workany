/**
 * WebSocket Service
 *
 * Provides real-time synchronization for multi-device chat sessions.
 *
 * Events:
 * - session:running - Session started executing
 * - session:idle - Session finished executing
 * - session:message - New message in session
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Message } from './sessions';

// ============================================================================
// Types
// ============================================================================

interface WSClient {
  ws: WebSocket;
  id: string;
  subscribedSessions: Set<string>;
}

interface WSMessage {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
}

// ============================================================================
// WebSocket Manager
// ============================================================================

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WSClient>();
  private clientIdCounter = 0;

  /**
   * Initialize WebSocket server
   */
  init(server: unknown): void {
    if (this.wss) {
      console.log('[WebSocket] Already initialized');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.wss = new WebSocketServer({ server: server as any, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const clientId = `client-${++this.clientIdCounter}`;
      const client: WSClient = {
        ws,
        id: clientId,
        subscribedSessions: new Set(),
      };

      this.clients.set(clientId, client);
      console.log(`[WebSocket] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send welcome message
      this.send(ws, {
        type: 'connected',
        clientId,
        message: 'Connected to WorkAny WebSocket',
      });

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as WSMessage;
          this.handleMessage(client, message);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      });

      // Handle disconnect
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WebSocket] Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`[WebSocket] Client error ${clientId}:`, error);
      });
    });

    console.log('[WebSocket] Server initialized on /ws');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(client: WSClient, message: WSMessage): void {
    switch (message.type) {
      case 'subscribe':
        // Subscribe to specific session updates
        if (message.sessionId) {
          client.subscribedSessions.add(message.sessionId);
          console.log(`[WebSocket] ${client.id} subscribed to session: ${message.sessionId}`);
        }
        break;

      case 'subscribe-all':
        // Subscribe to all session updates (use special marker)
        client.subscribedSessions.add('*');
        console.log(`[WebSocket] ${client.id} subscribed to all sessions`);
        break;

      case 'unsubscribe':
        if (message.sessionId) {
          client.subscribedSessions.delete(message.sessionId);
        }
        break;

      case 'ping':
        this.send(client.ws, { type: 'pong' });
        break;

      default:
        console.log(`[WebSocket] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Send message to a WebSocket
   */
  private send(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast to clients subscribed to a session
   */
  broadcast(sessionId: string, data: unknown): void {
    for (const client of this.clients.values()) {
      // Check if client is subscribed to this session or all sessions
      if (client.subscribedSessions.has(sessionId) || client.subscribedSessions.has('*')) {
        this.send(client.ws, data);
      }
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastAll(data: unknown): void {
    for (const client of this.clients.values()) {
      this.send(client.ws, data);
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }
}

// Singleton instance
const wsManager = new WebSocketManager();

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize WebSocket server with HTTP server
 */
export function initWebSocket(server: unknown): void {
  wsManager.init(server);
}

/**
 * Broadcast session status update
 */
export function broadcastSessionUpdate(sessionId: string, status: 'running' | 'idle'): void {
  wsManager.broadcastAll({
    type: `session:${status}`,
    sessionId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast new message in session
 */
export function broadcastSessionMessage(sessionId: string, message: Message): void {
  wsManager.broadcastAll({
    type: 'session:message',
    sessionId,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast session deleted
 */
export function broadcastSessionDeleted(sessionId: string): void {
  wsManager.broadcastAll({
    type: 'session:deleted',
    sessionId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get WebSocket manager (for advanced usage)
 */
export function getWebSocketManager(): WebSocketManager {
  return wsManager;
}
