import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// config.js 在调用时才读 DSH_HOME，所以这里先指到临时目录，避免碰到真实的 ~/.dsh。
const 沙箱 = mkdtempSync(join(tmpdir(), 'dsh-auto-archive-'))
process.env.DSH_HOME = 沙箱
mkdirSync(join(沙箱, 'auto-archive'), { recursive: true })

const { apply } = await import('../lib/index.js')

function 建事件(轮数) {
  const 事件 = []
  for (let i = 1; i <= 轮数; i += 1) {
    事件.push(
      { type: 'turn/start', seq: 事件.length + 1, time: i * 10, data: { turn: i } },
      {
        type: 'user/message',
        seq: 事件.length + 1,
        time: i * 10,
        data: { message: { role: 'user', content: [{ type: 'text', text: `第 ${i} 个问题` }] } },
      },
      {
        type: 'assistant/message',
        seq: 事件.length + 1,
        time: i * 10 + 1,
        data: { message: { role: 'assistant', content: [{ type: 'text', text: `第 ${i} 个回答` }] } },
      },
      { type: 'turn/end', seq: 事件.length + 1, time: i * 10 + 2, data: { turn: i } },
    )
  }
  return 事件
}

function 建沙盒(轮数, 配置 = {}) {
  // 每个用例都当成全新进程：清掉「已翻篇」的持久记录，隔离测试。
  rmSync(join(沙箱, 'auto-archive', 'rolled.json'), { force: true })
  const 事件 = 建事件(轮数)
  const session = {
    id: 'session-9',
    header: { cwd: 'C:/work/demo' },
    seq: 事件.length,
    snapshotEvents: () => 事件,
  }
  let 回调 = null
  const 新会话 = []
  const 投递 = []
  const ctx = {
    logger: { info() {}, warn() {} },
    effect: (工厂) => {
      工厂()
      return () => {}
    },
    on: (名字, 回调函数) => {
      回调 = 回调函数
      return () => {}
    },
    get: (名字) =>
      名字 === 'sessionController'
        ? {
            create: async (请求) => {
              新会话.push(请求)
              return { sessionId: 'session-new' }
            },
            prompt: async (请求) => {
              投递.push(请求)
            },
          }
        : undefined,
  }
  apply(ctx, {
    dailyAt: '',
    maxAgeHours: 0,
    memoryMigrate: false,
    newSession: true,
    effort: { enabled: false },
    ...配置,
  })
  return { session, 触发: () => 回调(session, { type: 'turn/end', data: {} }), 新会话, 投递 }
}

async function 等一等() {
  await new Promise((完成) => setTimeout(完成, 30))
}

after(() => {
  try {
    rmSync(沙箱, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('到阈值时归档并建新会话', async () => {
  const 沙盒 = 建沙盒(2, { maxTurns: 2, minTurns: 1 })
  沙盒.触发()
  await 等一等()

  assert.equal(沙盒.新会话.length, 1)
  assert.equal(沙盒.新会话[0].cwd, 'C:/work/demo')

  const 索引 = readFileSync(join(沙箱, 'auto-archive', 'index.jsonl'), 'utf8').trim().split('\n')
  const 记录 = JSON.parse(索引[索引.length - 1])
  assert.equal(记录.sessionId, 'session-9')
  assert.equal(记录.newSession, 'session-new')
  assert.ok(existsSync(记录.archive), `归档文件应存在：${记录.archive}`)
  const 正文 = readFileSync(记录.archive, 'utf8')
  assert.match(正文, /第 2 个问题/)
})

test('同一个会话只归档一次', async () => {
  const 沙盒 = 建沙盒(1, { maxTurns: 1, minTurns: 1 })
  for (let i = 0; i < 4; i += 1) {
    沙盒.触发()
    await 等一等()
  }
  assert.equal(沙盒.新会话.length, 1)
})

test('轮数不够不动', async () => {
  const 沙盒 = 建沙盒(5, { maxTurns: 10, minTurns: 3 })
  for (let i = 0; i < 3; i += 1) {
    沙盒.触发()
    await 等一等()
  }
  assert.equal(沙盒.新会话.length, 0)
})

test('子代理会话不碰', async () => {
  const 沙盒 = 建沙盒(5, { maxTurns: 1, minTurns: 1 })
  const 原子代理 = 沙盒.session.header.origin
  沙盒.session.header.origin = 'subagent'
  for (let i = 0; i < 3; i += 1) {
    沙盒.触发()
    await 等一等()
  }
  assert.equal(沙盒.新会话.length, 0)
  沙盒.session.header.origin = 原子代理
})

test('dryRun 只归档不建会话', async () => {
  const 沙盒 = 建沙盒(1, { maxTurns: 1, minTurns: 1, dryRun: true })
  沙盒.触发()
  await 等一等()
  assert.equal(沙盒.新会话.length, 0)
})
