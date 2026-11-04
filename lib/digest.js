// 把一段会话的日志变成两份东西：
//   1. 一份可以慢慢翻的 Markdown 归档
//   2. 一张很短、可以塞进新会话的「交接便条」
//
// 这里全是纯函数：不读盘、不碰 ctx、不发模型请求。
// 目的很俗 —— 归档这件事必须**零模型调用**，不然为了省 token 先烧一把 token，就成笑话了。

/** 每条消息在归档里最多留多少字。太长的话归档本身也会变成负担。 */
export const 单句上限 = 400

/** 从一条 Message 里抽出纯文字（思考过程、工具调用、工具结果都不算「话」）。 */
export function 取文字(message) {
  if (!message) return ''
  const 内容 = message.content
  if (typeof 内容 === 'string') return 内容
  if (!Array.isArray(内容)) return ''
  const 段们 = []
  for (const 段 of 内容) {
    if (!段 || 段.type !== 'text') continue
    const 文字 = typeof 段.text === 'string' ? 段.text : ''
    if (文字.trim()) 段们.push(文字)
  }
  return 段们.join('\n')
}

/** 会话日志里已经结束了几轮。turn/end 每轮恰好一次。 */
export function 数轮数(events) {
  let 轮 = 0
  for (const 事件 of events || []) {
    if (事件 && 事件.type === 'turn/end') 轮 += 1
  }
  return 轮
}

/** 会话里第一句用户说的话，当作主题。 */
export function 取主题(events, 上限 = 120) {
  for (const 事件 of events || []) {
    if (!事件 || 事件.type !== 'user/message') continue
    const 文 = 取文字(事件.data && 事件.data.message).replace(/\s+/g, ' ').trim()
    if (文) return 文.length > 上限 ? `${文.slice(0, 上限)}…` : 文
  }
  return '（没有留下文字）'
}

/**
 * 收最近 keepTail 轮对话（一轮 = 一条用户消息 + 它后面的助手回复）。
 * 从「第 keepTail 条用户消息」那里开始切，保证切片以用户开头，不会半句话起头。
 */
export function 收对话(events, keepTail = 12) {
  const 全部 = []
  for (const 事件 of events || []) {
    if (!事件) continue
    if (事件.type !== 'user/message' && 事件.type !== 'assistant/message') continue
    const 文 = 取文字(事件.data && 事件.data.message).trim()
    if (!文) continue
    全部.push({
      role: 事件.type === 'user/message' ? 'user' : 'assistant',
      text: 文,
      time: 事件.time || 0,
    })
  }
  const 用户位 = []
  全部.forEach((条, 位) => {
    if (条.role === 'user') 用户位.push(位)
  })
  const 起 = 用户位.length > keepTail ? 用户位[用户位.length - keepTail] : 0
  return 全部.slice(起)
}

function 补零(n) {
  return String(n).padStart(2, '0')
}

/** 本地时间的 YYYY-MM-DD HH:mm。 */
export function 格式化时间(ms) {
  const d = new Date(Number(ms) || Date.now())
  return (
    `${d.getFullYear()}-${补零(d.getMonth() + 1)}-${补零(d.getDate())} ` +
    `${补零(d.getHours())}:${补零(d.getMinutes())}`
  )
}

/** 归档文件名里能用的时间戳：20261104-132005 */
export function 时间戳(ms) {
  const d = new Date(Number(ms) || Date.now())
  return (
    `${d.getFullYear()}${补零(d.getMonth() + 1)}${补零(d.getDate())}-` +
    `${补零(d.getHours())}${补零(d.getMinutes())}${补零(d.getSeconds())}`
  )
}

function 剪(文, 上限) {
  const s = String(文 == null ? '' : 文).trim()
  if (s.length <= 上限) return s
  return `${s.slice(0, 上限)}…`
}

/**
 * 造出归档正文 + 交接便条。
 *
 * @param {object} 选项
 * @param {string} 选项.sessionId
 * @param {string} [选项.cwd]
 * @param {number} 选项.turns        累计轮数
 * @param {Array}  选项.events       这个会话自己的事件（按 seq 排好）
 * @param {number} [选项.keepTail]   归档里保留最近几轮原文
 * @param {number} [选项.maxChars]   归档正文上限
 * @param {number} [选项.handoffChars] 交接便条上限
 * @param {number} [选项.now]
 * @param {string} [选项.archivePath] 已经算好的归档路径（写进便条里）
 */
export function 造归档(选项) {
  const {
    sessionId = '',
    cwd = '',
    turns = 0,
    events = [],
    keepTail = 12,
    maxChars = 12000,
    handoffChars = 900,
    now = Date.now(),
    archivePath = '',
  } = 选项 || {}

  const 对话 = 收对话(events, keepTail)
  const 主题 = 取主题(events)
  const 头 = [
    `# 会话归档 · ${格式化时间(now)}`,
    '',
    `- 会话：${sessionId || '（未知）'}`,
    `- 工作目录：${cwd || '（未设置）'}`,
    `- 累计轮数：${turns}`,
    `- 归档时间：${new Date(now).toISOString()}`,
    '',
    '## 主题',
    '',
    主题,
    '',
    '## 对话节选',
    '',
  ]

  const 正文 = []
  for (const 条 of 对话) {
    const 谁 = 条.role === 'user' ? '用户' : '助手'
    const 时间 = 条.time ? ` · ${格式化时间(条.time)}` : ''
    正文.push(`**${谁}**${时间}`, '', 剪(条.text, 单句上限), '')
  }
  if (!正文.length) 正文.push('（这一段没有可读的文字消息）', '')

  let markdown = [...头, ...正文].join('\n')
  if (markdown.length > maxChars) {
    const 省略 = `\n\n…（归档正文超过 ${maxChars} 字，后面的内容已省略；完整日志还在 DSH 自己的会话存储里）\n`
    markdown = markdown.slice(0, Math.max(0, maxChars - 省略.length)) + 省略
  }

  const 最近 = 对话.slice(-4).map((条) => `- ${条.role === 'user' ? '你' : '我'}：${剪(条.text, 160)}`)
  const 便条原文 = [
    '【上一段会话的交接】',
    `上一段会话（${sessionId || '未知'}，共 ${turns} 轮）已经归档，太长就不带进新会话了。`,
    archivePath ? `归档文件：${archivePath}` : '',
    `主题：${主题}`,
    最近.length ? '最近聊到的：' : '',
    ...最近,
    '需要旧细节时再去翻归档文件；平常接着聊就行。',
  ]
    .filter((行) => 行 !== '')
    .join('\n')

  const handoff = 便条原文.length > handoffChars ? `${便条原文.slice(0, handoffChars)}…` : 便条原文

  return { markdown, handoff, topic: 主题, messageCount: 对话.length }
}
