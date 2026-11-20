import { describe, expect, it } from 'vitest'
import { createConsultTool } from '../src/tools.js'

// smoke：只验形状与渲染面，不真调用 execute（那需要宿主 agent 作用域）。
describe('consult_advisor 工具面（smoke）', () => {
  it('名称与参数形状', () => {
    const tool = createConsultTool({} as never, {} as never, (() => ({})) as never) as unknown as Record<string, unknown>
    expect(String(tool.name ?? '')).toContain('consult_advisor')
    const dumped = JSON.stringify(tool, (_k, v) => (typeof v === 'function' ? 'fn' : v))
    expect(dumped).toContain('consult_advisor')
    expect(dumped).toContain('question')
  })
})
