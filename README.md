# dsh-advisor-mode — DSH「顾问模式」插件（原型 v0.1.0）

一句话：Worker（执行模型）主导干活；只在卡点时请教顾问（Advisor，一个更强的模型）。三条介入点：

1. **开场计划**（plan）：会话**首个工具结果提交时**，顾问产出 3–6 步开工计划，以 PLAN 通知注入（触发点在 tools/result 而非 agent/request：后者时机上任务消息尚未提交进历史，顾问看不到任务原文，只能产通用套路计划——实测教训）。代价：纯文本零工具的 turn 拿不到开场计划。
2. **卡点 followup**（followup）：工具结果流水线检测到失败积压（连续 3 次，或 10 步窗口内 4 次）→ 顾问裁决 CONTINUE / ADJUST / STOP（STOP 经 steer 打断转交用户，不硬取消）。
3. **consult_advisor 工具**（consult）：Worker 遇到拿不准的地方可随时主动咨询，自带“何时用/何时不用”纪律。

## 工作机制速览

- **卡点检测**（src/signals.ts + src/trigger.ts）：结构化失败标签（bash-exit / bash-timeout / aborted / denied-sandbox / stale-version / schema-invalid）+ 语义小表（empty-search：grep/tgrep/glob 带非空 pattern 零命中；not-found：read ENOENT；quota：web 429）。阈值抄 QwenPaw 默认：连续 3 次失败=stuck（同一参数重复失败）、10 步窗口 4 次=struggling、每会话最多 3 次自动介入、fire 后计数清零。
- **裁决契约**（src/advisor.ts + src/prompts.ts）：顾问输出首行必须是 CONTINUE|ADJUST|STOP（容忍 markdown 装饰），可带第二行 SEVERITY: nit|concern|blocker（缺省 STOP→blocker，其余→concern；超窗忽略）。解析失败自动重试 2 次并附纠正提示；仍失败按 ADJUST 全文兜底注入（宁多勿丢）。
- **失败全降级，绝不阻断**：计划失败→无计划继续；followup 失败→视为未触发；咨询失败→返回 FALLBACK_ADVICE（不消耗咨询额度）。顾问不可达时 Worker 无感。
- **迟到投递账本**（src/runtime.ts）：turn 结束快于顾问响应时（trivial 任务实测出现过：turn 2s、顾问 8s），inject 落空的意见进 FIFO 账本（上限 3 条，丢最旧），下一个工具结果提交时（必然 mid-turn、会话活跃）冲账投递；审计行带 `queued: !delivered`。STOP 降级为 ADJUST 入账（steer 对已死 turn 无意义）。
- **防打扰护栏**（src/guards.ts，抄 omp emission-guard 的思路）：admit 顺序=空文本→噪声表（“好的/继续/ok/lgtm…”）→同内容去重（仅严重度严格升阶可复提，FIFO 4096）→每轮预算 4 / 会话上限 32（blocker 豁免）→投递成功后 3 轮免疫。被压制时把原因回执给顾问，下一轮请求自动附带。
- **自包含请求**：每次顾问请求独立成篇=任务原文+开场计划（若有）+最近 20 条消息裁剪（保头尾），附剩余介入预算（Anthropic advisor 的预算技巧）。顾问不持工具、不读文件。
- **审计**（src/audit.ts）：每次顾问互动一行 JSON 追加到 ~/.dsh/advisor/<session>.jsonl（工作区外），便于事后复盘；对话页的「顾问」视图实时聚合展示此文件。

## 安装（本机实测地面真值，2026-11-19 官方安装器真装验证）

