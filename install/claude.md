# Claude Code 接入 UnionCodePet

Claude Code 通过 `~/.claude/settings.json` 的 `hooks` 字段接入。每个事件触发时，Claude 把 hook 上下文以 JSON 形式写入 **stdin**，我们让 hook 调用 `dispatcher.ps1`，由它读 stdin 并 POST 给守护进程。

## 支持的事件

| 事件 | 上报为 | 能拿到的内容 |
|---|---|---|
| `Stop` | `task_complete` | 任务完成 |
| `Notification`（`permission_prompt`） | `permission_request` | 需要确认操作 |
| `Notification`（`idle_prompt`） | `permission_request` | 等待输入 |
| `PreToolUse`（`ExitPlanMode`） | `plan_started` | 退出计划，开始执行 |
| `PreToolUse`（其它工具） | `tool_call` | 工具名 + 入参摘要 |
| `PostToolUse` | `tool_result` | 工具完成 |

## 配置步骤

### 1. 备份现有配置

```powershell
Copy-Item "C:\Users\<你>\.claude\settings.json" "C:\Users\<你>\.claude\settings.json.bak"
```

### 2. 修改 `hooks` 字段

把 `C:\Users\<你>\.claude\settings.json` 的 `hooks` 替换为下面这一段（注意：如果你的 `Notification` 已有配置，**用下面的整体替换 `hooks` 整块**——播放逻辑已统一交给守护进程，不再需要每条 hook 单独写 wav 路径）。

> [!warning] 路径必须用正斜杠 `/`，不能用反斜杠
> Claude Code 在解析 hook 的 `command` 字符串时会吞掉反斜杠，导致 `D:\AL\...` 变成 `D:AL...`，dispatcher.ps1 找不到，报错：
> ```
> Stop hook error: Failed with non-blocking status code: -File ... 不存在
> ```
> 下面所有 command 里的路径**已经用正斜杠**（`D:/AL/...`），照抄即可。Windows 下 PowerShell 和 cmd 都接受正斜杠，JSON 也不用转义，最稳妥。


> 假设 UnionCodePet 在 `D:\AL\UnionCodePet`。把 `<你>` 换成你的用户名。

```json
"hooks": {
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AL/UnionCodePet/hooks/dispatcher.ps1 -Source claude -Kind Stop"
        }
      ]
    }
  ],
  "Notification": [
    {
      "matcher": "permission_prompt",
      "hooks": [
        {
          "type": "command",
          "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AL/UnionCodePet/hooks/dispatcher.ps1 -Source claude -Kind Notification"
        }
      ]
    },
    {
      "matcher": "idle_prompt",
      "hooks": [
        {
          "type": "command",
          "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AL/UnionCodePet/hooks/dispatcher.ps1 -Source claude -Kind Notification"
        }
      ]
    }
  ],
  "PreToolUse": [
    {
      "matcher": "ExitPlanMode|Bash|Write|Edit",
      "hooks": [
        {
          "type": "command",
          "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:/AL/UnionCodePet/hooks/dispatcher.ps1 -Source claude -Kind PreToolUse"
        }
      ]
    }
  ]
}
```

> **关于 `matcher`**：PreToolUse 用 `ExitPlanMode|Bash|Write|Edit` 只上报关键工具，避免每个 `Read` 都触发（噪音太大）。想全量就改成 `""`。

### 3. 启动守护进程

```powershell
cd D:\AL\UnionCodePet
npm run dev
```

### 4. 验证

另开终端确认守护进程在跑：

```powershell
(Invoke-WebRequest http://127.0.0.1:23333/health).Content
# 应返回 {"ok":true,...}
```

然后在 Claude Code 里让它做点事、触发一次审批。守护进程控制台应出现 `Claude` 行，并播放对应音效。

## 音效在哪里改

**不要在 settings.json 里改。** 所有音效统一在 `D:\AL\UnionCodePet\src\config.ts` 的 `SOUND_MAP` 里：

```typescript
'claude:task_complete':      'D:\\AL\\VoicePal\\...\\connected.wav',
'claude:permission_request': 'D:\\AL\\VoicePal\\...\\talkpower_requested.wav',
```

改完 `npm run dev` 重启即可。这就是 dispatcher 架构的核心收益——一处配置，全局生效。

## 排查

| 症状 | 原因 / 处理 |
|---|---|
| 没声但面板有显示 | 守护进程没起，或 `config.ts` 里该事件的音效路径为 `null` |
| 守护进程收到事件但没声 | wav 路径不存在，看日志 `[sound] missing file` |
| dispatcher 报错 | 守护进程没起 dispatcher 会静默退出；先确认 `/health` |
| settings.json 语法错 | Claude Code 启动报错；用 `.bak` 还原 |
