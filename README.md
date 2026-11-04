# dsh-auto-archive

给 DeepSeek Harness 的一个小刹车：**一个会话聊到设定轮数，就把该留的东西落成 Markdown，再开一个干净的新会话。**

上下文不会一路滚雪球，token 也就不会跟着一路烧。

## 它会做什么

1. 盯着每个会话的 `turn/end`（一轮真正结束才动手，不打断正在跑的那一轮）。
2. 累计轮数到达 `maxTurns` 时，把这个会话的最近对话整理成一份 Markdown 归档：
   - 主题（第一句用户消息）
   - 最近 `keepTail` 轮原文（思考过程、工具调用、工具结果都不收）
   - 轮数、工作目录、时间
3. 归档写进 `~/.dsh/auto-archive/<工作目录>/<时间>-<会话id>.md`，
   同时往 `index.jsonl` 记一条索引、往 `notice.log` 记一行留痕。
4. 默认再调 `sessionController.create()` 开一个新会话（沿用原来的工作目录和 agent preset）。

整个过程**不调用模型**——归档是从会话日志里按规则抽的。省 token 的功能不能先烧一把 token。

## 它不会做什么

- **不会替你切换页面。** 宿主没有对外暴露「把当前窗口切到另一个会话」这个动作，所以新会话只是出现在会话列表里，需要你自己点进去接着聊。老会话保持原样，随时能翻。
- 不会删任何会话日志，归档只是另存一份。
- 不碰子代理会话（`origin: 'subagent'`）。
- 不会「接管」新会话：新会话建出来是空的，没人点进去它就一直在列表里躺着。觉得烦就把 `newSession` 关掉，只归档。

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
  "maxTurns": 30,
  "keepTail": 12,
  "newSession": true,
  "handoffPrompt": false,
  "dryRun": false
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `maxTurns` | `30` | 累计到多少轮触发 |
| `minTurns` | `3` | 轮数太少的会话不动 |
| `keepTail` | `12` | 归档里保留最近几轮原文 |
| `maxChars` | `12000` | 归档正文上限（字符） |
| `handoffChars` | `900` | 交接便条上限 |
| `archiveDir` | `""` | 归档目录；空 = `~/.dsh/auto-archive` |
| `newSession` | `true` | 归档后要不要建新会话 |
| `handoffPrompt` | `false` | 建完新会话后把交接便条作为一条消息投进去（**会触发一次模型调用**，默认关） |
| `oncePerSession` | `true` | 一个会话只归档一次；`false` = 每再涨 `maxTurns` 轮再归档一次 |
| `excludeCwd` | `[]` | 路径命中这些片段的会话不碰 |
| `includeCwd` | `[]` | 只处理这些目录下的会话；空 = 不限 |
| `dryRun` | `false` | 只归档、不建会话；想先看看效果就开它 |

## 输出长什么样

```
~/.dsh/auto-archive/
├── index.jsonl                                    # 每次归档一行，机器可读
├── notice.log                                     # 每次归档一行，人可读
└── C-Users-me-project-demo/
    └── 20261104-132005-session-9.md
```

## 开发

```bash
node --test test/digest.test.js test/plugin.test.js
```

- `lib/digest.js`：纯函数（数轮数、抽文字、造归档、造交接便条），可以单独测。
- `lib/config.js`：配置默认值、归一化、目录过滤，可以单独测。
- `lib/index.js`：接 `session/event`、落盘、建新会话。

## License

MIT
