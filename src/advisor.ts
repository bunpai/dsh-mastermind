/**
 * advisor —— 顾问调用与裁决解析。
 *
 * 裁决协议（设计 §4）：回复首行恰为 CONTINUE / ADJUST / STOP（容忍
 * markdown 强调）；可带第二行 SEVERITY: nit|concern|blocker；ADJUST/STOP
 * 正文 <150 词。解析失败重试 2 次（附纠正提示），仍失败按 ADJUST 注入
 * 全文——顾问建议永不静默丢弃（宁多勿丢）。
 *
 * callAdvisor 是唯一的 ctx 依赖点（llm.stream 流式聚合），形状对齐前任
 * dsh-advisor-plugin llm-call.ts 的实测用法；其余函数全纯可单测。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { AdvisorSelection } from './config.js'
import { Severity, type Severity as SeverityType } from './config-types.js'
import type { VerdictKind } from './prompts.js'

// ---------- 解析（纯函数区，可单测） ----------

/** 剥首行的 markdown 强调装饰：**CONTINUE** / #ADJUST / > STOP 等都算合法首行 */
export function stripFirstLineDecoration(line: string): string {
  return line.replace(/^[\s>#*_\`~=(]+/, '').replace(/[\s:*_\`~=~)]+$/, '').trim()
}

export interface ParsedVerdict {
  readonly kind: VerdictKind
  readonly severity: SeverityType
  readonly detail: string
}

const SEVERITY_LINE = /^severity\s*[:：]\s*(nit|concern|blocker)\b/i

/** 首行裁决解析；不可解析 → undefined（由调用方决定重试/兜底） */
export function parseVerdict(raw: string): ParsedVerdict | undefined {
  const lines = raw.split('\n')
  let firstIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { firstIndex = i; break }
  }
  if (firstIndex < 0) return undefined
  const first = stripFirstLineDecoration(lines[firstIndex]).toUpperCase()
  const match = /^(CONTINUE|ADJUST|STOP)\b/.exec(first)
  if (match === null) return undefined
  const kind = match[1] as VerdictKind

  const body = lines.slice(firstIndex + 1)
  let severity: SeverityType | undefined
  let severityLine = -1
  for (let i = 0; i < Math.min(3, body.length); i++) {
    const sm = SEVERITY_LINE.exec(body[i].trim())
    if (sm !== null) {
      severity = sm[1].toLowerCase() as SeverityType
      severityLine = i
      break
    }
  }
  if (severity === undefined) severity = kind === 'STOP' ? Severity.BLOCKER : Severity.CONCERN

  const detail = body
    .filter((_, i) => i !== severityLine)
    .join('\n')
    .trim()
  return { kind, severity, detail }
}

// ---------- 顾问调用（薄 ctx 层） ----------

export interface UsageSnapshot {
  readonly inputTokens: number
  readonly outputTokens: number
}

export type AdvisorCallResult =
  | { readonly ok: true, readonly text: string, readonly finishKind: string, readonly usage?: UsageSnapshot }
  | { readonly ok: false, readonly errorMessage: string }

interface StreamChunk {
  readonly type?: string
  readonly text?: string
  readonly usage?: { inputTokens?: number, outputTokens?: number }
  readonly reason?: { kind?: string, failure?: unknown }
}

/**
 * 流式调用顾问模型。空回复重试一次（前任实测某些网关偶发空流）；
 * finish.kind aborted/error 一律作失败处理（降级不阻断由上层决定）。
 */
export async function callAdvisor(
  ctx: Context,
  selection: AdvisorSelection,
  system: string,
  messages: Message[],
  options: { sessionId?: string, signal?: AbortSignal, retryNote?: string } = {},
): Promise<AdvisorCallResult> {
  const finalMessages = options.retryNote === undefined
    ? messages
    : [
        ...messages,
        { role: 'user', content: [{ type: 'text', text: options.retryNote }], source: { kind: 'user' } } as unknown as Message,
      ]

  const attempt = async (): Promise<AdvisorCallResult> => {
    let text = ''
    let usage: UsageSnapshot | undefined
    let finishKind = 'stop'
    let sawFinish = false
    try {
      const stream = ctx.llm.stream({
        provider: selection.provider,
        model: selection.model,
        system,
        messages: finalMessages,
        ...(selection.effort === undefined ? {} : { reasoningEffort: selection.effort }),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      } as never)
      for await (const chunk of stream as AsyncIterable<StreamChunk>) {
        if (options.signal?.aborted === true) return { ok: false, errorMessage: '顾问调用被中止' }
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk.type === 'usage' && chunk.usage !== undefined) {
          usage = { inputTokens: chunk.usage.inputTokens ?? 0, outputTokens: chunk.usage.outputTokens ?? 0 }
        } else if (chunk.type === 'finish') {
          sawFinish = true
          const kind = chunk.reason?.kind ?? 'stop'
          if (kind === 'aborted' || kind === 'error') {
            const failure = chunk.reason?.failure
            const failureText = typeof failure === 'string'
              ? failure
              : failure instanceof Error
                ? (failure.stack ?? failure.message)
                : failure === undefined || failure === null
                  ? ''
                  : JSON.stringify(failure)
            const suffix = failureText === '' ? '' : `：${failureText}`
            return { ok: false, errorMessage: `顾问流式返回异常终局（${kind}）${suffix}` }
          }
          finishKind = kind
        }
      }
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
    }
    if (!sawFinish) return { ok: false, errorMessage: '顾问流式返回无终局帧' }
    if (text.trim() === '') return { ok: false, errorMessage: '顾问返回了空文本' }
    return { ok: true, text, finishKind, ...(usage === undefined ? {} : { usage }) }
  }

  const first = await attempt()
  if (first.ok) return first
  const second = await attempt() // 空流/网络瞬断重试一次
  if (second.ok) return second
  return { ok: false, errorMessage: first.errorMessage === second.errorMessage ? first.errorMessage : `${first.errorMessage}；重试仍失败：${second.errorMessage}` }
}

