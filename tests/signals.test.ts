import { describe, expect, it } from 'vitest'
import { classifyFailure, describeFailure, extractResultText, makeArgsKey, resultIsFailure } from '../src/signals.js'

type R = Record<string, unknown>
const res = (over: R = {}): R => ({ isError: true, ...over })

describe('signals 失败分类（设计 §3）', () => {
  it('resultIsFailure：只认 isError === true', () => {
    expect(resultIsFailure(res())).toBe(true)
    expect(resultIsFailure({ isError: false })).toBe(false)
    expect(resultIsFailure({})).toBe(false)
  })

  it('结构化层 labels', () => {
    expect(classifyFailure('bash', '{}', res({ exitCode: 2 })).label).toBe('bash-exit')
    expect(classifyFailure('bash', '{}', res({ timedOut: true })).label).toBe('bash-timeout')
    expect(classifyFailure('bash', '{}', res({ aborted: true })).label).toBe('aborted')
    const sandbox = res({ stderr: '[sandbox: file access denied under workspace-write mode]', stdout: '', text: '[sandbox: file access denied under workspace-write mode]' })
    expect(classifyFailure('bash', '{}', sandbox).label).toBe('denied')
    const stale = res({ text: 'Error: FS_STALE_VERSION please re-read the file', stdout: '', stderr: '' })
    expect(classifyFailure('read', '{}', stale).label).toBe('stale-version')
    expect(classifyFailure('tool', '{}', res({ text: 'Invalid tool arguments: schema validation failed' })).label).toBe('schema-invalid')
  })

  it('语义层：empty-search / not-found / quota', () => {
    expect(classifyFailure('grep', '{"pattern":"foo"}', res({ stdout: 'No matches found', text: 'No matches found' })).label).toBe('empty-search')
    expect(classifyFailure('tgrep', '{"pattern":"foo"}', res({ stdout: '', text: '' })).label).toBe('empty-search')
    expect(classifyFailure('grep', '{}', res({ stdout: 'No matches found', text: 'No matches found' })).label).not.toBe('empty-search')
    expect(classifyFailure('read', '{"file_path":"/x/y"}', res({ text: 'ENOENT: no such file or directory' })).label).toBe('not-found')
    expect(classifyFailure('web_search', '{"queries":["a"]}', res({ text: 'HTTP 429 Too Many Requests: quota exceeded' })).label).toBe('quota')
    expect(classifyFailure('web_fetch', '{"url":"https://x"}', res({ text: 'rate limit reached' })).label).toBe('quota')
  })

  it('兜底 generic', () => {
    expect(classifyFailure('bash', '{}', res({ exitCode: 0, text: 'connection refused' })).label).toBe('generic')
    expect(classifyFailure('grep', '{"pattern":"a"}', res({ stdout: 'src/a.ts:1:hit', text: 'src/a.ts:1:hit' })).label).toBe('generic')
  })

  it('makeArgsKey：键序不敏感 + 非 JSON 兜底', () => {
    expect(makeArgsKey('bash', '{"b":2,"a":1}')).toBe(makeArgsKey('bash', '{"a":1,"b":2}'))
    expect(makeArgsKey('bash', 'raw --flag')).toBe('bash:raw --flag')
    expect(makeArgsKey('bash', JSON.stringify({ x: { y: [1, 2] } }))).toBe(makeArgsKey('bash', JSON.stringify({ x: { y: [1, 2] } })))
  })

  it('describeFailure / extractResultText', () => {
    const text = describeFailure({ name: 'grep', argsKey: 'grep:k', label: 'empty-search' })
    expect(text).toContain('empty-search')
    expect(text).toContain('grep')
    expect(typeof extractResultText(res({ stdout: 'abc' }))).toBe('string')
  })

  it('DSH bash 文本型 [exit code: N]（isError=false 也算失败）', () => {
    const real = (code: number) => ({
      isError: false,
      content: [{ type: 'text', text: '[stderr]\nTraceback (most recent call last):\n  File "x.py", line 1\n[exit code: ' + code + ']' }],
    })
    expect(resultIsFailure(real(1))).toBe(true)
    expect(resultIsFailure(real(127))).toBe(true)
    expect(resultIsFailure(real(0))).toBe(false)
    expect(classifyFailure('bash', '{}', real(1)).label).toBe('bash-exit')
    // 标记被长输出推到尾部：haystack 采样尾部仍能捕到
    const long = { isError: false, content: [{ type: 'text', text: 'out '.repeat(2000) + '[exit code: 2]' }] }
    expect(resultIsFailure(long)).toBe(true)
  })
})
