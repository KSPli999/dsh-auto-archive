# Changelog

## 0.4.2

- 新增 `bridgeOnly`（默认开）：只处理 QQ 桥接里挂着的会话（私聊 / 群聊），桌面上自己开的会话不再被归档、也不再被换窗口。

## 0.4.1

- **修**：`user/message` 的事件形状是扁平的（`data` 就是消息），原来只认 `data.message`，导致归档里一条用户的话都没有、主题永远「没有留下文字」。现在两种形状都认。

## 0.4.0

- **思考强度跟着场合走**：新窗口用 `effort.normal`（默认 `low`），用户一句话里出现色色内容就切到 `effort.hot`（默认 `high`），
  最后一句之后再保持 `hotMinutes`（默认 30 分钟）然后自动降回来。
- 只管 QQ 桥接的会话，不动桌面里用户自己选的模型；模型/服务商默认沿用桥接 `config.json` 的 `dsh.provider` / `dsh.model`。
- 新增 `lib/effort.js`（词表 + 命中判断 + 档位判断）与单测。

## 0.3.0

- **每天定点翻篇**：`dailyAt: "03:00"` —— 过了这个点，把这个点之前建的、已经安静的会话统一归档换窗口；一天一次，凌晨动手。
- **记忆迁移**：换窗口时把 `~/.dsh/fish-memory/<会话id>.json` 复制给新会话（`memoryMigrate` / `memoryDirs`）。
  桥接的新会话是下一条消息才建的，所以监听 `session/created` 当场搬，另有 60 秒轮询兜底，等待中的记录存在 `pending-memory.json`。
- `maxAgeHours` 降级为可选规则，默认 `0`（关）。

## 0.2.0

- **按时间翻篇**：会话活过 `maxAgeHours`（默认 24 小时）、安静 `minIdleMinutes`（默认 20 分钟）后自动归档并换窗口。定时扫描，不打断正在进行的对话。
- **QQ 桥接换会话**：归档后读 `state/sessions.json` 反查对话 key，调 `POST /api/session/reset` 让桥接下一条消息开新会话（自动找端口和 `console-token`）。
- 桥接的长期记忆（`state/memory.jsonl`）按对话 key 记，换会话不丢。
- `maxTurns` 默认改为 `0`（按轮数触发默认关）。
- `rolled.json` 记住翻过篇的会话，重启后不会重复翻。
- 新增 `lib/rollover.js`（时间判断 + 映射反查）与对应单测。

## 0.1.0

- 监听 `session/event`，按 `turn/end` 累计轮数；到达 `maxTurns` 后归档。
- 归档为 Markdown：主题 + 最近 `keepTail` 轮原文 + 元信息，正文有 `maxChars` 上限。
- 默认用 `sessionController.create()` 新建会话，沿用原工作目录与 agent preset。
- 可选 `handoffPrompt`：把交接便条投进新会话（会触发一次模型调用，默认关）。
- `dryRun` 试运行、`oncePerSession`、`excludeCwd` / `includeCwd` 过滤。
- 子代理会话、QQ 桥接会话默认跳过。
- 归档全程不调用模型。
