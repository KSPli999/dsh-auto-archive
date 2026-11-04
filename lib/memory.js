// 把旧会话的「记忆」文件搬到新会话名下。
//
// dsh-fish-memory 这类插件是按 session id 存一份 json 的：换了窗口就从零开始。
// 换窗口的那一瞬间把文件复制一份过去，新窗口就接着记得。

import { copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** DSH 家目录。 */
export function 家目录() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * @param {object} 选项
 * @param {string} 选项.fromId 旧会话 id
 * @param {string} 选项.toId   新会话 id
 * @param {string[]} [选项.dirs] 家目录下的子目录，默认只搬 fish-memory
 * @param {string} [选项.home]  DSH 家目录，默认自动取
 * @returns {string[]} 实际复制出来的文件
 */
export function 迁移记忆({ fromId, toId, dirs = ['fish-memory'], home = 家目录() }) {
  if (!fromId || !toId || String(fromId) === String(toId)) return []
  const 复制了 = []
  for (const 子 of dirs || []) {
    if (!子) continue
    const 目录 = join(home, String(子))
    const 源 = join(目录, `${fromId}.json`)
    const 目标 = join(目录, `${toId}.json`)
    try {
      if (!existsSync(源) || existsSync(目标)) continue
      copyFileSync(源, 目标)
      复制了.push(目标)
    } catch {
      /* 单个目录失败不影响别的 */
    }
  }
  return 复制了
}
