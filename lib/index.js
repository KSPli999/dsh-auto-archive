// dsh-auto-archive · 宿主半边
//
// 一件事：一个对话开太久了，就把内容落成一份 Markdown 归档，再换一个新的窗口 ——
// 上下文别一直滚雪球，token 才不会一路烧。
//
// 两种触发：
//   · 按时间（默认）：会话活过 maxAgeHours（默认 24 小时）、并且已经安静 minIdleMinutes，
//     就翻篇。这样「每天一个新窗口」是自动的，不用记着换。
//   · 按轮数（可选，默认关）：累计到 maxTurns 轮就翻篇。
//
// 设计上的几条硬规矩：
//   1. 归档**不调模型**。所有东西都是从会话日志里规则化抽出来的，省 token 的事不能先花 token。
//   2. 只在 turn/end 之后或会话安静时动手，绝不打断正在进行的一轮。
//   3. 子代理会话不碰（它们的会话 id 另有主人）；要排除别的目录就配 excludeCwd。
//   4. 任何一步失败都只记一笔，不让插件把宿主拖下水。
//   5. QQ 桥接的会话：归档后让它把 `state/sessions.json` 里那条映射作废，
//      下一条消息它会自己开新会话 —— 桥接的长期记忆（state/memory.jsonl）是按对话 key 记的，
//      换窗口不会丢。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { 归档根目录, 该管这个目录, 归一化配置, 读配置档案 } from './config.js'
import { 时间戳, 数轮数, 造归档 } from './digest.js'
import { 从映射找会话键, 应每日翻篇, 解析每日时刻, 该按时间滚 } from './rollover.js'
import { 迁移记忆 } from './memory.js'

export const name = 'auto-archive'
export const inject = ['sessions']

function 安全文件名(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'session'
}

