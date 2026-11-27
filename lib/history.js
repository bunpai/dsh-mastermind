/**
 * history —— 组装发给顾问模型的自包含请求（设计 §4：任务原文 + 开场
 * 计划(若有) + 压缩历史专区(若有) + 最近消息裁剪，保头尾）。
 *
 * 走快照文本而不是转发原始 Message[]：
 *  - 自包含文本对 provider 最稳（无孤儿 toolCall 被拒的风险，omp
 *    transcript-recorder 同思路）；
 *  - 顾问系统提示已声明"只看到执行者转发的摘要上下文"；
 *  - deriveMessages() 是 compaction 感知的，转发面=执行模型实际可见面。
 *
 * v0.3.0 compaction 感知（设计补篇）：
 *  - compaction 检查点（source.kind === 'compact-checkpoint'，契约镜像
 *    \@deepseek-ai/dsh-compaction 的 isCompactCheckpointSource，避免新增
 *    运行时依赖边）是压缩面里信息密度最高的内容，却被通用规则浪费：
 *    单块 700 字符预算照裁、滑出尾窗即丢、还会被 findTaskOriginal 误标
 *    成任务原文。此处专项处理：
 *      1. 检查点消息一律从尾窗摘出，进独立的 "Compacted history" 专区
 *         （豁免单块预算，专区总量 maxSummaryChars 封顶，头尾双端保留）；
 *      2. 尾窗里原地留一行占位符，保持位置语义可追；
 *      3. findTaskOriginal 跳过检查点源（P2：防摘要误标任务原文）；
 *      4. 有活跃摘要时任务原文预算降级（摘要首节已含用户目标，对冲成本）。
 *  - 滚动合并不变量（compaction-basic 提示词契约：新压缩合并吞掉旧检查点）
 *    保证专区 O(1) 而非 O(N)；多检查点共存属边缘情况，尾优先截断兜底。
 *  - maxPayloadChars 硬顶兜底病理性膨胀：按 plan→task→checkpoint→recent
 *    顺序压缩（question 与 recent 新证据优先保住）。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
const DEFAULT_RECENT = 20;
const DEFAULT_TEXT_BUDGET = 700;
const TASK_BUDGET = 4000;
export const DEFAULT_CONTEXT_BUDGET = {
    // 真实 compaction 摘要实测 2659–6103 字符(v3 评测 4 会话); 3000 帽会使
    // 覆盖率反不如旧版意外的 4000 task 帽(极端扫描 OLD 6/10 vs NEW 4/10)。
    // 6000 覆盖绝大多数真实摘要全长, 更大size由 payload cap 头尾双端兜底。
    maxSummaryChars: 6000,
    maxPayloadChars: 12000,
    taskBudgetWithSummary: 800,
    recentMessages: 20,
    blockChars: 700,
    maxSalientChars: 1500,
};
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
function sourceKind(message) {
    return message.source?.kind;
}
/** compaction 检查点判定（镜像 isCompactCheckpointSource 的稳定契约串） */
export function isCheckpointMessage(message) {
    return sourceKind(message) === 'compact-checkpoint';
}
function sourceMark(message) {
    const kind = sourceKind(message);
    if (kind !== undefined && kind.startsWith('plugin:'))
        return ' (advisor notice)';
    return '';
}
/** 渲染消息尾段为顾问可读的逐条文本；检查点消息只留占位符（全文在专区） */
export function renderTranscript(messages, recent = DEFAULT_RECENT, budget = DEFAULT_TEXT_BUDGET) {
    const tail = recent > 0 && messages.length > recent ? messages.slice(-recent) : [...messages];
    const dropped = messages.length - tail.length;
    const lines = [];
    if (dropped > 0)
        lines.push(`[... ${dropped} earlier messages truncated ...]`);
    for (const message of tail) {
        if (isCheckpointMessage(message)) {
            lines.push(`--- ${message.role} (compaction checkpoint) ---\n[checkpoint of earlier history — full text in the "Compacted history" section]`);
            continue;
        }
        const text = textOf(message.content, budget);
        if (text === '')
            continue;
        lines.push(`--- ${message.role}${sourceMark(message)} ---\n${text}`);
    }
    return lines.join('\n');
}
/** 会话里第一条真实用户消息 = 任务原文（保头；跳过插件通知与压缩检查点） */
export function findTaskOriginal(messages, budget = TASK_BUDGET) {
    for (const message of messages) {
        if (message.role !== 'user')
            continue;
        const kind = sourceKind(message);
        if (kind !== undefined && kind.startsWith('plugin:'))
            continue;
        if (kind === 'compact-checkpoint')
            continue;
        const text = textOf(message.content, budget);
        if (text.trim() !== '')
            return text;
    }
    return undefined;
}
/** 渲染压缩检查点专区：全部检查点按时间序拼接，总量封顶、尾优先保最新 */
export function renderCheckpoints(checkpoints, cap) {
    const texts = [];
    for (const message of checkpoints) {
        const text = textOf(message.content, Number.POSITIVE_INFINITY);
        if (text.trim() !== '')
            texts.push(text);
    }
    const joined = texts.join('\n\n');
    if (joined.length <= cap)
        return joined;
    // compaction 摘要结构是"首要意图在顶(## Primary Request and Intent)、近期
    // 状态在尾"，两头都是高价值区——纯尾优先会把任务意图整个切掉（v0.3.0-rc
    // 评测实证：6103 字符摘要截到 3000 时 Primary Request 全丢，盐值仅靠运气
    // 留存）。改为头 60% + 尾 30% 双端保留，与 textOf 截断形态一致。
    const head = Math.floor(cap * 0.6);
    const tail = Math.floor(cap * 0.3);
    return `${joined.slice(0, head)}\n…[checkpoint middle dropped to fit budget]…\n${joined.slice(-tail)}`;
}
/**
 * 工作现场提取（v0.4.0）：扫全部消息的 write/edit 工具调用，渲染"本会话
 * 写过哪些文件、各几次"。尾窗滑出后执行者的工作面对顾问依然可见——
 * 设计 §F3 的 archive 提取版（不依赖 cwd/git 发现，纯消息面可证）。
 */
