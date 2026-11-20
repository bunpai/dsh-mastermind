/** session-stats —— 审计 JSONL 聚合读取器的边界与正确性 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// readSessionStats 的路径依赖 homedir()：测试用临时 HOME 隔离
const home = mkdtempSync(join(tmpdir(), 'adv-stats-'))
process.env.HOME = home
process.env.USERPROFILE = home

const { readSessionStats, sessionStatsPath } = await import('../src/session-stats.js')

describe('readSessionStats', () => {
  it('文件缺失返回空统计', () => {
    const s = readSessionStats('no-such-session')
    expect(s.totals.calls).toBe(0)
    expect(s.events).toEqual([])
  })

  it('聚合调用数与 token，坏行跳过', () => {
    const id = 'sess-1'
    mkdirSync(join(home, '.dsh', 'advisor'), { recursive: true })
    writeFileSync(sessionStatsPath(id), [
      JSON.stringify({ time: '2026-11-20T08:00:00Z', session: id, kind: 'plan', verdict: 'ADJUST', inputTokens: 1400, outputTokens: 269 }),
      'not json at all',
      JSON.stringify({ time: '2026-11-20T08:05:00Z', session: id, kind: 'followup', verdict: 'CONTINUE', suppressedReason: 'dedup' }),
      JSON.stringify({ time: '2026-11-20T08:10:00Z', session: id, kind: 'consult', verdict: 'ADJUST', inputTokens: 800, outputTokens: 120 }),
    ].join('\n'))
    const s = readSessionStats(id)
    expect(s.totals.calls).toBe(3)
    expect(s.totals.inputTokens).toBe(2200)
    expect(s.totals.outputTokens).toBe(389)
    expect(s.totals.byKind.plan).toEqual({ calls: 1, inputTokens: 1400, outputTokens: 269 })
    expect(s.totals.byKind.followup).toEqual({ calls: 1, inputTokens: 0, outputTokens: 0 })
    expect(s.totals.byKind.consult.calls).toBe(1)
    expect(s.events).toHaveLength(3)
  })

  it('tail 参数截断事件列表', () => {
    const id = 'sess-tail'
    mkdirSync(join(home, '.dsh', 'advisor'), { recursive: true })
    writeFileSync(sessionStatsPath(id), Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ time: '2026-11-20T08:00:0' + i + 'Z', session: id, kind: 'plan' })).join('\n'))
    const s = readSessionStats(id, 3)
    expect(s.totals.calls).toBe(10)
    expect(s.events).toHaveLength(3)
  })
})
