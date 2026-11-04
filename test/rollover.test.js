import assert from 'node:assert/strict'
import { test } from 'node:test'

import { 从映射找会话键, 该按时间滚, 一小时 } from '../lib/rollover.js'

const 现在 = 1_800_000_000_000

test('该按时间滚：不到 24 小时不动', () => {
  assert.equal(
    该按时间滚({
      createdAt: 现在 - 20 * 一小时,
      lastActivity: 现在 - 40 * 60 * 1000,
      now: 现在,
      maxAgeHours: 24,
      minIdleMinutes: 20,
      turns: 30,
    }),
    false,
  )
})

test('该按时间滚：超过 24 小时且安静够了才滚', () => {
  assert.equal(
    该按时间滚({
      createdAt: 现在 - 25 * 一小时,
      lastActivity: 现在 - 30 * 60 * 1000,
      now: 现在,
      maxAgeHours: 24,
      minIdleMinutes: 20,
      turns: 30,
    }),
    true,
  )
})

test('该按时间滚：刚聊完不滚（别打断人家）', () => {
  assert.equal(
    该按时间滚({
      createdAt: 现在 - 30 * 一小时,
      lastActivity: 现在 - 2 * 60 * 1000,
      now: 现在,
      maxAgeHours: 24,
      minIdleMinutes: 20,
      turns: 30,
    }),
    false,
  )
})

test('该按时间滚：空会话不滚；maxAgeHours=0 等于关掉', () => {
  assert.equal(
    该按时间滚({ createdAt: 现在 - 40 * 一小时, lastActivity: 现在 - 60 * 60 * 1000, now: 现在, turns: 0 }),
    false,
  )
  assert.equal(
    该按时间滚({
      createdAt: 现在 - 40 * 一小时,
      lastActivity: 现在 - 60 * 60 * 1000,
      now: 现在,
      maxAgeHours: 0,
      turns: 30,
    }),
    false,
  )
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
