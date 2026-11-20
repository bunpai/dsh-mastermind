/**
 * runtime —— 每会话运行时状态 + 卡点自动介入的编排（设计 §3–§6）。
 *
 * 状态按 agent.id（= session.id）分桶：触发器、准入闸、计划标记、
 * consult 剩余预算、介入互斥锁、最近一次执行路由。
 *
 * 顾问路由两级回落（设计 §8）：显式配置 advisorProvider/Model 为准；
 * 留空回落"会话当前模型"（agent/request 瀑布里 next() 解析出的路由，
 * 与 QwenPaw 的 model 槽位 fallback 语义一致）；两者皆无 → 顾问不
 * 调用，本次介入视为未触发（降级不阻断）。
 *
 * 防级联（设计 §5）：
 *  - inFlight 互斥：顾问自触发续跑不再调度新评审；
 *  - consult_advisor 自己的工具结果不进失败计数（index.ts 过滤）；
 *  - fire 即清零计数并扣名额，同一批失败绝不双问。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { selectionLabel, type AdvisorSelection } from './config.js'
import type { Config } from './config-types.js'
import { Trigger, type TriggerDecision } from './trigger.js'
import { AdmissionGate, describeSuppression } from './guards.js'
import { describeFailure, type FailureRecord } from './signals.js'
import { callAdvisor, resolveAdvisorReply } from './advisor.js'
import { ADVISOR_SYSTEM_PROMPT, FOLLOWUP_NUDGE, buildInterventionText } from './prompts.js'
import { snapshotFor } from './history.js'
import { deliverAdvice } from './inject.js'
import { appendAudit } from './audit.js'

/** agent/request 瀑布里解析出的执行路由（顾问回落的来源） */
export interface ExecutorRoute {
  readonly provider: string
  readonly model: string
  readonly effort?: string
}

/**
 * 迟到投递账本：consult 晚于 turn 生命周期（projection 不活跃）时挂账，
 * 在 tools/result / agent/request 等时机补投（必然 mid-turn 时才真送达）。
 * STOP 经此路径降级为 ADJUST 语义（steer 只对活跃 turn 有意义）。
 */
export interface PendingAdvice {
  kind: 'ADJUST' | 'PLAN'
  text: string
  summary: string
}

export const PENDING_CAP = 3

export interface AgentRuntime {
  readonly trigger: Trigger
  readonly gate: AdmissionGate
  planDone: boolean
  planText: string | undefined
  /** admission 闸压制上一条顾问建议的回执（下一次顾问请求时带给顾问；投递成功即清） */
  lastSuppression: string | undefined
  consultLeft: number
  inFlight: boolean
  route: ExecutorRoute | undefined
  /** 迟到顾问意见（cap PENDING_CAP，FIFO 丢最旧） */
  pending: PendingAdvice[]
}

export class RuntimeRegistry {
  private readonly map = new Map<string, AgentRuntime>()

  constructor(private readonly getConfig: () => Config) {}

  /** 活配置读取（注入内部使用） */
  currentConfig(): Config {
    return this.getConfig()
  }

  /** 幂等取桶；触发阈值/预算取建桶时的活配置 */
  for(agent: Agent): AgentRuntime {
    const existing = this.map.get(agent.id)
    if (existing !== undefined) return existing
    const config = this.getConfig()
    const state: AgentRuntime = {
      trigger: new Trigger(config.trigger),
      gate: new AdmissionGate(config.guards),
      planDone: false,
      planText: undefined,
      lastSuppression: undefined,
      consultLeft: config.guards.budgetCap,
      inFlight: false,
      route: undefined,
      pending: [],
    }
    this.map.set(agent.id, state)
    return state
  }

  /** 顾问路由解析：显式配置 → 会话当前模型 → 无 */
  selection(state: AgentRuntime): AdvisorSelection | undefined {
    const config = this.getConfig()
    if (config.advisorProvider !== '' && config.advisorModel !== '') {
      return config.advisorEffort === ''
        ? { provider: config.advisorProvider, model: config.advisorModel }
        : { provider: config.advisorProvider, model: config.advisorModel, effort: config.advisorEffort }
    }
    if (state.route !== undefined) {
      return state.route.effort === undefined
        ? { provider: state.route.provider, model: state.route.model }
        : { provider: state.route.provider, model: state.route.model, effort: state.route.effort }
    }
    return undefined
  }
}

/** 失败清单进顾问问题段（卡点现场） */
/** 挂账一条迟到意见（FIFO 丢最旧，避免不可投递时无限膨胀） */
export function queueAdvice(state: AgentRuntime, advice: PendingAdvice): void {
  state.pending.push(advice)
  while (state.pending.length > PENDING_CAP) state.pending.shift()
}

