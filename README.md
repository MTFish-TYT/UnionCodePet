# UnionCodePet

统一 CLI 状态监控守护进程——把 Claude Code、Codex、Zcode 三家 AI Coding CLI 的状态收归一处，用统一的提示音和状态面板告诉你"哪个 CLI 在做什么、什么时候需要你、什么时候完成了"。

这是**未来桌面宠物（桌宠）的数据层**。当前阶段（MVP）是一个无 UI 的后台守护进程 + 控制台状态面板，相当于一个加强版的 [Code-Notify](https://github.com/mylee04/code-notify)。后续会套上 Electron 桌宠外壳，前端可直接复用本项目的归一化事件协议。

## 为什么造这个

同时开多个 CLI 时，你不知道哪个在等审批、哪个跑完了。现有方案要么各响各的（提示音散落在 3 个 ps1 里，难统一管理），要么只看状态不显示内容（如 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)）。UnionCodePet 的核心设计是：

- **dispatcher 架构**：CLI 侧只负责"上报事件"，播放和状态展示全部由守护进程统一控制。一处配置，全局生效。
- **统一事件协议**：三家 CLI 的各种事件归一化成同一个 schema，前端（未来的桌宠）只面向这一个协议写。
- **双通道 Codex**：notify（完成信号）+ sessions 轮询（实时状态），解决 Windows 下 Codex 禁用 hooks 的问题。

## 架构

```
┌─────────────────────────────────────────────────────┐
│  守护进程 daemon.ts（常驻后台）                        │
│  ├─ HTTP server :23333（接收所有上报事件）             │
│  ├─ Codex sessions 轮询器（增量解析 jsonl）            │
│  ├─ 事件归一化层（各家事件 → 统一 schema）             │
│  ├─ 状态机（per session，idle/working/waiting/done）   │
│  ├─ 提示音引擎（统一配置 → SoundPlayer）               │
│  └─ 控制台状态面板（实时摘要打印）        ← MVP 阶段   │
└────▲──────────────────────────────────▲─────────────┘
     │ HTTP POST {统一事件}               │ 文件轮询
┌────┴──────────────┐           ┌────────┴──────────┐
│  dispatcher.ps1   │           │ Codex             │
│  (三家 CLI 共用)   │           │ sessions/*.jsonl  │
└────▲──────────────┘           └───────────────────┘
     │ 各 CLI 的 hook/notify 把事件交给 dispatcher
  ┌──┴──┬───────┬─────────┐
  │Claude│Zcode │Codex    │
  │hook │hook  │notify   │
  └─────┴──────┴─────────┘
```

## 统一事件协议

所有来源归一化成同一个形状：

```typescript
interface UnifiedEvent {
  source: 'claude' | 'zcode' | 'codex';
  sessionId: string;
  event: 'task_started' | 'message' | 'tool_call' | 'tool_result'
       | 'permission_request' | 'plan_started' | 'task_complete' | 'error';
  role?: 'user' | 'assistant' | 'tool';
  summary?: string;   // ≤120 字摘要，面板显示用
  toolName?: string;
  cwd?: string;
  ts: number;
}
```

加新 CLI 只需写一个 adapter 把它的事件转成 `UnifiedEvent`。

## 快速开始

### 环境要求
- Node.js 18+（开发用 24）
- Windows（当前音效播放走 PowerShell `System.Media.SoundPlayer`；macOS/Linux 可跑但无声，未来用 Electron Web Audio 补）

### 安装

```powershell
git clone https://github.com/MTFish-TYT/UnionCodePet.git
cd UnionCodePet
npm install
npm run build
```

### 启动守护进程

```powershell
npm start
# 或开发模式（编译+运行）
npm run dev
```

启动后会看到控制台状态面板，并监听 `http://127.0.0.1:23333`。

### 接入 CLI

按各家文档把 CLI 的 hook/notify 指向 dispatcher：

- [Claude Code 接入](install/claude.md)
- [Zcode 接入](install/zcode.md)
- [Codex 接入](install/codex.md)

### 配置提示音

所有音效统一在 [`src/config.ts`](src/config.ts) 的 `SOUND_MAP`。改完重启守护进程即可。

```typescript
'claude:task_complete':      'D:\\AL\\VoicePal\\...\\connected.wav',
'zcode:plan_started':        'D:\\AL\\VoicePal\\...\\Suisen_omake1_05.wav',
'codex:task_complete':       'D:\\AL\\VoicePal\\...\\servergroup_assigned.wav',
```

`null` 表示"面板显示但静默"（适合频繁的 tool_call）。

## 各 CLI 能力对比

| 能力 | Claude Code | Zcode | Codex |
|---|---|---|---|
| 任务完成 | ✅ `Stop` hook | ✅ `Stop` hook | ✅ `notify` agent-turn-complete |
| 询问/审批 | ✅ `Notification` permission_prompt | ✅ `PermissionRequest` | ❌ Codex 不外发 |
| 退出 plan 执行 | ✅ `PreToolUse` ExitPlanMode | ✅ `PermissionRequest` ExitPlanMode | ❌ |
| 实时状态/摘要 | ✅ `PreToolUse` tool_call | — | ✅ sessions 轮询 |
| 接入方式 | settings.json hook | 本地插件 hook | config.toml notify + 自动轮询 |

## 项目结构

```
UnionCodePet/
├── src/
│   ├── daemon.ts          # 主进程：HTTP server + 事件分发 + 启动 poller
│   ├── protocol.ts        # 统一事件协议定义
│   ├── normalizer.ts      # 各家事件 → UnifiedEvent
│   ├── session-state.ts   # per-session 状态机 + 限流
│   ├── sound-engine.ts    # 统一提示音播放
│   ├── codex-poller.ts    # Codex sessions jsonl 增量轮询
│   ├── console-panel.ts   # 控制台状态面板
│   └── config.ts          # 端口/轮询间隔/音效映射（唯一配置入口）
├── hooks/
│   └── dispatcher.ps1     # 统一上报脚本（三家共用）
├── install/
│   ├── claude.md          # Claude Code 接入
│   ├── zcode.md           # Zcode 接入
│   └── codex.md           # Codex 接入
└── package.json
```

## 限流（防刷屏）

借鉴 Code-Notify，per session + per event kind 限流：

| 事件 | 冷却 |
|---|---|
| `task_complete` | 10s |
| `permission_request` | 180s |
| `plan_started` | 30s |
| `tool_call`/`tool_result` | 10s |
| `message` | 5s |

在 [`src/config.ts`](src/config.ts) 的 `rateLimitsMs` 调整。

## 路线图

- [x] **MVP**：三家接入 + 统一提示音 + 控制台状态面板（当前）
- [ ] 开机自启 + 进程 watchdog（守护进程挂了自动拉起）
- [ ] Electron 桌宠外壳（透明置顶 + 角色 + 对话气泡）
- [ ] 对话内容可视化（实时对话流，不只是摘要）
- [ ] opencode 接入

## 致谢

- [Code-Notify](https://github.com/mylee04/code-notify) —— notify/限流/Codex sessions 解析的参考
- [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) —— 桌宠形态和 Codex 轮询延迟的参考

## License

MIT
