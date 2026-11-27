/**
 * signals —— 工具结果失败分类（纯模块，零宿主依赖，可单测）。
 *
 * 设计 §3 分层：结构化层（result 自带的成败字段，零解析成本、最可靠）
 * + 语义层（按工具限定的规则表，宁缺勿滥，防"页面文本里提到 fail
 * 也算失败"）。分类结果只做两件事：进触发器计数（所有非 ok 一视同仁）
 * 与进顾问提示词的失败摘要（带 label）。
 *
 * 对齐 QwenPaw trigger.py 分层原则；语义表条目照设计 §3 首版清单。
 */
/** 从 result 任意形态里尽量抽出可读文本（bounded，防超长日志进窗口） */
export function extractResultText(result, budget = 2000) {
    if (result === null || result === undefined)
        return '';
    if (typeof result === 'string')
        return headTailSample(result, budget);
    if (typeof result !== 'object')
        return String(result).slice(0, budget);
    const parts = [];
    const push = (text) => {
        if (text !== '' && parts.join('\n').length < budget)
            parts.push(text);
    };
    const obj = result;
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined)
            continue;
        if (typeof value === 'string') {
            if (value !== '')
                push(value);
            continue;
        }
        if (key === 'content' && Array.isArray(value)) {
            for (const block of value) {
                if (block !== null && typeof block === 'object' && block.type === 'text') {
                    const text = block.text;
                    if (typeof text === 'string')
                        push(text);
                }
            }
        }
    }
    return headTailSample(parts.join('\n'), budget);
}
/** 键排序的稳定序列化（argsKey 用：相同语义参数不同键序 → 同 key） */
export function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(item => stableStringify(item)).join(',')}]`;
    const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
/** 工具名 + 参数的打转判定 key；解析失败退回原文段 */
export function makeArgsKey(name, argsText) {
    const parsed = (() => { try {
        return JSON.parse(argsText);
    }
    catch {
        return undefined;
    } })();
    const normalized = parsed === undefined ? (argsText ?? '').slice(0, 200) : stableStringify(parsed).slice(0, 200);
    return `${name}:${normalized}`;
}
/** tools/result 的 result 里抠出结构化失败元数据（有就信，没有不强猜） */
function structuralMeta(result) {
    const meta = {};
    const own = (key) => result[key];
    const exitCode = own('exitCode');
    if (typeof exitCode === 'number')
        meta.exitCode = exitCode;
    const timedOut = own('timedOut');
    if (timedOut === true)
        meta.timedOut = true;
    const aborted = own('aborted');
    if (aborted === true)
        meta.aborted = true;
    return meta;
}
const EMPTY_HIT_TEXT = /no (matches|files|results|hits)|0 matches|no match found|未找到|没有(匹配|找到)|not found/i;
/** DSH bash 把非零退出码嵌进结果文本（[stderr]...[exit code: N]），isError 仍 false——必须文本级识别 */
const EXIT_CODE_TEXT = /\[exit code: (-?\d+)\]/;
const QUOTA_TEXT = /429|too many requests|quota|rate[ -]?limit|配额/i;
const STALE_TEXT = /FS_STALE_VERSION|stale version/i;
const SANDBOX_TEXT = /\[sandbox:|file access denied|access denied under/i;
/**
 * 失败分类主入口。name/argsText 原样来自 tools/result 的 exec；
 * resultText 是渲染文本或原始对象的抽取。
 * 只在 ok === false 的前提下调它（成败以 result.isError === true 为准）。
 */
function classifyFailureInner(name, argsText, result) {
    const resultText = extractResultText(result);
    const meta = typeof result === 'object' && result !== null
        ? structuralMeta(result)
        : {};
    if (meta.exitCode !== undefined && meta.exitCode !== 0)
        return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-exit' };
    if (meta.timedOut === true)
        return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-timeout' };
    const textExit = EXIT_CODE_TEXT.exec(resultText) ?? EXIT_CODE_TEXT.exec(exitCodeHaystack(result));
    if (textExit !== null && Number.parseInt(textExit[1], 10) !== 0)
        return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-exit' };
    if (meta.aborted === true)
        return { name, argsKey: makeArgsKey(name, argsText), label: 'aborted' };
    if (SANDBOX_TEXT.test(resultText))
        return { name, argsKey: makeArgsKey(name, argsText), label: 'denied' };
    if (STALE_TEXT.test(resultText))
        return { name, argsKey: makeArgsKey(name, argsText), label: 'stale-version' };
    // 语义层（按工具限定，宁缺勿滥）
    const isSearchTool = name === 'grep' || name === 'tgrep' || name === 'glob';
    if (isSearchTool) {
        // 仅当"明确在找东西"（pattern 非空）且结果文本表明零命中
        const searching = argsText !== '' && /"pattern"\s*:\s*"[^"]+"|"query"\s*:\s*"[^"]+"/.test(argsText);
        if (searching && (EMPTY_HIT_TEXT.test(resultText) || resultText.trim() === '')) {
            return { name, argsKey: makeArgsKey(name, argsText), label: 'empty-search' };
        }
    }
    if (name === 'read' && /ENOENT|no such file|不存在|not found/i.test(resultText)) {
        return { name, argsKey: makeArgsKey(name, argsText), label: 'not-found' };
    }
    if ((name === 'web_search' || name === 'web_fetch') && QUOTA_TEXT.test(resultText)) {
        return { name, argsKey: makeArgsKey(name, argsText), label: 'quota' };
    }
    // 参数 schema 校验失败的典型错误形态
    if (/invalid (tool |tool call |)arguments|schema validation|参数(校验|不合法)/i.test(resultText)) {
        return { name, argsKey: makeArgsKey(name, argsText), label: 'schema-invalid' };
    }
    return { name, argsKey: makeArgsKey(name, argsText), label: 'generic' };
}
/** 头60%+尾30%双端采样（与 history.ts 渲染同向，错误的关键行通常在头尾） */
export function headTailSample(text, budget) {
    if (text.length <= budget)
        return text;
    // 先构造标记再分配剩余预算，保证总长严格不超 budget
    const droppedApprox = text.length - Math.floor(budget * 0.6);
    const marker = '\n…[middle ' + droppedApprox + ' chars dropped]…\n';
    const avail = budget - marker.length;
    if (avail <= 20)
        return text.slice(0, budget);
    const head = Math.floor(avail * 0.6);
    const tail = avail - head;
    return text.slice(0, head) + marker + text.slice(-tail);
}
/** 失败证据采样预算（分类期固定捕捉，渲染期按 context.maxFailureChars 再裁） */
export const EVIDENCE_CAPTURE_CHARS = 2400;
/** 进顾问提示词的失败摘要行（label 人话化） */
export function describeFailure(record) {
    const table = {
        'bash-exit': 'command exited non-zero',
        'bash-timeout': 'command timed out',
        'aborted': 'execution aborted',
        'denied': 'sandbox/permission denied',
        'stale-version': 'stale file version (edit conflict)',
        'schema-invalid': 'tool arguments failed schema validation',
        'empty-search': 'explicit search returned zero hits',
        'not-found': 'target file not found',
        'quota': 'upstream quota/rate limited',
        generic: 'unclassified failure',
    };
    return `${record.label}: ${table[record.label]} [tool=${record.name}]`;
}
/** 递归收集 result 里所有 text 块（任意嵌套，跳过非字符串），返回头尾采样文本 */
function exitCodeHaystack(result, depth = 0) {
    if (depth > 4 || result === null || typeof result !== 'object')
        return typeof result === 'string' ? result.slice(0, 400) + ' ' + result.slice(-400) : '';
    const chunks = [];
    const walk = (v, d) => {
        if (d > 4 || v === null || v === undefined)
            return;
        if (typeof v === 'string') {
            chunks.push(v.slice(0, 300) + ' ' + v.slice(-300));
            return;
        }
        if (Array.isArray(v)) {
            for (const item of v)
                walk(item, d + 1);
            return;
        }
        if (typeof v === 'object') {
            for (const item of Object.values(v))
                walk(item, d + 1);
        }
    };
    walk(result, depth);
    return chunks.join(' ');
}
/** 失败分类主入口（包装内层，统一补证据采样——军师看得到真实报错原文而不只是 label） */
export function classifyFailure(name, argsText, result) {
    const record = classifyFailureInner(name, argsText, result);
    const text = extractResultText(result, EVIDENCE_CAPTURE_CHARS * 2);
    if (text.trim() === '')
        return record;
    return { ...record, evidence: headTailSample(text, EVIDENCE_CAPTURE_CHARS) };
}
/** tools/result 是否算一次失败：isError === true，或文本含非零 [exit code: N]
 * （DSH bash 非零退出 isError=false 靠文本标记；标记在文本尾部，故走头尾采样） */
export function resultIsFailure(result) {
    if (typeof result !== 'object' || result === null)
        return false;
    if (result.isError === true)
        return true;
    const m = EXIT_CODE_TEXT.exec(exitCodeHaystack(result));
    return m !== null && Number.parseInt(m[1], 10) !== 0;
}