function 目录名(cwd) {
  const 原文 = String(cwd || '').trim()
  if (!原文) return 'root'
  const 洗 = 原文
    .replace(/[\\/:]+/g, '-')
    .replace(/[*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return 洗 || 'root'
}

export function apply(ctx, 行配置) {
  const 配置 = 归一化配置(读配置档案(), 行配置)
  const 状态表 = new Map()
  const 根目录 = 归档根目录(配置)
  const 记录文件 = join(根目录, 'rolled.json')
  const 待迁移文件 = join(根目录, 'pending-memory.json')
  const 每日时刻 = 解析每日时刻(配置.dailyAt)

  // 已经翻过篇的会话，重启之后也不要再翻一次。
  const 已翻篇 = new Map()
  try {
    if (existsSync(记录文件)) {
      const 旧 = JSON.parse(readFileSync(记录文件, 'utf8'))
      for (const [id, 时间] of Object.entries(旧 || {})) {
        if (Date.now() - Number(时间) < 7 * 24 * 3600 * 1000) 已翻篇.set(String(id), Number(时间) || 0)
      }
    }
  } catch {
    /* 记录坏了就当空的 */
  }

  const 存记录 = () => {
    try {
      if (!existsSync(根目录)) mkdirSync(根目录, { recursive: true })
      writeFileSync(记录文件, JSON.stringify(Object.fromEntries(已翻篇), null, 0), 'utf8')
    } catch {
      /* 记不下来顶多翻两次，不致命 */
    }
  }

  // 桥接换会话是「下一条消息才建新会话」，所以记忆要等那个新 id 出现之后才能搬过去。
  const 待迁移 = new Map()
  try {
    if (existsSync(待迁移文件)) {
      const 旧 = JSON.parse(readFileSync(待迁移文件, 'utf8'))
      for (const [键, 值] of Object.entries(旧 || {})) {
        if (值 && 值.oldId) 待迁移.set(String(键), 值)
      }
    }
  } catch {
    /* 同上 */
  }

  const 存待迁移 = () => {
    try {
      if (!existsSync(根目录)) mkdirSync(根目录, { recursive: true })
      writeFileSync(待迁移文件, JSON.stringify(Object.fromEntries(待迁移), null, 0), 'utf8')
    } catch {
      /* ignore */
    }
  }

  const 记 = (级别, 文) => {
    try {
      const 方法 = ctx.logger && typeof ctx.logger[级别] === 'function' ? ctx.logger[级别] : null
      if (方法) 方法.call(ctx.logger, `auto-archive: ${文}`)
    } catch {
      /* 日志都不让写就算了 */
    }
  }

  const 留痕 = (行) => {
    try {
      if (!existsSync(根目录)) mkdirSync(根目录, { recursive: true })
      appendFileSync(join(根目录, 'notice.log'), `${new Date().toISOString()}  ${行}\n`, 'utf8')
    } catch {
      /* 留痕失败不影响主流程 */
    }
  }

  const 记账 = (记录) => {
    try {
      if (!existsSync(根目录)) mkdirSync(根目录, { recursive: true })
      appendFileSync(join(根目录, 'index.jsonl'), `${JSON.stringify(记录)}\n`, 'utf8')
    } catch {
      /* 同上 */
    }
  }

  /** 会话自己的事件；出任何岔子都当成空日志。 */
  const 取事件 = (session) => {
    try {
      const 末 = typeof session.seq === 'number' ? session.seq : 0
      const 事件 = session.snapshotEvents(0, 末)
      return Array.isArray(事件) ? 事件 : []
    } catch (错误) {
      记('warn', `读会话日志失败：${String((错误 && 错误.message) || 错误)}`)
      return []
    }
  }

  const 最后活动 = (session) => {
    try {
      const 事件 = session.eventAt(session.seq)
      if (事件 && typeof 事件.time === 'number') return 事件.time
    } catch {
      /* 拿不到就退回创建时间 */
    }
    return (session.header && session.header.createdAt) || 0
  }

  const 取状态 = (session) => {
    const id = String(session.id)
    let 状态 = 状态表.get(id)
    if (!状态) {
      状态 = {
        turns: 数轮数(取事件(session)),
        sinceArchive: 0,
        archived: false,
        archivedAt: 0,
        busy: false,
      }
      状态表.set(id, 状态)
    }
    return 状态
  }

  /** 这个会话在 QQ 桥接里对应哪条对话；不是桥接的会话返回 null。 */
  const 桥接信息 = (session) => {
    try {
      const cwd = session.header && session.header.cwd ? String(session.header.cwd) : ''
      if (!cwd) return null
      const 状态文件 = join(cwd, '..', 'sessions.json')
      if (!existsSync(状态文件)) return null
      const 映射 = JSON.parse(readFileSync(状态文件, 'utf8'))
      const 键 = 从映射找会话键(映射 && 映射.sessions, String(session.id))
      if (!键) return null
      let 端口 = 3100
      try {
        const 配置文 = JSON.parse(readFileSync(join(cwd, '..', '..', 'config.json'), 'utf8'))
        if (Number(配置文 && 配置文.consolePort) > 0) 端口 = Number(配置文.consolePort)
      } catch {
        /* 读不到就用默认端口 */
      }
      // 桥接的控制台 API 要令牌：配了就用配置里的，没配就用它自动生成的那份。
      let 令牌 = ''
      try {
        const 配置文 = JSON.parse(readFileSync(join(cwd, '..', '..', 'config.json'), 'utf8'))
        if (配置文 && typeof 配置文.consoleToken === 'string') 令牌 = 配置文.consoleToken.trim()
      } catch {
        /* 下面还有兜底 */
      }
      if (!令牌) {
        try {
          令牌 = readFileSync(join(cwd, '..', 'console-token'), 'utf8').trim()
        } catch {
          /* 没有令牌就只能放弃 */
        }
      }
      return { 键, 端口, 令牌 }
    } catch {
      return null
    }
  }

  const 让桥接换会话 = async (session) => {
    const 信息 = 桥接信息(session)
    if (!信息) return ''
    if (!信息.令牌) {
      记('warn', '桥接有映射但找不到控制台令牌，跳过重置')
      return ''
    }
    const 地址 = `http://127.0.0.1:${信息.端口}/api/session/reset`
    const 回应 = await fetch(地址, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': 信息.令牌 },
      body: JSON.stringify({ key: 信息.键 }),
      signal: AbortSignal.timeout(8000),
    })
    if (!回应.ok) throw new Error(`桥接返回 ${回应.status}`)
    return 信息.键
  }

  const 挑新会话 = async (session, cwd, handoff) => {
    const 控制器 = ctx.get('sessionController')
    if (!控制器 || typeof 控制器.create !== 'function') {
      记('warn', '当前部署没有 sessionController.create，跳过新建会话')
      return ''
    }
    const 请求 = {}
    if (cwd) 请求.cwd = cwd
    const 预设 = session.header && session.header.agentPreset
    if (预设) 请求.agentPreset = String(预设)

    const 结果 = await 控制器.create(请求)
    const 新id = 结果 && 结果.sessionId ? String(结果.sessionId) : ''
    if (!新id) {
      记('warn', '新建会话没有返回 sessionId')
      return ''
    }

    if (配置.handoffPrompt && typeof 控制器.prompt === 'function') {
      try {
        await 控制器.prompt({
          sessionId: 新id,
          mode: 'queue',
          requestId: `auto-archive-${Date.now()}`,
          content: [{ type: 'text', text: handoff }],
        })
      } catch (错误) {
        记('warn', `交接便条没投进去：${String((错误 && 错误.message) || 错误)}`)
      }
    }
    return 新id
  }

  /** 归档 + 换窗口。原因只用来记账（'age' / 'turns'）。 */
  const 翻篇 = async (session, 原因) => {
    const id = String(session.id)
    const 状态 = 取状态(session)
    if (状态.busy) return
    状态.busy = true
    try {
      const 事件 = 取事件(session)
      const 轮数 = 数轮数(事件)
      const 头 = session.header || {}
      const cwd = 头.cwd ? String(头.cwd) : ''
      const 现在 = Date.now()
      const 子目录 = join(根目录, 目录名(cwd))
      const 文件名 = `${时间戳(现在)}-${安全文件名(id)}.md`
      const 完整路径 = join(子目录, 文件名)

      const { markdown, handoff, topic } = 造归档({
        sessionId: id,
        cwd,
        turns: 轮数,
        events: 事件,
        keepTail: 配置.keepTail,
        maxChars: 配置.maxChars,
        handoffChars: 配置.handoffChars,
        now: 现在,
        archivePath: 完整路径,
      })

      mkdirSync(子目录, { recursive: true })
      writeFileSync(完整路径, markdown, 'utf8')

      let 桥接键 = ''
      let 新会话 = ''
      let 错误 = ''
      let 搬了记忆 = []
      if (!配置.dryRun) {
        if (配置.bridgeReset) {
          try {
            桥接键 = await 让桥接换会话(session)
          } catch (e) {
            错误 = String((e && e.message) || e)
            记('warn', `让桥接换会话失败：${错误}`)
          }
        }
        if (!桥接键 && 配置.newSession) {
          try {
            新会话 = await 挑新会话(session, cwd, handoff)
          } catch (e) {
            错误 = String((e && e.message) || e)
            记('warn', `新建会话失败：${错误}`)
          }
        }
        // 记忆迁移：新会话已经知道 id 的，当场搬；桥接的等它建出来再搬。
        try {
          if (配置.memoryMigrate) {
            if (新会话) {
              搬了记忆 = 迁移记忆({ fromId: id, toId: 新会话, dirs: 配置.memoryDirs })
            } else if (桥接键) {
              待迁移.set(桥接键, { oldId: id, cwd, at: 现在 })
              存待迁移()
            }
          }
        } catch (e) {
          记('warn', `迁移记忆失败：${String((e && e.message) || e)}`)
        }
      }

      记账({
        at: new Date(现在).toISOString(),
        reason: 原因,
        sessionId: id,
        cwd,
        turns: 轮数,
        topic,
        archive: 完整路径,
        bridgeKey: 桥接键 || undefined,
        newSession: 新会话 || undefined,
        memoryCopied: 搬了记忆.length || undefined,
        dryRun: 配置.dryRun || undefined,
        error: 错误 || undefined,
      })
      留痕(
        `已归档 ${id}（${轮数} 轮，${原因 === 'age' ? '按天' : 原因 === 'daily' ? '按天' : '按轮数'}）→ ${完整路径}` +
          (配置.dryRun ? '（dryRun：没换窗口）' : 桥接键 ? `；桥接 ${桥接键} 已重置` : 新会话 ? `；新会话 ${新会话}` : '；没换窗口') +
          (搬了记忆.length ? `；记忆搬了 ${搬了记忆.length} 个文件` : ''),
      )
      记('info', `已归档 ${id}（${轮数} 轮）${桥接键 ? `，桥接 ${桥接键} 已重置` : 新会话 ? `，新会话 ${新会话}` : ''}`)

      状态.archived = true
      状态.archivedAt = 现在
      状态.sinceArchive = 0
      已翻篇.set(id, 现在)
      存记录()
    } catch (错误) {
      记('warn', `归档失败：${String((错误 && 错误.message) || 错误)}`)
    } finally {
      状态.busy = false
    }
  }

  const 该管这个会话 = (session) => {
    const 头 = (session && session.header) || {}
    if (头.origin === 'subagent') return false
    if (typeof 头.delegationDepth === 'number' && 头.delegationDepth > 0) return false
    if (!该管这个目录(头.cwd ? String(头.cwd) : '', 配置)) return false
    return true
  }

  // ── 按轮数：一轮结束就看一眼 ─────────────────────────────────────────────
  const 看着这一轮 = (session) => {
    try {
      if (!session || !该管这个会话(session)) return
      const 状态 = 取状态(session)
      if (状态.busy || 已翻篇.has(String(session.id))) return
      if (配置.maxTurns <= 0) return
      if (状态.turns < 配置.minTurns) return
      if (状态.turns < 配置.maxTurns) return

      queueMicrotask(() => {
        void 翻篇(session, 'turns')
      })
    } catch (错误) {
      记('warn', `判断是否归档时出错：${String((错误 && 错误.message) || 错误)}`)
    }
  }

  // ── 桥接换过会话之后，等新 id 出现再把记忆搬过去 ──────────────────────────
  const 处理待迁移 = (新会话 = null) => {
    if (!配置.memoryMigrate || 待迁移.size === 0) return
    const 现在 = Date.now()
    const 新id = 新会话 ? String(新会话.id) : ''
    const 新目录 = 新会话 && 新会话.header && 新会话.header.cwd ? 目录名(String(新会话.header.cwd)) : ''

    // 新会话刚建出来的那一瞬间：如果同一个目录只有一个等着搬的条目，就不用等映射了。
    if (新id && 新目录) {
      const 同目录 = [...待迁移.entries()].filter(([, r]) => r && 目录名(String(r.cwd || '')) === 新目录)
      if (同目录.length === 1) {
        const [键, 记录] = 同目录[0]
        if (记录.oldId && String(记录.oldId) !== 新id) {
          const 复制 = 迁移记忆({ fromId: String(记录.oldId), toId: 新id, dirs: 配置.memoryDirs })
          待迁移.delete(键)
          存待迁移()
          if (复制.length) {
            留痕(`记忆已搬到新会话 ${新id}（${键}，${复制.length} 个文件）`)
            记('info', `记忆已搬到新会话 ${新id}（${键}）`)
          }
          return
        }
      }
    }

    for (const [键, 记录] of [...待迁移]) {
      try {
        if (!记录 || !记录.cwd || !记录.oldId) {
          待迁移.delete(键)
          continue
        }
        // 超过 3 天还没等到新会话：人可能就没再聊，放弃。
        if (现在 - (Number(记录.at) || 0) > 3 * 24 * 3600 * 1000) {
          待迁移.delete(键)
          continue
        }
        const 状态文件 = join(String(记录.cwd), '..', 'sessions.json')
        if (!existsSync(状态文件)) continue
        const 映射 = JSON.parse(readFileSync(状态文件, 'utf8'))
        const 目标 = 映射 && 映射.sessions ? String(映射.sessions[键] || '') : ''
        if (!目标 || 目标 === String(记录.oldId)) continue
        const 复制 = 迁移记忆({ fromId: String(记录.oldId), toId: 目标, dirs: 配置.memoryDirs })
        待迁移.delete(键)
        存待迁移()
        if (复制.length) {
          留痕(`记忆已搬到新会话 ${目标}（${键}，${复制.length} 个文件）`)
          记('info', `记忆已搬到新会话 ${目标}（${键}）`)
        }
      } catch (错误) {
        记('warn', `处理待迁移记忆失败：${String((错误 && 错误.message) || 错误)}`)
      }
    }
  }

  // ── 按时间：定时扫一遍，老的、安静的、翻过篇的一个不动 ────────────────────
  const 扫一遍 = async () => {
    处理待迁移()
    if (!每日时刻 && 配置.maxAgeHours <= 0) return
    let 列表 = []
    try {
      列表 = typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []
    } catch (错误) {
      记('warn', `列会话失败：${String((错误 && 错误.message) || 错误)}`)
      return
    }
    const 现在 = Date.now()
    for (const session of 列表) {
      try {
        if (!session || !该管这个会话(session)) continue
        const id = String(session.id)
        if (已翻篇.has(id)) continue
        const 状态 = 状态表.get(id) || 取状态(session)
        if (状态.busy) continue

        const 头 = session.header || {}
        const 轮数 = 状态.turns || 数轮数(取事件(session))
        const 公共 = {
          createdAt: Number(头.createdAt) || 0,
          lastActivity: 最后活动(session),
          now: 现在,
          minIdleMinutes: 配置.minIdleMinutes,
          turns: 轮数,
          minTurns: 配置.minTurns,
        }
        const 该翻 = 每日时刻
          ? 应每日翻篇({ ...公共, 时刻: 每日时刻 })
          : 该按时间滚({ ...公共, maxAgeHours: 配置.maxAgeHours })
        if (!该翻) continue
        await 翻篇(session, 每日时刻 ? 'daily' : 'age')
      } catch (错误) {
        记('warn', `扫描单个会话失败：${String((错误 && 错误.message) || 错误)}`)
      }
    }
  }

  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'turn/end') return
        const 状态 = 取状态(session)
        状态.turns += 1
        状态.sinceArchive += 1
        看着这一轮(session)
      } catch (错误) {
        记('warn', `监听会话事件出错：${String((错误 && 错误.message) || 错误)}`)
      }
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch {
        /* ignore */
      }
    }
  }, 'auto-archive: 盯住每个会话的轮数')

  // 桥接建出新会话的那一瞬间就搬记忆，别等 60 秒轮询。
  if (配置.memoryMigrate) {
    ctx.effect(() => {
      const 摘 = ctx.on('session/created', (session) => {
        try {
          处理待迁移(session)
        } catch {
          /* ignore */
        }
        // 桥接写 sessions.json 可能比建会话晚一拍，再补一次。
        const 补 = setTimeout(() => {
          try {
            处理待迁移(session)
          } catch {
            /* ignore */
          }
        }, 1500)
        if (typeof 补.unref === 'function') 补.unref()
      })
      return () => {
        try {
          if (typeof 摘 === 'function') 摘()
        } catch {
          /* ignore */
        }
      }
    }, 'auto-archive: 新会话建好就搬记忆')
  }

  const 要定时 = Boolean(每日时刻) || 配置.maxAgeHours > 0
  if (要定时) {
    ctx.effect(() => {
      const 间隔 = Math.max(1, 配置.checkIntervalMinutes) * 60 * 1000
      // 起来先扫一次：宿主重启后也能把昨天没翻的篇补上。
      const 首扫 = setTimeout(() => {
        void 扫一遍()
      }, 30 * 1000)
      const 定时 = setInterval(() => {
        void 扫一遍()
      }, 间隔)
      return () => {
        clearTimeout(首扫)
        clearInterval(定时)
      }
    }, 'auto-archive: 每天翻篇')
  }

  // 记忆迁移要抢在新会话第一句话之前，所以单独快一点轮询。
  if (配置.memoryMigrate) {
    ctx.effect(() => {
      const 快扫 = setInterval(() => {
        处理待迁移()
      }, 60 * 1000)
      return () => clearInterval(快扫)
    }, 'auto-archive: 搬记忆')
  }

  记(
    'info',
    `已加载（${每日时刻 ? `每天 ${配置.dailyAt} 翻篇` : 配置.maxAgeHours > 0 ? `${配置.maxAgeHours} 小时翻篇` : '按时间关闭'}` +
      `${配置.maxTurns > 0 ? `、${配置.maxTurns} 轮翻篇` : ''}，归档到 ${根目录}${配置.dryRun ? '、dryRun' : ''}）`,
  )
}
