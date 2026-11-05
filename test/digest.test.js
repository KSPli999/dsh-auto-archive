import assert from 'node:assert/strict'
import { test } from 'node:test'

import { 归一化配置, 该管这个目录 } from '../lib/config.js'
import { 取主题, 取消息, 取文字, 数轮数, 收对话, 造归档 } from '../lib/digest.js'

function 用户(text, time = 1) {
  // 真实 DSH 里 user/message 的 data 就是消息本身（扁平），不是 { message }。
  return { type: 'user/message', seq: time, time, data: { role: 'user', content: [{ type: 'text', text }] } }
}

function 助手(text, time = 1) {
  return {
    type: 'assistant/message',
    seq: time,
    time,
    data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: '想一下' }, { type: 'text', text }] } },
  }
}

function 一轮(turn, 问, 答) {
  return [
    { type: 'turn/start', data: { turn } },
    用户(问, turn * 10),
    助手(答, turn * 10 + 1),
    { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  ]
}

test('取消息：用户扁平、助手嵌套，两种都认', () => {
  const 扁平 = { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '你说呢' }] } }
  const 嵌套 = {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: '在呢' }] } },
  }
  assert.equal(取文字(取消息(扁平)), '你说呢')
  assert.equal(取文字(取消息(嵌套)), '在呢')
  assert.equal(取消息(null), null)
})

test('数轮数只数 turn/end', () => {
  const 事件 = [...一轮(1, '你好', '在呢'), ...一轮(2, '吃了吗', '刚吃完'), { type: 'turn/start', data: { turn: 3 } }]
  assert.equal(数轮数(事件), 2)
})

test('取文字只留 text 段', () => {
  assert.equal(取文字({ content: [{ type: 'text', text: '甲' }, { type: 'tool-call', name: 'x' }, { type: 'text', text: '乙' }] }), '甲\n乙')
  assert.equal(取文字({ content: '直接是字符串' }), '直接是字符串')
  assert.equal(取文字(null), '')
})

test('收对话从第 keepTail 条用户消息切开，不会半句起头', () => {
  const 事件 = [...一轮(1, 'q1', 'a1'), ...一轮(2, 'q2', 'a2'), ...一轮(3, 'q3', 'a3')]
  const 对话 = 收对话(事件, 2)
  assert.deepEqual(
    对话.map((条) => 条.text),
    ['q2', 'a2', 'q3', 'a3'],
  )
})

test('主题取第一句用户的话', () => {
  const 事件 = [...一轮(1, '帮我写个插件', '好'), ...一轮(2, '顺便提交', '行')]
  assert.equal(取主题(事件), '帮我写个插件')
})

test('造归档：有轮数、主题、节选和交接便条', () => {
  const 事件 = [...一轮(1, '帮我写个插件', '好'), ...一轮(2, '顺便提交到 git', '行')]
  const { markdown, handoff, topic } = 造归档({
    sessionId: 'session-1',
    cwd: 'C:\\work\\demo',
    turns: 2,
    events: 事件,
    keepTail: 5,
    now: Date.UTC(2026, 10, 4, 5, 0, 0),
    archivePath: 'C:\\archive\\demo.md',
  })
  assert.equal(topic, '帮我写个插件')
  assert.match(markdown, /累计轮数：2/)
  assert.match(markdown, /帮我写个插件/)
  assert.match(markdown, /顺便提交到 git/)
  assert.doesNotMatch(markdown, /想一下/)
  assert.match(handoff, /上一段会话/)
  assert.match(handoff, /C:\\archive\\demo\.md/)
})

test('造归档会截断过长的正文和便条', () => {
  const 长 = 'x'.repeat(5000)
  const 事件 = [...一轮(1, 长, 长)]
  const { markdown, handoff } = 造归档({
    sessionId: 's',
    turns: 1,
    events: 事件,
    maxChars: 600,
    handoffChars: 200,
  })
  assert.ok(markdown.length <= 600)
  assert.match(markdown, /后面的内容已省略/)
  assert.ok(handoff.length <= 201)
})

test('配置归一化：坏值退回默认，好值保留', () => {
  const 配置 = 归一化配置({ maxTurns: 12, keepTail: -1, newSession: false, excludeCwd: ['x'] })
  assert.equal(配置.maxTurns, 12)
  assert.equal(配置.keepTail, 12) // -1 不合法，退回默认值
  assert.equal(配置.newSession, false)
  assert.deepEqual(配置.excludeCwd, ['x'])
})

test('该管这个目录：能按 excludeCwd / includeCwd 过滤', () => {
  const 配置 = 归一化配置({})
  assert.equal(该管这个目录('C:\\dfy-deploy\\dafeiyu\\qq-bridge\\state\\agents', 配置), true)
  assert.equal(该管这个目录('C:\\dfy-deploy\\dsh-auto-archive', 配置), true)
  assert.equal(该管这个目录('', 配置), true)
  assert.equal(
    该管这个目录('C:\\dfy-deploy\\dafeiyu\\qq-bridge\\state\\agents', 归一化配置({ excludeCwd: ['qq-bridge'] })),
    false,
  )
  assert.equal(该管这个目录('C:\\a\\b', 归一化配置({ includeCwd: ['C:\\a'] })), true)
  assert.equal(该管这个目录('C:\\x\\y', 归一化配置({ includeCwd: ['C:\\a'] })), false)
})
