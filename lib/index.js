// dsh-auto-archive · 宿主半边
//
// 一件事：一个会话聊得太长了，就把关键内容落成一份 Markdown 归档，
// 再给它开一个干净的新会话 —— 上下文别一直滚雪球，token 才不会一路烧。
//
// 设计上的几条硬规矩：
//   1. 归档**不调模型**。所有东西都是从会话日志里规则化抽出来的，省 token 的事不能先花 token。
//   2. 只在 turn/end 之后动手，绝不打断正在进行的一轮。
//   3. 子代理会话不碰（它们的会话 id 另有主人）；要排除别的目录就配 excludeCwd。
//   4. 任何一步失败都只记一笔，不让插件把宿主拖下水。

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { 归档根目录, 该管这个目录, 归一化配置, 读配置档案 } from './config.js'
import { 时间戳, 数轮数, 造归档 } from './digest.js'

export const name = 'auto-archive'
export const inject = ['sessions']

const 事件类型 = new Set(['turn/end'])

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

  const 归档 = async (session, 状态) => {
    if (状态.busy) return
    状态.busy = true
    try {
      const 事件 = 取事件(session)
      const 轮数 = 数轮数(事件)
      const cwd = session.header && session.header.cwd ? String(session.header.cwd) : ''
      const 现在 = Date.now()
      const 子目录 = join(根目录, 目录名(cwd))
      const 文件名 = `${时间戳(现在)}-${安全文件名(session.id)}.md`
      const 完整路径 = join(子目录, 文件名)

      const { markdown, handoff, topic } = 造归档({
        sessionId: String(session.id),
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

      let 新会话 = ''
      let 错误 = ''
      if (!配置.dryRun && 配置.newSession) {
        try {
          新会话 = await 挑新会话(session, cwd, handoff)
        } catch (e) {
          错误 = String((e && e.message) || e)
          记('warn', `新建会话失败：${错误}`)
        }
      }

      记账({
        at: new Date(现在).toISOString(),
        sessionId: String(session.id),
        cwd,
        turns: 轮数,
        topic,
        archive: 完整路径,
        newSession: 新会话 || undefined,
        dryRun: 配置.dryRun || undefined,
        error: 错误 || undefined,
      })
      留痕(
        `已归档 ${session.id}（${轮数} 轮）→ ${完整路径}` +
          (配置.dryRun ? '（dryRun：没有建新会话）' : 新会话 ? `；新会话 ${新会话}` : '；没有建新会话'),
      )
      记('info', `已归档 ${session.id}（${轮数} 轮）→ ${完整路径}${新会话 ? `，新会话 ${新会话}` : ''}`)

      状态.archived = true
      状态.archivedAt = 现在
      状态.sinceArchive = 0
    } catch (错误) {
      记('warn', `归档失败：${String((错误 && 错误.message) || 错误)}`)
    } finally {
      状态.busy = false
    }
  }

  const 看着这一轮 = (session) => {
    try {
      if (!session) return
      const 头 = session.header || {}
      if (头.origin === 'subagent') return
      if (typeof 头.delegationDepth === 'number' && 头.delegationDepth > 0) return
      const cwd = 头.cwd ? String(头.cwd) : ''
      if (!该管这个目录(cwd, 配置)) return

      const 状态 = 取状态(session)
      if (状态.turns < 配置.minTurns) return
      if (状态.busy) return

      const 该动手 = 状态.archived
        ? !配置.oncePerSession && 状态.sinceArchive >= 配置.maxTurns
        : 状态.turns >= 配置.maxTurns
      if (!该动手) return

      // 不在这条同步回调里做 IO：等这一轮的事件分发走完再说。
      queueMicrotask(() => {
        void 归档(session, 状态)
      })
    } catch (错误) {
      记('warn', `判断是否归档时出错：${String((错误 && 错误.message) || 错误)}`)
    }
  }

  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        if (!event || !事件类型.has(event.type)) return
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

  记(
    'info',
    `已加载（${配置.maxTurns} 轮触发、归档到 ${根目录}${配置.dryRun ? '、dryRun' : ''}）`,
  )
}