// ---------- 重试 + 兜底决议 ----------

export interface AdvisorReply {
  readonly kind: VerdictKind
  readonly severity: SeverityType
  readonly detail: string
  /** 原始全文（兜底注入时 detail 即全文） */
  readonly raw: string
  /** 解析失败触发的重试次数 */
  readonly parseRetries: number
  /** true = 重试穷尽后按 ADJUST 全文兜底 */
  readonly fellBack: boolean
  readonly finishKind: string
  readonly usage?: UsageSnapshot
}

export type AdvisorOutcome =
  | { readonly ok: true, readonly reply: AdvisorReply }
  | { readonly ok: false, readonly errorMessage: string }

const RETRY_NOTE =
  'Your previous reply did not begin with exactly CONTINUE, ADJUST, or STOP on the first line. '
  + 'Reply again following the contract: first line exactly one of CONTINUE / ADJUST / STOP.'
const MAX_PARSE_RETRIES = 2

/**
 * 调用 + 解析 + 重试 + 兜底一条龙。
 * makeCall 由调用方闭包出（携带各自的消息组装）；本函数只管协议。
 * 调用层失败（顾问不可达等）原样透传——上层按场景降级：
 * 计划失败→无计划继续、介入失败→视为未触发、咨询失败→FALLBACK_ADVICE。
 */
export async function resolveAdvisorReply(
  makeCall: (retryNote: string | undefined) => Promise<AdvisorCallResult>,
): Promise<AdvisorOutcome> {
  let lastOkText: { text: string, finishKind: string, usage?: UsageSnapshot } | undefined
  let lastError = ''
  let parseRetries = 0

  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const result = await makeCall(attempt === 0 ? undefined : RETRY_NOTE)
    parseRetries = attempt
    if (!result.ok) {
      lastError = result.errorMessage
      continue // 调用失败也按"解析未成"路径继续重试（总预算 MAX_PARSE_RETRIES）
    }
    lastOkText = { text: result.text, finishKind: result.finishKind, ...(result.usage === undefined ? {} : { usage: result.usage }) }
    const parsed = parseVerdict(result.text)
    if (parsed !== undefined) {
      return {
        ok: true,
        reply: {
          kind: parsed.kind,
          severity: parsed.severity,
          detail: parsed.detail,
          raw: result.text,
          parseRetries: attempt,
          fellBack: false,
          finishKind: result.finishKind,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        },
      }
    }
  }

  if (lastOkText !== undefined) {
    // 宁多勿丢：全文按 ADJUST 兜底注入（设计 §4）
    return {
      ok: true,
      reply: {
        kind: 'ADJUST',
        severity: Severity.CONCERN,
        detail: lastOkText.text.trim(),
        raw: lastOkText.text,
        parseRetries,
        fellBack: true,
        finishKind: lastOkText.finishKind,
        ...(lastOkText.usage === undefined ? {} : { usage: lastOkText.usage }),
      },
    }
  }
  return { ok: false, errorMessage: lastError === '' ? '顾问多次调用未获有效回复' : lastError }
}
