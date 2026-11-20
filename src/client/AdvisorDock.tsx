/**
 * AdvisorDock —— 输入区右侧的顾问模式开关（client 半）。
 *
 * 挂 conversation.input.right（list/session）：模型选择器同排的小药丸。
 * 两种形态：
 *   活跃会话（sessionId 有值）→ 会话级覆盖：点击写进程内存 override，
 *     右键清覆盖回落全局；顺带轮询显示本会话顾问 token 消耗。
 *   草稿页（sessionId 无值）→ 全局开关：点击直接翻转 config.enabled
 *     （用户层持久化），让新会话带着选好的状态出生。
 * 数据通道：GET/POST /api/dsh-advisor-mode（host 半 src/api.ts）。
 */
import { useEffect, useRef, useState } from 'react'

interface SessionPayload {
  enabled: boolean
  override: boolean | null
  totals: { calls: number; inputTokens: number; outputTokens: number }
}

const styles = [
'.advisor-dock{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;user-select:none;white-space:nowrap}',
'.advisor-dock:hover{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-border-l2))}',
'.advisor-dock.adv-on{color:var(--dsw-alias-brand-primary,#7c5cff);border-color:var(--dsw-alias-brand-primary,#7c5cff);background:var(--dsw-alias-bg-brand-weaker,rgba(124,92,255,.08))}',
'.advisor-dock:disabled{opacity:.55;cursor:not-allowed}',
'.advisor-dock .adv-dot{width:6px;height:6px;border-radius:3px;background:currentColor;opacity:.5}',
'.advisor-dock.adv-on .adv-dot{opacity:1}',
'.advisor-dock .adv-tokens{opacity:.75;font-variant-numeric:tabular-nums}',
].join('\n')

const fmtTokens = (n: number): string => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)

export function AdvisorDock({ sessionId }: { sessionId?: string }) {
  const draft = sessionId === undefined || sessionId === ''
  const [data, setData] = useState<SessionPayload>()
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    let dead = false
    if (draft) {
      // 草稿页：读全局开关 + enabled 是否被组合层锁死
      void fetch('/api/dsh-advisor-mode?view=settings', { credentials: 'same-origin', cache: 'no-store' })
        .then(async res => {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const p = await res.json() as { config: { enabled: boolean }, locked: string[] }
          if (dead) return
          setData(d => ({ totals: d?.totals ?? { calls: 0, inputTokens: 0, outputTokens: 0 }, override: null, enabled: p.config.enabled }))
          setLocked(p.locked.includes('enabled'))
        })
        .catch(() => {})
      return () => { dead = true }
    }
    const tick = () => {
      const mine = ++seq.current
      void fetch('/api/dsh-advisor-mode?view=session&session=' + encodeURIComponent(sessionId), { credentials: 'same-origin', cache: 'no-store' })
        .then(async res => {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const p = await res.json() as SessionPayload
          if (!dead && seq.current === mine) setData(p)
        })
        .catch(() => { /* 轮询失败静默 */ })
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => { dead = true; clearInterval(timer) }
  }, [sessionId, draft])

  const toggle = () => {
    if (busy || (draft && locked)) return
    setBusy(true)
    const next = !(data?.enabled ?? false)
    if (draft) {
      void fetch('/api/dsh-advisor-mode', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: { enabled: next } }),
      }).then(async res => {
        if (res.ok) {
          // 以回执为准：被组合层锁的键进 ignored，不能乐观翻转
          const p = await res.json() as { config?: { enabled?: boolean }, ignored?: string[] }
          setData(d => d === undefined ? d : { ...d, enabled: p.config?.enabled ?? d.enabled })
          if (p.ignored?.includes('enabled')) setLocked(true)
        }
      }).catch(() => {}).finally(() => setBusy(false))
      return
    }
    void fetch('/api/dsh-advisor-mode?scope=session', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: { id: sessionId!, enabled: next } }),
    }).then(async res => {
      if (res.ok) {
        const p = await res.json() as { enabled: boolean; override: boolean | null }
        setData(d => d === undefined ? { enabled: p.enabled, override: p.override, totals: { calls: 0, inputTokens: 0, outputTokens: 0 } } : { ...d, enabled: p.enabled, override: p.override })
      }
    }).catch(() => {}).finally(() => setBusy(false))
  }

  const clearOverride = (e: { preventDefault(): void }) => {
    e.preventDefault()
    if (draft) return
    void fetch('/api/dsh-advisor-mode?scope=session', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: { id: sessionId!, enabled: null } }),
    }).then(async res => {
      if (res.ok) {
        const p = await res.json() as { enabled: boolean; override: boolean | null }
        setData(d => d === undefined ? d : { ...d, enabled: p.enabled, override: p.override })
      }
    }).catch(() => {})
  }

  const on = data?.enabled ?? false
  const hasOverride = data?.override !== null && data?.override !== undefined
  const tokens = (data?.totals.inputTokens ?? 0) + (data?.totals.outputTokens ?? 0)
  const title = draft
    ? (locked ? '顾问模式（全局）——被组合层 patch 锁死，不可改' : '顾问模式（全局开关）：新会话将按此状态启动')
    : '顾问模式：点击切换本会话开关' + (hasOverride ? '（会话覆盖，右键清覆盖回落全局）' : '（跟随全局设置）')

  return <button type='button' className={'advisor-dock' + (on ? ' adv-on' : '')} title={title}
    onClick={toggle} onContextMenu={clearOverride} disabled={busy || (draft && locked)}>
    <style>{styles}</style>
    <span className='adv-dot' />
    <span>顾问 {on ? '开' : '关'}</span>
    {!draft && tokens > 0 && <span className='adv-tokens'>{fmtTokens(tokens)}</span>}
  </button>
}
