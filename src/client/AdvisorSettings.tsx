/**
 * AdvisorSettings —— 顾问模式设置卡片（client 半）。
 *
 * 数据通道：host 半 /api/dsh-advisor-mode（src/api.ts）——
 *   GET  ?view=settings → { config（生效值）, locked（组合层锁）, catalog, file }
 *   POST {config}       → 白名单校验 → 写用户层 → 活应用
 * 组合层（cordis.patch.yml）显式写死的字段渲染为禁用，提示去 patch 改。
 */
import { useEffect, useState } from 'react'

interface EffortEntry { id: string; name: string }
interface CatalogModel { id: string; name: string; reasoning?: { efforts: EffortEntry[]; defaultEffort?: string } }
interface CatalogGroup { id: string; name: string; models: CatalogModel[] }
interface Catalog { groups: CatalogGroup[] }
interface AdvisorConfig {
  enabled: boolean; plan: boolean; followup: boolean; consult: boolean
  trigger: { consecutive: number; windowSize: number; windowFires: number; cooldown: number; maxInterventions: number }
  guards: { budgetPerTurn: number; budgetCap: number; immunityTurns: number }
  advisorProvider: string; advisorModel: string; advisorEffort: string
}
interface SettingsPayload { config: AdvisorConfig; locked: string[]; catalog: Catalog; file?: string }

const styles = [
'.advisor-settings{max-width:560px;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary)}',
'.advisor-settings h2{margin:0;font-size:20px;line-height:28px;font-weight:600}',
'.advisor-settings p{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
'.advisor-settings .adv-card{padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-bg-module-platform)}',
'.advisor-settings fieldset{padding:0;margin:0;border:0;min-inline-size:0;display:flex;flex-direction:column;gap:6px}',
'.advisor-settings legend{font-size:14px;font-weight:600;padding:0}',
'.advisor-settings label{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:12px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
'.advisor-settings label.adv-check{grid-template-columns:16px 1fr;cursor:pointer}',
'.advisor-settings select,.advisor-settings input[type=text]{box-sizing:border-box;width:100%;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 9px;font:inherit;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
'.advisor-settings input[type=number]{box-sizing:border-box;width:88px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:0 8px;font:inherit;background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
'.advisor-settings .adv-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}',
'.advisor-settings .adv-actions{display:flex;align-items:center;gap:12px}',
'.advisor-settings button{height:34px;border:1px solid transparent;border-radius:17px;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);padding:0 18px;font:inherit;font-size:13px;cursor:pointer}',
'.advisor-settings button:disabled{opacity:.5;cursor:default}',
'.advisor-settings :disabled{opacity:.55;cursor:not-allowed}',
'.advisor-settings [role=alert]{color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;font-size:13px}',
'.advisor-settings .adv-note{font-size:12px;color:var(--dsw-alias-label-secondary)}',
].join('\n')

const routeKey = (provider: string, model: string) => provider === '' ? '' : JSON.stringify([provider, model])

function NumField({ label, value, locked, onChange }: { label: string; value: number; locked: boolean; onChange(v: number): void }) {
  return <label>{label}<input type='number' value={String(value)} disabled={locked} onChange={e => onChange(Number(e.target.value))} /></label>
}

