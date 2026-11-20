import { describe, expect, it } from 'vitest'
import { Trigger } from '../src/trigger.js'
import type { TriggerConfig } from '../src/config-types.js'
import type { FailureRecord } from '../src/signals.js'

const cfg = (over: Partial<TriggerConfig> = {}): TriggerConfig => ({
  consecutive: 3, windowSize: 10, windowFires: 4, cooldown: 0, maxInterventions: 3, ...over,
})
const fail = (key: string): FailureRecord => ({ name: 'bash', argsKey: 'bash:' + key, label: 'bash-exit' })
const F = (key: string) => ({ ok: false, failure: fail(key) })
const OK = { ok: true }

describe('Trigger 阈值（设计 §3）', () => {
  it('consecutive：3 连击 fire，单 argsKey → stuck', () => {
    const t = new Trigger(cfg())
    expect(t.update([F('a')]).fired).toBe(false)
    expect(t.update([F('a')]).fired).toBe(false)
    const d = t.update([F('a')])
    expect(d.fired).toBe(true)
    expect(d.mode).toBe('stuck')
    expect(d.failures).toHaveLength(3)
  })

  it('consecutive：中途成功打断清零', () => {
    const t = new Trigger(cfg({ windowFires: 99 }))
    t.update([F('a'), F('a')])
    t.update([OK])
    expect(t.update([F('a'), F('a')]).fired).toBe(false)
  })

  it('window：4-of-10（consecutive 不足）→ struggling', () => {
    const t = new Trigger(cfg())
    const seq = [OK, F('a'), OK, F('b'), OK, F('a'), OK, F('c')]
    let d: { fired: boolean; mode?: string } | undefined
    for (const o of seq) d = t.update([o])
    expect(d!.fired).toBe(true)
    expect(d!.mode).toBe('struggling')
  })

  it('fire 后计数清零：再攒满才二次 fire', () => {
    const t = new Trigger(cfg())
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(true)
    expect(t.update([F('x'), F('y')]).fired).toBe(false)
    expect(t.update([F('z')]).fired).toBe(true)
  })

  it('cooldown：间隔不足不 fire', () => {
    const t = new Trigger(cfg({ cooldown: 10 }))
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(true)
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(false)
  })

  it('maxInterventions：用尽后 exhausted 不再 fire', () => {
    const t = new Trigger(cfg({ maxInterventions: 2 }))
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(true)
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(true)
    expect(t.exhausted).toBe(true)
    expect(t.update([F('a'), F('a'), F('a')]).fired).toBe(false)
    expect(t.remainingInterventions).toBe(0)
  })

  it('consultReset：清计数不动名额', () => {
    const t = new Trigger(cfg({ maxInterventions: 1 }))
    t.update([F('a'), F('a')])
    t.consultReset()
    expect(t.update([F('a'), F('a')]).fired).toBe(false)
    expect(t.update([F('a')]).fired).toBe(true)
    expect(t.exhausted).toBe(true)
  })

  it('窗口滑出：旧失败出窗后不计入 windowFires', () => {
    const t = new Trigger(cfg({ windowSize: 4, windowFires: 3, consecutive: 99 }))
    let d: { fired: boolean } | undefined
    for (const o of [F('a'), F('b'), OK, OK, OK, OK]) d = t.update([o])
    expect(d!.fired).toBe(false)
    d = t.update([F('c'), F('d')])
    expect(d!.fired).toBe(false)
    d = t.update([F('e')])
    expect(d!.fired).toBe(true)
  })
})