/**
 * 尝试冲刷挂账意见：任一条失败即停（projection 可能再次失效），
 * 未冲掉的留在账上等下一次时机。成功返回冲刷条数。
 */
export function flushPendingAdvice(agent: Agent, state: AgentRuntime): number {
  let flushed = 0
  while (state.pending.length > 0) {
    const head = state.pending[0]
    if (!deliverAdvice(agent, head.kind, head.text, head.summary)) break
    state.pending.shift()
    flushed += 1
  }
  return flushed
}

export function failuresBlock(failures: readonly FailureRecord[]): string {
  if (failures.length === 0) return ''
  const lines = failures.map(f => `- ${describeFailure(f)}`).join('\n')
  return `\n\nRecent failures (the likely stuck loop):\n${lines}`
}

/**
 * 卡点自动介入（触发器已 fire 后）：问顾问 → 裁决 → 准入 → 投递。
 * CONTINUE 零注入；ADJUST 经准入闸后尾上下文注入；STOP 走 steer 打断
 * 注入（绝不硬取消会话）。任何一步失败都视为"未触发"，绝不影响
 * Worker 的 turn；名额已在 fire 时扣除，防顾问故障时连环重试。
 * 返回 true 表示投递了一条。
 */
export async function runFollowup(
  ctx: Context,
  agent: Agent,
  registry: RuntimeRegistry,
  decision: TriggerDecision,
): Promise<boolean> {
  const state = registry.for(agent)
  if (state.inFlight) return false
  const config = registry.currentConfig()
  if (!config.enabled || !config.followup) return false
  const selection = registry.selection(state)
  state.inFlight = true
  try {
    if (selection === undefined) {
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: '(unresolved)', verdict: 'skipped', errorMessage: '顾问路由未配置且无会话路由可回落，视为未触发' })
      return false
    }
    // 预算随行（Anthropic 技巧，设计 §1）+ 压制回执（设计 §5：换措辞绕闸无意义）
    const pieces = [FOLLOWUP_NUDGE + failuresBlock(decision.failures)]
    if (state.lastSuppression !== undefined) {
      pieces.push(`\n\nReceipt for your previous advice: the admission gate suppressed it — ${state.lastSuppression}. Only resubmit advice that is materially different or at strictly higher severity.`)
    }
    pieces.push(`\n\nSession budget left for this executor: ${state.trigger.remainingInterventions} automatic intervention(s) and ${state.consultLeft} consultation(s). Shape your reply accordingly.`)
    const question = pieces.join('')
    const messages = [snapshotFor(agent, {
      question,
      recent: 20,
      ...(state.planText === undefined ? {} : { planText: state.planText }),
    })]
    const outcome = await resolveAdvisorReply(retryNote =>
      callAdvisor(ctx, selection, ADVISOR_SYSTEM_PROMPT, messages, { sessionId: agent.id, retryNote }))
    if (!outcome.ok) {
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: 'error', errorMessage: outcome.errorMessage, failures: [...decision.failures] })
      return false
    }
    const reply = outcome.reply
    const usage = reply.usage === undefined ? {} : { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens }
    if (reply.kind === 'CONTINUE') {
      // 设计 §4：CONTINUE 零注入
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: 'CONTINUE', severity: reply.severity, delivered: false, ...usage })
      return false
    }
    const admission = state.gate.admit(reply.detail, reply.severity)
    if (!admission.admitted) {
      // 压制原因原样进审计 + 存档回执（下一次顾问请求随行带给顾问，设计 §5）
      state.lastSuppression = describeSuppression(admission.reason)
      await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: reply.kind, severity: reply.severity, delivered: false, suppressedReason: admission.reason, detail: reply.detail.slice(0, 400), ...usage })
      return false
    }
    const text = buildInterventionText(reply.kind, reply.detail)
    const summary = reply.kind === 'STOP' ? `顾问叫停：${reply.detail.slice(0, 90)}` : `顾问纠偏：${reply.detail.slice(0, 90)}`
    const delivered = deliverAdvice(agent, reply.kind, text, summary)
    if (!delivered) {
      // turn 已结束（projection 不活跃）：挂账等 mid-turn 时机补投；
      // STOP 降级为 ADJUST 注入（steer 对已死 turn 无意义，文本保持叫停措辞）。
      queueAdvice(state, { kind: 'ADJUST', text, summary })
    }
    state.lastSuppression = undefined
    await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: reply.kind, severity: reply.severity, delivered, queued: !delivered,
      parseRetries: reply.parseRetries, fellBack: reply.fellBack, detail: reply.detail.slice(0, 400), ...usage })
    return delivered
  } catch (error) {
    console.warn('[dsh-mastermind] 卡点介入流程异常（已降级为未触发）：', error)
    return false
  } finally {
    state.inFlight = false
  }
}