export function AdvisorSettings() {
  const [payload, setPayload] = useState<SettingsPayload>()
  const [draft, setDraft] = useState<AdvisorConfig>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    void fetch('/api/dsh-advisor-mode?view=settings', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
      .then(async res => { if (!res.ok) throw new Error('HTTP ' + res.status); const p = await res.json() as SettingsPayload; setPayload(p); setDraft(p.config) })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
    return () => abort.abort()
  }, [])
  if (error !== undefined && payload === undefined) return <section className='advisor-settings'><style>{styles}</style><h2>顾问模式</h2><p role='alert'>{'无法读取设置：' + error}</p></section>
  if (payload === undefined || draft === undefined) return <section className='advisor-settings'><style>{styles}</style><h2>顾问模式</h2><p>加载中…</p></section>
  const locked = new Set(payload.locked)
  const catalog = payload.catalog ?? { groups: [] }
  const currentModel = catalog.groups.find(g => g.id === draft.advisorProvider)?.models.find(m => m.id === draft.advisorModel)
  const routeLocked = locked.has('advisorProvider') || locked.has('advisorModel')
  const patch = (k: keyof AdvisorConfig, v: unknown) => setDraft({ ...draft, [k]: v })
  const patchSub = (s: 'trigger' | 'guards', k: string, v: number) => setDraft({ ...draft, [s]: { ...draft[s], [k]: v } })
  const save = () => {
    setSaving(true); setError(undefined); setNotice(undefined)
    void fetch('/api/dsh-advisor-mode', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: draft }),
    }).then(async res => {
      const body = await res.json() as { ok?: boolean; config?: AdvisorConfig; ignored?: string[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? ('HTTP ' + res.status))
      if (body.config) setDraft(body.config)
      const ig = (body.ignored ?? []).length > 0 ? '（组合层锁定已忽略：' + (body.ignored ?? []).join('、') + '）' : ''
      setNotice('已保存' + ig)
    }).catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false))
  }
  const checks: { key: 'enabled' | 'plan' | 'followup' | 'consult'; label: string; hint: string }[] = [
    { key: 'enabled', label: '启用顾问模式', hint: '总开关' },
    { key: 'plan', label: '开场计划', hint: '会话首个工具结果后问顾问要 plan' },
    { key: 'followup', label: '卡点自动介入', hint: '连续失败攒够阈值才触发' },
    { key: 'consult', label: 'consult_advisor 工具', hint: '执行模型自己升级咨询' },
  ]
  return <section className='advisor-settings'><style>{styles}</style>
    <h2>顾问模式</h2>
    <p>小模型主导干活，遇到卡点才问顾问。顾问模型与触发阈值在此配置；被插件组合层锁定的字段显示为禁用。</p>
    <div className='adv-card'>
      {checks.map(c => <label key={c.key} className='adv-check' title={c.hint}>
        <input type='checkbox' checked={draft[c.key]} disabled={locked.has(c.key)} onChange={e => patch(c.key, e.target.checked)} />
        <span>{c.label}{locked.has(c.key) ? '（锁定）' : ''}</span>
      </label>)}
    </div>
    <div className='adv-card'>
      <fieldset><legend>顾问模型</legend>
        <p>不选则跟随会话当前执行模型。</p>
        {catalog.groups.length > 0 ? <label>模型<select disabled={routeLocked} value={routeKey(draft.advisorProvider, draft.advisorModel)} onChange={e => {
          if (e.target.value === '') { setDraft({ ...draft, advisorProvider: '', advisorModel: '', advisorEffort: '' }); return }
          const [provider, model] = JSON.parse(e.target.value) as [string, string]
          setDraft({ ...draft, advisorProvider: provider, advisorModel: model, advisorEffort: '' })
        }}>
          <option value=''>跟随执行模型</option>
          {catalog.groups.map(g => <optgroup key={g.id} label={g.name}>{g.models.map(m => <option key={m.id} value={routeKey(g.id, m.id)}>{m.name}</option>)}</optgroup>)}
        </select></label>
          : <><label>Provider<input type='text' value={draft.advisorProvider} disabled={routeLocked} onChange={e => patch('advisorProvider', e.target.value)} placeholder='如 cpa' /></label>
            <label>模型<input type='text' value={draft.advisorModel} disabled={routeLocked} onChange={e => patch('advisorModel', e.target.value)} placeholder='如 devin/swe-2' /></label></>}
        {currentModel?.reasoning !== undefined && draft.advisorModel !== '' ? <label>推理强度<select disabled={locked.has('advisorEffort')} value={draft.advisorEffort} onChange={e => patch('advisorEffort', e.target.value)}>
          <option value=''>{'模型默认' + (currentModel.reasoning.defaultEffort ? ' · ' + currentModel.reasoning.defaultEffort : '')}</option>
          {currentModel.reasoning.efforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label> : null}
        {routeLocked ? <p className='adv-note'>模型被插件组合层（cordis.patch.yml）锁定，到 patch 里改。</p> : null}
      </fieldset>
    </div>
    <div className='adv-card'>
      <fieldset><legend>触发阈值（连续失败 N 次 或 窗口内累计）</legend><div className='adv-grid'>
        <NumField label='连续失败' value={draft.trigger.consecutive} locked={locked.has('trigger.consecutive')} onChange={v => patchSub('trigger', 'consecutive', v)} />
        <NumField label='窗口大小' value={draft.trigger.windowSize} locked={locked.has('trigger.windowSize')} onChange={v => patchSub('trigger', 'windowSize', v)} />
        <NumField label='窗口累计' value={draft.trigger.windowFires} locked={locked.has('trigger.windowFires')} onChange={v => patchSub('trigger', 'windowFires', v)} />
        <NumField label='冷却步数' value={draft.trigger.cooldown} locked={locked.has('trigger.cooldown')} onChange={v => patchSub('trigger', 'cooldown', v)} />
        <NumField label='介入上限' value={draft.trigger.maxInterventions} locked={locked.has('trigger.maxInterventions')} onChange={v => patchSub('trigger', 'maxInterventions', v)} />
      </div></fieldset>
    </div>
    <div className='adv-card'>
      <fieldset><legend>防噪护栏</legend><div className='adv-grid'>
        <NumField label='每轮预算' value={draft.guards.budgetPerTurn} locked={locked.has('guards.budgetPerTurn')} onChange={v => patchSub('guards', 'budgetPerTurn', v)} />
        <NumField label='总预算' value={draft.guards.budgetCap} locked={locked.has('guards.budgetCap')} onChange={v => patchSub('guards', 'budgetCap', v)} />
        <NumField label='免疫轮数' value={draft.guards.immunityTurns} locked={locked.has('guards.immunityTurns')} onChange={v => patchSub('guards', 'immunityTurns', v)} />
      </div></fieldset>
    </div>
    <div className='adv-actions'>
      <button disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>
      {notice !== undefined ? <p className='adv-note'>{notice}</p> : null}
      {error !== undefined ? <p role='alert'>{error}</p> : null}
    </div>
    {payload.file !== undefined ? <p className='adv-note'>{'用户层：' + payload.file}</p> : null}
  </section>
}
