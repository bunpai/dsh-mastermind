import { describe, expect, it } from 'vitest'
import { applyLayer, composeConfig, lockedPaths } from '../src/user-config.js'
import { DEFAULT_CONFIG } from '../src/config.js'

describe('user-config 三层合成', () => {
  it('组合层胜出用户层', () => {
    const c = composeConfig({ advisorModel: 'a', trigger: { consecutive: 5 } }, { advisorModel: 'b' })
    expect(c.advisorModel).toBe('b')
    expect(c.trigger.consecutive).toBe(5) // patch 未写 → 用户层生效
    expect(c.enabled).toBe(true)
  })
  it('undefined 键不覆盖基线', () => {
    const c = applyLayer(DEFAULT_CONFIG, { enabled: undefined, followup: false })
    expect(c.enabled).toBe(true)
    expect(c.followup).toBe(false)
  })
  it('lockedPaths 报叶子路径', () => {
    const locked = lockedPaths({ enabled: true, trigger: { consecutive: 3 }, advisorModel: 'x' })
    expect(locked).toContain('enabled')
    expect(locked).toContain('trigger.consecutive')
    expect(locked).toContain('advisorModel')
    expect(locked).not.toContain('plan')
  })
})
