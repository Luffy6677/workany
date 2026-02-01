/**
 * OpenAI Compatible API
 *
 * Provides /v1/chat/completions endpoint for compatibility with
 * OpenAI-compatible clients like ChatterUI.
 *
 * Supports verbose levels via model name suffix or request parameter:
 * - workany-quiet: verbose=off (hide tool calls, human-like conversation)
 * - workany: verbose=on (show tool summaries)
 * - workany-verbose: verbose=full (show tool summaries + outputs)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';

import {
  createSession,
  runAgent,
  type AgentMessage,
} from '@/shared/services/agent';

import {
  type VerboseLevel,
  shouldEmitMessage,
  formatToolSummary,
  formatToolOutput,
  extractVerboseFromModel,
  stripVerboseSuffix,
  parseVerboseLevel,
} from '@/shared/utils/tool-display';

const openai = new Hono();

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Format an agent message based on verbose level
 * Returns empty string if message should be skipped
 */
function formatMessageContent(
  message: AgentMessage,
  verboseLevel: VerboseLevel
): string {
  // Check if this message type should be emitted
  if (!shouldEmitMessage(message.type, verboseLevel)) {
    return '';
  }

  switch (message.type) {
    case 'text':
      return message.content || '';

    case 'tool_use':
      // Format as concise summary: "🛠️ Bash: ls -la ~/Documents"
      return `\n${formatToolSummary(message.name, message.input)}\n`;

    case 'tool_result':
      // Only shown in 'full' mode (already checked by shouldEmitMessage)
      if (message.isError) {
        return `\n${formatToolOutput(message.name, message.output, true)}\n`;
      }
      return `\n${formatToolOutput(message.name, message.output, false)}\n`;

    case 'plan':
      if (message.plan) {
        let content = `\n📋 **Plan: ${message.plan.goal}**\n`;
        message.plan.steps?.forEach((step, i) => {
          content += `${i + 1}. ${step.description}\n`;
        });
        content += '\n';
        return content;
      }
      return '';

    case 'error':
      return `\n❌ Error: ${message.message}\n`;

    default:
      return '';
  }
}

// ============================================================================
// SSE Stream Creation
// ============================================================================

/**
 * Create SSE stream with OpenAI format, respecting verbose level
 */
function createOpenAIStream(
  generator: AsyncGenerator<AgentMessage>,
  runId: string,
  model: string,
  verboseLevel: VerboseLevel
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

          // Handle done message specially
          if (message.type === 'done') {
            const doneChunk = {
              id: runId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(doneChunk)}\n\n`));
            continue;
          }

          // Format message based on verbose level
          const content = formatMessageContent(message, verboseLevel);

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

// ============================================================================
// Helper Functions
// ============================================================================

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

/**
 * Resolve verbose level from request
 * Priority: explicit parameter > model suffix > header > default (off)
 *
 * Default is 'off' for mobile-friendly output (hide tool calls)
 */
function resolveVerboseLevel(
  model: string,
  explicitVerbose?: unknown,
  header?: string | null
): VerboseLevel {
  // 1. Explicit parameter in request body
  if (explicitVerbose !== undefined) {
    return parseVerboseLevel(explicitVerbose);
  }

  // 2. HTTP header (allows override)
  if (header) {
    return parseVerboseLevel(header);
  }

  // 3. Model name suffix (e.g., workany-quiet, workany-on, workany-verbose)
  // Default is 'off' if no suffix specified
  return extractVerboseFromModel(model);
}

// SSE Response headers
const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': '*',
};

// ============================================================================
// API Endpoints
// ============================================================================

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
    // Custom extension for verbose level
    verbose?: string | boolean;
  }>();

  const rawModel = body.model || 'workany';
  const verboseHeader = c.req.header('X-Verbose-Level');
  const verboseLevel = resolveVerboseLevel(rawModel, body.verbose, verboseHeader);
  const model = stripVerboseSuffix(rawModel);

  console.log('[OpenAI API] POST /v1/chat/completions received:', {
    model: rawModel,
    effectiveModel: model,
    verboseLevel,
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

  const stream = body.stream !== false; // Default to streaming
  const runId = `chatcmpl-${nanoid()}`;

  // Create session and run agent
  const session = createSession();
  const conversation = buildConversation(messages.slice(0, -1)); // Exclude last message (it's the prompt)

  console.log('[OpenAI API] Running agent with:', {
    promptLength: userMessage.length,
    conversationLength: conversation.length,
    sessionId: session.id,
    verboseLevel,
  });

  if (!stream) {
    // Non-streaming response
    try {
      let fullContent = '';

      for await (const message of runAgent(userMessage, session, conversation)) {
        const content = formatMessageContent(message, verboseLevel);
        fullContent += content;
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
  const readable = createOpenAIStream(generator, runId, model, verboseLevel);

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
        description: 'WorkAny agent (verbose: on)',
      },
      {
        id: 'workany-quiet',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'workany',
        permission: [],
        root: 'workany',
        parent: null,
        description: 'WorkAny agent (verbose: off, human-like conversation)',
      },
      {
        id: 'workany-verbose',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'workany',
        permission: [],
        root: 'workany',
        parent: null,
        description: 'WorkAny agent (verbose: full, includes tool outputs)',
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
  const baseModel = stripVerboseSuffix(modelId);

  return c.json({
    id: modelId,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'workany',
    permission: [],
    root: baseModel,
    parent: null,
  });
});

export { openai as openaiRoutes };
