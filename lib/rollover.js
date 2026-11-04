// 「这一天该翻篇了吗」的判断，和「桥接里这条对话是谁」的反查。
// 都是纯函数：不读盘、不发请求，方便单独测。

/** 一天多少毫秒。 */
export const 一小时 = 3600 * 1000

/**
 * 这个会话该不该按时间滚到下一个窗口。
 *
 * @param {object} 输入
 * @param {number} 输入.createdAt     会话创建时间（ms）
 * @param {number} 输入.lastActivity  最后一次活动时间（ms）
 * @param {number} 输入.now           现在
 * @param {number} 输入.maxAgeHours   超过多少小时算老
 * @param {number} 输入.minIdleMinutes 至少安静多少分钟才动手（别在人家正聊着的时候换）
 * @param {number} [输入.turns]       轮数，太少的（空会话）不滚
 * @param {number} [输入.minTurns]
 * @returns {boolean}
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
