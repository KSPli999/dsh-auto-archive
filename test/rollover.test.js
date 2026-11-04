import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { 迁移记忆 } from '../lib/memory.js'
import { 今天某时刻, 应每日翻篇, 解析每日时刻, 从映射找会话键 } from '../lib/rollover.js'

const 临时 = mkdtempSync(join(tmpdir(), 'dsh-auto-archive-mem-'))
after(() => {
  try {
    rmSync(临时, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('解析每日时刻', () => {
  assert.deepEqual(解析每日时刻('03:00'), { hour: 3, minute: 0 })
  assert.deepEqual(解析每日时刻('3:05'), { hour: 3, minute: 5 })
  assert.equal(解析每日时刻(''), null)
  assert.equal(解析每日时刻('25:00'), null)
  assert.equal(解析每日时刻('夜里三点'), null)
})

test('应每日翻篇：凌晨 3 点之前不动，3 点之后翻前一天的', () => {
  const 时刻 = { hour: 3, minute: 0 }
  const 今天3点 = 今天某时刻(Date.now(), 时刻)
  const 一小时 = 3600 * 1000

  // 3 点之后：昨天建的会话该翻
  assert.equal(
    应每日翻篇({
      createdAt: 今天3点 - 5 * 一小时,
      lastActivity: 今天3点 - 2 * 一小时,
      now: 今天3点 + 1 * 一小时,
      时刻,
      minIdleMinutes: 20,
      turns: 10,
      minTurns: 3,
    }),
    true,
  )

  // 3 点之后：3 点之后新建的不翻
  assert.equal(
    应每日翻篇({
      createdAt: 今天3点 + 10 * 60 * 1000,
      lastActivity: 今天3点 + 30 * 60 * 1000,
      now: 今天3点 + 2 * 一小时,
      时刻,
      minIdleMinutes: 20,
      turns: 10,
      minTurns: 3,
    }),
    false,
  )

  // 3 点之前：哪怕会话很老也不翻
  assert.equal(
    应每日翻篇({
      createdAt: 今天3点 - 30 * 一小时,
      lastActivity: 今天3点 - 10 * 一小时,
      now: 今天3点 - 一小时,
      时刻,
      minIdleMinutes: 20,
      turns: 10,
      minTurns: 3,
    }),
    false,
  )
})

test('应每日翻篇：刚聊完不翻、空会话不翻', () => {
  const 时刻 = { hour: 3, minute: 0 }
  const 今天3点 = 今天某时刻(Date.now(), 时刻)
  assert.equal(
    应每日翻篇({
      createdAt: 今天3点 - 30 * 3600 * 1000,
      lastActivity: 今天3点 + 60 * 1000,
      now: 今天3点 + 2 * 60 * 1000,
      时刻,
      minIdleMinutes: 20,
      turns: 10,
      minTurns: 3,
    }),
    false,
  )
  assert.equal(
    应每日翻篇({ createdAt: 今天3点 - 30 * 3600 * 1000, now: 今天3点 + 3600 * 1000, 时刻, turns: 0 }),
    false,
  )
})

test('迁移记忆：把旧会话的文件复制给新会话，已有的不覆盖', () => {
  const 家 = join(临时, 'home')
  mkdirSync(join(家, 'fish-memory'), { recursive: true })
  writeFileSync(join(家, 'fish-memory', 'session-old.json'), '{"记忆":"旧的"}', 'utf8')

  const 复制 = 迁移记忆({ home: 家, fromId: 'session-old', toId: 'session-new' })
  assert.equal(复制.length, 1)
  assert.equal(readFileSync(join(家, 'fish-memory', 'session-new.json'), 'utf8'), '{"记忆":"旧的"}')

  // 再搬一次：目标已存在，不覆盖
  writeFileSync(join(家, 'fish-memory', 'session-new.json'), '{"记忆":"新的"}', 'utf8')
  assert.equal(迁移记忆({ home: 家, fromId: 'session-old', toId: 'session-new' }).length, 0)
  assert.equal(readFileSync(join(家, 'fish-memory', 'session-new.json'), 'utf8'), '{"记忆":"新的"}')

  // 源不存在 / 同一个 id：什么都不做
  assert.equal(迁移记忆({ home: 家, fromId: 'session-missing', toId: 'session-x' }).length, 0)
  assert.equal(迁移记忆({ home: 家, fromId: 'session-old', toId: 'session-old' }).length, 0)
})

test('从映射找会话键：按 sessionId 反查 QQ 对话', () => {
  const 映射 = {
    'group:2155048136': 'session-a31f',
    'private:3547229536': 'session-69b3',
  }
  assert.equal(从映射找会话键(映射, 'session-69b3'), 'private:3547229536')
  assert.equal(从映射找会话键(映射, 'session-nope'), '')
  assert.equal(从映射找会话键(null, 'session-69b3'), '')
})
