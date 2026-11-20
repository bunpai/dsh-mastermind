import { describe, expect, it } from 'vitest'
import { parseVerdict, resolveAdvisorReply, stripFirstLineDecoration } from '../src/advisor.js'

type CallResult = { ok: true, text: string, finishKind?: string } | { ok: false, errorMessage: string }

describe('advisor 裁决解析（设计 §4）', () => {
  it('stripFirstLineDecoration：剥 markdown 装饰', () => {
    expect(stripFirstLineDecoration('**CONTINUE**')).toBe('CONTINUE')
    expect(stripFirstLineDecoration('## STOP')).toBe('STOP')
    expect(stripFirstLineDecoration('`ADJUST`')).toBe('ADJUST')
  })

  it('parseVerdict：三值 + 装饰容忍 + 空行容忍', () => {
    expect(parseVerdict('CONTINUE')?.kind).toBe('CONTINUE')
    expect(parseVerdict('**ADJUST**\nUse tsc.')?.kind).toBe('ADJUST')
    expect(parseVerdict('> STOP\nThe plan is wrong')?.kind).toBe('STOP')
    expect(parseVerdict('\n\n  CONTINUE  \nnothing to add')?.kind).toBe('CONTINUE')
    expect(parseVerdict('ADJUST: fix the build')?.kind).toBe('ADJUST')
  })

  it('parseVerdict：不可解析 → undefined（触发重试协议）', () => {
    expect(parseVerdict('CONTINUING the refactor')).toBeUndefined()
    expect(parseVerdict('Sounds good. CONTINUE')).toBeUndefined()
    expect(parseVerdict('')).toBeUndefined()
  })

  it('parseVerdict：SEVERITY 行窗口与缺省档', () => {
    const withSev = parseVerdict('STOP\nSEVERITY: concern\nWe are off track')
    expect(withSev?.severity).toBe('concern')
    expect(withSev?.detail).toBe('We are off track')
    expect(parseVerdict('STOP\nWe are off track')?.severity).toBe('blocker')
    expect(parseVerdict('ADJUST\nDo X')?.severity).toBe('concern')
    expect(parseVerdict('ADJUST\nSEVERITY: nit\nTiny tweak')?.severity).toBe('nit')
    // SEVERITY 出现在 body 第 4 行起 → 忽略，用缺省档
    expect(parseVerdict('ADJUST\nb1\nb2\nb3\nSEVERITY: blocker\ntail')?.severity).toBe('concern')
  })

  it('resolveAdvisorReply：首轮解析成功 0 重试', async () => {
    const calls: unknown[][] = []
    const reply = await resolveAdvisorReply((...a: unknown[]) => {
      calls.push(a)
      return Promise.resolve({ ok: true, text: 'CONTINUE', finishKind: 'stop' } as CallResult)
    })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.reply.kind).toBe('CONTINUE')
      expect(reply.reply.parseRetries).toBe(0)
      expect(reply.reply.fellBack).toBe(false)
    }
    expect(calls).toHaveLength(1)
  })

  it('resolveAdvisorReply：坏输出重试 1 次后成功，纠正提示仅在 attempt>0', async () => {
    const notes: unknown[][] = []
    let n = 0
    const reply = await resolveAdvisorReply((...a: unknown[]) => {
      notes.push(a)
      n += 1
      return Promise.resolve(
        n === 1
          ? { ok: true, text: 'Sure! Sounds good to me.', finishKind: 'stop' } as CallResult
          : { ok: true, text: 'ADJUST\nRun tests first.', finishKind: 'stop' } as CallResult,
      )
    })
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.reply.kind).toBe('ADJUST')
      expect(reply.reply.parseRetries).toBe(1)
    }
    expect(notes).toHaveLength(2)
    expect(notes[1].some((x) => typeof x === 'string' && x.length > 10)).toBe(true)
  })

  it('resolveAdvisorReply：穷尽重试 → ADJUST 全文兜底 fellBack', async () => {
    const garbage = 'I would suggest rebuilding the module with a different strategy and checking the tests.'
    const reply = await resolveAdvisorReply(() => Promise.resolve({ ok: true, text: garbage, finishKind: 'stop' } as CallResult))
    expect(reply.ok).toBe(true)
    if (reply.ok) {
      expect(reply.reply.kind).toBe('ADJUST')
      expect(reply.reply.fellBack).toBe(true)
      expect(reply.reply.parseRetries).toBe(2)
      expect(reply.reply.severity).toBe('concern')
      expect(reply.reply.detail).toContain('rebuilding the module')
    }
  })

  it('resolveAdvisorReply：顾问调用全失败 → ok:false + errorMessage', async () => {
    const reply = await resolveAdvisorReply(() => Promise.resolve({ ok: false, errorMessage: 'llm down' } as CallResult))
    expect(reply.ok).toBe(false)
    if (!reply.ok) expect(reply.errorMessage).toBe('llm down')
  })
})
