import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, resolveAdvisorSelection, selectionLabel } from '../src/config.js'

describe('config 旋钮（设计 §2/§7）', () => {
  it('DEFAULT_CONFIG：QwenPaw 默认阈值精确', () => {
    expect(DEFAULT_CONFIG.trigger).toEqual({ consecutive: 3, windowSize: 10, windowFires: 4, cooldown: 0, maxInterventions: 3 })
    expect(DEFAULT_CONFIG.guards).toEqual({ budgetPerTurn: 4, budgetCap: 32, immunityTurns: 3 })
    expect(DEFAULT_CONFIG.plan).toBe(true)
    expect(DEFAULT_CONFIG.followup).toBe(true)
    expect(DEFAULT_CONFIG.consult).toBe(true)
    expect(DEFAULT_CONFIG.advisorProvider).toBe('')
    expect(DEFAULT_CONFIG.advisorModel).toBe('')
    expect(DEFAULT_CONFIG.advisorEffort).toBe('')
  })

  it('mergeConfig：两层深合并', () => {
    const c = mergeConfig({ trigger: { consecutive: 5 } })
    expect(c.trigger.consecutive).toBe(5)
    expect(c.trigger.windowSize).toBe(10)
    expect(c.guards.budgetPerTurn).toBe(4)
    expect(c.enabled).toBe(true)
  })

  it('resolveAdvisorSelection：双槽全填才生效', () => {
    expect(resolveAdvisorSelection(DEFAULT_CONFIG)).toBeUndefined()
    expect(resolveAdvisorSelection(mergeConfig({ advisorProvider: 'x' }))).toBeUndefined()
    const s = resolveAdvisorSelection(mergeConfig({ advisorProvider: 'x', advisorModel: 'y' }))
    expect(s?.provider).toBe('x')
    expect(s?.model).toBe('y')
    expect(s?.effort).toBeUndefined()
    const s2 = resolveAdvisorSelection(mergeConfig({ advisorProvider: 'x', advisorModel: 'y', advisorEffort: 'high' }))
    expect(s2?.effort).toBe('high')
  })

  it('selectionLabel：格式', () => {
    expect(selectionLabel({ provider: 'p', model: 'm' })).toBe('p/m')
    expect(selectionLabel({ provider: 'p', model: 'm', effort: 'high' })).toContain('p/m')
  })
})
