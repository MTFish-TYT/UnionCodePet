# Codex 接入 UnionCodePet

Codex 在 Windows 上**禁用了 hooks**，所以和 Claude/Zcode 不同，需要**双通道**接入：

1. **notify 通道**：Codex 在事件触发时调用 `config.toml` 里配置的外部程序，把 JSON payload 作为参数传入。可靠拿到 `agent-turn-complete`。
2. **sessions 轮询通道**：守护进程自己轮询 `~/.codex/sessions/**/*.jsonl`，按行解析，拿到**实时**的任务状态和 agent 回复摘要（notify 拿不到这些）。

两个通道互补：notify 负责"完成"那一刻的精确信号；轮询负责过程中的实时性。

## 通道 1：notify（任务完成）

### 1. 备份现有脚本

```powershell
Copy-Item "C:\Users\<你>\.codex\notify.ps1" "C:\Users\<你>\.codex\notify.ps1.bak"
```

### 2. 修改 `config.toml` 的 notify

打开 `C:\Users\<你>\.codex\config.toml`，确认顶层有（已有则保留）：

```toml
notify = [
  "powershell.exe",
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "C:\\Users\\<你>\\.codex\\notify.ps1"
]
```

> `notify = [...]` 必须是顶层配置，放在所有 `[section]` 之前。

### 3. 改写 `notify.ps1`，转发给 dispatcher

把 `C:\Users\<你>\.codex\notify.ps1` 内容替换为：

```powershell
param([string]$JsonPayload)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $JsonPayload) { exit 0 }

# Codex notify 收到的事件，转发给 UnionCodePet dispatcher。
# 由守护进程统一决定响什么声、显示什么摘要。
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  "D:\AL\UnionCodePet\hooks\dispatcher.ps1" `
  -Source codex -JsonPayload $JsonPayload
exit 0
```

> 这样原来的"直接播声"就被"转发给守护进程"取代。播放统一由 `config.ts` 控制。

### 4. 验证

```powershell
# 手动模拟一个 agent-turn-complete 事件
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\<你>\.codex\notify.ps1" '{"type":"agent-turn-complete","cwd":"D:/test","last-assistant-message":"测试完成"}'
```

守护进程控制台应出现 `Codex 完成`，并播放 `servergroup_assigned.wav`。

## 通道 2：sessions 轮询（实时状态 + 摘要）

**这一通道无需任何 Codex 配置改动**——守护进程启动时自动开始轮询 `~/.codex/sessions/`。

### 工作原理

- 守护进程每 1.5s 扫描 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`。
- **首次发现文件时跳到末尾**，不回放历史（避免启动时刷屏）。
- 之后只读新增行，按 `type` 字段归一化：
  - `event_msg.payload.type === 'task_started'` → `task_started`
  - `event_msg.payload.type === 'agent_message'` → `message`（assistant）+ 摘要
  - `response_item.payload.type === 'function_call'` → `tool_call`（工具名 + 入参摘要）
  - `response_item.payload.type === 'message'` 且 `role === 'assistant'` → `message` + 摘要

### 你能看到什么

守护进程控制台面板的 `Codex` 行会实时显示：开始任务 → 工作中（带工具名）→ agent 回复摘要 → 完成。这是 notify 单通道给不了的。

> 注意：Codex 的 `request_permissions`/approval 事件**不会**通过 notify 发给外部脚本（Codex 已知限制），所以"需要确认"这类状态目前 Codex 端**拿不到**。这是 Codex 本身的限制，不是 UnionCodePet 的问题。Clawd 等其它工具同样如此。

## 音效映射

统一在 `D:\AL\UnionCodePet\src\config.ts`：

```typescript
'codex:task_complete': 'D:\\AL\\VoicePal\\html\\client_ui\\sound\\default\\servergroup_assigned.wav',
'codex:permission_request': null,   // Codex 拿不到，留空
'codex:tool_call': null,            // 工具调用太频繁，静默（仅在面板显示）
'codex:message': null,              // agent 消息，静默
```

## 排查

| 症状 | 原因 / 处理 |
|---|---|
| 完成时没声 | notify.ps1 没改 / daemon 没起 / config.toml 的 notify 路径错 |
| 面板里 Codex 一直是空的 | sessions 目录不存在（Codex 没跑过会话）；或 daemon 没轮询 |
| 启动时面板刷屏一堆旧 Codex | （已修复）老版本会回放历史，新版跳到末尾。更新 daemon |
| 实时性差（几秒延迟） | 正常，轮询间隔 1.5s；想更快改 `config.ts` 的 `codexPollIntervalMs` |
| 拿不到 approval 事件 | Codex 本身限制，见上 |
