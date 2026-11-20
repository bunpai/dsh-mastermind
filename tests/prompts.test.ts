import { describe, expect, it } from 'vitest'
import { ADVISOR_SYSTEM_PROMPT, buildInterventionText, buildPlanText, CONSULT_TOOL_DESCRIPTION, CONSULT_TOOL_NAME, FOLLOWUP_NUDGE, PLAN_NUDGE } from '../src/prompts.js'

describe('prompts 契约（设计 §4/§6）', () => {
  it('ADVISOR_SYSTEM_PROMPT：三值首行契约 + 150 词约束 + SEVERITY 档', () => {
    expect(ADVISOR_SYSTEM_PROMPT).toContain('CONTINUE')
    expect(ADVISOR_SYSTEM_PROMPT).toContain('ADJUST')
    expect(ADVISOR_SYSTEM_PROMPT).toContain('STOP')
    expect(ADVISOR_SYSTEM_PROMPT).toContain('150')
    expect(ADVISOR_SYSTEM_PROMPT).toContain('SEVERITY')
  })

  it('CONSULT_TOOL_DESCRIPTION：纪律 + 自足提问', () => {
    expect(CONSULT_TOOL_DESCRIPTION).toContain('question')
    expect(CONSULT_TOOL_DESCRIPTION).toContain('When NOT to call')
    expect(CONSULT_TOOL_DESCRIPTION.length > 200).toBe(true)
  })

  it('buildInterventionText：STOP 交还用户；ADJUST 带 consult_advisor 语境', () => {
    const stop = buildInterventionText('STOP', 'The direction violates the user constraint.')
    expect(stop).toContain('STOP')
    expect(stop).toMatch(/hand|user/i)
    const adjust = buildInterventionText('ADJUST', 'Run the linter first.')
    expect(adjust).toContain('ADJUST')
    expect(adjust).toContain('consult_advisor')
  })

  it('PLAN/FOLLOWUP nudge 与包装', () => {
    expect(PLAN_NUDGE.length > 50).toBe(true)
    expect(FOLLOWUP_NUDGE.length > 50).toBe(true)
    expect(CONSULT_TOOL_NAME).toBe('consult_advisor')
    expect(buildPlanText('The first milestone')).toContain('The first milestone')
  })
})
