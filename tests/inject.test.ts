import { describe, expect, it } from 'vitest'
import { ADVICE_SOURCE_KIND, advisorNotice, deliverAdvice } from '../src/inject.js'

describe('inject 投递通道（设计 §7/R3 降级）', () => {
  it('advisorNotice：notice 标记 + summary 上限', () => {
    const m = advisorNotice('the advice body', 'short summary') as unknown as { source: { kind: string; form: string; summary: string } }
    expect(m.source.kind).toBe(ADVICE_SOURCE_KIND)
    expect(m.source.form).toBe('notice')
    expect(m.source.summary.length <= 120).toBe(true)
  })

  it('deliverAdvice：STOP→steer；ADJUST/PLAN→inject', () => {
    const mk = () => {
      const calls: string[] = []
      return {
        calls,
        steer: () => { calls.push('steer') },
        inject: () => { calls.push('inject') },
      }
    }
    const a1 = mk()
    expect(deliverAdvice(a1 as never, 'STOP', 'hand back to user', 's')).toBe(true)
    expect(a1.calls).toEqual(['steer'])
    const a2 = mk()
    expect(deliverAdvice(a2 as never, 'ADJUST', 'tweak it', 's')).toBe(true)
    expect(a2.calls).toEqual(['inject'])
    const a3 = mk()
    expect(deliverAdvice(a3 as never, 'PLAN', 'steps', 's')).toBe(true)
    expect(a3.calls).toEqual(['inject'])
  })

  it('deliverAdvice：宿主接口异常 → 吞成 false 不炸 turn', () => {
    const bad = { steer: () => { throw new Error('boom') }, inject: () => { throw new Error('boom') } }
    expect(deliverAdvice(bad as never, 'ADJUST', 't', 's')).toBe(false)
  })
})
