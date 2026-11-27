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
  /** 打转检测：同一 (工具+参数) 调用在上次成功写文件后重复此次数即视为打转（0=关闭） */
  loopRepeat: number
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

/** 顾问上下文预算（compaction 感知渲染的护栏，v0.3.0） */
export type ContextConfig = {
  /** 压缩检查点专区总字符上限（尾优先保留最新内容） */
  maxSummaryChars: number
  /** 整个顾问载荷的字符硬顶 */
  maxPayloadChars: number
  /** 有活跃压缩摘要时任务原文的降级字符预算 */
  taskBudgetWithSummary: number
  /** 尾窗消息条数 */
  recentMessages: number
  /** 单块文本字符预算 */
  blockChars: number
  /** 每条失败证据进顾问载荷的字符预算（v0.4.0 失败证据全文） */
  maxFailureChars: number
  /** 中段显著性节字符预算（窗口外用户消息等关键事件；0=关闭，v0.4.0） */
  maxSalientChars: number
}

export type Config = {
  enabled: boolean
  plan: boolean
  planMode: PlanMode
  followup: boolean
  consult: boolean
  promptLanguage: PromptLanguage
  trigger: TriggerConfig
  guards: GuardConfig
  context: ContextConfig
  advisorProvider: string
  advisorModel: string
  advisorEffort: string
  /** 开场计划专用推理强度（v0.4.0 顾问分层：plan 实测又短又套路，用低档位省钱；
   *  '' = 跟随 advisorEffort） */
  planEffort: string
}
