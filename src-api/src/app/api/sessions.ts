/**
 * Sessions API
 *
 * REST API for managing chat sessions, enabling multi-device sync.
 *
 * Endpoints:
 * - GET /sessions - List all sessions
 * - GET /sessions/:id - Get a specific session
 * - POST /sessions/:id/message - Send a message (creates session if needed)
 * - DELETE /sessions/:id - Delete a session
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  createSession as createAgentSession,
  runAgent,
  type AgentMessage,
} from '@/shared/services/agent';
import { sessionStore, type Message, type Session } from '@/shared/services/sessions';
import { broadcastSessionUpdate, broadcastSessionMessage } from '@/shared/services/websocket';

const sessions = new Hono();

/**
 * GET /sessions
 * List all sessions
 */
sessions.get('/', async (c) => {
  try {
    const list = await sessionStore.list();
    return c.json({ sessions: list });
  } catch (error) {
    console.error('[Sessions API] Failed to list sessions:', error);
    return c.json({ error: 'Failed to list sessions' }, 500);
  }
});

/**
 * GET /sessions/:id
 * Get a specific session with full message history
 */
sessions.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const session = await sessionStore.get(id);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ session });
  } catch (error) {
    console.error(`[Sessions API] Failed to get session ${id}:`, error);
    return c.json({ error: 'Failed to get session' }, 500);
  }
});

/**
 * POST /sessions/:id/message
 * Send a message to a session (creates session if it doesn't exist)
 *
 * Body: { content: string }
 *
 * Returns SSE stream with agent responses
 */
sessions.post('/:id/message', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'Message content is required' }, 400);
  }

  const userMessage = body.content.trim();

  try {
    // Add user message to session
    let session = await sessionStore.addMessage(sessionId, 'user', userMessage);

    // Set session status to running
    await sessionStore.setStatus(sessionId, 'running');
    broadcastSessionUpdate(sessionId, 'running');

    // Get conversation history for context
    const conversation = await sessionStore.getConversation(sessionId);
    // Remove the last message (current prompt) from conversation
    const history = conversation.slice(0, -1);

    // Create agent session and run
    const agentSession = createAgentSession();

    // Return SSE stream
    return streamSSE(c, async (stream) => {
      let fullResponse = '';

      try {
        for await (const message of runAgent(userMessage, agentSession, history)) {
          // Convert agent message to SSE event
          const event = convertAgentMessage(message);

          if (event) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event.data),
            });

            // Accumulate text content
            if (message.type === 'text' && message.content) {
              fullResponse += message.content;
            }
          }

          // Handle completion
          if (message.type === 'done') {
            // Save assistant response
            if (fullResponse) {
              session = await sessionStore.addMessage(sessionId, 'assistant', fullResponse);
              broadcastSessionMessage(sessionId, {
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date().toISOString(),
              });
            }

            // Set session status to idle
            await sessionStore.setStatus(sessionId, 'idle');
            broadcastSessionUpdate(sessionId, 'idle');
          }
        }
      } catch (error) {
        console.error(`[Sessions API] Agent error for session ${sessionId}:`, error);

        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        });

        // Save error response if we have partial content
        if (fullResponse) {
          await sessionStore.addMessage(sessionId, 'assistant', fullResponse);
        }

        // Set session status to idle
        await sessionStore.setStatus(sessionId, 'idle');
        broadcastSessionUpdate(sessionId, 'idle');
      }
    });
  } catch (error) {
    console.error(`[Sessions API] Failed to process message for session ${sessionId}:`, error);
    return c.json({ error: 'Failed to process message' }, 500);
  }
});

/**
 * DELETE /sessions/:id
 * Delete a session
 */
sessions.delete('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const deleted = await sessionStore.delete(id);
    if (!deleted) {
      return c.json({ error: 'Session not found' }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error(`[Sessions API] Failed to delete session ${id}:`, error);
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

/**
 * POST /sessions
 * Create a new empty session
 */
sessions.post('/', async (c) => {
  try {
    const session = await sessionStore.create();
    return c.json({ session }, 201);
  } catch (error) {
    console.error('[Sessions API] Failed to create session:', error);
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

interface SSEEvent {
  type: string;
  data: unknown;
}

/**
 * Convert agent message to SSE event
 */
function convertAgentMessage(message: AgentMessage): SSEEvent | null {
  switch (message.type) {
    case 'text':
      return {
        type: 'text',
        data: { content: message.content },
      };

    case 'tool_use':
      return {
        type: 'tool',
        data: {
          name: message.name,
          input: message.input,
        },
      };

    case 'tool_result':
      return {
        type: 'tool_result',
        data: {
          name: message.name,
          output: message.output,
          isError: message.isError,
        },
      };

    case 'plan':
      return {
        type: 'plan',
        data: { plan: message.plan },
      };

    case 'error':
      return {
        type: 'error',
        data: { message: message.message },
      };

    case 'done':
      return {
        type: 'done',
        data: {},
      };

    default:
      return null;
  }
}

export { sessions as sessionsRoutes };
