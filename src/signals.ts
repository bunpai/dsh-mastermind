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

/** 失败类别标签：结构化层 structural-* / 语义层 semantic-* / 兜底 */
export type FailureLabel =
  | 'bash-exit' | 'bash-timeout' | 'aborted' | 'denied' | 'stale-version' | 'schema-invalid'
  | 'empty-search' | 'not-found' | 'quota'
  | 'generic'

/** 触发器吃的最小失败记录 */
export interface FailureRecord {
  /** 工具名 */
  readonly name: string
  /** 工具名 + 规范化参数 key（打转判定用，重复同 key = 同一件事反复失败） */
  readonly argsKey: string
  /** 失败类别 */
  readonly label: FailureLabel
}

/** 从 result 任意形态里尽量抽出可读文本（bounded，防超长日志进窗口） */
export function extractResultText(result: unknown, budget = 2000): string {
  if (result === null || result === undefined) return ''
  if (typeof result === 'string') return result.slice(0, budget)
  if (typeof result !== 'object') return String(result).slice(0, budget)
  const parts: string[] = []
  const push = (text: string): void => {
    if (text !== '' && parts.join('\n').length < budget) parts.push(text)
  }
  const obj = result as Record<string, unknown>
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      if (value !== '') push(value)
      continue
    }
    if (key === 'content' && Array.isArray(value)) {
      for (const block of value) {
        if (block !== null && typeof block === 'object' && (block as { text?: unknown }).type === 'text') {
          const text = (block as { text?: unknown }).text
          if (typeof text === 'string') push(text)
        }
      }
    }
  }
  return parts.join('\n').slice(0, budget)
}

/** 键排序的稳定序列化（argsKey 用：相同语义参数不同键序 → 同 key） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** 工具名 + 参数的打转判定 key；解析失败退回原文段 */
export function makeArgsKey(name: string, argsText: string): string {
  const parsed = (() => { try { return JSON.parse(argsText) } catch { return undefined } })()
  const normalized = parsed === undefined ? (argsText ?? '').slice(0, 200) : stableStringify(parsed).slice(0, 200)
  return `${name}:${normalized}`
}

/** tools/result 的 result 里抠出结构化失败元数据（有就信，没有不强猜） */
function structuralMeta(result: Record<string, unknown>): {
  exitCode?: number
  timedOut?: boolean
  aborted?: boolean
  schemaError?: boolean
} {
  const meta: { exitCode?: number, timedOut?: boolean, aborted?: boolean, schemaError?: boolean } = {}
  const own = (key: string): unknown => result[key]
  const exitCode = own('exitCode')
  if (typeof exitCode === 'number') meta.exitCode = exitCode
  const timedOut = own('timedOut')
  if (timedOut === true) meta.timedOut = true
  const aborted = own('aborted')
  if (aborted === true) meta.aborted = true
  return meta
}

