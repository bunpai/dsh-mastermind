import { describe, expect, it } from 'vitest'
import { Trigger } from '../src/trigger.js'
import { classifyFailure, headTailSample, resultIsFailure } from '../src/signals.js'
import { failuresBlock, loopBlock } from '../src/runtime.js'

const CFG = { consecutive: 3, windowSize: 10, windowFires: 4, cooldown: 0, maxInterventions: 5, loopRepeat: 3 }

describe('打转检测（v0.4.0 loop-guard）', () => {
  it('同一签名成功调用重复 3 次且无写入 → loop fire', () => {
    const t = new Trigger(CFG)
    const call = { ok: true, argsKey: 'bash:{"command":"./verify.sh"}' }
    let d = t.update([call])
    expect(d.fired).toBe(false)
    d = t.update([call])
    expect(d.fired).toBe(false)
    d = t.update([call])
    expect(d.fired).toBe(true)
    expect(d.kind).toBe('loop')
    expect(d.loopCount).toBe(3)
    expect(d.loopKey).toContain('verify.sh')
  })

  it('中途成功 write → 计数清零不 fire', () => {
    const t = new Trigger(CFG)
    const call = { ok: true, argsKey: 'bash:x' }
    t.update([call])
    t.update([call])
    t.update([{ ok: true, argsKey: 'edit:y', write: true }])
    t.update([call])
    t.update([call])
    const d = t.update([{ ok: true, argsKey: 'bash:z' }])
    expect(d.fired).toBe(false)
  })

  it('loopRepeat=0 关闭打转检测', () => {
    const t = new Trigger({ ...CFG, loopRepeat: 0 })
    const call = { ok: true, argsKey: 'bash:x' }
    for (let i = 0; i < 6; i += 1) {
      const d = t.update([call])
      expect(d.fired).toBe(false)
    }
  })

  it('失败的 write 不算进度证据', () => {
    const t = new Trigger(CFG)
    const call = { ok: true, argsKey: 'bash:x' }
    t.update([call])
    t.update([call])
    // write 但失败（ok:false）→ 不清零
    t.update([{ ok: false, argsKey: 'edit:y', write: true }])
    const d = t.update([call])
    expect(d.fired).toBe(true)
    expect(d.kind).toBe('loop')
  })

  it('loop fire 消耗介入名额', () => {
    const t = new Trigger({ ...CFG, maxInterventions: 1 })
    const call = { ok: true, argsKey: 'bash:x' }
    t.update([call]); t.update([call])
    const d = t.update([call])
    expect(d.fired).toBe(true)
    expect(t.exhausted).toBe(true)
  })
})

describe('失败证据（v0.4.0）', () => {
  it('classifyFailure 附 evidence 原文采样', () => {
    const result = { isError: true, content: [{ type: 'text', text: 'Error: something exploded at line 42' }] }
    const rec = classifyFailure('bash', '{"command":"x"}', result)
    expect(rec.evidence).toBeDefined()
    expect(rec.evidence).toContain('exploded')
  })

  it('超长错误被双端采样截断', () => {
    const long = 'HEAD-' + 'x'.repeat(5000) + '-TAIL'
    const rec = classifyFailure('bash', '{}', { isError: true, content: [{ type: 'text', text: long }] })
    expect(rec.evidence!.length).toBeLessThanOrEqual(2450)
    expect(rec.evidence).toContain('HEAD-')
    expect(rec.evidence).toContain('-TAIL')
  })

  it('failuresBlock 渲染证据且按预算裁剪', () => {
    const result = { isError: true, content: [{ type: 'text', text: 'E'.repeat(3000) }] }
    const rec = classifyFailure('bash', '{}', result)
    const block = failuresBlock([rec], 500)
    expect(block).toContain('evidence:')
    // 500 预算内
    expect(block.indexOf('evidence:')).toBeGreaterThan(0)
    expect(block.length).toBeLessThan(700)
  })

  it('failuresBlock maxFailureChars=0 不带证据', () => {
    const rec = classifyFailure('bash', '{}', { isError: true, content: [{ type: 'text', text: 'boom' }] })
    const block = failuresBlock([rec], 0)
    expect(block).not.toContain('evidence:')
  })

  it('loopBlock 可读', () => {
    const block = loopBlock('bash:{"command":"./verify.sh"}', 4)
    expect(block).toContain('4 times')
    expect(block).toContain('verify.sh')
  })

  it('headTailSample 短文本原样', () => {
    expect(headTailSample('short', 100)).toBe('short')
  })
})