export function renderWorksite(messages, cap) {
    if (cap <= 0)
        return '';
    const touches = new Map();
    let index = 0;
    for (const message of messages) {
        index += 1;
        if (message.content === undefined)
            continue;
        for (const block of message.content) {
            if (block === null || typeof block !== 'object')
                continue;
            if (block.type !== 'tool-call')
                continue;
            if (block.name !== 'write' && block.name !== 'edit')
                continue;
            const args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments) ?? '';
            const match = /"(?:file_path|filePath|path)"\s*:\s*"([^"]+)"/.exec(args);
            if (match === null)
                continue;
            const path = match[1];
            const touch = touches.get(path) ?? { count: 0, lastIndex: 0, ops: new Set() };
            touch.count += 1;
            touch.lastIndex = index;
            touch.ops.add(block.name);
            touches.set(path, touch);
        }
    }
    if (touches.size === 0)
        return '';
    // 最近触碰的排前面（越近越可能是当前工作焦点）
    const rows = [...touches.entries()]
        .sort((a, b) => b[1].lastIndex - a[1].lastIndex)
        .map(([path, touch]) => `- ${path} (${[...touch.ops].sort().join('+')} ×${touch.count})`);
    const joined = rows.join('\n');
    if (joined.length <= cap)
        return joined;
    return joined.slice(0, cap) + '\n…[more files truncated]';
}
/**
 * 中段显著性提取（v0.4.0）：尾窗之外的用户消息是长会话里信息密度最高的
 * 内容——纠正、补充约束、改需求全在里面，20 条尾窗一滑就永久丢失。
 * 此处把窗口外用户消息（跳过检查点/插件通知/任务原文本身）提升进独立节。
 */
export function renderSalient(messages, recent, cap) {
    if (cap <= 0)
        return '';
    const tailStart = recent > 0 && messages.length > recent ? messages.length - recent : 0;
    const outside = messages.slice(0, Math.max(0, tailStart));
    const lines = [];
    let firstUserSkipped = false;
    for (const message of outside) {
        if (message.role !== 'user')
            continue;
        const kind = sourceKind(message);
        if (kind !== undefined && kind.startsWith('plugin:'))
            continue;
        if (kind === 'compact-checkpoint')
            continue;
        if (!firstUserSkipped) {
            // 第一条真实用户消息 = 任务原文，已在 task 节，不重复
            firstUserSkipped = true;
            continue;
        }
        const text = textOf(message.content, 300);
        if (text.trim() !== '')
            lines.push(`--- user (earlier) ---\n${text}`);
    }
    const joined = lines.join('\n');
    if (joined.length <= cap)
        return joined;
    // 尾部优先：越晚的用户消息越接近当前状态
    return `…[earlier user messages dropped to fit budget]…\n` + joined.slice(-cap);
}
/** 拆出标题行，只对正文做截断后再拼回（保节标题不丢） */
function truncateBody(section, keep, len) {
    const splitAt = section.indexOf('\n\n');
    if (splitAt === -1) {
        return keep === 'head' ? section.slice(0, len) : section.slice(-len);
    }
    const heading = section.slice(0, splitAt);
    const body = section.slice(splitAt + 2);
    if (body.length <= len)
        return section;
    const trimmed = keep === 'head'
        ? `${body.slice(0, len)}\n…[truncated to fit payload budget]…`
        : `…[earlier content dropped to fit payload budget]…\n${body.slice(-len)}`;
    return `${heading}\n\n${trimmed}`;
}
/**
 * 载荷硬顶执行：超 cap 时按 plan→task→checkpoint→recent 顺序压缩
 * （question 永不裁；recent 是卡壳新证据最后动，且尾优先保最新）。
 */
