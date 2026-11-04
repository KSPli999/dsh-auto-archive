# Changelog

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
