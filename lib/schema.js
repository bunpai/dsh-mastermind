/**
 * schema —— schemastery 配置面（设置页卡片 + ~/.dsh/settings.yaml 的
 * advisor-mode: 段共用一份形状）。默认值与 DEFAULT_CONFIG 严格同源。
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_CONFIG } from './config.js';
const trigger = Schema.object({
    consecutive: Schema.number().default(DEFAULT_CONFIG.trigger.consecutive).description('连续失败多少次判定卡点'),
    windowSize: Schema.number().default(DEFAULT_CONFIG.trigger.windowSize).description('滑窗步数'),
    windowFires: Schema.number().default(DEFAULT_CONFIG.trigger.windowFires).description('窗口内失败多少次判定卡点'),
    cooldown: Schema.number().default(DEFAULT_CONFIG.trigger.cooldown).description('两次介入间最小间隔步数'),
    maxInterventions: Schema.number().default(DEFAULT_CONFIG.trigger.maxInterventions).description('每会话自动介入上限'),
});
const guards = Schema.object({
    budgetPerTurn: Schema.number().default(DEFAULT_CONFIG.guards.budgetPerTurn).description('每轮自动介入注入预算'),
    budgetCap: Schema.number().default(DEFAULT_CONFIG.guards.budgetCap).description('每会话注入总上限'),
    immunityTurns: Schema.number().default(DEFAULT_CONFIG.guards.immunityTurns).description('注入后免疫轮数'),
});
const context = Schema.object({
    maxSummaryChars: Schema.number().default(DEFAULT_CONFIG.context.maxSummaryChars).description('压缩检查点专区总字符上限'),
    maxPayloadChars: Schema.number().default(DEFAULT_CONFIG.context.maxPayloadChars).description('顾问载荷整体字符硬顶'),
    taskBudgetWithSummary: Schema.number().default(DEFAULT_CONFIG.context.taskBudgetWithSummary).description('有压缩摘要时任务原文的降级字符预算'),
    recentMessages: Schema.number().default(DEFAULT_CONFIG.context.recentMessages).description('尾窗消息条数'),
    blockChars: Schema.number().default(DEFAULT_CONFIG.context.blockChars).description('单块文本字符预算'),
});
export const ConfigSchema = Schema.object({
    enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled).description('顾问模式总开关'),
    plan: Schema.boolean().default(DEFAULT_CONFIG.plan).description('介入点①计划'),
    planMode: Schema.union(['once', 'every']).default(DEFAULT_CONFIG.planMode).description('计划注入时机：once=每会话一次 every=每次用户消息'),
    followup: Schema.boolean().default(DEFAULT_CONFIG.followup).description('介入点②卡点自动介入'),
    consult: Schema.boolean().default(DEFAULT_CONFIG.consult).description('介入点③consult_advisor 工具'),
    promptLanguage: Schema.union(['zh', 'en']).default(DEFAULT_CONFIG.promptLanguage).description('顾问提示词语言（裁决关键词仍是英文契约）'),
    trigger: trigger.default(DEFAULT_CONFIG.trigger),
    guards: guards.default(DEFAULT_CONFIG.guards),
    context: context.default(DEFAULT_CONFIG.context),
    advisorProvider: Schema.string().default('').description('顾问 provider（空=会话当前模型）'),
    advisorModel: Schema.string().default('').description('顾问 model（空=会话当前模型）'),
    advisorEffort: Schema.string().default('').description('顾问推理档位（空=模型默认）'),
    planEffort: Schema.string().default('').description('开场计划专用推理档位（空=跟随顾问档位）'),
});
