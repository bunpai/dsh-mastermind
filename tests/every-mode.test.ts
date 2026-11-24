/**
 * every-mode 回归测试 —— 进程内模拟 agent/request + tools/result 序列。
 *
 * 背景：v0.2.1 用 payload.step===0 判轮次边界，宿主 step 缺席/1-based 时
 * every 退化成 once（用户实报 bug）。v0.2.2 改 turn 号变化检测。
 * 本测试把两类 step 形状都盖住，防再退。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const planSpy = vi.fn()
vi.mock('../src/plan.js', () => ({
  runOpeningPlan: (...args: unknown[]) => planSpy(...args),
}))
// 锁定探测依赖真实 patch 文件/环境——测试里全放行，让 apply() 的 config
// 参数原样生效（等价于 patch 显式键全量）。
vi.mock('../src/patch-locks.js', () => ({
  maskToLiteralPatch: (x: unknown) => x,
  readPatchLockedPaths: () => [],
}))
// 用户层 settings.json 读真实 HOME 会污染断言——固定空对象。
vi.mock('../src/user-config.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/user-config.js')>()
  return { ...orig, readUserConfigSync: () => ({}) }
})

import { apply } from '../src/index.js'

type Handler = (...args: unknown[]) => unknown

function makeCtx() {
  const handlers = new Map<string, Handler>()
  const ctx = {
    on: (name: string, fn: Handler) => { handlers.set(name, fn); return () => {} },
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    inject: () => {},
    effect: () => {},
    get: () => undefined,
  }
  return { ctx, handlers }
}

const agent = { id: 'sess-1' }
const okResult = { content: [{ type: 'text', text: 'ok' }] }
const next = async () => ({ provider: 'p', model: 'm' })

async function step(handlers: Map<string, Handler>, payload: Record<string, unknown>) {
  await handlers.get('agent/request')!({ agent, ...payload }, next)
  handlers.get('tools/result')!({ agent, name: 'bash', arguments: '{}' }, okResult)
}

function setup(planMode: 'once' | 'every') {
  planSpy.mockClear()
  const { ctx, handlers } = makeCtx()
  apply(ctx as never, { enabled: true, plan: true, planMode, consult: false, followup: false } as never)
  return handlers
}

describe('planMode=once / every 轮次边界', () => {
  it('once：跨 turn 不重置，整会话只问一次计划', async () => {
    const h = setup('once')
    await step(h, { turn: 1, step: 0 })
    await step(h, { turn: 1, step: 1 })
    await step(h, { turn: 2, step: 0 })
    await step(h, { turn: 3, step: 0 })
    expect(planSpy).toHaveBeenCalledTimes(1)
  })

  it('every：turn 号变化即新轮次，每条用户消息问一次', async () => {
    const h = setup('every')
    await step(h, { turn: 1, step: 0 })
    await step(h, { turn: 1, step: 1 })   // 同轮续步，不得重复
    await step(h, { turn: 1, step: 2 })
    await step(h, { turn: 2, step: 0 })   // 新用户消息
    await step(h, { turn: 3, step: 0 })
    expect(planSpy).toHaveBeenCalledTimes(3)
  })

  it('every：step 字段缺席也不退化（turn 兜底生效）', async () => {
    const h = setup('every')
    await step(h, { turn: 1 })            // 无 step
    await step(h, { turn: 1 })
    await step(h, { turn: 2 })
    expect(planSpy).toHaveBeenCalledTimes(2)
  })

  it('every：step 1-based 编码同样成立（0.2.1 的盲区）', async () => {
    const h = setup('every')
    await step(h, { turn: 1, step: 1 })
    await step(h, { turn: 1, step: 2 })
    await step(h, { turn: 2, step: 1 })
    expect(planSpy).toHaveBeenCalledTimes(2)
  })
})
