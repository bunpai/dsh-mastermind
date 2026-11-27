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
import { selectionLabel } from './config.js';
import { Trigger } from './trigger.js';
import { AdmissionGate, describeSuppression } from './guards.js';
import { describeFailure } from './signals.js';
import { callAdvisor, resolveAdvisorReply } from './advisor.js';
import { pickPrompts } from './prompts.js';
import { snapshotFor } from './history.js';
import { deliverAdvice } from './inject.js';
import { appendAudit } from './audit.js';
export const PENDING_CAP = 3;
export class RuntimeRegistry {
    constructor(getConfig) {
        this.getConfig = getConfig;
        this.map = new Map();
    }
    /** 活配置读取（注入内部使用） */
    currentConfig() {
        return this.getConfig();
    }
    /** 幂等取桶；触发阈值/预算取建桶时的活配置 */
    for(agent) {
        const existing = this.map.get(agent.id);
        if (existing !== undefined)
            return existing;
        const config = this.getConfig();
        const state = {
            trigger: new Trigger(config.trigger),
            gate: new AdmissionGate(config.guards),
            planDone: false,
            planText: undefined,
            lastRequestTurn: undefined,
            lastSuppression: undefined,
            consultLeft: config.guards.budgetCap,
            inFlight: false,
            route: undefined,
            pending: [],
        };
        this.map.set(agent.id, state);
        return state;
    }
    /** 顾问路由解析：显式配置 → 会话当前模型 → 无 */
    selection(state) {
        const config = this.getConfig();
        if (config.advisorProvider !== '' && config.advisorModel !== '') {
            return config.advisorEffort === ''
                ? { provider: config.advisorProvider, model: config.advisorModel }
                : { provider: config.advisorProvider, model: config.advisorModel, effort: config.advisorEffort };
        }
        if (state.route !== undefined) {
            return state.route.effort === undefined
                ? { provider: state.route.provider, model: state.route.model }
                : { provider: state.route.provider, model: state.route.model, effort: state.route.effort };
        }
        return undefined;
    }
}
/** 失败清单进顾问问题段（卡点现场） */
/** 挂账一条迟到意见（FIFO 丢最旧，避免不可投递时无限膨胀） */
export function queueAdvice(state, advice) {
    state.pending.push(advice);
    while (state.pending.length > PENDING_CAP)
        state.pending.shift();
}
/**
 * 尝试冲刷挂账意见：任一条失败即停（projection 可能再次失效），
 * 未冲掉的留在账上等下一次时机。成功返回冲刷条数。
 */
export function flushPendingAdvice(agent, state) {
    let flushed = 0;
    while (state.pending.length > 0) {
        const head = state.pending[0];
        if (!deliverAdvice(agent, head.kind, head.text, head.summary))
            break;
        state.pending.shift();
        flushed += 1;
    }
    return flushed;
}
export function failuresBlock(failures) {
    if (failures.length === 0)
        return '';
    const lines = failures.map(f => `- ${describeFailure(f)}`).join('\n');
    return `\n\nRecent failures (the likely stuck loop):\n${lines}`;
}
/**
 * 卡点自动介入（触发器已 fire 后）：问顾问 → 裁决 → 准入 → 投递。
 * CONTINUE 零注入；ADJUST 经准入闸后尾上下文注入；STOP 走 steer 打断
 * 注入（绝不硬取消会话）。任何一步失败都视为"未触发"，绝不影响
 * Worker 的 turn；名额已在 fire 时扣除，防顾问故障时连环重试。
 * 返回 true 表示投递了一条。
 */
export async function runFollowup(ctx, agent, registry, decision) {
    const state = registry.for(agent);
    if (state.inFlight)
        return false;
    const config = registry.currentConfig();
    if (!config.enabled || !config.followup)
        return false;
    const selection = registry.selection(state);
    state.inFlight = true;
    try {
        if (selection === undefined) {
            await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: '(unresolved)', verdict: 'skipped', errorMessage: '顾问路由未配置且无会话路由可回落，视为未触发' });
            return false;
        }
        // 预算随行（Anthropic 技巧，设计 §1）+ 压制回执（设计 §5：换措辞绕闸无意义）
        const ps = pickPrompts(config.promptLanguage);
        const pieces = [ps.followupNudge + failuresBlock(decision.failures)];
        if (state.lastSuppression !== undefined) {
            pieces.push(`\n\nReceipt for your previous advice: the admission gate suppressed it — ${state.lastSuppression}. Only resubmit advice that is materially different or at strictly higher severity.`);
        }
        pieces.push(`\n\nSession budget left for this executor: ${state.trigger.remainingInterventions} automatic intervention(s) and ${state.consultLeft} consultation(s). Shape your reply accordingly.`);
        const question = pieces.join('');
        const messages = [snapshotFor(agent, {
                question,
                context: config.context,
                ...(state.planText === undefined ? {} : { planText: state.planText }),
            })];
        const outcome = await resolveAdvisorReply(retryNote => callAdvisor(ctx, selection, ps.advisorSystem, messages, { sessionId: agent.id, retryNote }));
        if (!outcome.ok) {
            await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: 'error', errorMessage: outcome.errorMessage, failures: [...decision.failures] });
            return false;
        }
        const reply = outcome.reply;
        const usage = reply.usage === undefined ? {} : { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens };
        if (reply.kind === 'CONTINUE') {
            // 设计 §4：CONTINUE 零注入
            await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: 'CONTINUE', severity: reply.severity, delivered: false, ...usage });
            return false;
        }
        const admission = state.gate.admit(reply.detail, reply.severity);
        if (!admission.admitted) {
            // 压制原因原样进审计 + 存档回执（下一次顾问请求随行带给顾问，设计 §5）
            state.lastSuppression = describeSuppression(admission.reason);
            await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: reply.kind, severity: reply.severity, delivered: false, suppressedReason: admission.reason, detail: reply.detail.slice(0, 400), ...usage });
            return false;
        }
        const text = ps.interventionText(reply.kind, reply.detail);
        const summary = reply.kind === 'STOP' ? `顾问叫停：${reply.detail.slice(0, 90)}` : `顾问纠偏：${reply.detail.slice(0, 90)}`;
        const delivered = deliverAdvice(agent, reply.kind, text, summary);
        if (!delivered) {
            // turn 已结束（projection 不活跃）：挂账等 mid-turn 时机补投；
            // STOP 降级为 ADJUST 注入（steer 对已死 turn 无意义，文本保持叫停措辞）。
            queueAdvice(state, { kind: 'ADJUST', text, summary });
        }
        state.lastSuppression = undefined;
        await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'followup', advisor: selectionLabel(selection), verdict: reply.kind, severity: reply.severity, delivered, queued: !delivered,
            parseRetries: reply.parseRetries, fellBack: reply.fellBack, detail: reply.detail.slice(0, 400), ...usage });
        return delivered;
    }
    catch (error) {
        console.warn('[dsh-mastermind] 卡点介入流程异常（已降级为未触发）：', error);
        return false;
    }
    finally {
        state.inFlight = false;
    }
}
