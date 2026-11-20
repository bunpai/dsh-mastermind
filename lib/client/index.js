window.__ModuleLoader__.load({
  id: "dsh-advisor-mode",
  factory: (hostRequire) => {
    const __modules = {
    "./AdvisorDock.tsx": function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvisorDock = AdvisorDock;
const jsx_runtime_1 = require("react/jsx-runtime");
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
const react_1 = require("react");
const styles = [
    '.advisor-dock{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:13px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer;user-select:none;white-space:nowrap}',
    '.advisor-dock:hover{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-border-l2))}',
    '.advisor-dock.adv-on{color:var(--dsw-alias-brand-primary,#7c5cff);border-color:var(--dsw-alias-brand-primary,#7c5cff);background:var(--dsw-alias-bg-brand-weaker,rgba(124,92,255,.08))}',
    '.advisor-dock:disabled{opacity:.55;cursor:not-allowed}',
    '.advisor-dock .adv-dot{width:6px;height:6px;border-radius:3px;background:currentColor;opacity:.5}',
    '.advisor-dock.adv-on .adv-dot{opacity:1}',
    '.advisor-dock .adv-tokens{opacity:.75;font-variant-numeric:tabular-nums}',
].join('\n');
const fmtTokens = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
function AdvisorDock({ sessionId }) {
    const draft = sessionId === undefined || sessionId === '';
    const [data, setData] = (0, react_1.useState)();
    const [locked, setLocked] = (0, react_1.useState)(false);
    const [busy, setBusy] = (0, react_1.useState)(false);
    const seq = (0, react_1.useRef)(0);
    (0, react_1.useEffect)(() => {
        let dead = false;
        if (draft) {
            // 草稿页：读全局开关 + enabled 是否被组合层锁死
            void fetch('/api/dsh-advisor-mode?view=settings', { credentials: 'same-origin', cache: 'no-store' })
                .then(async (res) => {
                if (!res.ok)
                    throw new Error('HTTP ' + res.status);
                const p = await res.json();
                if (dead)
                    return;
                setData(d => ({ totals: d?.totals ?? { calls: 0, inputTokens: 0, outputTokens: 0 }, override: null, enabled: p.config.enabled }));
                setLocked(p.locked.includes('enabled'));
            })
                .catch(() => { });
            return () => { dead = true; };
        }
        const tick = () => {
            const mine = ++seq.current;
            void fetch('/api/dsh-advisor-mode?view=session&session=' + encodeURIComponent(sessionId), { credentials: 'same-origin', cache: 'no-store' })
                .then(async (res) => {
                if (!res.ok)
                    throw new Error('HTTP ' + res.status);
                const p = await res.json();
                if (!dead && seq.current === mine)
                    setData(p);
            })
                .catch(() => { });
        };
        tick();
        const timer = setInterval(tick, 3000);
        return () => { dead = true; clearInterval(timer); };
    }, [sessionId, draft]);
    const toggle = () => {
        if (busy || (draft && locked))
            return;
        setBusy(true);
        const next = !(data?.enabled ?? false);
        if (draft) {
            void fetch('/api/dsh-advisor-mode', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ config: { enabled: next } }),
            }).then(async (res) => {
                if (res.ok) {
                    // 以回执为准：被组合层锁的键进 ignored，不能乐观翻转
                    const p = await res.json();
                    setData(d => d === undefined ? d : { ...d, enabled: p.config?.enabled ?? d.enabled });
                    if (p.ignored?.includes('enabled'))
                        setLocked(true);
                }
            }).catch(() => { }).finally(() => setBusy(false));
            return;
        }
        void fetch('/api/dsh-advisor-mode?scope=session', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: { id: sessionId, enabled: next } }),
        }).then(async (res) => {
            if (res.ok) {
                const p = await res.json();
                setData(d => d === undefined ? { enabled: p.enabled, override: p.override, totals: { calls: 0, inputTokens: 0, outputTokens: 0 } } : { ...d, enabled: p.enabled, override: p.override });
            }
        }).catch(() => { }).finally(() => setBusy(false));
    };
    const clearOverride = (e) => {
        e.preventDefault();
        if (draft)
            return;
        void fetch('/api/dsh-advisor-mode?scope=session', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: { id: sessionId, enabled: null } }),
        }).then(async (res) => {
            if (res.ok) {
                const p = await res.json();
                setData(d => d === undefined ? d : { ...d, enabled: p.enabled, override: p.override });
            }
        }).catch(() => { });
    };
    const on = data?.enabled ?? false;
    const hasOverride = data?.override !== null && data?.override !== undefined;
    const tokens = (data?.totals.inputTokens ?? 0) + (data?.totals.outputTokens ?? 0);
    const title = draft
        ? (locked ? '顾问模式（全局）——被组合层 patch 锁死，不可改' : '顾问模式（全局开关）：新会话将按此状态启动')
        : '顾问模式：点击切换本会话开关' + (hasOverride ? '（会话覆盖，右键清覆盖回落全局）' : '（跟随全局设置）');
    return (0, jsx_runtime_1.jsxs)("button", { type: 'button', className: 'advisor-dock' + (on ? ' adv-on' : ''), title: title, onClick: toggle, onContextMenu: clearOverride, disabled: busy || (draft && locked), children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("span", { className: 'adv-dot' }), (0, jsx_runtime_1.jsxs)("span", { children: ["\u987E\u95EE ", on ? '开' : '关'] }), !draft && tokens > 0 && (0, jsx_runtime_1.jsx)("span", { className: 'adv-tokens', children: fmtTokens(tokens) })] });
}

    },
    "./AdvisorSettings.tsx": function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvisorSettings = AdvisorSettings;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * AdvisorSettings —— 顾问模式设置卡片（client 半）。
 *
 * 数据通道：host 半 /api/dsh-advisor-mode（src/api.ts）——
 *   GET  ?view=settings → { config（生效值）, locked（组合层锁）, catalog, file }
 *   POST {config}       → 白名单校验 → 写用户层 → 活应用
 * 组合层（cordis.patch.yml）显式写死的字段渲染为禁用，提示去 patch 改。
 */
