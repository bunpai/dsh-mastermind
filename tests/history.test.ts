import { describe, expect, it } from 'vitest'
import { buildSnapshot, findTaskOriginal, renderTranscript, snapshotFor } from '../src/history.js'

type Msg = Record<string, unknown>
const user = (text: string, plugin = false): Msg => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: plugin ? 'plugin:dsh-mastermind' : 'user' } })
const assistant = (text: string): Msg => ({ role: 'assistant', content: [{ type: 'text', text }] })

describe('history 顾问请求自包含（设计 §6/§9）', () => {
  it('renderTranscript：截断标记 + plugin 来源后缀', () => {
    const msgs: Msg[] = [user('m0'), user('m1', true), assistant('a0'), ...Array.from({ length: 21 }, (_, i) => user('m' + (i + 2))), user('plugin notice tail', true), assistant('done')]
    const out = renderTranscript(msgs, 10)
    expect(out).toContain('truncated')
    expect(out).toContain('16')
    expect(out).toContain('(advisor notice)')
    expect(out).toContain('--- user ---')
    expect(out).toContain('--- assistant ---')
  })

  it('findTaskOriginal：跳过 plugin 来源的 user 消息', () => {
    const task = findTaskOriginal([user('behold the plugin notice', true), user('fix the login bug')])
    expect(task).toContain('fix the login bug')
  })

  it('buildSnapshot：四段结构；无计划省 Opening plan 段', () => {
    const msgs = [user('fix the login bug'), assistant('on it')]
    const snap = buildSnapshot(msgs, { question: 'Should I use a JWT or a session cookie?' })
    expect(snap.role).toBe('user')
    const text = (snap.content as { type: string; text: string }[])[0].text
    expect(text).toContain('## Task (original user request)')
    expect(text).toContain('fix the login bug')
    expect(text).not.toContain('## Opening plan (previously delivered)')
    expect(text).toContain('## Recent conversation (trimmed)')
    expect(text).toContain('## Question for you')
    expect(text).toContain('JWT')
  })

  it('buildSnapshot：带 planText 时补 Opening plan 段', () => {
    const snap = buildSnapshot([user('do the thing')], { question: 'q?', planText: 'PLAN TEXT HERE' })
    const text = (snap.content as { text: string }[])[0].text
    expect(text).toContain('## Opening plan (previously delivered)')
    expect(text).toContain('PLAN TEXT HERE')
  })

  it('snapshotFor：经 agent.session.deriveMessages()', () => {
    const agent = { session: { deriveMessages: () => [user('task')] } }
    const snap = snapshotFor(agent as never, { question: 'q' })
    expect(snap.role).toBe('user')
  })
})
