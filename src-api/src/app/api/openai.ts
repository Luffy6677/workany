/**
 * OpenAI Compatible API
 *
 * Provides /v1/chat/completions endpoint for compatibility with
 * OpenAI-compatible clients like ChatterUI.
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import {
  createSession,
  runAgent,
  type AgentMessage,
} from '@/shared/services/agent';

const openai = new Hono();

// Helper to create SSE stream with OpenAI format
function createOpenAIStream(
  generator: AsyncGenerator<AgentMessage>,
  runId: string,
  model: string
) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let wroteRole = false;

      try {
        for await (const message of generator) {
          // Write role on first chunk
          if (!wroteRole) {
            wroteRole = true;
            const roleChunk = {
              id: runId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));
          }

          // Convert workany message to OpenAI chunk
          let content = '';

          switch (message.type) {
            case 'text':
              content = message.content || '';
              break;
            case 'tool_use':
              content = `\n🔧 Using tool: ${message.name}\n`;
              break;
            case 'tool_result':
              // Skip tool results in stream, or show brief summary
              if (message.isError) {
                content = `\n❌ Tool error: ${message.output || 'Unknown error'}\n`;
              }
              break;
            case 'plan':
              if (message.plan) {
                content = `\n📋 **Plan: ${message.plan.goal}**\n`;
                message.plan.steps?.forEach((step, i) => {
                  content += `${i + 1}. ${step.description}\n`;
                });
                content += '\n';
              }
              break;
            case 'error':
              content = `\n❌ Error: ${message.message}\n`;
              break;
            case 'done':
              // Send finish reason
              const doneChunk = {
                id: runId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
              continue;
            default:
              // Skip other message types
              continue;
          }

          if (content) {
            const chunk = {
              id: runId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { content }, finish_reason: null }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
        }
      } catch (error) {
        // Send error as content
        const errorChunk = {
          id: runId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: { content: `\n❌ Error: ${error instanceof Error ? error.message : String(error)}` },
            finish_reason: null,
          }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
      } finally {
        // Send [DONE]
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}

// Extract user message from OpenAI messages array
function extractUserMessage(messages: Array<{ role: string; content: unknown }>): string {
  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      // Handle array content (multimodal)
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text || '');
        return textParts.join('\n');
      }
    }
  }
  return '';
}

// Extract system prompt from messages
function extractSystemPrompt(messages: Array<{ role: string; content: unknown }>): string | undefined {
  const systemMessages = messages.filter(m => m.role === 'system' || m.role === 'developer');
  if (systemMessages.length === 0) return undefined;

  return systemMessages
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .filter(Boolean)
    .join('\n\n');
}

// Build conversation history for context
function buildConversation(messages: Array<{ role: string; content: unknown }>) {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    }));
}

// SSE Response headers
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': '*',
};

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat completions endpoint
 */
openai.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json<{
    model?: string;
    messages?: Array<{ role: string; content: unknown }>;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    user?: string;
  }>();

  console.log('[OpenAI API] POST /v1/chat/completions received:', {
    model: body.model,
    messageCount: body.messages?.length || 0,
    stream: body.stream,
  });

  const messages = body.messages || [];
  const userMessage = extractUserMessage(messages);

  if (!userMessage) {
    return c.json({
      error: {
        message: 'No user message found in messages array',
        type: 'invalid_request_error',
        code: 'invalid_request',
      },
    }, 400);
  }

  const model = body.model || 'workany';
  const stream = body.stream !== false; // Default to streaming
  const runId = `chatcmpl-${nanoid()}`;

  // Create session and run agent
  const session = createSession();
  const conversation = buildConversation(messages.slice(0, -1)); // Exclude last message (it's the prompt)

  console.log('[OpenAI API] Running agent with:', {
    promptLength: userMessage.length,
    conversationLength: conversation.length,
    sessionId: session.id,
  });

  if (!stream) {
    // Non-streaming response
    try {
      let fullContent = '';

      for await (const message of runAgent(userMessage, session, conversation)) {
        if (message.type === 'text') {
          fullContent += message.content || '';
        } else if (message.type === 'plan' && message.plan) {
          fullContent += `\n📋 **Plan: ${message.plan.goal}**\n`;
          message.plan.steps?.forEach((step, i) => {
            fullContent += `${i + 1}. ${step.description}\n`;
          });
        } else if (message.type === 'error') {
          fullContent += `\n❌ Error: ${message.message}\n`;
        }
      }

      return c.json({
        id: runId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: fullContent || 'No response generated.' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });
    } catch (error) {
      return c.json({
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: 'api_error',
        },
      }, 500);
    }
  }

  // Streaming response
  const generator = runAgent(userMessage, session, conversation);
  const readable = createOpenAIStream(generator, runId, model);

  return new Response(readable, { headers: SSE_HEADERS });
});

/**
 * GET /v1/models
 * List available models (OpenAI compatible)
 */
openai.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: [
      {
        id: 'workany',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'workany',
        permission: [],
        root: 'workany',
        parent: null,
      },
      {
        id: 'workany-agent',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'workany',
        permission: [],
        root: 'workany-agent',
        parent: null,
      },
    ],
  });
});

/**
 * GET /v1/models/:model
 * Get specific model info
 */
openai.get('/v1/models/:model', (c) => {
  const modelId = c.req.param('model');

  return c.json({
    id: modelId,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'workany',
    permission: [],
    root: modelId,
    parent: null,
  });
});

export { openai as openaiRoutes };
