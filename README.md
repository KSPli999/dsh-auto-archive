# dsh-auto-archive

给 DeepSeek Harness 的一个小刹车：**一个对话开太久了，就把该留的东西落成 Markdown，再换一个新的窗口。**

默认**一天翻一篇**。上下文不会一路滚雪球，token 也就不会跟着一路烧。

## 它会做什么

1. 盯住每个会话。两种触发方式：
   - **按时间（默认）**：会话活过 `maxAgeHours`（默认 24 小时），并且已经安静 `minIdleMinutes`（默认 20 分钟），就翻篇。
     「每天换个新窗口」是自动的，不用你记着换；也不会在你正聊着的时候把窗口抽走。
   - **按轮数（可选，默认关）**：累计到 `maxTurns` 轮就翻篇（`maxTurns: 0` 表示关掉）。
2. 翻篇前把它整理成一份 Markdown 归档：
   - 主题（第一句用户消息）
   - 最近 `keepTail` 轮原文（思考过程、工具调用、工具结果都不收）
   - 轮数、工作目录、时间
3. 归档写进 `~/.dsh/auto-archive/<工作目录>/<时间>-<会话id>.md`，
   同时往 `index.jsonl` 记一条索引、往 `notice.log` 记一行留痕、往 `rolled.json` 记下「这个会话翻过了」。
4. 换窗口：
   - **QQ 桥接的会话**：让桥接把 `state/sessions.json` 里那条映射作废（`POST /api/session/reset`），
     下一条消息它会自己开一个新会话 —— 这才是 QQ 那边真正省 token 的地方。
   - **桌面/普通会话**：调 `sessionController.create()` 开一个新会话，沿用原来的工作目录和 agent preset。

整个过程**不调用模型**——归档是从会话日志里按规则抽的。省 token 的功能不能先烧一把 token。

## 记忆会不会丢

- **QQ 那边不丢**：桥接自己的长期记忆在 `state/memory.jsonl`，是按对话 key（`group:…` / `private:…`）记的，
  换会话不换 key，记忆照旧注入。
- **归档可以翻**：昨天的原文都在 `~/.dsh/auto-archive/` 里，想查细节随时 grep。
- **会丢的是**：`dsh-fish-memory` 那份是按 session id 存的，新会话等于从零开始；
  以及昨天对话的逐字上下文（这本来就是翻篇要丢掉的东西）。
  想保住更多，把 `maxAgeHours` 调大，或者告诉我，我再加一段「把旧会话的记忆文件带过去」。

## 它不会做什么

- **不会替你切换页面。** 宿主没有对外暴露「把当前窗口切到另一个会话」这个动作，所以桌面端的新会话只是出现在列表里，需要你自己点进去。
- 不会删任何会话日志，归档只是另存一份。
- 不碰子代理会话（`origin: 'subagent'`）。
- 不会在会话正忙时动手：按时间触发要求至少安静 `minIdleMinutes`，按轮数触发只在 `turn/end` 之后。

## 安装

在 DSH 里用 Plugin Manager 装这个目录：

```
plugin_manager  action: install_bundle  target: <这个包的绝对路径>
```

装完 bundle 会自动插一行：

```yaml
- insert:
    - id: auto-archive
      name: dsh-auto-archive
      config: {}
```

## 配置

插件行里的 `config` 优先，其次是 `~/.dsh/auto-archive.json`，最后是默认值。文件不存在或写坏了都安静地退回默认。

> 配置是在插件加载时读的：改完 JSON 要在「设置 → 重载与重启」点一下重载（或者重启 DSH）才生效。

```json
{
  "maxAgeHours": 24,
  "minIdleMinutes": 20,
  "bridgeReset": true
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `maxAgeHours` | `24` | 会话活过多少小时翻篇；`0` = 关掉按时间触发 |
| `minIdleMinutes` | `20` | 至少安静多少分钟才动手，别打断正在聊的对话 |
| `checkIntervalMinutes` | `10` | 多久扫一次 |
| `maxTurns` | `0` | 按轮数触发；`0` = 关 |
| `minTurns` | `3` | 轮数太少的不动（空会话不翻） |
| `keepTail` | `12` | 归档里保留最近几轮原文 |
| `maxChars` | `12000` | 归档正文上限（字符） |
| `handoffChars` | `900` | 交接便条上限 |
| `archiveDir` | `""` | 归档目录；空 = `~/.dsh/auto-archive` |
| `newSession` | `true` | 归档后要不要建新会话（桥接会话走桥接，不建） |
| `bridgeReset` | `true` | QQ 桥接的会话：归档后让桥接作废映射，下一条消息开新会话 |
| `handoffPrompt` | `false` | 建完新会话后把交接便条作为一条消息投进去（**会触发一次模型调用**） |
| `oncePerSession` | `true` | 一个会话只翻一次；`false` = 每再涨 `maxTurns` 轮再翻 |
| `excludeCwd` | `[]` | 路径命中这些片段的会话不碰 |
| `includeCwd` | `[]` | 只处理这些目录下的会话；空 = 不限 |
| `dryRun` | `false` | 只归档、不换窗口；想先看看效果就开它 |

## 桥接是怎么找到的

不用填 URL，也不用填令牌。插件从会话的工作目录往上找：

- `state/sessions.json` → 反查这个 DSH 会话对应哪条 QQ 对话
- `config.json` 的 `consolePort` → 端口（默认 3100）
- `config.json` 的 `consoleToken`，没有就读 `state/console-token`

对不上就不动，只归档不换窗口。

## 输出长什么样

```
~/.dsh/auto-archive/
├── index.jsonl                                    # 每次翻篇一行，机器可读
├── notice.log                                     # 每次翻篇一行，人可读
├── rolled.json                                    # 翻过篇的会话，7 天内不再翻
└── C-Users-me-project-demo/
    └── 20261104-132005-session-9.md
```

## 开发

```bash
node --test test/digest.test.js test/rollover.test.js test/plugin.test.js
```

- `lib/digest.js`：数轮数、抽文字、造归档、造交接便条。
- `lib/rollover.js`：「该不该按时间翻篇」「这个会话是桥接里的哪条对话」。
- `lib/config.js`：默认值、归一化、目录过滤。
- `lib/index.js`：接 `session/event` 和定时扫描、落盘、换窗口。

## License

MIT
