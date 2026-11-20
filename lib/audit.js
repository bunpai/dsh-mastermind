/**
 * audit —— 顾问调用审计（设计 §8）。
 *
 * 每次顾问请求+裁决+usage 追加写 ~/.dsh/advisor/<session>.jsonl：
 *  - 放工作区外：防 Worker 的 grep/read 把顾问日志当工作对象摸到（避免
 *    自指与循环引用）；
 *  - 纯追加 JSONL：一行一事件，事后可 jq 分析；
 *  - 审计失败绝不影响主链路（吞掉成日志）。
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
function advisorDir() {
    return join(homedir(), '.dsh', 'advisor');
}
/** 追加一行审计（永不抛错） */
export async function appendAudit(entry) {
    try {
        const dir = advisorDir();
        await mkdir(dir, { recursive: true });
        const line = `${JSON.stringify(entry)}\n`;
        await appendFile(join(dir, `${entry.session}.jsonl`), line, 'utf8');
    }
    catch (error) {
        console.warn('[dsh-advisor-mode] 审计写入失败（已吞掉）：', error);
    }
}
