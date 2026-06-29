# Zcode 接入 UnionCodePet

Zcode（基于 OpenCode 内核的 GUI 版）通过**本地插件 + hooks** 接入。复用你已有的 `notify-sound` 插件骨架，只把 `hooks.json` 里 hook 的 command 从"直接播声"改成"调 dispatcher.ps1"。

> 这份文档假设你已经按《各家 CLI 加提示音和改界面.md》里的 ZCode 章节建好了 `notify-sound` 插件。如果还没有，先按那份文档把插件目录结构搭起来，再回来改 command。

## 背景：Zcode 的 hook 机制（踩坑要点）

- 共 7 个事件：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。
- `AskUserQuestion`（提问）和 `ExitPlanMode`（退出计划开始执行）**不是独立事件**，而是挂在 `PermissionRequest` 下、靠 payload 的 `toolName` 区分。
- 配置 `~/.zcode/cli/config.json` 的 `hooks` 字段**没用**（GUI 版没接进 runtime，日志会一直是 `hookCount:0`）。**唯一可行路径是本地插件 + GUI 启用。**
- 插件必须放在 `~/.zcode/cli/plugins/cache/zcode-plugins-official/<插件名>/<版本>/`，否则不被扫描。
- async hook 读 stdin 必须用 `[Console]::In.ReadToEnd()`，不能用 `$input | Out-String`。
- 含中文路径的 ps1 必须**存成 UTF-8 with BOM**。

## 支持的事件

| Zcode 事件 | toolName | 上报为 |
|---|---|---|
| `Stop` | — | `task_complete` |
| `PermissionRequest` | `AskUserQuestion` | `permission_request` |
| `PermissionRequest` | `ExitPlanMode` | `plan_started` |
| `PermissionRequest` | 其它 | `permission_request` |

## 配置步骤

### 1. 改插件的 `hooks.json`

打开：
```
C:\Users\<你>\.zcode\cli\plugins\cache\zcode-plugins-official\notify-sound\1.0.0\hooks\hooks.json
```

把两个 hook 的 command 都改成指向 dispatcher（替换原来的 play-sound.ps1）：

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "AskUserQuestion|ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"D:/AL/UnionCodePet/hooks/dispatcher.ps1\" -Source zcode",
            "async": true
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"D:/AL/UnionCodePet/hooks/dispatcher.ps1\" -Source zcode",
            "async": true
          }
        ]
      }
    ]
  }
}
```

> 注意：dispatcher 自己会从 stdin 读 payload 并解析 `hookEventName` + `toolName`，所以这里**不需要**像原来那样在 ps1 里手动分流音效——分流统一交给守护进程的 `normalizer.ts` + `config.ts`。

### 2. `play-sound.ps1` 可以保留或删除

原来的 `notify-sound/.../play-sound.ps1` 现在用不上了（播放由守护进程统一做）。可以留着备查，也可以删。

### 3. 完全关闭再重开 ZCode

hooks 只在启动时注册。改完 `hooks.json` 必须重启 ZCode。

### 4. 验证启动日志

重启后查 `~/.zcode/cli/log/zcode-<日期>.jsonl`，找 `bootstrap.app.startup.plugins.completed`：

```
pluginCount = 含 notify-sound
enabledPluginCount = 已启用
hookCount = 2          # PermissionRequest + Stop
```

`hookCount` 应该还是 2（和原来一样）。

### 5. 启动守护进程并测试

```powershell
cd D:\AL\UnionCodePet
npm run dev
```

让 Zcode 提一次问（AskUserQuestion）、走一遍 plan、再完成一轮任务，守护进程控制台应分别出现 Zcode 行 + 播放对应音效。

## 音效映射

统一在 `D:\AL\UnionCodePet\src\config.ts`：

```typescript
'zcode:task_complete':       'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_08.wav',
'zcode:permission_request':  'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_15.wav',
'zcode:plan_started':        'D:\\AL\\VoicePal\\次元错位\\04崩月水仙\\Suisen_omake1_05.wav',
```

改完重启守护进程即可（不用动 Zcode 插件）。

## 排查

| 症状 | 原因 / 处理 |
|---|---|
| hookCount=0 | hooks.json 格式错，或事件名不是那 7 个之一 |
| hookCount>0 但 dispatcher 没收到 | daemon 没起（先 `/health`）；或 dispatcher 路径写错 |
| 提问/完成都没声但 panel 有显示 | 该事件音效路径为 null 或不存在 |
| 之前能响改完不响 | hooks.json 的 command 路径用了反斜杠没转义，或 Zcode 没完全重启 |
