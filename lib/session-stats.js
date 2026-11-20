/**
 * session-stats —— 会话顾问活动聚合（设置卡片之外的活动页数据源）。
 *
 * 读 ~/.dsh/advisor/<session>.jsonl 尾部事件，汇总调用次数与 token 消耗。
 * 文件由 audit.ts 写，本模块只读；损坏行跳过；文件缺失 → 空统计。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const TAIL_LINES = 200;
export function sessionStatsPath(sessionId) {
    return join(homedir(), '.dsh', 'advisor', sessionId + '.jsonl');
}
export function readSessionStats(sessionId, tail = 50) {
    var _a, _b;
    const totals = { calls: 0, inputTokens: 0, outputTokens: 0, byKind: {} };
    const events = [];
    const file = sessionStatsPath(sessionId);
    if (existsSync(file)) {
        const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim() !== '');
        for (const line of lines.slice(-TAIL_LINES)) {
            try {
                const e = JSON.parse(line);
                if (typeof e !== 'object' || e === null || typeof e.kind !== 'string')
                    continue;
                events.push(e);
                totals.calls += 1;
                totals.inputTokens += typeof e.inputTokens === 'number' ? e.inputTokens : 0;
                totals.outputTokens += typeof e.outputTokens === 'number' ? e.outputTokens : 0;
                const k = ((_a = totals.byKind)[_b = e.kind] ?? (_a[_b] = { calls: 0, inputTokens: 0, outputTokens: 0 }));
                k.calls += 1;
                k.inputTokens += typeof e.inputTokens === 'number' ? e.inputTokens : 0;
                k.outputTokens += typeof e.outputTokens === 'number' ? e.outputTokens : 0;
            }
            catch { /* 坏行跳过 */ }
        }
    }
    return { session: sessionId, events: events.slice(-tail), totals };
}