export function enforcePayloadCap(sections, cap) {
    const out = sections.map(s => ({ ...s }));
    let total = out.reduce((sum, s) => sum + s.text.length, 0);
    if (total <= cap)
        return out;
    const victims = [
        { key: 'plan', floor: 0, keep: 'head' },
        { key: 'task', floor: 300, keep: 'head' },
        { key: 'checkpoint', floor: 1200, keep: 'tail' },
        { key: 'salient', floor: 400, keep: 'tail' },
        { key: 'worksite', floor: 300, keep: 'head' },
        { key: 'recent', floor: 1500, keep: 'tail' },
    ];
    for (const victim of victims) {
        if (total <= cap)
            break;
        const section = out.find(s => s.key === victim.key);
        if (section === undefined)
            continue;
        const excess = total - cap;
        const target = Math.max(victim.floor, section.text.length - excess);
        if (target >= section.text.length)
            continue;
        const before = section.text.length;
        section.text = victim.floor === 0 && target === 0 ? '' : truncateBody(section.text, victim.keep, target);
        total -= before - section.text.length;
    }
    return out.filter(s => s.text !== '');
}
/** 组装单条自包含 user 消息（顾问请求载荷） */
export function buildSnapshot(messages, options) {
    const budget = { ...DEFAULT_CONTEXT_BUDGET, ...(options.context ?? {}) };
    const checkpoints = messages.filter(isCheckpointMessage);
    const hasCheckpoint = checkpoints.length > 0;
    const sections = [];
    const task = findTaskOriginal(messages, hasCheckpoint ? budget.taskBudgetWithSummary : TASK_BUDGET);
    if (task !== undefined)
        sections.push({ key: 'task', text: `## Task (original user request)${hasCheckpoint ? ' — compressed history active, see checkpoint section' : ''}\n\n${task}` });
    if (options.planText !== undefined && options.planText !== '') {
        sections.push({ key: 'plan', text: `## Opening plan (previously delivered)\n\n${options.planText}` });
    }
    if (hasCheckpoint) {
        sections.push({ key: 'checkpoint', text: `## Compacted history (checkpoint summary of the earlier conversation; the executor sees the same compressed face)\n\n${renderCheckpoints(checkpoints, budget.maxSummaryChars)}` });
    }
    const recentCount = options.recent ?? budget.recentMessages;
    const salient = renderSalient(messages, recentCount, budget.maxSalientChars);
    if (salient !== '') {
        sections.push({ key: 'salient', text: `## Earlier user messages (beyond the recent window — corrections and added constraints live here)\n\n${salient}` });
    }
    const worksite = renderWorksite(messages, 1200);
    if (worksite !== '') {
        sections.push({ key: 'worksite', text: `## Files written/edited this session (the work surface)\n\n${worksite}` });
    }
    sections.push({ key: 'recent', text: `## Recent conversation (trimmed)\n\n${renderTranscript(messages, recentCount, budget.blockChars)}` });
    sections.push({ key: 'question', text: `## Question for you\n\n${options.question}` });
    const capped = enforcePayloadCap(sections, budget.maxPayloadChars);
    return createUserMessage({
        content: [{ type: 'text', text: capped.map(s => s.text).join('\n\n') }],
        source: { kind: 'user' },
    });
}
/** consult / 介入共用的构建入口：从 agent 会话取模型可见面 */
export function snapshotFor(agent, options) {
    return buildSnapshot(agent.session.deriveMessages(), options);
}
