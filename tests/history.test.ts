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
const checkpoint = (text: string): Msg => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'compact-checkpoint' } })

describe('history v0.3.0 compaction 感知', () => {
  const bigSummary = 'CHECKPOINT-DETAIL ' + 'x'.repeat(1500)

  it('检查点进独立专区且全文保留（豁免单块预算）', () => {
    const msgs: Msg[] = [user('fix the login bug'), checkpoint(bigSummary), assistant('working on it')]
    const snap = buildSnapshot(msgs as never, { question: 'q?' })
    const text = (snap.content as { text: string }[])[0].text
    expect(text).toContain('## Compacted history')
    expect(text).toContain(bigSummary) // 1500 字符远超 700 单块预算，专区里全文保留
  })

  it('尾窗里检查点只留占位符（不重复计费）', () => {
    const msgs: Msg[] = [user('task'), checkpoint('SUMMARY-CONTENT'), assistant('a')]
    const snap = buildSnapshot(msgs as never, { question: 'q?' })
    const text = (snap.content as { text: string }[])[0].text
    expect(text).toContain('(compaction checkpoint)')
    const recentPart = text.split('## Recent conversation')[1]
    expect(recentPart).not.toContain('SUMMARY-CONTENT')
  })

  it('P2：findTaskOriginal 跳过 compact-checkpoint 源', () => {
    const task = findTaskOriginal([checkpoint('the original task was fix login'), assistant('a')] as never)
    expect(task).toBeUndefined()
    const real = findTaskOriginal([checkpoint('summary'), user('real task'), assistant('a')] as never)
    expect(real).toContain('real task')
  })

  it('有摘要时任务原文预算降级', () => {
    const longTask = 'TASK-START ' + 'y'.repeat(2000)
    // Task 段提取（## Task 到下一节之间）
    const taskSection = (text: string) => text.split('## Task')[1].split('## ')[1] !== undefined ? text.split('## Task (original user request)')[1].split('\n## ')[0] : ''
    const withCkpt = buildSnapshot([user(longTask), checkpoint('s'), assistant('a')] as never, { question: 'q' })
    const withText = (withCkpt.content as { text: string }[])[0].text
    const withTask = withText.split('## Task (original user request)')[1].split('\n## ')[0]
    // 800 预算 → 头 480 + 尾 240，中间截断：y 连续段最长不超过 480
    expect(withTask).toContain('…[truncated]…')
    expect(withTask).not.toContain('y'.repeat(500))
    // 无摘要：4000 预算 → 2000 字符任务全文保留
    const without = buildSnapshot([user(longTask), assistant('a')] as never, { question: 'q' })
    const withoutText = (without.content as { text: string }[])[0].text
    const withoutTask = withoutText.split('## Task (original user request)')[1].split('\n## ')[0]
    expect(withoutTask).not.toContain('…[truncated]…')
    expect(withoutTask).toContain('y'.repeat(1500))
  })

  it('maxSummaryChars 封顶：超大摘要头尾双端保留（顶部意图与尾部状态都不可丢）', () => {
    const huge = 'HEAD-MARKER ' + 'z'.repeat(8000) + ' TAIL-MARKER'
    const snap = buildSnapshot([user('t'), checkpoint(huge), assistant('a')] as never, { question: 'q' })
    const text = (snap.content as { text: string }[])[0].text
    const ckptPart = text.split('## Compacted history')[1].split('## Recent')[0]
    expect(ckptPart).toContain('HEAD-MARKER')
    expect(ckptPart).toContain('TAIL-MARKER')
    expect(ckptPart).toContain('dropped to fit budget')
  })

  it('maxPayloadChars 硬顶：病理性膨胀被压回 cap 内且 question 保住', () => {
    const fat = 'w'.repeat(900)
    const msgs: Msg[] = [user(fat), checkpoint('z'.repeat(3000)), ...Array.from({ length: 20 }, (_, i) => assistant(fat + i))]
    const snap = buildSnapshot(msgs as never, { question: 'QUESTION-SENTINEL', planText: fat, context: { maxPayloadChars: 4000 } })
    const text = (snap.content as { text: string }[])[0].text
    expect(text.length).toBeLessThanOrEqual(4100)
    expect(text).toContain('QUESTION-SENTINEL')
  })

  it('context 覆盖生效：自定义 maxSummaryChars', () => {
    const huge = 'k'.repeat(2000)
    const snap = buildSnapshot([user('t'), checkpoint(huge), assistant('a')] as never, { question: 'q', context: { maxSummaryChars: 500 } })
    const text = (snap.content as { text: string }[])[0].text
    const ckptPart = text.split('## Compacted history')[1].split('## Recent')[0]
    expect(ckptPart.length).toBeLessThan(900)
  })

  it('无压缩会话行为不变：无 Compacted history 段', () => {
    const snap = buildSnapshot([user('task'), assistant('a')] as never, { question: 'q' })
    const text = (snap.content as { text: string }[])[0].text
    expect(text).not.toContain('## Compacted history')
    expect(text).toContain('## Task (original user request)')
    expect(text).not.toContain('compressed history active')
  })
})
