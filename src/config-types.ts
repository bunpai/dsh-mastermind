/**
 * config-types —— 供 guards.ts 循环引用（配置类型）与 severity 运行时值。
 * config.ts 因需引用 DEFAULT_CONFIG 不宜反向引入 guards，故独立此小模块。
 */

export type Severity = 'nit' | 'concern' | 'blocker'

// 运行时值枚举（可擦写语法的常量对象替代 enum，任务约束①）
export const Severity = {
  NIT: 'nit',
  CONCERN: 'concern',
  BLOCKER: 'blocker',
} as const satisfies Record<string, Severity>

export type TriggerConfig = {
  consecutive: number
  windowSize: number
  windowFires: number
  cooldown: number
  maxInterventions: number
}

export type GuardConfig = {
  budgetPerTurn: number
  budgetCap: number
  immunityTurns: number
}

/** 计划注入时机：once=每会话开场一次（首个 tools/result）；every=每次用户消息（该轮首个 tools/result） */
export type PlanMode = 'once' | 'every'

/** 顾问与注入文案的语言：zh=中文 en=英文 */
export type PromptLanguage = 'zh' | 'en'

export type Config = {
  enabled: boolean
  plan: boolean
  planMode: PlanMode
  followup: boolean
  consult: boolean
  promptLanguage: PromptLanguage
  trigger: TriggerConfig
  guards: GuardConfig
  advisorProvider: string
  advisorModel: string
  advisorEffort: string
}
