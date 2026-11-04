# Changelog

## 0.1.0

- 监听 `session/event`，按 `turn/end` 累计轮数；到达 `maxTurns` 后归档。
- 归档为 Markdown：主题 + 最近 `keepTail` 轮原文 + 元信息，正文有 `maxChars` 上限。
- 默认用 `sessionController.create()` 新建会话，沿用原工作目录与 agent preset。
- 可选 `handoffPrompt`：把交接便条投进新会话（会触发一次模型调用，默认关）。
- `dryRun` 试运行、`oncePerSession`、`excludeCwd` / `includeCwd` 过滤。
- 子代理会话、QQ 桥接会话默认跳过。
- 归档全程不调用模型。
