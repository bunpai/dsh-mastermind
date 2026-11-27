import { describe, expect, it } from 'vitest'
import { renderSalient, renderWorksite, buildSnapshot } from '../src/history.js'
import type { Message } from '@deepseek-ai/dsh-llm'

const user = (text: string, kind = 'user') => ({ role: 'user', content: [{ type: 'text', text }], source: { kind } }) as unknown as Message
const asst = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'assistant' } }) as unknown as Message
const toolcall = (name: string, args: unknown) => ({ role: 'assistant', content: [{ type: 'tool-call', name, arguments: JSON.stringify(args) }], source: { kind: 'assistant' } }) as unknown as Message
const toolresult = (text: string) => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'tool' } }) as unknown as Message

describe('中段显著性（v0.4.0）', () => {
  it('窗口外用户纠正被提升，工具结果噪音不混入', () => {
    const messages: Message[] = [
      user('任务原文'),
      user('补充：CORRECTION-MARKER 必须用 v2 前缀'),
      asst('好的'),
    ]
    for (let i = 0; i < 25; i += 1) {
      messages.push(toolcall('read', { file_path: 'f' + i }))
      messages.push(toolresult('工具结果噪音'.repeat(30)))
    }
    const out = renderSalient(messages, 20, 1500)
    expect(out).toContain('CORRECTION-MARKER')
    expect(out).not.toContain('工具结果噪音')
  })

  it('窗口内用户消息不重复提升', () => {
    const messages: Message[] = [user('任务'), asst('好'), user('窗口内的补充')]
    const out = renderSalient(messages, 20, 1500)
    expect(out).toBe('')
  })

  it('任务原文（第一条用户消息）不进显著性节', () => {
    const messages: Message[] = [user('TASK-ORIGINAL-MARKER 任务'), user('后续补充')]
    for (let i = 0; i < 25; i += 1) messages.push(asst('填充' + i), toolresult('r'))
    const out = renderSalient(messages, 20, 1500)
    expect(out).not.toContain('TASK-ORIGINAL-MARKER')
    expect(out).toContain('后续补充')
  })

  it('buildSnapshot 组装含 salient 节', () => {
    const messages: Message[] = [user('任务'), user('纠正：SALIENT-XYZ')]
    for (let i = 0; i < 25; i += 1) messages.push(toolcall('read', {}), toolresult('x'.repeat(100)))
    const msg = buildSnapshot(messages, { question: 'q' })
    const text = msg.content.map(b => (b as { text?: string }).text ?? '').join('\n')
    expect(text).toContain('Earlier user messages')
    expect(text).toContain('SALIENT-XYZ')
  })
})

describe('工作现场（v0.4.0）', () => {
  it('write/edit 触碰面提取，按近度排序', () => {
    const messages: Message[] = [
      user('任务'),
      toolcall('write', { file_path: 'src/a.js', content: 'x' }),
      toolresult('ok'),
      toolcall('edit', { file_path: 'src/a.js', old_string: '1', new_string: '2' }),
      toolresult('ok'),
      toolcall('write', { file_path: 'src/b.js', content: 'y' }),
      toolresult('ok'),
    ]
    const out = renderWorksite(messages, 1200)
    expect(out).toContain('src/a.js')
    expect(out).toContain('src/b.js')
    expect(out).toContain('edit+write ×2')
    // b.js 更近，排前面
    expect(out.indexOf('src/b.js')).toBeLessThan(out.indexOf('src/a.js'))
  })

  it('无 write/edit 时输出空', () => {
    expect(renderWorksite([user('任务'), toolcall('read', {}), toolresult('x')], 1200)).toBe('')
  })

  it('cap=0 关闭', () => {
    expect(renderWorksite([toolcall('write', { file_path: 'x' })], 0)).toBe('')
  })
})
