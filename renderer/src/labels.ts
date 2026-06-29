// Shared display labels — the Chinese mappings the old console-panel used,
// lifted into a renderer-friendly module so every UI page is consistent.
import type { CliSource } from '@shared/protocol';

export const SOURCE_LABEL: Record<CliSource, string> = {
  claude: 'Claude',
  zcode: 'Zcode',
  codex: 'Codex',
};

export type EventKind =
  | 'task_started' | 'message' | 'tool_call' | 'tool_result'
  | 'permission_request' | 'plan_started' | 'task_complete' | 'error';

export const EVENT_LABEL: Record<EventKind, string> = {
  task_started: '任务开始',
  message: '消息',
  tool_call: '工具调用',
  tool_result: '工具完成',
  permission_request: '请求确认',
  plan_started: '开始执行计划',
  task_complete: '任务完成',
  error: '出错',
};

export const PHASE_LABEL: Record<string, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待',
  done: '完成',
  error: '出错',
};

export const PHASE_COLOR: Record<string, string> = {
  idle: '#565f89',
  working: '#7aa2f7',
  waiting: '#e0af68',
  done: '#9ece6a',
  error: '#f7768e',
};

/** Format an updatedAt epoch-ms into a relative "Ns 前" label. */
export function ageLabel(updatedAt: number): string {
  const sec = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  if (sec < 60) return `${sec}s 前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m 前`;
  return `${Math.round(min / 60)}h 前`;
}
