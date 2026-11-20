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

export type Config = {
  enabled: boolean
  plan: boolean
  followup: boolean
  consult: boolean
  trigger: TriggerConfig
  guards: GuardConfig
  advisorProvider: string
  advisorModel: string
  advisorEffort: string
}
