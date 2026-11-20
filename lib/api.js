/**
 * api —— /api/dsh-mastermind：设置卡片的后端（host 半）。
 *
 * 照 fusion-next fusion-next.ts:379 活例：webServer 服务可能晚于 apply()
 * 到达 → ctx.inject 延迟挂载；handler 只应答本机回源请求（trustedRequest）。
 *
 * 端面：
 *   GET  ?view=settings → { config（合成生效值）, user, locked, catalog, file }
 *   GET  ?view=catalog  → 模型目录（sessionController.modelCatalog）
 *   GET  ?view=session&session=<id> → 会话顾问活动聚合（事件/token/开关态）
 *   POST {config:{...}} → 校验白名单 → 剥组合层锁 → 写用户层 → 活应用
 *   POST ?scope=session {session:{id,enabled:boolean|null}} → 会话级开关覆盖
 */
import { DEFAULT_CONFIG } from './config.js';
import { applyLayer, composeConfig, userConfigPath, writeUserConfigSync } from './user-config.js';
import { maskToLiteralPatch, readPatchLockedPaths } from './patch-locks.js';
import { readSessionStats } from './session-stats.js';
function trustedRequest(req) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? ''))
        return false;
    if (req.headers['sec-fetch-site'] === 'cross-site' || !req.headers.host)
        return false;
    try {
        const target = new URL('http://' + req.headers.host);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
            return false;
        return !req.headers.origin || new URL(req.headers.origin).host === target.host;
    }
    catch {
        return false;
    }
}
function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
}
async function readJson(req) {
    const ct = req.headers['content-type']?.toLowerCase() ?? '';
    if (!ct.startsWith('application/json'))
        throw new Error('JSON content type required');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024)
            throw new Error('Request body exceeds 64 KiB');
        chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('JSON object required');
    return value;
}
async function modelCatalog(ctx) {
    try {
        const sc = ctx.get('sessionController');
        return await sc?.modelCatalog?.() ?? { groups: [] };
    }
    catch {
        return { groups: [] };
    }
}
const BOOL_KEYS = ['enabled', 'plan', 'followup', 'consult'];
const ROUTE_KEYS = ['advisorProvider', 'advisorModel', 'advisorEffort'];
const TRIGGER_BOUNDS = { consecutive: [1, 10], windowSize: [2, 50], windowFires: [1, 20], cooldown: [0, 20], maxInterventions: [0, 10] };
const GUARD_BOUNDS = { budgetPerTurn: [1, 16], budgetCap: [1, 128], immunityTurns: [0, 10] };
/** 白名单校验 + 剥组合层锁；不认识的键进 ignored */
function sanitizeUserConfig(raw, locked) {
    const user = {};
    const ignored = [];
    const bool = (k) => {
        const v = raw[k];
        if (v === undefined)
            return;
        if (typeof v !== 'boolean' || locked.has(k)) {
            ignored.push(k);
            return;
        }
        user[k] = v;
    };
    for (const k of BOOL_KEYS)
        bool(k);
    for (const k of ROUTE_KEYS) {
        const v = raw[k];
        if (v === undefined)
            continue;
        if (typeof v !== 'string' || v.length > 128 || locked.has(k)) {
            ignored.push(k);
            continue;
        }
        user[k] = v;
    }
    const numbers = (section, bounds) => {
        const src = raw[section];
        if (src === undefined)
            return;
        if (typeof src !== 'object' || src === null || Array.isArray(src)) {
            ignored.push(section);
            return;
        }
        const out = {};
        for (const [k, [lo, hi]] of Object.entries(bounds)) {
            const v = src[k];
            if (v === undefined)
                continue;
            const path = section + '.' + k;
            if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi || locked.has(path)) {
                ignored.push(path);
                continue;
            }
            out[k] = v;
        }
        if (Object.keys(out).length > 0)
            user[section] = out;
    };
    numbers('trigger', TRIGGER_BOUNDS);
    numbers('guards', GUARD_BOUNDS);
    return { user, ignored };
}
export function wireAdvisorApi(ctx, state, patchConfig, userState, onConfigChange, sw) {
    const locked = new Set(readPatchLockedPaths());
    const literalPatch = maskToLiteralPatch(patchConfig, [...locked]);
    let mounted = false;
    ctx.inject(['webServer'], webCtx => webCtx.effect(() => {
        const webServer = webCtx.get('webServer');
        if (typeof webServer?.register !== 'function')
            return undefined;
        mounted = true;
        return webServer.register({
            kind: 'exact',
            path: '/api/dsh-mastermind',
            handler: async (req, res) => {
                if (!trustedRequest(req))
                    return json(res, 403, { error: 'forbidden' });
                try {
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const view = url.searchParams.get('view');
                    if (req.method === 'GET' && view === 'settings') {
                        return json(res, 200, {
                            config: state.config,
                            user: userState.value,
                            locked: [...locked],
                            catalog: await modelCatalog(ctx),
                            file: userConfigPath(),
                        });
                    }
                    if (req.method === 'GET' && view === 'catalog') {
                        return json(res, 200, await modelCatalog(ctx));
                    }
                    // 会话活动：审计 JSONL 聚合（调用数 / token / 事件尾部）+ 开关态
                    if (req.method === 'GET' && view === 'session') {
                        const sessionId = url.searchParams.get('session') ?? '';
                        if (sessionId === '' || sessionId.length > 128 || !/^[\w.-]+$/.test(sessionId)) {
                            return json(res, 400, { error: 'session id required' });
                        }
                        const stats = readSessionStats(sessionId);
                        return json(res, 200, {
                            ...stats,
                            enabled: sw?.isEnabledFor(sessionId) ?? state.config.enabled,
                            globalEnabled: state.config.enabled,
                            override: sw !== undefined && sw.sessionEnabled.has(sessionId) ? sw.sessionEnabled.get(sessionId) : null,
                        });
                    }
                    // 会话开关：{session:{id, enabled:boolean|null}}——null 清除覆盖回落全局
                    if (req.method === 'POST' && url.searchParams.get('scope') === 'session') {
                        const body = await readJson(req);
                        const s = body.session;
                        if (s === undefined || typeof s !== 'object' || s === null || typeof s.id !== 'string' || s.id === '' || s.id.length > 128 || !/^[\w.-]+$/.test(s.id)) {
                            return json(res, 400, { error: 'session.id required' });
                        }
                        if (sw === undefined)
                            return json(res, 501, { error: 'session switch not wired' });
                        const v = s.enabled;
                        if (v === null || v === undefined)
                            sw.sessionEnabled.delete(s.id);
                        else if (typeof v === 'boolean')
                            sw.sessionEnabled.set(s.id, v);
                        else
                            return json(res, 400, { error: 'session.enabled must be boolean|null' });
                        return json(res, 200, { ok: true, session: s.id, enabled: sw.isEnabledFor(s.id), override: sw.sessionEnabled.has(s.id) ? sw.sessionEnabled.get(s.id) : null });
                    }
                    if (req.method === 'POST') {
                        const body = await readJson(req);
                        const raw = (body.config !== undefined ? body.config : body);
                        if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
                            return json(res, 400, { error: 'config object required' });
                        const { user, ignored } = sanitizeUserConfig(raw, locked);
                        userState.value = user;
                        state.config = composeConfig(user, literalPatch);
                        writeUserConfigSync(user);
                        onConfigChange();
                        return json(res, 200, { ok: true, config: state.config, ignored });
                    }
                    return json(res, 404, { error: 'not found' });
                }
                catch (error) {
                    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        });
    }));
    return { info: mounted ? 'webServer 已挂载 /api/dsh-mastermind' : 'webServer 尚未就绪——api 挂载已挂入 inject 队列' };
}
/** 供 index 复用：compose 一次生效配置 */
export function effectiveConfig(user, patch) {
    return applyLayer(applyLayer(DEFAULT_CONFIG, user), patch);
}
