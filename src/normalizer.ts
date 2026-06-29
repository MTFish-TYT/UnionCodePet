/**
 * Event normalization.
 *
 * Converts the raw, per-CLI payloads (read from hook stdin or notify argv) into
 * the canonical {@link UnifiedEvent}. Each source has its own function because
 * the wire formats differ wildly; the daemon only ever deals with the output.
 */
import type { CliSource, UnifiedEvent, UnifiedEventKind } from './protocol.js';

/** Truncate to a readable length for the console panel. */
export function summarize(text: unknown, max = 120): string {
  if (text == null) return '';
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  // Collapse whitespace (newlines from JSON payloads look bad in one line).
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

interface ClaudeHookPayload {
  hookEventName?: string;
  toolName?: string;
  tool_name?: string; // snake_case variant on PermissionRequest
  tool_input?: unknown;
  notification_type?: string; // 'permission_prompt' | 'idle_prompt' on Notification
  [k: string]: unknown;
}

/**
 * Claude Code passes a JSON object on stdin for hooks. The hook command itself
 * receives the kind via argv (the dispatcher is invoked as
 * `dispatcher.ps1 claude <event>`), so `kind` is authoritative and we mine the
 * payload for summary/toolName.
 */
export function normalizeClaude(
  kind: string,
  raw: ClaudeHookPayload | null,
  sessionId: string,
  ts: number,
): UnifiedEvent | null {
  const base = { source: 'claude' as const, sessionId, ts };
  const cwd = typeof raw?.cwd === 'string' ? raw.cwd : undefined;

  switch (kind) {
    case 'Stop':
      return {
        ...base,
        event: 'task_complete',
        summary: '任务完成',
        cwd,
      };
    case 'Notification': {
      // permission_prompt = needs approval (incl. plan approval); idle_prompt =
      // waiting for input. NOTE: ExitPlanMode does NOT arrive here — it comes as
      // a PermissionRequest event (verified from a real Claude event dump).
      const ntype = raw?.notification_type ?? '';
      return {
        ...base,
        event: 'permission_request',
        summary: ntype === 'idle_prompt' ? '等待输入' : '需要确认',
        cwd,
      };
    }
    case 'PermissionRequest': {
      // Claude Code's dedicated permission event. ExitPlanMode arrives here
      // (tool_name=ExitPlanMode) and means "leaving plan mode, start executing"
      // — map it to plan_started so it plays the plan sound, not permission.
      const tool = raw?.toolName ?? raw?.tool_name;
      if (tool === 'ExitPlanMode') {
        return {
          ...base,
          event: 'plan_started',
          toolName: tool,
          summary: '退出计划模式，开始执行',
          cwd,
        };
      }
      return {
        ...base,
        event: 'permission_request',
        toolName: tool,
        summary: tool ? `请求确认: ${tool}` : '请求确认',
        cwd,
      };
    }
    case 'PreToolUse': {
      const tool = raw?.toolName ?? 'tool';
      // AskUserQuestion / ExitPlanMode are conceptually prompts, not tool spam.
      if (tool === 'ExitPlanMode') {
        return {
          ...base,
          event: 'plan_started',
          toolName: tool,
          summary: '退出计划模式，开始执行',
          cwd,
        };
      }
      const inputSummary = summarizeToolInput(tool, raw?.tool_input);
      return {
        ...base,
        event: 'tool_call',
        toolName: tool,
        summary: inputSummary ? `${tool}: ${inputSummary}` : tool,
        cwd,
      };
    }
    case 'PostToolUse': {
      const tool = raw?.toolName ?? 'tool';
      return {
        ...base,
        event: 'tool_result',
        toolName: tool,
        summary: `${tool} 完成`,
        cwd,
      };
    }
    default:
      // Unknown/unhandled hook kind — don't fabricate an event.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Zcode
// ---------------------------------------------------------------------------

interface ZcodeHookPayload {
  hookEventName?: string;
  toolName?: string;
  toolInput?: unknown;       // camelCase in real Zcode payload (not tool_input)
  responsePreview?: string;  // agent's last reply, on Stop
  reason?: string;           // why permission is requested, on PermissionRequest
  riskLevel?: string;
  mode?: string;             // "yolo" | "plan"
  cwd?: string;
  sessionId?: string;
  [k: string]: unknown;
}

/**
 * Zcode hooks use a fixed set of 7 event names; the ones we care about are
 * `PermissionRequest` and `Stop`. AskUserQuestion/ExitPlanMode arrive under
 * PermissionRequest and are distinguished by toolName.
 *
 * Real payload fields (verified from a dump):
 *  - Stop:            responsePreview (agent's last reply — great summary text)
 *  - PermissionRequest: toolName, reason, toolInput (question text / plan text)
 */
export function normalizeZcode(
  raw: ZcodeHookPayload | null,
  sessionId: string,
  ts: number,
): UnifiedEvent | null {
  const hookEvent = raw?.hookEventName ?? '';
  const tool = raw?.toolName;
  const cwd = typeof raw?.cwd === 'string' ? raw.cwd : undefined;
  const sid = raw?.sessionId ?? sessionId;
  const base = { source: 'zcode' as const, sessionId: sid, ts };

  switch (hookEvent) {
    case 'Stop': {
      // responsePreview is the agent's final reply — use it as the summary.
      const preview = typeof raw?.responsePreview === 'string' ? raw.responsePreview : '';
      return {
        ...base,
        event: 'task_complete',
        summary: summarize(preview) || '任务完成',
        cwd,
      };
    }
    case 'PermissionRequest':
      if (tool === 'ExitPlanMode') {
        const planText = extractZcodePlanText(raw?.toolInput);
        return {
          ...base,
          event: 'plan_started',
          toolName: tool,
          summary: planText ? summarize(planText) : '退出计划模式，开始执行',
          cwd,
        };
      }
      if (tool === 'AskUserQuestion') {
        const question = extractZcodeQuestion(raw?.toolInput);
        return {
          ...base,
          event: 'permission_request',
          toolName: tool,
          summary: question ? summarize(question) : '提问',
          cwd,
        };
      }
      return {
        ...base,
        event: 'permission_request',
        toolName: tool,
        summary: summarize(raw?.reason) || '需要确认',
        cwd,
      };
    default:
      return null;
  }
}

/** Pull the first question text out of a Zcode AskUserQuestion toolInput. */
function extractZcodeQuestion(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const questions = (toolInput as Record<string, unknown>).questions;
  if (!Array.isArray(questions) || questions.length === 0) return '';
  const q0 = questions[0];
  if (q0 && typeof q0 === 'object' && 'question' in q0) {
    return String((q0 as Record<string, unknown>).question);
  }
  return '';
}

/** Pull the plan text out of a Zcode ExitPlanMode toolInput. */
function extractZcodePlanText(toolInput: unknown): string {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const plan = (toolInput as Record<string, unknown>).plan;
  return typeof plan === 'string' ? plan : '';
}

// ---------------------------------------------------------------------------
// Codex (notify channel)
// ---------------------------------------------------------------------------

interface CodexNotifyPayload {
  type?: string; // 'agent-turn-complete' | 'request_permissions' | ...
  cwd?: string;
  'thread-id'?: string;
  'last-assistant-message'?: string;
  [k: string]: unknown;
}

/**
 * Codex `notify` only reliably delivers `agent-turn-complete`. approval /
 * request_permissions are declared in some configs but currently don't reach
 * the notify hook (confirmed by Code-Notify source + Codex issues). We still
 * map them defensively so the day they arrive, the panel is ready.
 */
export function normalizeCodexNotify(
  raw: CodexNotifyPayload | null,
  sessionId: string,
  ts: number,
): UnifiedEvent | null {
  if (!raw) return null;
  const cwd = raw.cwd;
  const base = { source: 'codex' as const, sessionId: sessionId || raw['thread-id'] || 'unknown', ts };
  const t = (raw.type ?? '').toLowerCase();

  if (t === 'agent-turn-complete' || t.includes('turn-complete')) {
    return {
      ...base,
      event: 'task_complete',
      summary: summarize(raw['last-assistant-message']) || '任务完成',
      cwd,
    };
  }
  if (t.includes('permission') || t.includes('approval') || t.includes('elicitation')) {
    return {
      ...base,
      event: 'permission_request',
      summary: '需要确认',
      cwd,
    };
  }
  if (t.includes('error') || t.includes('failed')) {
    return { ...base, event: 'error', summary: '出错', cwd };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Codex (sessions jsonl poller channel)
// ---------------------------------------------------------------------------

/**
 * A single parsed line from a Codex rollout-*.jsonl. The poller reads raw lines
 * and hands them here to be classified. Only the high-signal line types are
 * surfaced; reasoning/developer/system messages are dropped (noise).
 */
export function normalizeCodexJsonlLine(
  parsed: unknown,
  sessionId: string,
  ts: number,
): UnifiedEvent | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type : '';
  const payload = (obj.payload ?? {}) as Record<string, unknown>;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
  const base = { source: 'codex' as const, sessionId, ts };

  // event_msg lines carry the human-facing state transitions.
  if (type === 'event_msg') {
    const sub = typeof payload.type === 'string' ? payload.type : '';
    if (sub === 'task_started') {
      return { ...base, event: 'task_started', summary: '开始任务', cwd };
    }
    if (sub === 'agent_message') {
      const msg = typeof payload.message === 'string' ? payload.message : '';
      return {
        ...base,
        event: 'message',
        role: 'assistant',
        summary: summarize(msg),
        cwd,
      };
    }
    return null;
  }

  // response_item lines carry the model's actual messages and tool calls.
  if (type === 'response_item') {
    const ptype = typeof payload.type === 'string' ? payload.type : '';
    if (ptype === 'message') {
      const role = typeof payload.role === 'string' ? payload.role : '';
      const text = extractMessageText(payload.content);
      if (role === 'assistant') {
        return {
          ...base,
          event: 'message',
          role: 'assistant',
          summary: summarize(text),
          cwd,
        };
      }
      // user/developer messages are not surfaced as state changes.
      return null;
    }
    if (ptype === 'function_call') {
      const name = typeof payload.name === 'string' ? payload.name : 'tool';
      const argSummary = summarizeToolArgs(payload.arguments);
      return {
        ...base,
        event: 'tool_call',
        toolName: name,
        summary: argSummary ? `${name}: ${argSummary}` : name,
        cwd,
      };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Extract concatenated text from a Codex message `content` array. */
function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as Record<string, unknown>).text) : ''))
    .join(' ')
    .trim();
}

/** Best-effort short summary of a tool's input/arguments. */
function summarizeToolInput(tool: string, input: unknown): string {
  if (input == null) return '';
  if (tool === 'Bash' && typeof input === 'object' && input !== null) {
    const cmd = (input as Record<string, unknown>).command;
    if (typeof cmd === 'string') return summarize(cmd, 80);
  }
  if (tool === 'Write' && typeof input === 'object' && input !== null) {
    const fp = (input as Record<string, unknown>).file_path;
    if (typeof fp === 'string') return summarize(fp, 80);
  }
  return summarize(input, 80);
}

/** Codex function_call arguments arrive as a JSON string. */
function summarizeToolArgs(args: unknown): string {
  if (typeof args !== 'string') return '';
  try {
    const obj = JSON.parse(args);
    if (obj && typeof obj === 'object' && 'command' in obj) {
      return summarize(obj.command, 80);
    }
    return summarize(obj, 80);
  } catch {
    return summarize(args, 80);
  }
}

/**
 * Pick a stable sessionId for normalization callers that don't have one.
 * Codex jsonl path encodes the session id; callers pass it through.
 */
export function deriveSessionId(source: CliSource, hint?: string): string {
  if (hint) return hint;
  return `${source}-${Date.now().toString(36)}`;
}
