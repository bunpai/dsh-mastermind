/**
 * trigger —— 卡点触发器（纯模块，零 ctx 依赖，可单测边界）。
 *
 * 语义照 QwenPaw modes/advisor/trigger.py（设计 §3 原样起步）：
 *   - 连续失败 consecutive=3 或 滑窗 windowSize=10 步内 windowFires=4 次 → fire
 *   - 每次 fire 清零两计数器；冷却 cooldown=0（步）；会话上限 maxInterventions=3
 *   - fire 时的失败 (argsKey 集合大小==1 → stuck；>1 → struggling)
 *   - consult_advisor 主动咨询后 reset——同一批失败不会被问两次
 *
 * 窗口的"步"= 工具结果事件（成功也占窗位，反映真实工作流）。
 * fire 即消耗一次介入名额（调用方负责顾问调用与注入；顾问失败
 * 按"未触发"降级=不影响 Worker，但名额照扣，防顾问故障时连环重试）。
 */

import type { TriggerConfig } from './config.js'
import type { FailureRecord } from './signals.js'

export interface Outcome {
  readonly ok: boolean
  readonly failure?: FailureRecord
  /** 工具名+规范化参数 key（打转检测用；成功调用也要，缺省不参与打转计数） */
  readonly argsKey?: string
  /** 成功的写文件类调用（write/edit）：推进度的证据，重置打转计数 */
  readonly write?: boolean
}

export type StuckMode = 'stuck' | 'struggling'

export interface TriggerDecision {
  readonly fired: boolean
  /** fired 时：stuck=struggling 失败集合大小 1（一步到位纠正） */
  readonly mode: StuckMode | undefined
  /** fired 时给顾问看的近期失败记录（窗口内全部失败） */
  readonly failures: readonly FailureRecord[]
  /** 触发来源：failure=失败计数；loop=打转检测（成功的原地打转，v0.4.0） */
  readonly kind: 'failure' | 'loop'
  /** kind=loop 时：打转的调用签名与次数 */
  readonly loopKey?: string
  readonly loopCount?: number
}

export class Trigger {
  private consecutive = 0
  private window: Outcome[] = []
  private windowFailures: FailureRecord[] = []
  private interventionsLeft: number
  private totalSteps = 0
  private lastFireStep = -1
  /** 打转检测：自上次成功写文件以来各调用签名的重复次数 */
  private sinceWrite = new Map<string, number>()

  constructor(private readonly cfg: TriggerConfig) {
    this.interventionsLeft = Math.max(0, cfg.maxInterventions)
  }

  /** 顾问主动咨询后调用：清零连续/滑窗（名额不动） */
  consultReset(): void {
    this.consecutive = 0
    this.window = []
    this.windowFailures = []
  }

  get remainingInterventions(): number {
    return this.interventionsLeft
  }

  /** 是否已无自动介入名额（会话上限；顾问可照常被 consult） */
  get exhausted(): boolean {
    return this.interventionsLeft <= 0
  }

  /** 消化自上次检查以来的工具结果序列，返回是否 fire */
  update(outcomes: readonly Outcome[]): TriggerDecision {
    const pushOutcome = (outcome: Outcome): void => {
      this.totalSteps += 1
      this.window.push(outcome)
      if (this.window.length > this.cfg.windowSize) {
        const dropped = this.window.shift()
        if (dropped !== undefined && !dropped.ok && dropped.failure !== undefined) this.dropFailure(dropped.failure)
      }
      if (!outcome.ok && outcome.failure !== undefined) {
        this.consecutive += 1
        this.windowFailures.push(outcome.failure)
      } else {
        this.consecutive = 0
      }
    }
    for (const outcome of outcomes) pushOutcome(outcome)

    // 打转计数：成功写文件 = 进度证据，清零；其余带签名的调用累计重复次数
    for (const outcome of outcomes) {
      if (outcome.write === true && outcome.ok) {
        this.sinceWrite.clear()
      } else if (outcome.argsKey !== undefined) {
        this.sinceWrite.set(outcome.argsKey, (this.sinceWrite.get(outcome.argsKey) ?? 0) + 1)
      }
    }

    const noDecision: TriggerDecision = { fired: false, mode: undefined, failures: [], kind: 'failure' }
    if (this.interventionsLeft <= 0) return noDecision

    const sinceFire = this.totalSteps - this.lastFireStep
    const cooled = this.lastFireStep < 0 || sinceFire > this.cfg.cooldown
    if (!cooled) return noDecision

    // 打转 fire：同一签名重复到阈值（成功的原地打转，失败路径管不着）
    if (this.cfg.loopRepeat > 0) {
      let worstKey: string | undefined
      let worstCount = 0
      for (const [key, count] of this.sinceWrite) {
        if (count > worstCount) { worstCount = count; worstKey = key }
      }
      if (worstKey !== undefined && worstCount >= this.cfg.loopRepeat) {
        this.consecutive = 0
        this.window = []
        this.windowFailures = []
        this.sinceWrite.clear()
        this.interventionsLeft -= 1
        this.lastFireStep = this.totalSteps
        return { fired: true, mode: undefined, failures: [], kind: 'loop', loopKey: worstKey, loopCount: worstCount }
      }
    }

    const consecutiveHit = this.consecutive >= this.cfg.consecutive
    const windowHit = this.windowFailures.length >= this.cfg.windowFires
    if (!consecutiveHit && !windowHit) return noDecision

    // 打转判定：近期失败里 (工具名+参数) 集合大小
    const distinct = new Set(this.windowFailures.map(f => f.argsKey))
    const mode: StuckMode = distinct.size <= 1 ? 'stuck' : 'struggling'
    const failures = [...this.windowFailures]

    // fire：清零计数器、扣名额、记冷却锚点
    this.consecutive = 0
    this.window = []
    this.windowFailures = []
    this.interventionsLeft -= 1
    this.lastFireStep = this.totalSteps
    this.sinceWrite.clear()
    return { fired: true, mode, failures, kind: 'failure' }
  }

  private dropFailure(target: FailureRecord): void {
    const index = this.windowFailures.findIndex(f => f === target)
    if (index >= 0) this.windowFailures.splice(index, 1)
  }
}
