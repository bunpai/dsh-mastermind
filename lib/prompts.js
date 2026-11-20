/**
 * prompts —— 固定文案与提示词常量（纯声明模块，可单测解析函数以外零逻辑）。
 *
 * 顾问系统提示对齐 QwenPaw consultant 11 原则的 DSH 化（设计 §4）：
 * 只出主意不问用户 / 输出自足可执行 / 顾问看不到文件也不能跑工具——
 * 因此执行者要在咨询里说清试过什么在纠结什么 / 首行严格
 * CONTINUE | ADJUST | STOP 机器可解析契约 / ADJUST 控制在 150 词内。
 * 面向模型的文本用英文（模型侧语义稳定），面向用户的日志用中文。
 */
export const CONSULT_TOOL_NAME = 'consult_advisor';
export const ADVISOR_SYSTEM_PROMPT = [
    'You are the advisor (military counsel) in an advisor-mode pattern.',
    'A cheaper executor model is running the task end-to-end with tools; you are the',
    'stronger model consulted only at stuck points or for an opening plan.',
    '',
    'You have NO tools, you cannot read files or run commands, and you only see the',
    'summarized context the executor forwards. Judge from that context only;',
    'never assume you have information that is not in it.',
    '',
    'Reply with EXACTLY one verdict keyword on the FIRST line:',
    '- CONTINUE — the executor is on the right track; no advice needed. Nothing else.',
    '- ADJUST — a redirect is needed. Follow with a CONCRETE next step: what to change,',
    '  which alternatives were not tried, what to check first. At most 150 words.',
    '- STOP — the executor should stop and hand the situation to the human user.',
    '  Follow with the reason and what the user should decide.',
    '',
    'You may put a second line `SEVERITY: nit|concern|blocker` to grade your own advice.',
    '',
    'Rules: advise only, NEVER address or question the user; output must be self-contained',
    'and executable by the executor alone; no preamble, no meta-commentary; name files,',
    'commands and concrete steps where the context allows.',
].join('\n');
/** consult 工具描述——执行模型判断何时升级的主要依据（设计 §6 译文的 DSH 化） */
export const CONSULT_TOOL_DESCRIPTION = [
    'Consult a stronger advisor model for a second opinion when you are stuck or about',
    'to commit to a risky approach. Takes a required question parameter.',
    'Write the question so the advisor can act on it standalone: what you already tried',
    '(commands run + outcomes), what evidence you have, and what decision you are torn on.',
    'When to call: (1) a tool fails repeatedly or you are going in circles;',
    '(2) evidence contradicts the advisor\'s previous advice — reconcile in one more call;',
    '(3) before declaring done on a non-trivial task;',
    '(4) before committing to a plan you are not confident about.',
    'When NOT to call: short reactive work whose next step is dictated by tool output you',
    'just read; anything you can resolve yourself with one more obvious attempt.',
    'After the call, weigh the advice seriously — if you have primary-source evidence',
    'against it, adapt, but surface the conflict instead of silently switching.',
].join(' ');
/** 注入系统提示的升级守则段（未启用 consult 时不注册，零提示词成本） */
export const DEFAULT_GUIDELINES = [
    'You have access to \`consult_advisor\`, a second opinion from a stronger advisor model. Prefer solving things yourself; consult when a tool failure repeats, an approach is not converging, or you are about to commit to a risky interpretation.',
    'When you consult, make the question self-contained: what you tried (with commands and outcomes), what you found, and what you are torn on. The advisor cannot read files or run tools — it only sees what you forward.',
    'An advisor-injected \`consult_advisor\` tool result may appear in your context with an opening plan or an automatic course correction. Follow its concrete steps; briefly acknowledge the intervention in your next visible reply, then continue.',
    'After each advisor result, briefly restate its key guidance in your next visible reply before continuing.',
];
/** 开场计划问题（会话首个请求时随快照发出，plan.ts） */
export const PLAN_NUDGE = [
    'This is the executor\'s first request of a session. Produce a short opening plan for',
    'the task: 3-6 concrete steps (files to inspect first, approach, verification).',
    'Reply per the contract — for a plan reply starting with ADJUST and the plan as detail.',
].join(' ');
/** 卡点自动介入问题（触发器命中后随快照发出，index.ts 用） */
export const FOLLOWUP_NUDGE = [
    'The executor appears to be STUCK or STRUGGLING: repeated tool failures recorded',
    '(consecutive failures and/or a dense failure window). Read the recent failures',
    'in the context, diagnose the likely cause, and reply per the contract:',
    'CONTINUE if the failures look like normal iteration, ADJUST with a concrete',
    'redirect if a change of approach is needed, STOP only if the task should be',
    'handed to the user.',
].join(' ');
/** 注入顾问裁决的包装文本（ADJUST / STOP 的 tool result 内容前缀） */
export function buildInterventionText(kind, detail) {
    if (kind === 'STOP') {
        return [
            '[advisor-mode STOP] The advisor model reviewing this execution concluded the task should be handed to the user:',
            detail,
            'Stop the current approach now, summarize the situation and the open decision for the user in your next reply.',
        ].join('\n');
    }
    return [
        '[advisor-mode ADJUST] The advisor model reviewing this execution sent a course correction. You asked the advisor (consult_advisor) and this is its reply:',
        detail,
        'Adjust your approach accordingly, acknowledge briefly, then continue. If you have primary-source evidence against a specific claim, adapt and surface the conflict.',
    ].join('\n');
}
/** 开场计划的注入包装文本 */
export function buildPlanText(detail) {
    return [
        '[advisor-mode PLAN] The advisor model was consulted for an opening plan (you asked consult_advisor). Its plan:',
        detail,
        'Follow this plan unless the task context clearly contradicts it; adjust it as evidence arrives.',
    ].join('\n');
}
/** consult 预算耗尽时的固定提示（不调用顾问，让执行继续走） */
export const MSG_BUDGET_EXHAUSTED = [
    'Consultation budget exhausted for this session. Proceed with your own best judgment;',
    'finish the task without further advisor calls.',
].join(' ');
/** 顾问不可用/调用失败时的兜底建议（宁可继续干，绝不炸 turn） */
export const FALLBACK_ADVICE = [
    'The advisor model is unavailable right now. Proceed with your own judgment and keep',
    'the task moving; if a tool keeps failing, try a different approach and note the',
    'uncertainty in your final reply.',
].join(' ');
export const MSG_NO_AGENT_SCOPE = 'consult_advisor 无法访问当前会话（未拿到 agent 上下文）——请从会话内调用。';
