/**
 * tools —— consult_advisor 工具（介入点③，设计 §6）。
 *
 * 纪律：工具失败绝不炸 Worker 的 turn——所有异常路径都返回值信封，
 * 渲染成可读文本；超会话预算不调顾问，回固定提示让执行继续走；调用
 * 成功后触发器计数清零（consult 与自动介入不双问同一批失败）；答尾
 * 附剩余次数提示。
 *
 * 写法照前任 dsh-advisor-plugin tool.ts（defineTool 实测面）：返回值信封
 * + render 只出文本 + presentResult 卡片让用户看到"真的调了顾问"。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { callAdvisor, resolveAdvisorReply } from './advisor.js';
import { selectionLabel } from './config.js';
import { snapshotFor } from './history.js';
import { appendAudit } from './audit.js';
import { CONSULT_TOOL_NAME, MSG_NO_AGENT_SCOPE, pickPrompts, } from './prompts.js';
function renderText(value) {
    if (!value.ok)
        return value.errorMessage ?? 'Advisor consult failed.';
    return value.guidance ?? '';
}
function textOfContent(content) {
    return content
        .filter((block) => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();
}
/** 顾问看不到文件也不能跑工具——问题必须自足（设计 §6 译文要点） */
function buildQuestion(question, context) {
    const parts = [question];
    if (context !== undefined && context.trim() !== '')
        parts.push(`\n\nAdditional context from the executor:\n${context}`);
    return parts.join('');
}
export function createConsultTool(ctx, registry, getConfig, isEnabledFor = () => true) {
    return defineTool({
        name: CONSULT_TOOL_NAME,
        description: pickPrompts(getConfig().promptLanguage).consultDescription,
        // dsh-tools rc.5 契约：parameters 是 per-property spec map（每项自带
        // type/description/required），defineTool 自动包 object 根——不是标准
        // JSON Schema 形状（写 {type:'object',properties,required[]} 会报
        // "parameters.type must be a value schema object"）。
        parameters: {
            question: {
                type: 'string',
                description: 'Self-contained question for the advisor: what you tried (commands + outcomes), the evidence you have, and the decision you are torn on.',
                required: true,
            },
            context: {
                type: 'string',
                description: 'Optional extra context: error messages, code excerpts, or constraints the advisor needs.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean' },
                    advisorModel: { type: 'string' },
                    guidance: { type: 'string' },
                    errorMessage: { type: 'string' },
                    finishKind: { type: 'string' },
                    inputTokens: { type: 'number' },
                    outputTokens: { type: 'number' },
                    consultationsLeft: { type: 'number' },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderText(value) }],
        },
        presentCall: () => ({ card: 'generic', title: '🧭 顾问咨询中…' }),
        presentResult: (_args, result) => {
            const text = textOfContent(result.content);
            return {
                card: 'generic',
                title: result.isError ? '🧭 顾问调用失败' : '🧭 顾问建议',
                ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
            };
        },
        async execute(args, exec) {
            const agent = exec.agent;
            if (agent === undefined) {
                return { ok: false, advisorModel: '(no scope)', errorMessage: MSG_NO_AGENT_SCOPE };
            }
            const state = registry.for(agent);
            const config = getConfig();
            if (!isEnabledFor(agent.id) || !config.consult) {
                return { ok: false, advisorModel: '(disabled)', errorMessage: 'consult_advisor 当前已被配置禁用——请自行继续。' };
            }
            // 会话预算（设计 §6：注入总上限同值，默认 32）：超了不调顾问，回固定提示继续干
            if (state.consultLeft <= 0) {
                return { ok: true, advisorModel: '(budget)', guidance: pickPrompts(getConfig().promptLanguage).budgetExhausted, consultationsLeft: 0 };
            }
            const question = typeof args.question === 'string' && args.question.trim() !== ''
                ? args.question
                : '(executor 未写明问题——依据最近对话给出最合适的建议。)';
            const selection = registry.selection(state);
            if (selection === undefined) {
                return { ok: false, advisorModel: '(unresolved)', errorMessage: pickPrompts(getConfig().promptLanguage).fallbackAdvice };
            }
            const snapshot = snapshotFor(agent, { question: buildQuestion(question, args.context), recent: 20 });
            const outcome = await resolveAdvisorReply(retryNote => callAdvisor(ctx, selection, pickPrompts(getConfig().promptLanguage).advisorSystem, [snapshot], {
                sessionId: agent.id,
                signal: exec.signal,
                retryNote,
            }));
            if (!outcome.ok) {
                // 咨询失败 → FALLBACK_ADVICE 兜底，Worker 继续干活（绝不炸 turn）
                await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'consult', advisor: selectionLabel(selection), verdict: 'error', errorMessage: outcome.errorMessage });
                return { ok: false, advisorModel: selectionLabel(selection), errorMessage: pickPrompts(getConfig().promptLanguage).fallbackAdvice };
            }
            const reply = outcome.reply;
            state.consultLeft -= 1;
            state.trigger.consultReset();
            const guidance = reply.detail.trim() === '' ? reply.raw.trim() : reply.detail;
            const suffixed = `${guidance}\n(consultations left: ${state.consultLeft})`;
            await appendAudit({ time: new Date().toISOString(), session: agent.id, kind: 'consult', advisor: selectionLabel(selection),
                verdict: reply.kind, severity: reply.severity, parseRetries: reply.parseRetries, fellBack: reply.fellBack,
                ...(reply.usage === undefined ? {} : { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens }),
                detail: reply.detail.slice(0, 400) });
            return {
                ok: true,
                advisorModel: selectionLabel(selection),
                guidance: suffixed,
                finishKind: reply.finishKind,
                ...(reply.usage === undefined ? {} : { inputTokens: reply.usage.inputTokens, outputTokens: reply.usage.outputTokens }),
                consultationsLeft: state.consultLeft,
            };
        },
    });
}
