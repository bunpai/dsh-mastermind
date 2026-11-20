/**
 * guards —— 自动介入的防打扰准入（纯模块，零 ctx 依赖，可单测）。
 *
 * 顺序照 omp emission-guard.ts:279-322（设计 §5 移植）：
 *   normalize（小写+NFKC+非字母数字折叠）→ 噪声表拒收 → 会话级
 *   严重度感知去重（仅严格升阶 nit→concern→blocker 可复提，FIFO 4096）
 *   → 每轮预算（blocker 豁免）→ 免疫轮（投递成功后 3 轮内静默）。
 * 压制原因（empty/noise/duplicate/rate-limit）原样回执进审计日志，
 * 让顾问换措辞绕闸变得没有意义——闸门换不掉付不出的预算。
 */
import { Severity as Sev } from './config-types.js';
/** 归一化：小写 + NFKC + 非字母数字折叠（omp emission-guard 同款） */
export function normalize(text) {
    return text
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
/** 噪声表（设计 §5 + §12.4 中文场景扩充）：无实质理由的短语直接拒收 */
export const NOISE_TOKENS = new Set([
    // EN（omp 清单）
    'stop', 'stop it', 'done', 'lgtm', 'no issue', 'no issues', 'continue',
    'keep going', 'ok', 'okay', 'fine', 'good', 'looks good', 'yes', 'agreed',
    // CN 保险丝
    '好的', '没问题', '继续', '收到', '搞定', '明白', '明白了', '可以', '行', '嗯',
].map(token => normalize(token)));
export function isNoise(text) {
    const normalized = normalize(text);
    if (normalized === '')
        return false;
    return NOISE_TOKENS.has(normalized);
}
const SEVERITY_ORDER = { nit: 0, concern: 1, blocker: 2 };
/** 会话级严重度感知去重：remember 后仅严格升阶可复提（FIFO 容量 4096） */
export class DedupeStore {
    constructor(capacity = 4096) {
        this.seen = new Map();
        this.order = [];
        this.capacity = capacity;
    }
    remember(digest, severity) {
        if (!this.seen.has(digest)) {
            this.order.push(digest);
            if (this.order.length > this.capacity) {
                const dropped = this.order.shift();
                if (dropped !== undefined)
                    this.seen.delete(dropped);
            }
        }
        this.seen.set(digest, severity);
    }
    /** 同内容同/降级严重度 → duplicate；严格升阶才放行 */
    allows(digest, severity) {
        const stored = this.seen.get(digest);
        if (stored === undefined)
            return true;
        return SEVERITY_ORDER[severity] > SEVERITY_ORDER[stored];
    }
}
export function severityDigest(text) {
    return normalize(text).slice(0, 256);
}
/**
 * 预算 + 免疫轮记账（轮 = 一次 agent/request）。
 * blocker 豁免每轮预算与免疫轮（设计 §5"严重度即通道"）。
 */
export class BudgetLedger {
    constructor(cfg) {
        this.cfg = cfg;
        this.turnUsed = 0;
        this.sessionUsed = 0;
        this.immunityLeft = 0;
        this.immunityArmed = false;
    }
    /**
     * 每轮（agent/request）开头调用：重置轮内预算；上轮投递过建议则
     * 自此开启免疫窗（设计 §5：投递成功后 N 轮内静默——窗口从下一轮
     * 起算，不吞掉本轮的 budgetPerTurn 余量）。
     */
    beginTurn() {
        this.turnUsed = 0;
        if (this.immunityArmed) {
            this.immunityArmed = false;
            this.immunityLeft = this.cfg.immunityTurns;
        }
        else if (this.immunityLeft > 0) {
            this.immunityLeft -= 1;
        }
    }
    canSpend(severity) {
        if (severity === Sev.BLOCKER)
            return true;
        if (this.sessionUsed >= this.cfg.budgetCap)
            return false;
        if (this.turnUsed >= this.cfg.budgetPerTurn)
            return false;
        if (this.immunityLeft > 0)
            return false;
        return true;
    }
    spend(severity) {
        if (severity === Sev.BLOCKER)
            return;
        this.turnUsed += 1;
        this.sessionUsed += 1;
        this.immunityArmed = true;
    }
    get sessionConsumed() {
        return this.sessionUsed;
    }
}
/** admit() 唯一准入点：串起 normalize→noise→dedupe→budget→immunity */
export class AdmissionGate {
    constructor(cfg) {
        this.dedupe = new DedupeStore(4096);
        this.ledger = new BudgetLedger(cfg);
    }
    beginTurn() {
        this.ledger.beginTurn();
    }
    admit(detail, severity) {
        if (detail.trim() === '')
            return { admitted: false, reason: 'empty' };
        if (isNoise(detail))
            return { admitted: false, reason: 'noise' };
        const digest = severityDigest(detail);
        if (!this.dedupe.allows(digest, severity))
            return { admitted: false, reason: 'duplicate' };
        if (!this.ledger.canSpend(severity))
            return { admitted: false, reason: 'rate-limit' };
        this.dedupe.remember(digest, severity);
        this.ledger.spend(severity);
        return { admitted: true, reason: 'ok' };
    }
    get sessionConsumed() {
        return this.ledger.sessionConsumed;
    }
}
/** 压制原因 → 给顾问的回执短语（原样回执，使换措辞绕闸无意义） */
export function describeSuppression(reason) {
    switch (reason) {
        case 'empty': return 'advice text was empty';
        case 'noise': return 'advice matched the no-substance noise list';
        case 'duplicate': return 'same-content advice was already delivered (only strictly higher severity may resubmit)';
        case 'rate-limit': return 'delivery budget/immunity limit reached';
    }
}
