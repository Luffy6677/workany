/**
 * Tool Display Utilities
 *
 * Provides formatting for tool calls with emoji icons and concise summaries.
 * Used to create human-friendly tool call displays based on verbose level.
 */

import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type VerboseLevel = 'off' | 'on' | 'full';

interface ToolDisplayConfig {
  emoji: string;
  label: string;
  detailKeys?: string[];
}

// ============================================================================
// Tool Display Configuration
// ============================================================================

const TOOL_DISPLAY: Record<string, ToolDisplayConfig> = {
  // File operations
  Read: { emoji: '📖', label: 'Read', detailKeys: ['file_path', 'path'] },
  Write: { emoji: '✍️', label: 'Write', detailKeys: ['file_path', 'path'] },
  Edit: { emoji: '📝', label: 'Edit', detailKeys: ['file_path', 'path'] },
  Glob: { emoji: '🔍', label: 'Glob', detailKeys: ['pattern', 'path'] },
  Grep: { emoji: '🔎', label: 'Grep', detailKeys: ['pattern', 'path'] },

  // Execution
  Bash: { emoji: '🛠️', label: 'Bash', detailKeys: ['command'] },
  Task: { emoji: '🧑‍🔧', label: 'Sub-agent', detailKeys: ['prompt', 'description'] },

  // Web
  WebSearch: { emoji: '🌐', label: 'Web Search', detailKeys: ['query'] },
  WebFetch: { emoji: '📄', label: 'Web Fetch', detailKeys: ['url'] },

  // Other
  Skill: { emoji: '⚡', label: 'Skill', detailKeys: ['skill', 'name'] },
  LSP: { emoji: '🧠', label: 'LSP', detailKeys: ['action'] },
  TodoWrite: { emoji: '📋', label: 'Todo', detailKeys: ['todos'] },
};

const FALLBACK_DISPLAY: ToolDisplayConfig = {
  emoji: '🧩',
  label: 'Tool',
};

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Shorten home directory to ~
 */
export function shortenHomePath(filePath: string): string {
  if (!filePath) return filePath;
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return '~' + filePath.slice(home.length);
  }
  return filePath;
}

/**
 * Shorten path for display (max 60 chars)
 */
function shortenForDisplay(value: string, maxLength = 60): string {
  if (!value) return value;

  // Shorten home path first
  let shortened = shortenHomePath(value);

  // If still too long, truncate from middle
  if (shortened.length > maxLength) {
    const half = Math.floor((maxLength - 3) / 2);
    shortened = shortened.slice(0, half) + '...' + shortened.slice(-half);
  }

  return shortened;
}

/**
 * Extract first line and limit length
 */
function extractFirstLine(value: string, maxLength = 50): string {
  if (!value) return value;
  const firstLine = value.split('\n')[0]?.trim() ?? '';
  if (firstLine.length > maxLength) {
    return firstLine.slice(0, maxLength - 3) + '...';
  }
  return firstLine;
}

// ============================================================================
// Tool Display Functions
// ============================================================================

/**
 * Get display config for a tool
 */
function getToolDisplay(toolName?: string): ToolDisplayConfig {
  if (!toolName) return FALLBACK_DISPLAY;
  return TOOL_DISPLAY[toolName] ?? { ...FALLBACK_DISPLAY, label: toolName };
}

/**
 * Extract detail from tool input based on configured keys
 */
function extractToolDetail(toolName: string | undefined, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;

  const display = getToolDisplay(toolName);
  const detailKeys = display.detailKeys ?? [];
  const record = input as Record<string, unknown>;

  for (const key of detailKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      // Special handling for different types of values
      if (key === 'command') {
        return extractFirstLine(value, 60);
      }
      if (key === 'query' || key === 'prompt' || key === 'description') {
        return extractFirstLine(value, 40);
      }
      if (key.includes('path') || key === 'url') {
        return shortenForDisplay(value);
      }
      return extractFirstLine(value, 50);
    }
  }

  return undefined;
}

/**
 * Format a tool call as a concise summary line
 * Example: "🛠️ Bash: ls -la ~/Documents"
 */
export function formatToolSummary(
  toolName?: string,
  input?: unknown
): string {
  const display = getToolDisplay(toolName);
  const detail = extractToolDetail(toolName, input);

  if (detail) {
    return `${display.emoji} ${display.label}: ${detail}`;
  }
  return `${display.emoji} ${display.label}`;
}

/**
 * Format tool result output for full verbose mode
 */
export function formatToolOutput(
  toolName?: string,
  output?: string,
  isError?: boolean
): string {
  if (!output?.trim()) {
    return isError ? '❌ (error, no output)' : '(no output)';
  }

  // Limit output to first 500 chars
  let displayOutput = output.trim();
  if (displayOutput.length > 500) {
    displayOutput = displayOutput.slice(0, 497) + '...';
  }

  const prefix = isError ? '❌ Error:\n' : '';
  return `${prefix}\`\`\`\n${displayOutput}\n\`\`\``;
}

/**
 * Determine if a message type should be emitted based on verbose level
 */
export function shouldEmitMessage(
  messageType: string,
  verboseLevel: VerboseLevel
): boolean {
  // Always emit these types
  if (['text', 'done', 'error', 'direct_answer'].includes(messageType)) {
    return true;
  }

  // Tool messages depend on verbose level
  if (messageType === 'tool_use') {
    return verboseLevel !== 'off';
  }

  if (messageType === 'tool_result') {
    return verboseLevel === 'full';
  }

  // Plan messages only in full mode
  if (messageType === 'plan') {
    return verboseLevel === 'full';
  }

  // Session messages are internal
  if (messageType === 'session') {
    return false;
  }

  // Default: emit in on/full mode
  return verboseLevel !== 'off';
}

/**
 * Parse verbose level from various input formats
 */
export function parseVerboseLevel(value: unknown): VerboseLevel {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().trim();
    if (normalized === 'off' || normalized === 'false' || normalized === '0' || normalized === 'quiet') {
      return 'off';
    }
    if (normalized === 'full' || normalized === 'debug' || normalized === 'verbose') {
      return 'full';
    }
  }
  // Default to 'on'
  return 'on';
}

/**
 * Extract verbose level from model name suffix
 * e.g., "workany-quiet" -> "off", "workany-verbose" -> "full"
 *
 * Default behavior: if no suffix specified, returns 'off' for clean mobile output
 */
export function extractVerboseFromModel(model: string): VerboseLevel {
  if (!model) return 'off'; // Default to off for mobile

  const lower = model.toLowerCase();
  if (lower.endsWith('-quiet') || lower.endsWith('-silent') || lower.endsWith('-off')) {
    return 'off';
  }
  if (lower.endsWith('-verbose') || lower.endsWith('-debug') || lower.endsWith('-full')) {
    return 'full';
  }
  if (lower.endsWith('-on')) {
    return 'on';
  }

  // Default to 'off' for clean mobile output (hide tool calls)
  return 'off';
}

/**
 * Strip verbose suffix from model name
 */
export function stripVerboseSuffix(model: string): string {
  if (!model) return model;

  const suffixes = ['-quiet', '-silent', '-off', '-verbose', '-debug', '-full'];
  const lower = model.toLowerCase();

  for (const suffix of suffixes) {
    if (lower.endsWith(suffix)) {
      return model.slice(0, -suffix.length);
    }
  }

  return model;
}
