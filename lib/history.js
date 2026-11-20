/**
 * history —— 组装发给顾问模型的自包含请求（设计 §4：任务原文 + 开场
 * 计划(若有) + 最近 ~20 条消息裁剪，保头尾）。
 *
 * 走快照文本而不是转发原始 Message[]：
 *  - 自包含文本对 provider 最稳（无孤儿 toolCall 被拒的风险，omp
 *    transcript-recorder 同思路）；
 *  - 顾问系统提示已声明"只看到执行者转发的摘要上下文"；
 *  - deriveMessages() 是 compaction 感知的，转发面=执行模型实际可见面。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
const DEFAULT_RECENT = 20;
const DEFAULT_TEXT_BUDGET = 700;
const TASK_BUDGET = 4000;
function textOf(blocks, budget) {
    if (blocks === undefined)
        return '';
    const parts = [];
    for (const block of blocks) {
        if (block === null || typeof block !== 'object')
            continue;
        if (block.type === 'text' && typeof block.text === 'string' && block.text !== '')
            parts.push(block.text);
        else if (block.type === 'tool-call')
            parts.push(`[calls ${block.name}(${typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments) ?? ''})]`);
    }
    const joined = parts.join('\n');
    if (joined.length <= budget)
        return joined;
    return `${joined.slice(0, Math.floor(budget * 0.6))}\n…[truncated]…\n${joined.slice(-Math.floor(budget * 0.3))}`;
}
function sourceMark(message) {
    const source = message.source;
    if (source !== undefined && typeof source.kind === 'string' && source.kind.startsWith('plugin:'))
        return ' (advisor notice)';
    return '';
}
/** 渲染消息尾段为顾问可读的逐条文本 */
export function renderTranscript(messages, recent = DEFAULT_RECENT, budget = DEFAULT_TEXT_BUDGET) {
    const tail = recent > 0 && messages.length > recent ? messages.slice(-recent) : [...messages];
    const dropped = messages.length - tail.length;
    const lines = [];
    if (dropped > 0)
        lines.push(`[... ${dropped} earlier messages truncated ...]`);
    for (const message of tail) {
        const text = textOf(message.content, budget);
        if (text === '')
            continue;
        lines.push(`--- ${message.role}${sourceMark(message)} ---\n${text}`);
    }
    return lines.join('\n');
}
/** 会话里第一条真实用户消息 = 任务原文（保头） */
export function findTaskOriginal(messages) {
    for (const message of messages) {
        if (message.role !== 'user')
            continue;
        const kind = message.source?.kind;
        if (kind !== undefined && kind.startsWith('plugin:'))
            continue;
        const text = textOf(message.content, TASK_BUDGET);
        if (text.trim() !== '')
            return text;
    }
    return undefined;
}
/** 组装单条自包含 user 消息（顾问请求载荷） */
export function buildSnapshot(messages, options) {
    const sections = [];
    const task = findTaskOriginal(messages);
    if (task !== undefined)
        sections.push(`## Task (original user request)\n\n${task}`);
    if (options.planText !== undefined && options.planText !== '') {
        sections.push(`## Opening plan (previously delivered)\n\n${options.planText}`);
    }
    sections.push(`## Recent conversation (trimmed)\n\n${renderTranscript(messages, options.recent ?? DEFAULT_RECENT)}`);
    sections.push(`## Question for you\n\n${options.question}`);
    return createUserMessage({
        content: [{ type: 'text', text: sections.join('\n\n') }],
        source: { kind: 'user' },
    });
}
/** consult / 介入共用的构建入口：从 agent 会话取模型可见面 */
export function snapshotFor(agent, options) {
    return buildSnapshot(agent.session.deriveMessages(), options);
}
