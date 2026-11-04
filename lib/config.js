// 配置读取：插件行里的 config 优先，其次是 ~/.dsh/auto-archive.json，最后是默认值。
// 不声明 schemastery Config —— 这个包不想为了一个表单把「能不能加载」赌在一个 import 上。

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const 默认配置 = Object.freeze({
  /** 总开关。 */
  enabled: true,
  /** 一个会话活过多少小时就翻篇（0 = 关掉按时间触发）。 */
  maxAgeHours: 24,
  /** 至少安静多少分钟才动手，别在人家正聊着的时候把窗口换掉。 */
  minIdleMinutes: 20,
  /** 多久扫一次（分钟）。 */
  checkIntervalMinutes: 10,
  /** 一个会话累计到多少轮就归档（0 = 关掉按轮数触发）。 */
  maxTurns: 0,
  /** 归档里保留最近几轮原文。 */
  keepTail: 12,
  /** 归档正文上限（字符）。 */
  maxChars: 12000,
  /** 交接便条上限（字符）。 */
  handoffChars: 900,
  /** 归档目录；空 = <DSH_HOME>/auto-archive。 */
  archiveDir: '',
  /** 归档完要不要顺手建一个新会话。 */
  newSession: true,
  /** QQ 桥接的会话：归档后让桥接把映射作废，下一条消息它自己开新会话。 */
  bridgeReset: true,
  /** 建了新会话后，要不要把交接便条作为一条消息投进去（会触发一次模型调用，默认关）。 */
  handoffPrompt: false,
  /** 一个会话只归档一次；false = 每再涨 maxTurns 轮就再归档一次。 */
  oncePerSession: true,
  /** 轮数太少的不动（防止空会话被归档）。 */
  minTurns: 3,
  /** 路径里命中这些片段的会话不碰；默认全都管（子代理另有判断）。 */
  excludeCwd: [],
  /** 只处理这些工作目录下的会话；空 = 不限。 */
  includeCwd: [],
  /** 只归档、不建会话（试运行用）。 */
  dryRun: false,
})

export function 配置路径() {
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(家, 'auto-archive.json')
}

export function 归档根目录(配置 = 默认配置) {
  if (配置 && 配置.archiveDir) return String(配置.archiveDir)
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(家, 'auto-archive')
}

/** 读配置文件；文件不存在 / 写坏了都安静地退回默认值。 */
export function 读配置档案() {
  const 路径 = 配置路径()
  try {
    if (!existsSync(路径)) return {}
    const 原文 = readFileSync(路径, 'utf8')
    const 解析 = JSON.parse(原文)
    return 解析 && typeof 解析 === 'object' && !Array.isArray(解析) ? 解析 : {}
  } catch {
    return {}
  }
}

function 是布尔(v) {
  return typeof v === 'boolean'
}

function 是正整数(v, 最小值 = 1) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 最小值
}

function 是非负数(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** 把乱七八糟的输入洗成一份能用的配置。 */
export function 归一化配置(...来源) {
  const 结果 = { ...默认配置 }
  for (const 层 of 来源) {
    if (!层 || typeof 层 !== 'object' || Array.isArray(层)) continue
    if (是布尔(层.enabled)) 结果.enabled = 层.enabled
    if (是非负数(层.maxAgeHours)) 结果.maxAgeHours = 层.maxAgeHours
    if (是非负数(层.minIdleMinutes)) 结果.minIdleMinutes = Math.floor(层.minIdleMinutes)
    if (是正整数(层.checkIntervalMinutes, 1)) 结果.checkIntervalMinutes = Math.floor(层.checkIntervalMinutes)
    if (是非负数(层.maxTurns)) 结果.maxTurns = Math.floor(层.maxTurns)
    if (是布尔(层.bridgeReset)) 结果.bridgeReset = 层.bridgeReset
    if (是正整数(层.keepTail, 1)) 结果.keepTail = Math.floor(层.keepTail)
    if (是正整数(层.maxChars, 1000)) 结果.maxChars = Math.floor(层.maxChars)
    if (是正整数(层.handoffChars, 100)) 结果.handoffChars = Math.floor(层.handoffChars)
    if (是正整数(层.minTurns, 1)) 结果.minTurns = Math.floor(层.minTurns)
    if (typeof 层.archiveDir === 'string') 结果.archiveDir = 层.archiveDir.trim()
    if (是布尔(层.newSession)) 结果.newSession = 层.newSession
    if (是布尔(层.handoffPrompt)) 结果.handoffPrompt = 层.handoffPrompt
    if (是布尔(层.oncePerSession)) 结果.oncePerSession = 层.oncePerSession
    if (是布尔(层.dryRun)) 结果.dryRun = 层.dryRun
    if (Array.isArray(层.excludeCwd)) {
      结果.excludeCwd = 层.excludeCwd.map((x) => String(x)).filter(Boolean)
    }
    if (Array.isArray(层.includeCwd)) {
      结果.includeCwd = 层.includeCwd.map((x) => String(x)).filter(Boolean)
    }
  }
  return 结果
}

function 统一斜杠(s) {
  return String(s || '').replace(/\\/g, '/')
}

/** 这个工作目录要不要管。 */
export function 该管这个目录(cwd, 配置) {
  const 路径 = 统一斜杠(cwd)
  if (!路径) return true
  for (const 片段 of 配置.excludeCwd || []) {
    if (片段 && 路径.includes(统一斜杠(片段))) return false
  }
  const 只这些 = 配置.includeCwd || []
  if (只这些.length) return 只这些.some((片段) => 路径.includes(统一斜杠(片段)))
  return true
}
