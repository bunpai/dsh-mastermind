// build —— 军师模式插件本地构建（无打包器、无 Bun 依赖）。
//
// 产出（对齐 package.json exports "types/default" 与 main）：
//   lib/**/*.js + **/*.d.ts —— host 半：逐文件 TypeScript 转译（ESNext，
//     import 保留 .js 相对引用，NodeNext 形状），@deepseek-ai/* 由宿主
//     profile workspace 提供运行时；
//   lib/client/index.js      —— client 半：src/client/** 逐文件 CJS 转译后
//     装进 window.__ModuleLoader__ 壳 + 极简相对路径 require 表（对齐
//     fusion-next lib/client.js 产物形态；react/react/jsx-runtime/
//     @deepseek-ai/* 透传给宿主 ModuleLoader 的 require）。
//
// typescript 来源：本包 node_modules 优先，回退到同仓
// fusion-next-source-review/node_modules（本机原型路径）。
// 注意：宿主安装面不执行本脚本——发布包必须已含 lib/（见 README）。
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

function loadDep(name) {
  const candidates = [
    path.resolve(process.cwd(), 'node_modules', name),
    path.resolve(process.cwd(), '..', 'fusion-next-source-review', 'node_modules', name),
  ]
  for (const candidate of candidates) {
    try { return require(candidate) } catch {}
  }
  throw new Error('[dsh-advisor-mode] ' + name + ' 不可用：请在插件目录 npm install，或保留同仓 fusion-next-source-review 目录。')
}

const ts = loadDep('typescript')
const SRC = path.resolve(process.cwd(), 'src')
const LIB = path.resolve(process.cwd(), 'lib')
const CLIENT_SRC = path.join(SRC, 'client')

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(p))
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

await rm(LIB, { recursive: true, force: true })
const files = await walk(SRC)
let jsCount = 0
let dtsCount = 0
const clientModules = []  // { spec, cjs }
for (const file of files) {
  const rel = path.relative(SRC, file)
  const isClient = rel.startsWith('client' + path.sep) || rel.startsWith('client/')
  const source = await readFile(file, 'utf8')
  const { outputText, declarationText } = ts.transpileModule(source, {
    fileName: rel,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: isClient ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      declaration: true,
      esModuleInterop: true,
    },
  })
  const outBase = path.join(LIB, rel.replace(/\.tsx?$/, ''))
  await mkdir(path.dirname(outBase), { recursive: true })
  if (isClient) {
    clientModules.push({ spec: './' + path.relative(CLIENT_SRC, file).replace(/\\/g, '/'), cjs: outputText })
  } else {
    await writeFile(outBase + '.js', outputText, 'utf8')
    jsCount += 1
  }
  if (declarationText !== undefined && declarationText !== '') {
    await writeFile(outBase + '.d.ts', declarationText, 'utf8')
    dtsCount += 1
  }
}

// client 半：ModuleLoader 壳 + 相对 require 表（host spec 透传给宿主 require）
const moduleTable = clientModules.map(m =>
  '    ' + JSON.stringify(m.spec) + ': function (require, module, exports) {\n' + m.cjs + '\n    },'
).join('\n')
const clientShell = [
  'window.__ModuleLoader__.load({',
  '  id: "dsh-advisor-mode",',
  '  factory: (hostRequire) => {',
  '    const __modules = {',
  moduleTable,
  '    };',
  '    const __cache = {};',
  '    const __req = (spec) => {',
  '      let key = spec;',
  '      if (spec.startsWith(\'./\')) {',
  '        if (__modules[spec] === undefined) {',
  '          for (const ext of [\'.ts\', \'.tsx\']) if (__modules[spec + ext] !== undefined) { key = spec + ext; break }',
  '        }',
  '        if (__modules[key] === undefined) throw new Error(\'advisor client: unknown module \' + spec);',
  '        if (__cache[key] === undefined) {',
  '          const m = { exports: {} };',
  '          __modules[key](__req, m, m.exports);',
  '          __cache[key] = m.exports;',
  '        }',
  '        return __cache[key];',
  '      }',
  '      return hostRequire(spec);',
  '    };',
  '    return __req(\'./index.ts\');',
  '  },',
  '});',
  '',
].join('\n')
await writeFile(path.join(LIB, 'client', 'index.js'), clientShell, 'utf8')
await writeFile(path.join(LIB, 'client', 'index.d.ts'),
  'export declare const name: string\nexport declare const inject: string[]\nexport declare function apply(ctx: unknown): void\n', 'utf8')

console.log('[dsh-advisor-mode] 构建完成：lib/**（' + jsCount + ' js / ' + dtsCount + ' d.ts；client 半 = ' + clientModules.length + ' 模块进 ModuleLoader 壳）')
