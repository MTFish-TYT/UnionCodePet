# UnionCodePet 🐾

统一 CLI 状态监控 + 桌面桌宠系统——把 Claude Code、Codex、Zcode 三家 AI Coding CLI 的状态收归一处，用一个桌面桌宠实时反映"谁在干什么"，并支持可视化配置。

从一个"统一提示音"守护进程，演进成完整的桌宠系统：数据采集 → 状态归一化 → 可视化配置 → 桌宠动画 → 历史回溯。

## 功能总览

### 桌宠（桌面悬浮）
- **透明置顶悬浮窗**：经典桌宠形态，可拖动，常驻桌面
- **状态驱动动画**：根据全局 CLI 状态切换动画（空闲呼吸 / 工作中 / 等待确认 / 完成欢呼 / 出错）
- **idle 随机小动作**：空闲时偶尔挥手 / 跳跃 / 检视，让桌宠更生动
- **状态气泡**：实时显示当前状态 + 具体内容（如 `Zcode：完成 - <回复摘要>`），单击展开看完整内容
- **历史面板**：气泡 📜 按钮打开独立可滚动历史面板，查看最近 200 条事件（时间 / 来源 / 摘要）
- **菜单**：气泡 ☰ 按钮弹菜单，显示运行中的 CLI 及状态
- **多 pet 切换**：配置 UI 选择桌宠形象，热切换不用重启
- **素材**：复用 Codex hatch-pet 生成的 sprite sheet（1536×1872，8列×9行）

### 配置 UI（cc-switch 式图形界面）
- **音效映射**：可视化配置每个 CLI 事件的提示音（选文件 / 试听 / 静默 / 自动保存）
- **通用设置**：端口、Codex 轮询间隔、各事件限流值
- **会话状态**：实时显示各 CLI 会话当前状态
- **桌宠选择**：扫描 pets/ 目录，卡片式选择当前桌宠
- **音效路径检测**：启动时检查音效文件是否存在，失效时提示重选

### 系统
- **后台常驻**：系统托盘 + 关窗隐藏（关闭配置窗口不退出，托盘菜单退出）
- **可打包**：`npm run pack` 产出 win-unpacked（绕过 winCodeSign 的普通权限打包方案）

## 架构

```
┌─────────────────────────────────────────────────────┐
│  Electron main 进程                                  │
│  ├─ HTTP server :23333（接收 CLI hook/notify 上报）   │
│  ├─ Codex sessions 轮询器（增量解析 jsonl）           │
│  ├─ 事件归一化层（各家事件 → 统一 schema）            │
│  ├─ SessionTracker（状态机 + 限流 + 历史记录）        │
│  ├─ SoundEngine（统一提示音）                         │
│  ├─ Tray（系统托盘 + 常驻）                           │
│  └─ IPC → 推送给两个窗口                              │
└────▲──────────────────────────────────▲─────────────┘
     │ HTTP POST                          │ IPC
┌────┴──────────────┐           ┌────────┴──────────────┐
│  dispatcher.ps1   │           │  配置窗口（renderer）   │
│  (三家 CLI 共用)   │           │  音效/通用/会话/桌宠页  │
└────▲──────────────┘           └────────────────────────┘
     │ 各 CLI 的 hook/notify          ┌────────────────────────┐
  ┌──┴──┬───────┬─────────┐          │  桌宠窗口（renderer-pet）│
  │Claude│Zcode │Codex    │          │  sprite 播放 + 气泡 + 历史│
  │hook │hook  │notify   │          └────────────────────────┘
  │     │      │+轮询    │
  └─────┴──────┴─────────┘
```

## 各 CLI 能力对比

| 能力 | Claude Code | Codex | Zcode |
|---|---|---|---|
| 任务完成 | ✅ Stop hook | ✅ notify + 轮询 | ✅ Stop hook |
| 工作中（工具调用） | ✅ PreToolUse | ✅ sessions 轮询 | ✅ PreToolUse |
| 请求确认/提问 | ✅ Notification | ❌ 不外发 | ✅ PermissionRequest |
| 执行 plan | ✅ PermissionRequest | ❌ | ✅ PermissionRequest |
| 实时状态/摘要 | ✅ | ✅（轮询） | ✅ |
| 接入方式 | settings.json hook | config.toml notify + 自动轮询 | 本地插件 hook |

