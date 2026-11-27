/**
 * config —— 默认值与配置合成（类型在 config-types.ts，此处零重复定义）。
 *
 * 三层合成：schema 默认值（schema.ts 由 settings 服务解析）→ 插件组合层
 * → 用户层（~/.dsh/settings.yaml 的 advisor-mode: 段；设置页卡片同层）。
 *
 * 阈值语义对齐 QwenPaw modes/advisor/trigger.py；默认值照抄设计定稿 §8
 * （R5：阈值照抄参考实现，不臆造——所有值在配置卡片可调）。
 */

import type { Config } from './config-types.js'

export type { Config, Severity, TriggerConfig, GuardConfig } from './config-types.js'

export const DEFAULT_CONFIG: Config = {
  enabled: true,
  plan: true,
  planMode: 'once',
  followup: true,
  consult: true,
  promptLanguage: 'zh',
  trigger: { consecutive: 3, windowSize: 10, windowFires: 4, cooldown: 0, maxInterventions: 3 },
  guards: { budgetPerTurn: 4, budgetCap: 32, immunityTurns: 3 },
  context: { maxSummaryChars: 3000, maxPayloadChars: 12000, taskBudgetWithSummary: 800, recentMessages: 20, blockChars: 700 },
  advisorProvider: '',
  advisorModel: '',
  advisorEffort: '',
}

/** 已显式配置的顾问路由；undefined = 未指定（回落会话当前执行模型） */
export interface AdvisorSelection {
  readonly provider: string
  readonly model: string
  readonly effort?: string
}

export function resolveAdvisorSelection(config: Config): AdvisorSelection | undefined {
  const { advisorProvider, advisorModel } = config
  if (advisorProvider === '' || advisorModel === '') return undefined
  return config.advisorEffort === ''
    ? { provider: advisorProvider, model: advisorModel }
    : { provider: advisorProvider, model: advisorModel, effort: config.advisorEffort }
}

export function selectionLabel(selection: AdvisorSelection): string {
  return selection.effort === undefined
    ? `${selection.provider}/${selection.model}`
    : `${selection.provider}/${selection.model} (${selection.effort})`
}

/** 部分配置合并到默认值上（嵌套两节深合并；缺段回默认） */
export function mergeConfig(partial: Partial<Config> | undefined): Config {
  const p = partial ?? {}
  return {
    ...DEFAULT_CONFIG,
    ...p,
    trigger: { ...DEFAULT_CONFIG.trigger, ...(p.trigger ?? {}) },
    guards: { ...DEFAULT_CONFIG.guards, ...(p.guards ?? {}) },
    context: { ...DEFAULT_CONFIG.context, ...(p.context ?? {}) },
    planMode: p.planMode ?? 'once',
    promptLanguage: p.promptLanguage ?? 'zh',
    advisorProvider: p.advisorProvider ?? '',
    advisorModel: p.advisorModel ?? '',
    advisorEffort: p.advisorEffort ?? '',
  }
}
