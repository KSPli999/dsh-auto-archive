// 「这句算不算在色色」的判断。纯函数，方便单独调、单独测。
//
// 规则很简单：中文里那种话基本绕不开那些词；命中就直接把思考强度拉上去。
// 宁可多开一会儿（热度会自己衰减），也别在该想的时候想不动。

/** 默认的「色色」关键词。都是明确的词，尽量不误伤日常聊天。 */
export const 默认词表 = Object.freeze([
  '色色', '涩涩', '搞色', '做爱', '做愛', '操你', '干你', '插你', '插进', '射',
  '高潮', '呻吟', '抽插', '龟头', '骚', '发情', '欲望', '硬了', '湿了', '勃起',
  '舔', '含住', '脱光', '脱掉', '裸体', '全裸', '胸', '乳头', '屁股', '大腿根',
  '内裤', '情趣', '调教', '捆', '绑起来', '舔弄', '吻遍', '顶到', '进到里面', '里面好',
  '想要你', '要你', '抱我', '上我', '摸我', '舔我', '亲我', '进来', '慢一点', '深一点',
])

/** 一句话里有没有色色的意思。 */
export function 命中色色(文字, 词表 = 默认词表) {
  const 文 = String(文字 == null ? '' : 文字).toLowerCase().replace(/\s+/g, '')
  if (!文) return false
  for (const 词 of 词表 || []) {
    const 小 = String(词 || '').toLowerCase()
    if (小 && 文.includes(小)) return true
  }
  return false
}

/**
 * 这份热度该用什么强度：到点之前 high，过了 decay 就回 normal。
 * @param {object} 状态 { until:number, applied:string }
 * @param {number} now
 * @param {{normal:string, hot:string}} 档位
 */
export function 该用什么强度(状态, now, 档位) {
  const 现在 = Number(now) || Date.now()
  if (状态 && 状态.until && 现在 < Number(状态.until)) return 档位.hot
  return 档位.normal
}
