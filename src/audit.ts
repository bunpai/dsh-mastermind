/**
 * audit —— 顾问调用审计（设计 §8）。
 *
 * 每次顾问请求+裁决+usage 追加写 ~/.dsh/advisor/<session>.jsonl：
 *  - 放工作区外：防 Worker 的 grep/read 把顾问日志当工作对象摸到（避免
 *    自指与循环引用）；
 *  - 纯追加 JSONL：一行一事件，事后可 jq 分析；
 *  - 审计失败绝不影响主链路（吞掉成日志）。
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type AdvisorEventKind = 'plan' | 'followup' | 'consult'
import type { FailureRecord } from './signals.js'

export interface AuditEntry {
  readonly time: string
  readonly session: string
  readonly kind: AdvisorEventKind
  readonly advisor: string
  readonly verdict?: string
  readonly severity?: string
  readonly parseRetries?: number
  readonly fellBack?: boolean
  readonly delivered?: boolean
  readonly suppressedReason?: string
  readonly errorMessage?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly detail?: string
  readonly failures?: FailureRecord[]
}

function advisorDir(): string {
  return join(homedir(), '.dsh', 'advisor')
}

/** 追加一行审计（永不抛错） */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    const dir = advisorDir()
    await mkdir(dir, { recursive: true })
    const line = `${JSON.stringify(entry)}\n`
    await appendFile(join(dir, `${entry.session}.jsonl`), line, 'utf8')
  } catch (error) {
    console.warn('[dsh-mastermind] 审计写入失败（已吞掉）：', error)
  }
}
