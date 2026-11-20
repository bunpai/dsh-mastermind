// vitest —— 在无本地依赖的原型目录直接可跑：
//   ../fusion-next-source-review/node_modules/.bin/vitest run
// resolve.alias 借用兄弟目录 fusion-next 的 node_modules 提供宿主 peer
// 包（仅测试面需要；插件运行时这些包由宿主 profile workspace 提供）。
// 注意 fileURLToPath：URL.pathname 会把中文目录（插件）百分号编码。
import { fileURLToPath } from 'node:url'

const sibling = fileURLToPath(new URL('../fusion-next-source-review/node_modules/', import.meta.url))
const at = (pkg: string): string => sibling + pkg

export default {
  resolve: {
    alias: [
      { find: /^@deepseek-ai\/cordis$/, replacement: at('@deepseek-ai/cordis') },
      { find: /^@deepseek-ai\/dsh-agent$/, replacement: at('@deepseek-ai/dsh-agent') },
      { find: /^@deepseek-ai\/dsh-llm$/, replacement: at('@deepseek-ai/dsh-llm') },
      { find: /^@deepseek-ai\/dsh-session$/, replacement: at('@deepseek-ai/dsh-session') },
      { find: /^@deepseek-ai\/dsh-settings$/, replacement: at('@deepseek-ai/dsh-settings') },
      { find: /^@deepseek-ai\/dsh-system-prompt$/, replacement: at('@deepseek-ai/dsh-system-prompt') },
      { find: /^@deepseek-ai\/dsh-tools$/, replacement: at('@deepseek-ai/dsh-tools') },
      { find: /^schemastery$/, replacement: at('schemastery') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}