const EMPTY_HIT_TEXT = /no (matches|files|results|hits)|0 matches|no match found|未找到|没有(匹配|找到)|not found/i
/** DSH bash 把非零退出码嵌进结果文本（[stderr]...[exit code: N]），isError 仍 false——必须文本级识别 */
const EXIT_CODE_TEXT = /\[exit code: (-?\d+)\]/
const QUOTA_TEXT = /429|too many requests|quota|rate[ -]?limit|配额/i
const STALE_TEXT = /FS_STALE_VERSION|stale version/i
const SANDBOX_TEXT = /\[sandbox:|file access denied|access denied under/i

/**
 * 失败分类主入口。name/argsText 原样来自 tools/result 的 exec；
 * resultText 是渲染文本或原始对象的抽取。
 * 只在 ok === false 的前提下调它（成败以 result.isError === true 为准）。
 */
export function classifyFailure(name: string, argsText: string, result: unknown): FailureRecord {
  const resultText = extractResultText(result)
  const meta = typeof result === 'object' && result !== null
    ? structuralMeta(result as Record<string, unknown>)
    : {}

  if (meta.exitCode !== undefined && meta.exitCode !== 0) return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-exit' }
  if (meta.timedOut === true) return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-timeout' }
  const textExit = EXIT_CODE_TEXT.exec(resultText) ?? EXIT_CODE_TEXT.exec(exitCodeHaystack(result))
  if (textExit !== null && Number.parseInt(textExit[1], 10) !== 0) return { name, argsKey: makeArgsKey(name, argsText), label: 'bash-exit' }
  if (meta.aborted === true) return { name, argsKey: makeArgsKey(name, argsText), label: 'aborted' }
  if (SANDBOX_TEXT.test(resultText)) return { name, argsKey: makeArgsKey(name, argsText), label: 'denied' }
  if (STALE_TEXT.test(resultText)) return { name, argsKey: makeArgsKey(name, argsText), label: 'stale-version' }

  // 语义层（按工具限定，宁缺勿滥）
  const isSearchTool = name === 'grep' || name === 'tgrep' || name === 'glob'
  if (isSearchTool) {
    // 仅当"明确在找东西"（pattern 非空）且结果文本表明零命中
    const searching = argsText !== '' && /"pattern"\s*:\s*"[^"]+"|"query"\s*:\s*"[^"]+"/.test(argsText)
    if (searching && (EMPTY_HIT_TEXT.test(resultText) || resultText.trim() === '')) {
      return { name, argsKey: makeArgsKey(name, argsText), label: 'empty-search' }
    }
  }
  if (name === 'read' && /ENOENT|no such file|不存在|not found/i.test(resultText)) {
    return { name, argsKey: makeArgsKey(name, argsText), label: 'not-found' }
  }
  if ((name === 'web_search' || name === 'web_fetch') && QUOTA_TEXT.test(resultText)) {
    return { name, argsKey: makeArgsKey(name, argsText), label: 'quota' }
  }

  // 参数 schema 校验失败的典型错误形态
  if (/invalid (tool |tool call |)arguments|schema validation|参数(校验|不合法)/i.test(resultText)) {
    return { name, argsKey: makeArgsKey(name, argsText), label: 'schema-invalid' }
  }
  return { name, argsKey: makeArgsKey(name, argsText), label: 'generic' }
}

/** 进顾问提示词的失败摘要行（label 人话化） */
export function describeFailure(record: FailureRecord): string {
  const table: Record<FailureLabel, string> = {
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
  }
  return `${record.label}: ${table[record.label]} [tool=${record.name}]`
}

/** 递归收集 result 里所有 text 块（任意嵌套，跳过非字符串），返回头尾采样文本 */
function exitCodeHaystack(result: unknown, depth = 0): string {
  if (depth > 4 || result === null || typeof result !== 'object') return typeof result === 'string' ? result.slice(0, 400) + ' ' + result.slice(-400) : ''
  const chunks: string[] = []
  const walk = (v: unknown, d: number): void => {
    if (d > 4 || v === null || v === undefined) return
    if (typeof v === 'string') { chunks.push(v.slice(0, 300) + ' ' + v.slice(-300)); return }
    if (Array.isArray(v)) { for (const item of v) walk(item, d + 1); return }
    if (typeof v === 'object') { for (const item of Object.values(v as Record<string, unknown>)) walk(item, d + 1) }
  }
  walk(result, depth)
  return chunks.join(' ')
}

/** tools/result 是否算一次失败：isError === true，或文本含非零 [exit code: N]
 * （DSH bash 非零退出 isError=false 靠文本标记；标记在文本尾部，故走头尾采样） */
export function resultIsFailure(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false
  if ((result as { isError?: unknown }).isError === true) return true
  const m = EXIT_CODE_TEXT.exec(exitCodeHaystack(result))
  return m !== null && Number.parseInt(m[1], 10) !== 0
}