const react_1 = require("react");
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
].join('\n');
const routeKey = (provider, model) => provider === '' ? '' : JSON.stringify([provider, model]);
function NumField({ label, value, locked, onChange }) {
    return (0, jsx_runtime_1.jsxs)("label", { children: [label, (0, jsx_runtime_1.jsx)("input", { type: 'number', value: String(value), disabled: locked, onChange: e => onChange(Number(e.target.value)) })] });
}
function AdvisorSettings() {
    const [payload, setPayload] = (0, react_1.useState)();
    const [draft, setDraft] = (0, react_1.useState)();
    const [error, setError] = (0, react_1.useState)();
    const [notice, setNotice] = (0, react_1.useState)();
    const [saving, setSaving] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => {
        const abort = new AbortController();
        void fetch('/api/dsh-advisor-mode?view=settings', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })
            .then(async (res) => { if (!res.ok)
            throw new Error('HTTP ' + res.status); const p = await res.json(); setPayload(p); setDraft(p.config); })
            .catch(e => { if (!abort.signal.aborted)
            setError(e instanceof Error ? e.message : String(e)); });
        return () => abort.abort();
    }, []);
    if (error !== undefined && payload === undefined)
        return (0, jsx_runtime_1.jsxs)("section", { className: 'advisor-settings', children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("h2", { children: "\u987E\u95EE\u6A21\u5F0F" }), (0, jsx_runtime_1.jsx)("p", { role: 'alert', children: '无法读取设置：' + error })] });
    if (payload === undefined || draft === undefined)
        return (0, jsx_runtime_1.jsxs)("section", { className: 'advisor-settings', children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("h2", { children: "\u987E\u95EE\u6A21\u5F0F" }), (0, jsx_runtime_1.jsx)("p", { children: "\u52A0\u8F7D\u4E2D\u2026" })] });
    const locked = new Set(payload.locked);
    const catalog = payload.catalog ?? { groups: [] };
    const currentModel = catalog.groups.find(g => g.id === draft.advisorProvider)?.models.find(m => m.id === draft.advisorModel);
    const routeLocked = locked.has('advisorProvider') || locked.has('advisorModel');
    const patch = (k, v) => setDraft({ ...draft, [k]: v });
    const patchSub = (s, k, v) => setDraft({ ...draft, [s]: { ...draft[s], [k]: v } });
    const save = () => {
        setSaving(true);
        setError(undefined);
        setNotice(undefined);
        void fetch('/api/dsh-advisor-mode', {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: draft }),
        }).then(async (res) => {
            const body = await res.json();
            if (!res.ok)
                throw new Error(body.error ?? ('HTTP ' + res.status));
            if (body.config)
                setDraft(body.config);
            const ig = (body.ignored ?? []).length > 0 ? '（组合层锁定已忽略：' + (body.ignored ?? []).join('、') + '）' : '';
            setNotice('已保存' + ig);
        }).catch(e => setError(e instanceof Error ? e.message : String(e)))
            .finally(() => setSaving(false));
    };
    const checks = [
        { key: 'enabled', label: '启用顾问模式', hint: '总开关' },
        { key: 'plan', label: '开场计划', hint: '会话首个工具结果后问顾问要 plan' },
        { key: 'followup', label: '卡点自动介入', hint: '连续失败攒够阈值才触发' },
        { key: 'consult', label: 'consult_advisor 工具', hint: '执行模型自己升级咨询' },
    ];
    return (0, jsx_runtime_1.jsxs)("section", { className: 'advisor-settings', children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("h2", { children: "\u987E\u95EE\u6A21\u5F0F" }), (0, jsx_runtime_1.jsx)("p", { children: "\u5C0F\u6A21\u578B\u4E3B\u5BFC\u5E72\u6D3B\uFF0C\u9047\u5230\u5361\u70B9\u624D\u95EE\u987E\u95EE\u3002\u987E\u95EE\u6A21\u578B\u4E0E\u89E6\u53D1\u9608\u503C\u5728\u6B64\u914D\u7F6E\uFF1B\u88AB\u63D2\u4EF6\u7EC4\u5408\u5C42\u9501\u5B9A\u7684\u5B57\u6BB5\u663E\u793A\u4E3A\u7981\u7528\u3002" }), (0, jsx_runtime_1.jsx)("div", { className: 'adv-card', children: checks.map(c => (0, jsx_runtime_1.jsxs)("label", { className: 'adv-check', title: c.hint, children: [(0, jsx_runtime_1.jsx)("input", { type: 'checkbox', checked: draft[c.key], disabled: locked.has(c.key), onChange: e => patch(c.key, e.target.checked) }), (0, jsx_runtime_1.jsxs)("span", { children: [c.label, locked.has(c.key) ? '（锁定）' : ''] })] }, c.key)) }), (0, jsx_runtime_1.jsx)("div", { className: 'adv-card', children: (0, jsx_runtime_1.jsxs)("fieldset", { children: [(0, jsx_runtime_1.jsx)("legend", { children: "\u987E\u95EE\u6A21\u578B" }), (0, jsx_runtime_1.jsx)("p", { children: "\u4E0D\u9009\u5219\u8DDF\u968F\u4F1A\u8BDD\u5F53\u524D\u6267\u884C\u6A21\u578B\u3002" }), catalog.groups.length > 0 ? (0, jsx_runtime_1.jsxs)("label", { children: ["\u6A21\u578B", (0, jsx_runtime_1.jsxs)("select", { disabled: routeLocked, value: routeKey(draft.advisorProvider, draft.advisorModel), onChange: e => {
                                        if (e.target.value === '') {
                                            setDraft({ ...draft, advisorProvider: '', advisorModel: '', advisorEffort: '' });
                                            return;
                                        }
                                        const [provider, model] = JSON.parse(e.target.value);
                                        setDraft({ ...draft, advisorProvider: provider, advisorModel: model, advisorEffort: '' });
                                    }, children: [(0, jsx_runtime_1.jsx)("option", { value: '', children: "\u8DDF\u968F\u6267\u884C\u6A21\u578B" }), catalog.groups.map(g => (0, jsx_runtime_1.jsx)("optgroup", { label: g.name, children: g.models.map(m => (0, jsx_runtime_1.jsx)("option", { value: routeKey(g.id, m.id), children: m.name }, m.id)) }, g.id))] })] })
                            : (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("label", { children: ["Provider", (0, jsx_runtime_1.jsx)("input", { type: 'text', value: draft.advisorProvider, disabled: routeLocked, onChange: e => patch('advisorProvider', e.target.value), placeholder: '\u5982 cpa' })] }), (0, jsx_runtime_1.jsxs)("label", { children: ["\u6A21\u578B", (0, jsx_runtime_1.jsx)("input", { type: 'text', value: draft.advisorModel, disabled: routeLocked, onChange: e => patch('advisorModel', e.target.value), placeholder: '\u5982 devin/swe-2' })] })] }), currentModel?.reasoning !== undefined && draft.advisorModel !== '' ? (0, jsx_runtime_1.jsxs)("label", { children: ["\u63A8\u7406\u5F3A\u5EA6", (0, jsx_runtime_1.jsxs)("select", { disabled: locked.has('advisorEffort'), value: draft.advisorEffort, onChange: e => patch('advisorEffort', e.target.value), children: [(0, jsx_runtime_1.jsx)("option", { value: '', children: '模型默认' + (currentModel.reasoning.defaultEffort ? ' · ' + currentModel.reasoning.defaultEffort : '') }), currentModel.reasoning.efforts.map(e => (0, jsx_runtime_1.jsx)("option", { value: e.id, children: e.name }, e.id))] })] }) : null, routeLocked ? (0, jsx_runtime_1.jsx)("p", { className: 'adv-note', children: "\u6A21\u578B\u88AB\u63D2\u4EF6\u7EC4\u5408\u5C42\uFF08cordis.patch.yml\uFF09\u9501\u5B9A\uFF0C\u5230 patch \u91CC\u6539\u3002" }) : null] }) }), (0, jsx_runtime_1.jsx)("div", { className: 'adv-card', children: (0, jsx_runtime_1.jsxs)("fieldset", { children: [(0, jsx_runtime_1.jsx)("legend", { children: "\u89E6\u53D1\u9608\u503C\uFF08\u8FDE\u7EED\u5931\u8D25 N \u6B21 \u6216 \u7A97\u53E3\u5185\u7D2F\u8BA1\uFF09" }), (0, jsx_runtime_1.jsxs)("div", { className: 'adv-grid', children: [(0, jsx_runtime_1.jsx)(NumField, { label: '\u8FDE\u7EED\u5931\u8D25', value: draft.trigger.consecutive, locked: locked.has('trigger.consecutive'), onChange: v => patchSub('trigger', 'consecutive', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u7A97\u53E3\u5927\u5C0F', value: draft.trigger.windowSize, locked: locked.has('trigger.windowSize'), onChange: v => patchSub('trigger', 'windowSize', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u7A97\u53E3\u7D2F\u8BA1', value: draft.trigger.windowFires, locked: locked.has('trigger.windowFires'), onChange: v => patchSub('trigger', 'windowFires', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u51B7\u5374\u6B65\u6570', value: draft.trigger.cooldown, locked: locked.has('trigger.cooldown'), onChange: v => patchSub('trigger', 'cooldown', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u4ECB\u5165\u4E0A\u9650', value: draft.trigger.maxInterventions, locked: locked.has('trigger.maxInterventions'), onChange: v => patchSub('trigger', 'maxInterventions', v) })] })] }) }), (0, jsx_runtime_1.jsx)("div", { className: 'adv-card', children: (0, jsx_runtime_1.jsxs)("fieldset", { children: [(0, jsx_runtime_1.jsx)("legend", { children: "\u9632\u566A\u62A4\u680F" }), (0, jsx_runtime_1.jsxs)("div", { className: 'adv-grid', children: [(0, jsx_runtime_1.jsx)(NumField, { label: '\u6BCF\u8F6E\u9884\u7B97', value: draft.guards.budgetPerTurn, locked: locked.has('guards.budgetPerTurn'), onChange: v => patchSub('guards', 'budgetPerTurn', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u603B\u9884\u7B97', value: draft.guards.budgetCap, locked: locked.has('guards.budgetCap'), onChange: v => patchSub('guards', 'budgetCap', v) }), (0, jsx_runtime_1.jsx)(NumField, { label: '\u514D\u75AB\u8F6E\u6570', value: draft.guards.immunityTurns, locked: locked.has('guards.immunityTurns'), onChange: v => patchSub('guards', 'immunityTurns', v) })] })] }) }), (0, jsx_runtime_1.jsxs)("div", { className: 'adv-actions', children: [(0, jsx_runtime_1.jsx)("button", { disabled: saving, onClick: save, children: saving ? '保存中…' : '保存' }), notice !== undefined ? (0, jsx_runtime_1.jsx)("p", { className: 'adv-note', children: notice }) : null, error !== undefined ? (0, jsx_runtime_1.jsx)("p", { role: 'alert', children: error }) : null] }), payload.file !== undefined ? (0, jsx_runtime_1.jsx)("p", { className: 'adv-note', children: '用户层：' + payload.file }) : null] });
}

    },
    "./AdvisorView.tsx": function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdvisorView = AdvisorView;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * AdvisorView —— 会话顾问活动页（client 半）。
 *
 * 挂 conversation.view（list/session）：与 对话/轨迹/统计 并列的
 * 第四个视图，label '顾问'。展示本会话顾问的调用计数、token 消耗
 * 与事件流（plan/followup/consult 每次裁决、抑制原因、错误）。
 *
 * 数据：GET /api/dsh-advisor-mode?view=session&session=<id>，3s 轮询；
 * 源文件是 host 半写的 ~/.dsh/advisor/<session>.jsonl 审计日志。
 */
const react_1 = require("react");
const KIND_LABEL = { plan: '📋 开场计划', followup: '🔧 卡点介入', consult: '🧭 主动咨询' };
const KIND_FALLBACK = '✦ 介入';
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
].join('\n');
const fmtTime = (iso) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso.slice(0, 16) : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
};
const fmtTokens = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
function AdvisorView({ sessionId }) {
    const [data, setData] = (0, react_1.useState)();
    const [offline, setOffline] = (0, react_1.useState)(false);
    const seq = (0, react_1.useRef)(0);
    (0, react_1.useEffect)(() => {
        if (sessionId === undefined || sessionId === '') {
            setData(undefined);
            return;
        }
        let dead = false;
        const tick = () => {
            const mine = ++seq.current;
            void fetch('/api/dsh-advisor-mode?view=session&session=' + encodeURIComponent(sessionId), { credentials: 'same-origin', cache: 'no-store' })
                .then(async (res) => {
                if (!res.ok)
                    throw new Error('HTTP ' + res.status);
                const p = await res.json();
                if (!dead && seq.current === mine) {
                    setData(p);
                    setOffline(false);
                }
            })
                .catch(() => { if (!dead)
                setOffline(true); });
        };
        tick();
        const timer = setInterval(tick, 3000);
        return () => { dead = true; clearInterval(timer); };
    }, [sessionId]);
    if (sessionId === undefined || sessionId === '') {
        return (0, jsx_runtime_1.jsxs)("div", { className: 'advisor-view', children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("div", { className: 'adv-empty', children: "\u6B64\u9762\u677F\u9700\u4F1A\u8BDD\u4F5C\u7528\u57DF" })] });
    }
    const t = data?.totals;
    const events = data?.events ?? [];
    const stateLine = data === undefined
        ? (offline ? '后端 API 暂不可达——重试中' : '加载中…')
        : (data.enabled ? '本会话顾问：开' + (data.override !== null ? '（会话覆盖）' : '（跟随全局）') : '本会话顾问：关' + (data.override !== null ? '（会话覆盖）' : '（跟随全局）'));
    return (0, jsx_runtime_1.jsxs)("div", { className: 'advisor-view', children: [(0, jsx_runtime_1.jsx)("style", { children: styles }), (0, jsx_runtime_1.jsx)("h2", { children: "\u987E\u95EE\u6D3B\u52A8" }), (0, jsx_runtime_1.jsx)("p", { className: 'adv-sub', children: stateLine }), t !== undefined && (0, jsx_runtime_1.jsxs)("div", { className: 'adv-stats', children: [(0, jsx_runtime_1.jsxs)("div", { className: 'adv-stat', children: [(0, jsx_runtime_1.jsx)("b", { children: t.calls }), (0, jsx_runtime_1.jsx)("span", { children: "\u8C03\u7528\u6B21\u6570" })] }), (0, jsx_runtime_1.jsxs)("div", { className: 'adv-stat', children: [(0, jsx_runtime_1.jsx)("b", { children: fmtTokens(t.inputTokens) }), (0, jsx_runtime_1.jsx)("span", { children: "\u8F93\u5165 tokens" })] }), (0, jsx_runtime_1.jsxs)("div", { className: 'adv-stat', children: [(0, jsx_runtime_1.jsx)("b", { children: fmtTokens(t.outputTokens) }), (0, jsx_runtime_1.jsx)("span", { children: "\u8F93\u51FA tokens" })] }), Object.entries(t.byKind).map(([k, v]) => (0, jsx_runtime_1.jsxs)("div", { className: 'adv-stat', children: [(0, jsx_runtime_1.jsx)("b", { children: v.calls }), (0, jsx_runtime_1.jsx)("span", { children: (KIND_LABEL[k] ?? KIND_FALLBACK + ' ' + k) + ' · ' + fmtTokens(v.inputTokens + v.outputTokens) })] }, k))] }), events.length === 0
                ? (0, jsx_runtime_1.jsx)("div", { className: 'adv-empty', children: data === undefined ? '—' : '本会话还没有顾问调用记录' })
                : [...events].reverse().map((e, i) => (0, jsx_runtime_1.jsxs)("div", { className: 'adv-row' + (e.suppressedReason !== undefined ? ' adv-suppressed' : ''), children: [(0, jsx_runtime_1.jsx)("span", { className: 'adv-time', children: fmtTime(e.time) }), (0, jsx_runtime_1.jsx)("span", { className: 'adv-kind', children: KIND_LABEL[e.kind] ?? KIND_FALLBACK + ' ' + e.kind }), (0, jsx_runtime_1.jsxs)("span", { className: 'adv-body', children: [e.verdict !== undefined && (0, jsx_runtime_1.jsx)("span", { className: 'adv-verdict ' + e.verdict, children: e.verdict }), (0, jsx_runtime_1.jsx)("span", { className: 'adv-meta', children: [e.advisor, e.delivered === false ? '未投递' : undefined, e.suppressedReason, e.errorMessage].filter(s => s !== undefined && s !== '').join(' · ') }), e.detail !== undefined && e.detail !== '' && (0, jsx_runtime_1.jsx)("div", { className: 'adv-detail', children: e.detail })] }), (0, jsx_runtime_1.jsx)("span", { className: 'adv-tokens', children: ((e.inputTokens ?? 0) + (e.outputTokens ?? 0)) > 0 ? '↑' + fmtTokens(e.inputTokens ?? 0) + ' ↓' + fmtTokens(e.outputTokens ?? 0) : '' })] }, i))] });
}

    },
    "./index.ts": function (require, module, exports) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.apply = apply;
const AdvisorSettings_1 = require("./AdvisorSettings");
const AdvisorDock_1 = require("./AdvisorDock");
const AdvisorView_1 = require("./AdvisorView");
exports.name = 'dsh-advisor-mode/client';
exports.inject = ['slots'];
function apply(ctx) {
    const slots = ctx.slots;
    slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'dsh-advisor-mode',
        order: 19,
        label: () => '顾问模式',
        inject: () => ({}),
    }, AdvisorSettings_1.AdvisorSettings));
    // 输入区右侧：顾问开关 pill——input.right 在草稿页与活跃会话都挂载
    // （composer.dock 只在活跃会话挂载，草稿页没有该槽位 → 换这里）
    slots.inject('conversation.input.right', () => slots.register({
        name: 'conversation.input.right',
        id: 'dsh-advisor-mode',
        order: 90,
        label: () => '顾问',
        inject: () => ({}),
    }, AdvisorDock_1.AdvisorDock));
    // 会话视图：顾问活动页（与 对话/轨迹/统计 并列的第四个 tab）
    slots.inject('conversation.view', () => slots.register({
        name: 'conversation.view',
        id: 'advisor',
        order: 90,
        label: () => '顾问',
        inject: () => ({}),
    }, AdvisorView_1.AdvisorView));
}

    },
    };
    const __cache = {};
    const __req = (spec) => {
      let key = spec;
      if (spec.startsWith('./')) {
        if (__modules[spec] === undefined) {
          for (const ext of ['.ts', '.tsx']) if (__modules[spec + ext] !== undefined) { key = spec + ext; break }
        }
        if (__modules[key] === undefined) throw new Error('advisor client: unknown module ' + spec);
        if (__cache[key] === undefined) {
          const m = { exports: {} };
          __modules[key](__req, m, m.exports);
          __cache[key] = m.exports;
        }
        return __cache[key];
      }
      return hostRequire(spec);
    };
    return __req('./index.ts');
  },
});
