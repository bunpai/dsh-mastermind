/**
 * patch-locks —— 组合层显式键探测（设置卡片『锁定字段』的真值来源）。
 *
 * 为什么不能信 apply() 的 config 参数：cordis 会先用 ConfigSchema 把缺省
 * 补齐再传进来——schema 填的默认和 patch 显式写死在该对象上无法区分。
 * 唯一诚实的来源是 patch 文件本身：
 *   ① 插件自带 bundle patch：包根 cordis.patch.yml（import.meta.url 定位）
 *   ② profile patch：$DSH_HOME/profiles/<--profile 参数>/cordis.patch.yml
 * 两份里 dsh-advisor-mode 的 config: 块显式出现的叶子路径即锁定集。
 * 不引 yaml 依赖：对块级 2 层嵌套做缩进扫描（本插件 patch 面足够规整）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

interface YamlLine { indent: number; text: string }

function linesOf(file: string): YamlLine[] | undefined {
  if (!existsSync(file)) return undefined
  return readFileSync(file, 'utf8').split(/\r?\n/).map(raw => {
    const stripped = raw.replace(/#.*$/, '').replace(/\s+$/, '')
    const indent = stripped.length - stripped.trimStart().length
    return { indent, text: stripped.trim() }
  })
}

/** 在 patch 文档里定位 `- id: <pluginId>` 条目块内的 config: 段行区间 */
function findConfigBlock(lines: YamlLine[], pluginId: string): YamlLine[] | undefined {
  // 条目头：'- id: xxx' 或独立行 'id: xxx'（兼容 insert: 包裹形状）
  let inItem = false
  let itemIndent = -1
  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i]
    if (text === '') continue
    if (!inItem) {
      if (text === '- id: ' + pluginId || text === 'id: ' + pluginId) { inItem = true; itemIndent = indent; continue }
      continue
    }
    // 下一个同级/更浅条目头终止当前条目
    if (indent <= itemIndent && (text.startsWith('- id:') || text.startsWith('id:'))) break
    if (text === 'config:') {
      const cfgIndent = indent
      const block: YamlLine[] = []
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]
        if (l.text === '') continue
        if (l.indent <= cfgIndent) break
        block.push(l)
      }
      return block
    }
  }
  return undefined
}

/** config 块 → 叶子路径集（顶层键 + section.leaf 两层） */
function blockToPaths(block: YamlLine[]): string[] {
  const out: string[] = []
  const keyIndent = block[0]?.indent ?? -1
  let section = ''
  for (const l of block) {
    if (l.indent === keyIndent) {
      const m = /^([A-Za-z0-9_]+):/.exec(l.text)
      if (!m) continue
      const key = m[1]
      const hasValue = l.text.slice(m[0].length).trim() !== ''
      if (hasValue) { out.push(key); section = '' }
      else { out.push(key); section = key }
    } else if (l.indent > keyIndent && section !== '') {
      const m = /^([A-Za-z0-9_]+):/.exec(l.text)
      if (m) out.push(section + '.' + m[1])
    }
  }
  return out
}

function pluginPatchPath(): string {
  // lib/patch-locks.js → 包根；src 形态跑（tests）时 ../ 也到包根
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'cordis.patch.yml')
}

function profilePatchPath(): string | undefined {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const argv = process.argv
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--profile') return join(home, 'profiles', argv[i + 1], 'cordis.patch.yml')
  }
  const eq = argv.find(a => a.startsWith('--profile='))
  if (eq !== undefined) return join(home, 'profiles', eq.slice('--profile='.length), 'cordis.patch.yml')
  return undefined
}

/** 两份 patch 中本插件 config 显式叶子路径的并集（找不到文件 → 该层无锁） */
export function readPatchLockedPaths(pluginId = 'dsh-advisor-mode'): string[] {
  const paths = new Set<string>()
  for (const file of [pluginPatchPath(), profilePatchPath()]) {
    if (file === undefined) continue
    const lines = linesOf(file)
    if (lines === undefined) continue
    const block = findConfigBlock(lines, pluginId)
    if (block === undefined) continue
    for (const p of blockToPaths(block)) paths.add(p)
  }
  return [...paths]
}

/**
 * 把 schema 补全后的 config 参数裁剪回『patch 字面键』：
 * cordis 传入的 config 是全量解析结果，若直接当组合层会遮蔽用户层
 * （schema 默认值被当成 patch 显式值）。locked 里的顶层键（非 trigger/guards
 * 容器）整段保留；trigger./guards. 叶子路径逐键保留。
 */
export function maskToLiteralPatch<T extends Record<string, unknown>>(config: T, locked: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const path of locked) {
    const dot = path.indexOf('.')
    if (dot < 0) {
      const key = path
      if (key === 'trigger' || key === 'guards') continue // 容器键由叶子路径覆盖
      if (key in config) out[key] = config[key]
      continue
    }
    const section = path.slice(0, dot)
    const leaf = path.slice(dot + 1)
    const src = config[section]
    if (src === null || typeof src !== 'object') continue
    const srcObj = src as Record<string, unknown>
    if (!(leaf in srcObj)) continue
    const dst = (out[section] ??= {}) as Record<string, unknown>
    dst[leaf] = srcObj[leaf]
  }
  return out as Partial<T>
}
