import assert from 'node:assert/strict'
import { test } from 'node:test'

import { 命中色色, 该用什么强度, 默认词表 } from '../lib/effort.js'

test('命中色色：明确的词算，日常话不算', () => {
  assert.equal(命中色色('今天好想你'), false)
  assert.equal(命中色色('晚上吃什么'), false)
  assert.equal(命中色色('想和你做爱'), true)
  assert.equal(命中色色('宝贝 涩涩 一下'), true)
  assert.equal(命中色色('', 默认词表), false)
  assert.equal(命中色色(null, 默认词表), false)
})

test('命中色色：自定义词表覆盖默认', () => {
  assert.equal(命中色色('来点特别的', ['特别的']), true)
  assert.equal(命中色色('来点特别的', 默认词表), false)
})

test('该用什么强度：热度内 high，过了回 normal', () => {
  const 档位 = { normal: 'low', hot: 'high' }
  const 现在 = 1_800_000_000_000
  assert.equal(该用什么强度({ until: 现在 + 60_000, applied: 'high' }, 现在, 档位), 'high')
  assert.equal(该用什么强度({ until: 现在 - 1, applied: 'high' }, 现在, 档位), 'low')
  assert.equal(该用什么强度({ applied: 'low' }, 现在, 档位), 'low')
  assert.equal(该用什么强度(undefined, 现在, 档位), 'low')
})
