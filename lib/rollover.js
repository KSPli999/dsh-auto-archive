// 「这一天该翻篇了吗」的判断、「桥接里这条对话是谁」的反查、
// 「凌晨几点算新的一天」的解析 —— 都是纯函数，方便单独测。

/** 一小时多少毫秒。 */
export const 一小时 = 3600 * 1000

/** 把 "03:00" / "3:00" 解析成 { hour, minute }；写坏了返回 null。 */
export function 解析每日时刻(文) {
  const s = String(文 == null ? '' : 文).trim()
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!(hour >= 0 && hour <= 23) || !(minute >= 0 && minute <= 59)) return null
  return { hour, minute }
}

/** 今天那个时刻（本地时间）的毫秒数。 */
export function 今天某时刻(now, 时刻) {
  const { hour, minute } = 时刻
  const d = new Date(Number(now) || Date.now())
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/**
 * 这个会话该不该按「每天几点」翻篇。
 *
 * 规则：到了今天的那个点之后，把「在那之前建的、已经安静的」会话翻掉。
 * 这样每天只在那个点之后统一翻一次，不用管宿主中途有没有重启 / 睡过去。
 *
 * @param {object} 输入
 * @param {number} 输入.createdAt
 * @param {number} 输入.lastActivity
 * @param {number} 输入.now
 * @param {{hour:number, minute:number}} 输入.时刻
 * @param {number} 输入.minIdleMinutes
 * @param {number} 输入.turns
 * @param {number} 输入.minTurns
 */
export function 应每日翻篇(输入) {
  const {
    createdAt = 0,
    lastActivity = 0,
    now = Date.now(),
    时刻,
    minIdleMinutes = 20,
    turns = 0,
    minTurns = 3,
  } = 输入 || {}
  if (!时刻 || !createdAt) return false
  if (turns < minTurns) return false
  const 分界 = 今天某时刻(now, 时刻)
  // 今天那个点还没到：今天还没到翻篇的时候。
  if (now < 分界) return false
  // 只翻「分界之前就存在」的会话；分界之后新建的属于新的一天。
  if (createdAt >= 分界) return false
  const 安静 = now - (lastActivity || createdAt)
  return 安静 >= minIdleMinutes * 60 * 1000
}

/**
 * 旧的时间规则（会话活过 N 小时就翻），保留给想用「滚动窗口」的人。
 */
export function 该按时间滚(输入) {
  const {
    createdAt = 0,
    lastActivity = 0,
    now = Date.now(),
    maxAgeHours = 24,
    minIdleMinutes = 20,
    turns = 0,
    minTurns = 3,
  } = 输入 || {}
  if (!(maxAgeHours > 0)) return false
  if (!createdAt || now - createdAt < maxAgeHours * 一小时) return false
  if (turns < minTurns) return false
  const 安静 = now - (lastActivity || createdAt)
  return 安静 >= minIdleMinutes * 60 * 1000
}

/**
 * 在桥接的 `sessions` 映射里反查：这个 DSH 会话对应哪条 QQ 对话。
 *
 * @param {Record<string, string>} 映射  state/sessions.json 里的 sessions
 * @param {string} sessionId
 * @returns {string} 形如 `group:123` / `private:456`；找不到返回空串
 */
export function 从映射找会话键(映射, sessionId) {
  if (!映射 || typeof 映射 !== 'object' || !sessionId) return ''
  for (const [键, 值] of Object.entries(映射)) {
    if (String(值) === String(sessionId)) return String(键)
  }
  return ''
}
