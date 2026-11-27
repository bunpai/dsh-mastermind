/**
 * plan —— 介入点①：开场计划（设计 §7 映射 QwenPaw hooks.py 的
 * plan 阶段）。会话首个 tools/result 时机问顾问要一次开工计划，
 * 以尾上下文注入（inject，不打断）。触发点从 agent/request 移到
 * 首个 tools/result：request 时任务原文未提交进历史（顾问会拿到
 * 空面只产套路计划），tools/result 时任务+首批动作都已可见。
 *
 * 重复触发防护：依赖计数模式（lánchez guard 同款思路）——标记在
 * 任何异步工作之前置位，并发首请求也只会跑一次（见 index.ts 瀑布）。
 * 计划失败 → 无计划继续跑（不注任何东西），失败进审计。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { selectionLabel } from './config.js'
import { callAdvisor, resolveAdvisorReply } from './advisor.js'
import { pickPrompts } from './prompts.js'
import { snapshotFor } from './history.js'
import { deliverAdvice } from './inject.js'
import { appendAudit } from './audit.js'
import { queueAdvice } from './runtime.js'
import type { RuntimeRegistry } from './runtime.js'

/** 问一次开工计划；异常/失败一律吞掉（无计划继续跑） */
export async function runOpeningPlan(
  ctx: Context,
  agent: Agent,
  registry: RuntimeRegistry,
): Promise<void> {
  const state = registry.for(agent)
  const config = registry.currentConfig()
  if (!config.enabled || !config.plan) return
  const selection = registry.selection(state)
  if (selection === undefined) return
  const ps = pickPrompts(config.promptLanguage)
  const nudge = config.planMode === 'every' ? ps.planNudgeEvery : ps.planNudge
  try {
    const messages = [snapshotFor(agent, { question: nudge, recent: 8, context: config.context })]
    const outcome = await resolveAdvisorReply(retryNote =>
      callAdvisor(ctx, selection, ps.advisorSystem, messages, { sessionId: agent.id, retryNote }))
    if (!outcome.ok) {
      // 计划失败 → 无计划继续跑（设计 §2 铁则）
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'plan', advisor: selectionLabel(selection), verdict: 'error', errorMessage: outcome.errorMessage })
      return
    }
    const reply = outcome.reply
    const usage = reply.usage === undefined ? {} : { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens }
    if (reply.detail.trim() === '') {
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'plan', advisor: selectionLabel(selection), verdict: reply.kind, delivered: false })
      return
    }
    const text = ps.planText(reply.detail)
    const summary = `开场计划：${reply.detail.slice(0, 90)}`
    const delivered = deliverAdvice(agent, 'PLAN', text, summary)
    if (delivered) state.planText = reply.detail
    else queueAdvice(state, { kind: 'PLAN', text, summary })
    await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'plan', advisor: selectionLabel(selection), verdict: reply.kind, delivered, queued: !delivered, detail: reply.detail.slice(0, 400), ...usage })
  } catch (error) {
    console.warn('[dsh-mastermind] 开场计划失败（已降级为无计划）：', error)
  }
}
