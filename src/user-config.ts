/**
 * user-config —— 用户层配置（GUI 设置卡片的持久层）。
 *
 * 三层合成序（设计 §8）：schema 默认 → 用户层（~/.dsh/advisor/settings.json）
 * → 插件组合层（cordis.patch.yml config:，最高优先——组合层显式写死的键
 * 在卡片里锁定为只读）。
 *
 * 与审计同目录（工作区外，Worker 摸不到）；JSON 小文件，读用同步版本
 * （apply() 是同步路径，文件缺失/损坏一律回 {}）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { Config } from './config-types.js'
import { DEFAULT_CONFIG } from './config.js'

export function userConfigPath(): string {
  return join(homedir(), '.dsh', 'advisor', 'settings.json')
}

/** 仅拷贝已定义键（undefined 不覆盖基线） */
function assignDefined<T extends object>(target: T, src: Partial<T> | undefined): void {
  if (src === undefined) return
  for (const k of Object.keys(src) as (keyof T)[]) {
    const v = src[k]
    if (v !== undefined) target[k] = v
  }
}

/** 把单层补丁叠到完整配置上（顶层标量 + trigger/guards 深合并） */
export function applyLayer(base: Config, layer: Partial<Config> | undefined): Config {
  const l = layer ?? {}
  const out: Config = { ...base, trigger: { ...base.trigger }, guards: { ...base.guards }, context: { ...base.context } }
  assignDefined(out.trigger, l.trigger)
  assignDefined(out.guards, l.guards)
  assignDefined(out.context, l.context)
  for (const key of ['enabled', 'plan', 'followup', 'consult', 'advisorProvider', 'advisorModel', 'advisorEffort', 'planEffort', 'planMode', 'promptLanguage'] as const) {
    const v = l[key]
    if (v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}

/** 三层合成：默认 → 用户 → 组合层（组合层胜出） */
export function composeConfig(user: Partial<Config>, patch: Partial<Config>): Config {
  return applyLayer(applyLayer(DEFAULT_CONFIG, user), patch)
}

/** 组合层显式写死的叶子路径（卡片据此锁字段），如 ['enabled','trigger.consecutive'] */
export function lockedPaths(patch: Partial<Config> | undefined): string[] {
  const l = patch ?? {}
  const out: string[] = []
  for (const k of ['enabled', 'plan', 'followup', 'consult', 'advisorProvider', 'advisorModel', 'advisorEffort', 'planEffort', 'planMode', 'promptLanguage'] as const) {
    if (l[k] !== undefined) out.push(k)
  }
  for (const k of Object.keys(l.trigger ?? {})) out.push('trigger.' + k)
  for (const k of Object.keys(l.guards ?? {})) out.push('guards.' + k)
  for (const k of Object.keys(l.context ?? {})) out.push('context.' + k)
  return out
}

/** 同步读用户层（缺失/损坏 → {}；启动路径用） */
export function readUserConfigSync(): Partial<Config> {
  try {
    const v: unknown = JSON.parse(readFileSync(userConfigPath(), 'utf8'))
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Partial<Config> : {}
  } catch {
    return {}
  }
}

/** 写用户层（创建目录；写坏抛给调用方，由 api 层转成 500） */
export function writeUserConfigSync(user: Partial<Config>): void {
  const file = userConfigPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(user, null, 2) + '\n', 'utf8')
}
