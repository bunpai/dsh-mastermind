/**
 * AdvisorView —— 会话顾问活动页（client 半）。
 *
 * 挂 conversation.view（list/session）：与 对话/轨迹/统计 并列的
 * 第四个视图，label '顾问'。展示本会话顾问的调用计数、token 消耗
 * 与事件流（plan/followup/consult 每次裁决、抑制原因、错误）。
 *
 * 数据：GET /api/dsh-mastermind?view=session&session=<id>，3s 轮询；
 * 源文件是 host 半写的 ~/.dsh/advisor/<session>.jsonl 审计日志。
 */
import { useEffect, useRef, useState } from 'react'

interface SessionEvent {
  time: string; kind: string; advisor?: string; verdict?: string; severity?: string
  delivered?: boolean; suppressedReason?: string; errorMessage?: string
  inputTokens?: number; outputTokens?: number; detail?: string
}
interface SessionPayload {
  enabled: boolean; override: boolean | null; globalEnabled: boolean
  events: SessionEvent[]
  totals: { calls: number; inputTokens: number; outputTokens: number; byKind: Record<string, { calls: number; inputTokens: number; outputTokens: number }> }
}

const KIND_LABEL: Record<string, string> = { plan: '📋 开场计划', followup: '🔧 卡点介入', consult: '🧭 主动咨询' }
const KIND_FALLBACK = '✦ 介入'

const styles = [
'.advisor-view{height:100%;overflow-y:auto;padding:20px 24px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;box-sizing:border-box}',
'.advisor-view h2{margin:0 0 4px;font-size:18px;line-height:26px;font-weight:600}',
'.advisor-view .adv-sub{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0 0 16px}',
'.advisor-view .adv-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}',
'.advisor-view .adv-stat{min-width:120px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-module-platform)}',
'.advisor-view .adv-stat b{display:block;font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums}',
'.advisor-view .adv-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}',
'.advisor-view .adv-row{display:grid;grid-template-columns:64px 96px 1fr auto;gap:10px;align-items:baseline;padding:8px 10px;border-radius:8px}',
'.advisor-view .adv-row:hover{background:var(--dsw-alias-bg-module-platform)}',
'.advisor-view .adv-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px}',
'.advisor-view .adv-kind{white-space:nowrap;font-size:12px}',
'.advisor-view .adv-body{min-width:0;overflow-wrap:anywhere}',
'.advisor-view .adv-meta{color:var(--dsw-alias-label-secondary);font-size:12px}',
'.advisor-view .adv-detail{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:2px;white-space:pre-wrap}',
'.advisor-view .adv-tokens{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}',
'.advisor-view .adv-empty{padding:40px 0;text-align:center;color:var(--dsw-alias-label-secondary)}',
'.advisor-view .adv-verdict{display:inline-block;margin-right:8px;padding:0 7px;border-radius:7px;font-size:11px;border:1px solid var(--dsw-alias-border-l2)}',
'.advisor-view .adv-verdict.CONTINUE{color:var(--dsw-alias-state-success-primary,#3a9e62)}',
'.advisor-view .adv-verdict.ADJUST{color:var(--dsw-alias-state-warning-primary,#d8933a)}',
'.advisor-view .adv-verdict.STOP{color:var(--dsw-alias-state-error-primary,#d8453a)}',
'.advisor-view .adv-suppressed{opacity:.55}',
].join('\n')

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso.slice(0, 16) : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
}
const fmtTokens = (n: number): string => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)

export function AdvisorView({ sessionId }: { sessionId?: string }) {
  const [data, setData] = useState<SessionPayload>()
  const [offline, setOffline] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (sessionId === undefined || sessionId === '') { setData(undefined); return }
    let dead = false
    const tick = () => {
      const mine = ++seq.current
      void fetch('/api/dsh-mastermind?view=session&session=' + encodeURIComponent(sessionId), { credentials: 'same-origin', cache: 'no-store' })
        .then(async res => {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const p = await res.json() as SessionPayload
          if (!dead && seq.current === mine) { setData(p); setOffline(false) }
        })
        .catch(() => { if (!dead) setOffline(true) })
    }
    tick()
    const timer = setInterval(tick, 3000)
    return () => { dead = true; clearInterval(timer) }
  }, [sessionId])

  if (sessionId === undefined || sessionId === '') {
    return <div className='advisor-view'><style>{styles}</style><div className='adv-empty'>此面板需会话作用域</div></div>
  }

  const t = data?.totals
  const events = data?.events ?? []
  const stateLine = data === undefined
    ? (offline ? '后端 API 暂不可达——重试中' : '加载中…')
    : (data.enabled ? '本会话顾问：开' + (data.override !== null ? '（会话覆盖）' : '（跟随全局）') : '本会话顾问：关' + (data.override !== null ? '（会话覆盖）' : '（跟随全局）'))

  return <div className='advisor-view'>
    <style>{styles}</style>
    <h2>顾问活动</h2>
    <p className='adv-sub'>{stateLine}</p>
    {t !== undefined && <div className='adv-stats'>
      <div className='adv-stat'><b>{t.calls}</b><span>调用次数</span></div>
      <div className='adv-stat'><b>{fmtTokens(t.inputTokens)}</b><span>输入 tokens</span></div>
      <div className='adv-stat'><b>{fmtTokens(t.outputTokens)}</b><span>输出 tokens</span></div>
      {Object.entries(t.byKind).map(([k, v]) =>
        <div className='adv-stat' key={k}><b>{v.calls}</b><span>{(KIND_LABEL[k] ?? KIND_FALLBACK + ' ' + k) + ' · ' + fmtTokens(v.inputTokens + v.outputTokens)}</span></div>)}
    </div>}
    {events.length === 0
      ? <div className='adv-empty'>{data === undefined ? '—' : '本会话还没有顾问调用记录'}</div>
      : [...events].reverse().map((e, i) =>
        <div key={i} className={'adv-row' + (e.suppressedReason !== undefined ? ' adv-suppressed' : '')}>
          <span className='adv-time'>{fmtTime(e.time)}</span>
          <span className='adv-kind'>{KIND_LABEL[e.kind] ?? KIND_FALLBACK + ' ' + e.kind}</span>
          <span className='adv-body'>
            {e.verdict !== undefined && <span className={'adv-verdict ' + e.verdict}>{e.verdict}</span>}
            <span className='adv-meta'>{[e.advisor, e.delivered === false ? '未投递' : undefined, e.suppressedReason, e.errorMessage].filter(s => s !== undefined && s !== '').join(' · ')}</span>
            {e.detail !== undefined && e.detail !== '' && <div className='adv-detail'>{e.detail}</div>}
          </span>
          <span className='adv-tokens'>{((e.inputTokens ?? 0) + (e.outputTokens ?? 0)) > 0 ? '↑' + fmtTokens(e.inputTokens ?? 0) + ' ↓' + fmtTokens(e.outputTokens ?? 0) : ''}</span>
        </div>)}
  </div>
}
