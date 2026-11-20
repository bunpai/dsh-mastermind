import { describe, expect, it } from 'vitest'
import { AdmissionGate, DedupeStore, describeSuppression, isNoise, normalize, severityDigest } from '../src/guards.js'
import type { GuardConfig } from '../src/config-types.js'

const cfg = (over: Partial<GuardConfig> = {}): GuardConfig => ({ budgetPerTurn: 4, budgetCap: 32, immunityTurns: 3, ...over })

describe('guards 防噪闸（设计 §5）', () => {
  it('normalize：小写 + 折叠非字母数字', () => {
    expect(normalize('  A_B-C!!  ')).toBe('a b c')
  })

  it('isNoise：EN/CN 精确命中，长句不命中', () => {
    expect(isNoise(' LGTM ')).toBe(true)
    expect(isNoise('**Continue**')).toBe(true)
    expect(isNoise('好的')).toBe(true)
    expect(isNoise('嗯')).toBe(true)
    expect(isNoise('please continue with the plan')).toBe(false)
  })

  it('admit 顺序：empty → noise → duplicate → rate-limit', () => {
    const g = new AdmissionGate(cfg())
    expect(g.admit('', 'concern').reason).toBe('empty')
    expect(g.admit('LGTM', 'concern').reason).toBe('noise')
    expect(g.admit('ship it now', 'concern').admitted).toBe(true)
    expect(g.admit('ship it now', 'concern').reason).toBe('duplicate')
  })

  it('升阶复提：concern→blocker 放行，同阶再 duplicate', () => {
    const g = new AdmissionGate(cfg())
    expect(g.admit('the build is red', 'concern').admitted).toBe(true)
    expect(g.admit('the build is red', 'blocker').admitted).toBe(true)
    expect(g.admit('the build is red', 'blocker').reason).toBe('duplicate')
  })

  it('每轮预算 budgetPerTurn：超额 rate-limit；blocker 豁免', () => {
    const g = new AdmissionGate(cfg({ budgetPerTurn: 2 }))
    expect(g.admit('advice one', 'concern').admitted).toBe(true)
    expect(g.admit('advice two', 'concern').admitted).toBe(true)
    expect(g.admit('advice three', 'concern').reason).toBe('rate-limit')
    expect(g.admit('advice four', 'blocker').admitted).toBe(true)
  })

  it('免疫轮 immunityTurns：投递后封锁 N 轮', () => {
    const g = new AdmissionGate(cfg({ budgetPerTurn: 9, budgetCap: 99, immunityTurns: 2 }))
    expect(g.admit('first advice', 'concern').admitted).toBe(true)
    g.beginTurn()
    expect(g.admit('second advice', 'concern').reason).toBe('rate-limit')
    g.beginTurn()
    expect(g.admit('second advice', 'concern').reason).toBe('rate-limit')
    g.beginTurn()
    expect(g.admit('second advice', 'concern').admitted).toBe(true)
  })

  it('blocker 不耗预算、不设免疫', () => {
    const g = new AdmissionGate(cfg({ budgetPerTurn: 1, budgetCap: 1 }))
    expect(g.admit('blocker one', 'blocker').admitted).toBe(true)
    g.beginTurn()
    expect(g.admit('concern one', 'concern').admitted).toBe(true)
    expect(g.admit('concern two', 'blocker').admitted).toBe(true)
  })

  it('会话上限 budgetCap', () => {
    const g = new AdmissionGate(cfg({ budgetPerTurn: 9, budgetCap: 2 }))
    expect(g.admit('x one', 'concern').admitted).toBe(true)
    expect(g.admit('x two', 'concern').admitted).toBe(true)
    expect(g.admit('x three', 'concern').reason).toBe('rate-limit')
  })

  it('DedupeStore：FIFO 淘汰 + 严格升阶才复提', () => {
    const store = new DedupeStore(2)
    store.remember('a', 'nit')
    store.remember('b', 'nit')
    store.remember('c', 'nit')
    expect(store.allows('a', 'nit')).toBe(true)
    expect(store.allows('b', 'nit')).toBe(false)
    expect(store.allows('b', 'concern')).toBe(true)
  })

  it('severityDigest：归一化摘要', () => {
    expect(severityDigest('Fix `config.TS`!')).toBe(severityDigest('fix config ts'))
  })

  it('describeSuppression：四种压制原因都有人话回执', () => {
    for (const reason of ['empty', 'noise', 'duplicate', 'rate-limit'] as const) {
      const text = describeSuppression(reason)
      expect(typeof text).toBe('string')
      expect(text.length > 4).toBe(true)
    }
  })
})