- **CLI 安装（含本地路径，已验证）**：`dsh plugin --profile <name> add github:bunpai/dsh-mastermind`（本地路径 `dsh plugin --profile <name> add ./dsh-advisor-mode` 亦可，实测输出 `+ dsh-advisor-mode link:…` 通过）。
- **仓库名说明**：GitHub 仓库叫 `dsh-mastermind`（“军师”的俏皮说法），但包名/插件 id 仍是 `dsh-advisor-mode`——安装后 DSH 里显示 `dsh-advisor-mode`，两者不冲突。
- 安装器的真实接线（与早期说法不同，以此为准）：写入 profile 的 **package.json dependencies（本地路径为 link: 符号链接协议）** + **dsh.profile.bundles 数组追加插件名**（ bundles 数组就是挂载清单，`.plugin-manager` 只是日志）。插件本体经由插件的 bundle.patch（cordis.patch.yml 的 insert 条目）注入宿主。
- **本地路径 link: 安装的依赖解析注意**：Node 从符号链接真实路径向上解析模块，插件运行时的 peer 依赖（@deepseek-ai/dsh-llm、@deepseek-ai/dsh-tools、schemastery）找不到时，需在插件 node_modules 下补符号链接指向全局 dsh 安装根（本机三链已补，属 link: 安装的固有粗糙处；正常 npm/pnpm 包安装无此问题）。
- **DSH Studio 桌面**市场路径照旧可用；发布包必须已含 lib/（本仓库已构建）。装完重启生效。
-`~/.dsh/plugins/<name>/` 只是状态/记录目录；插件代码真正通过 profile workspace（~/.dsh/profiles/*）依赖注入 + `cordis.patch.yml` 的 bundle.patch 打入宿主。
- `dshx.yml` 是 dshx 开发工具的 manifest，**宿主运行时不读它**——保留无害，但别把它当宿主必需。
- **2026-11-20 github: 真装踩坑记录**（DSH 宿主侧，与本插件无关但会撞上）：①安装器调 corepack pnpm 时写死 `bin/pnpm.cjs`，pnpm≥12 已改为 `pnpm.mjs`，git 安装会报 `MODULE_NOT_FOUND …/pnpm/12.x/bin/pnpm.cjs`——临时解法是往该目录软链一个可用的 pnpm.cjs，或等宿主修复；②`dsh plugin add` 只做 pnpm 安装，bundles/patch 接线由插件管理器在 profile 启动/市场安装流程里 reconcile 自动完成（bundle 依赖会自动补进 `dsh.profile.bundles`），装完重启即生效，无需手工接线。
- **import 注意**：插件代码引 `@deepseek-ai/schemastery`（scoped），不是裸 `schemastery`——运行时解析表只路由安装声明的包名。

## 配置（三层合成：schema 默认 → 用户层 → 组合层 patch 胜出）

| 键 | 默认 | 说明 |
|---|---|---|
| enabled | true | 总开关 |
| plan / followup / consult | true | 三介入点各自开关 |
| trigger.consecutive | 3 | 连续失败阈值（stuck） |
| trigger.windowSize / trigger.windowFires | 10 / 4 | 滑窗困境阈值（struggling） |
| trigger.cooldown | 0 | fire 后静默步数 |
| trigger.maxInterventions | 3 | 每会话自动介入上限 |
| guards.budgetPerTurn / budgetCap / immunityTurns | 4 / 32 / 3 | 护栏：每轮预算 / 会话上限 / 免疫轮数 |
| advisorProvider / advisorModel | 空 | 顾问模型；两槽都填才算显式指定，否则回落 Worker 当前模型 |
| advisorEffort | 空 | 顾问推理力度（模型支持时） |

**GUI 设置卡片（模型入口在这里）**：设置页 →「顾问模式」卡片（src/client/，经 `ctx.slots.inject('settings.section')` 注册，宿主范式照 fusion-next）。卡片提供：启用/三介入点开关、顾问模型下拉（实时拉取宿主模型目录、按 provider 分组、空值=跟随执行模型）、推理强度下拉（随所选模型的 efforts 动态出现）、触发阈值与护栏数值域。被组合层 patch 显式写死的键在卡片里显示「锁定」禁用态。保存 → POST /api/dsh-advisor-mode → 写用户层文件 `$HOME/.dsh/advisor/settings.json`（与审计 JSONL 同目录）并即时生效，无需重启。

**会话级开关 + 顾问活动页（对话界面内）**：输入框右侧、与模型选择器同排有「顾问」药丸（src/client/AdvisorDock.tsx，经 `conversation.input.right` 槽位注册——该槽位草稿页与活跃会话页都挂载，因此**新建会话时就能先选要不要顾问**；草稿本身携带真会话 id，覆盖随会话出生自动生效）——点击即对**当前会话**单独开/关顾问（进程内存覆盖，不影响其他会话与全局设置；右键清覆盖回落全局），药丸上顺带显示本会话顾问 token 消耗（3s 轮询）。对话/轨迹旁的第三个 tab「顾问」（src/client/AdvisorView.tsx，经 `conversation.view` 注册）展示本会话顾问活动：调用次数、输入/输出 token 汇总、按介入类型分桶，以及事件流（时间/类型/裁决/顾问模型/抑制原因/每次的 token 数）。数据源=审计 JSONL 经 `GET /api/dsh-advisor-mode?view=session&session=<id>` 聚合；开关写 `POST ?scope=session {session:{id,enabled:boolean|null}}`。

**后端**（src/api.ts + src/patch-locks.ts）：GET ?view=settings 返回 {config 生效值, user 用户层, locked 锁定集, catalog 模型目录, file}；POST 白名单校验（布尔/字符串≤128/整数边界）+ 剥锁定键 → 写盘 → 活应用。另两支会话端面：`GET ?view=session&session=<id>` 聚合审计 JSONL（事件尾部 50 + token 汇总 + 开关态），`POST ?scope=session` 写 sessionEnabled 覆盖表（index.ts 的 isEnabledFor 闸被 tools/result 与 consult 共用）。本机回源守卫 + 64KB 上限。**锁定集真值**：cordis 会把 ConfigSchema 默认补齐后才传进 apply()，因此字面锁只能从 patch 文件本身读——readPatchLockedPaths() 扫插件包根 cordis.patch.yml + $DSH_HOME/profiles/<--profile>/cordis.patch.yml 中本插件的 config 块（缩进解析，无 yaml 依赖），compose 也用裁过的 literalPatch，否则 schema 默认会遮蔽用户层。

三个出厂旋钮的取向：**骨架写法对齐 dsh-advisor-plugin、阈值抄 QwenPaw 默认、顾问模型未配置=回落 Worker 同款**。consult_advisor 工具的咨询额度独立计（每会话 guards.budgetCap 次），用尽返回提示而不烧顾问。

## 构建与测试

本仓库零依赖安装即可构建/测试（vitest/tsc 借邻目录 `fusion-next-source-review/node_modules`）：

```bash
零依赖构建（产出 lib/**，GitHub 分发用）：
node scripts/build.mjs

全量单测（11 文件 56 测）：
../fusion-next-source-review/node_modules/.bin/vitest run
```

vitest 通过别名把 @deepseek-ai/dsh-* 系包与 schemastery 解析到 fusion-next 的 node_modules（见 vitest.config.ts），无需在本仓库 npm install。

## 模块-参考对照表

| 本插件 | 语义 | 参考 |
|---|---|---|
| src/signals.ts | 失败分类（结构化标签+语义小表） | QwenPaw 失败面贴着 DSH 平台落地 |
| src/trigger.ts | 连击/窗口阈值、stuck vs struggling | QwenPaw advisor/trigger.py 语义 |
| src/guards.ts | 噪声表、升阶去重、预算、免疫 | omp emission-guard.ts 的防打扰谱系 |
| src/advisor.ts | 首行裁决、重试、全文兜底 | 设计§4 + Anthropic advisor-tool 契约 |
| src/tools.ts | consult_advisor 工具 | QwenPaw advisor/tools.py + dsh-tools defineTool 契约 |
| src/plan.ts / runtime.ts | 三介入点挂载与编排 | QwenPaw advisor/hooks.py 挂载点 |
| src/inject.ts | 意见投递（inject/steer/notice） | dsh-advisor-plugin 实测教训（patrol 尾注入） |
| src/history.ts | 自包含顾问请求快照 | Anthropic advisor 自包含请求技巧 |
| src/schema.ts / config.ts / user-config.ts | 配置面、三层合成、用户层读写 | schemastery Schema + 用户层 JSON 文件 |
| src/patch-locks.ts / api.ts | 锁定集真值探测、设置卡片后端、会话开关/聚合 API | fusion-next webServer.register 活例 |
| src/session-stats.ts | 会话审计聚合（token/事件尾部） | 只读 audit JSONL 的展示侧 |
| src/client/index.ts + AdvisorSettings.tsx | 设置页「顾问模式」卡片 | fusion-next slots.inject('settings.section') 活例 |
| src/client/AdvisorDock.tsx + AdvisorView.tsx | input.right 顾问开关（草稿页也可用）、对话页「顾问」活动视图 | conversation.input.right / conversation.view 槽位契约 |

## 阶段 1/2 未竟清单（诚实）

- 语义层失败规则可继续扩充（现仅 empty-search / not-found / quota 三条）。
- ~~live 实测未做~~ → live 已验证：官方安装器真装进独立 profile，开场计划/审计文件/delivered 注入链路全通（详见 ../顾问模式-eval/）。
- nit 严重度的“非打断卡片”通道未做（现状一律注入/steer）。
- 防级联机关②（打断作废+终局补审）未做。
- 后台 job 失败不计数（tools/result 无 exec.agent 时跳过）。
- 顾问=Worker 同模型时无自动降级提示。

---

License: MIT。