> Codex 的"请求确认/plan"是 Codex 本身的限制（Windows 禁 hooks，notify 不外发这些事件），不是 UnionCodePet 的问题。

## 快速开始

### 环境要求
- Node.js 18+
- Windows（音效播放走 PowerShell；macOS/Linux 可跑但无声）
- Electron 镜像（国内）：`ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`

### 安装与开发

```powershell
git clone https://github.com/MTFish-TYT/UnionCodePet.git
cd UnionCodePet
npm install
npm run dev          # 开发模式（HMR）
```

### 接入 CLI

按各家文档把 CLI 的 hook/notify 指向 dispatcher：
- [Claude Code 接入](install/claude.md)
- [Zcode 接入](install/zcode.md)
- [Codex 接入](install/codex.md)

### 配置提示音

所有音效统一在配置 UI 的"音效"页（数据存在 `~/.unioncodepet/config.json`）。改完即时生效。

### 打包

```powershell
npm run pack         # 产出 release/win-unpacked/UnionCodePet.exe
```

> electron-builder 的 winCodeSign 在非管理员权限会失败（符号链接问题），`pack.ps1` 脚本绕过它，直接组装 win-unpacked。如需安装程序 + 自定义 exe 图标，用管理员权限跑一次 `npm run dist:win`（缓存好后普通权限也能用）。

## 桌宠素材（hatch-pet）

桌宠素材复用 Codex 的 hatch-pet 生成。在任意 CLI 里调用 hatch-pet skill 生成 pet，把产出的 `pet.json + spritesheet.webp` 复制到 `pets/<pet名>/`，重启后在配置 UI 的"桌宠"页选择。

素材契约（播放器内置）：
- 1536×1872，8列×9行，cell 192×208
- 9 个动画状态：idle / running-right / running-left / waving / jumping / failed / waiting / running / review
- 帧时长写死在 `renderer/pet/animation-rows.ts`（不在 pet.json 里）

## 项目结构

```
UnionCodePet/
├── src/                        # 纯逻辑核心（main/renderer 共享）
│   ├── protocol.ts             # 统一事件协议
│   ├── normalizer.ts           # 各家事件 → UnifiedEvent
│   ├── session-state.ts        # 状态机 + 限流
│   ├── config.ts               # 外置 JSON 配置（~/.unioncodepet/）
│   ├── sound-engine.ts         # 提示音播放
│   └── codex-poller.ts         # Codex sessions jsonl 轮询
├── electron/
│   ├── main/                   # 主进程：HTTP/poller/ingest/tray/IPC
│   └── preload/                # IPC 桥（config 窗口 + pet 窗口）
├── renderer/                   # 配置 UI（React）
│   ├── src/components/         # 音效/通用/会话/桌宠页
│   └── pet/                    # 桌宠窗口（canvas 播放器 + 气泡 + 历史）
├── pets/                       # 桌宠素材（从 codex 复制）
├── build/                      # 图标资源
├── hooks/dispatcher.ps1        # 三家 CLI 共用上报脚本
├── install/                    # 各 CLI 接入文档
└── scripts/pack.ps1            # 普通权限打包脚本
```

## 状态映射

daemon 的统一事件 → 桌宠动画：

| CLI 事件 | 桌宠动画 | 气泡 |
|---|---|---|
| 空闲 | idle（呼吸）/ 随机小动作 | 空闲 |
| 任务完成 | jumping（欢呼，10秒） | `<源>：完成 - <摘要>` |
| 工作中（工具调用） | running | `<源>：工作中 [<工具>]` |
| 请求确认/提问 | waiting | `<源>：等待确认` |
| 执行 plan | waiting | `<源>：开始执行计划` |
| 出错 | failed | `<源>：出错` |

## 致谢

- [Code-Notify](https://github.com/mylee04/code-notify) — notify/限流/Codex sessions 解析参考
- [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) — 桌宠形态参考
- [cc-switch](https://github.com/farion1231/cc-switch) — 配置 UI 参考
- [hatch-pet](https://github.com/openai/skills/tree/main/skills/.curated/hatch-pet) — 桌宠素材契约

## License

MIT
