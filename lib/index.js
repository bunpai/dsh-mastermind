/**
 * dsh-mastermind —— 顾问模式插件（host 半入口）。
 *
 * 机制（设计定稿 §1–§7）：小模型主导干活，卡点才问大模型顾问——
 *   介入点① 开场计划：会话首个请求问一次顾问要 plan（config.plan）
 *   介入点② 卡点自动介入：tools/result 失败计数 → 触发器 fire →
 *     顾问裁决 CONTINUE/ADJUST/STOP → 防噪准入 → 尾上下文注入/steer
 *   介入点③ consult_advisor 工具：执行模型自我判断升级点手动咨询
 *
 * 三条铁则：一切行为纯注入不拦截（无硬门禁）；顾问调用失败全降级
 * 不阻断；审计写 ~/.dsh/advisor/<session>.jsonl（工作区外）。
 *
 * 服务时序照前任 dsh-advisor-plugin index.ts：tools/llm/systemPrompt 是
 * 硬依赖（inject 导出）；settings 是软依赖——ctx.inject 等待就绪。
 */
import { composeConfig, readUserConfigSync } from './user-config.js';
import { maskToLiteralPatch, readPatchLockedPaths } from './patch-locks.js';
import { wireAdvisorApi } from './api.js';
import { resultIsFailure, classifyFailure } from './signals.js';
import { CONSULT_TOOL_NAME, pickPrompts } from './prompts.js';
import { RuntimeRegistry, flushPendingAdvice, runFollowup } from './runtime.js';
import { runOpeningPlan } from './plan.js';
import { createConsultTool } from './tools.js';
import { ConfigSchema } from './schema.js';
export const name = 'dsh-mastermind';
export const inject = ['tools', 'llm', 'systemPrompt'];
export { ConfigSchema as Config };
export function apply(ctx, config) {
    // 三层合成：默认 → 用户层（~/.dsh/advisor/settings.json，设置卡片写）
    // → 插件组合层（cordis.patch.yml config:，胜出；显式键在卡片里锁定）
    const patchConfig = (config ?? {});
    const literalPatch = maskToLiteralPatch(patchConfig, readPatchLockedPaths());
    const userState = { value: readUserConfigSync() };
    const state = { config: composeConfig(userState.value, literalPatch) };
    const registry = new RuntimeRegistry(() => state.config);
    // 会话级开关：dock pill 按 sessionId 覆盖全局 enabled（Map 仅存显式覆盖；
    // 未覆盖会话回落全局值；进程内存态，不持久化——重启回到全局默认）
    const sessionEnabled = new Map();
    const isEnabledFor = (sessionId) => {
        if (sessionId !== undefined && sessionEnabled.has(sessionId))
            return sessionEnabled.get(sessionId);
        return state.config.enabled;
    };
    const sectionText = () => ['## Advisor escalation (advisor-mode)', '', ...pickPrompts(state.config.promptLanguage).guidelines.map(g => '- ' + g)].join('\n');
    // consult 工具 + 升级守则提示段：与 (enabled && consult) 同生同灭
    let registration;
    const reconcileRegistration = () => {
        registration?.();
        registration = undefined;
        if (!state.config.enabled || !state.config.consult)
            return;
        const disposeTool = ctx.tools.register(createConsultTool(ctx, registry, () => state.config, isEnabledFor));
        const disposeSection = ctx.systemPrompt.section({
            name: 'advisor-mode-consult',
            order: 550,
            text: sectionText(),
        });
        registration = () => {
            disposeTool();
            disposeSection();
        };
    };
    // 瀑布：解析路由（顾问回落源）+ 每轮准入记账
    const disposeRequest = ctx.on('agent/request', async (payload, next) => {
        const resolved = await next();
        try {
            const agent = payload.agent;
            const rt = registry.for(agent);
            rt.route = {
                provider: resolved.provider,
                model: resolved.model,
                ...(resolved.reasoningEffort === undefined || resolved.reasoningEffort === '' ? {} : { effort: resolved.reasoningEffort }),
            };
            rt.gate.beginTurn();
            // planMode=every：每条用户消息（turn 号变化）重置计划置位，
            // 该轮首个 tools/result 会重新问一次计划；once 模式不重置。
            // 注意 agent/request 每步模型调用都触发，不能裸重置（每步都炸顾问）；
            // 也不猜 step 编码（有宿主 1-based / 缺席）——以 payload.turn 变化为准，
            // step===0 做兜底（0-based 循环上同义、1-based 时靠 turn 兜底）。
            const reqTurn = payload.turn;
            const reqStep = payload.step;
            const turnChanged = typeof reqTurn === 'number' && rt.lastRequestTurn !== reqTurn;
            if (typeof reqTurn === 'number')
                rt.lastRequestTurn = reqTurn;
            if (state.config.plan && state.config.planMode === 'every' && (turnChanged || reqStep === 0))
                rt.planDone = false;
            // 介入点①已移至首个 tools/result（见下）：agent/request 时任务原文
            // 尚未提交进历史，顾问只能拿到无任务的空面；首个 tools/result 时
            // 任务必然已在 deriveMessages() 可见面里。
        }
        catch (error) {
            console.warn('[dsh-mastermind] agent/request 处理失败：', error);
        }
        return resolved;
    });
    // tools/result 通知缝：失败分类 → 触发器 → 自动介入（介入点②）
    const disposeResults = ctx.on('tools/result', (exec, result) => {
        try {
            // 无会话作用域不计数
            const agentScoped = exec.agent;
            if (agentScoped === undefined)
                return;
            if (!isEnabledFor(agentScoped.id))
                return;
            const rtScoped = registry.for(agentScoped);
            // 迟到意见补投：tools/result 必然 mid-turn，projection 活跃
            flushPendingAdvice(agentScoped, rtScoped);
            // 介入点①：开场计划改在会话首个 tools/result 触发（此前在
            // agent/request，但那时用户任务还没提交进历史，顾问看不到任务
            // 文本，只能产出通用套路计划）。置位先于异步，防并发双问。
            if (state.config.plan && !rtScoped.planDone) {
                rtScoped.planDone = true;
                void runOpeningPlan(ctx, agentScoped, registry);
            }
            if (!state.config.followup)
                return;
            // 防级联③：顾问 consult 自己的结果不计数
            if (exec.name === CONSULT_TOOL_NAME)
                return;
            const failed = resultIsFailure(result);
            const record = failed ? classifyFailure(exec.name, typeof exec.arguments === 'string' ? exec.arguments : '', result) : undefined;
            const decision = rtScoped.trigger.update([
                { ok: !failed, ...(record === undefined ? {} : { failure: record }) },
            ]);
            if (decision.fired)
                void runFollowup(ctx, agentScoped, registry, decision);
        }
        catch (error) {
            console.warn('[dsh-mastermind] tools/result 处理失败：', error);
        }
    }, { global: true });
    // 设置卡片后端：webServer 就绪后挂 /api/dsh-mastermind（fusion-next 活例）
    wireAdvisorApi(ctx, state, literalPatch, userState, reconcileRegistration, { sessionEnabled, isEnabledFor });
    reconcileRegistration();
    const { enabled, plan, followup, consult } = state.config;
    console.log(`[dsh-mastermind] 顾问模式已加载：enabled=${enabled} plan=${plan} followup=${followup} consult=${consult}`);
    ctx.effect(() => () => {
        disposeRequest();
        disposeResults();
        registration?.();
    });
}
