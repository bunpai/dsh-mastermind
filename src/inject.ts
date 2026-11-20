/**
 * inject —— 裁决投递（设计 §4 + §7）。
 *
 * DSH 宿主投递三通道都只收单条 UserMessage（dsh-agent-loop Agent 接口
 * 实证：followup=next-turn+wake / steer=next-step+wake / inject=next-step
 * 不 wake）。设计 R3 的 tool_call+tool_result 对在该 API 面不可实现——
 * 按已定偏差降级为单条 user notice，文本用"You asked the advisor
 * (consult_advisor) and this is its reply"框定，保持 Worker 心理一致性。
 *
 * 消息来源用 dsh 0.2.0 会话格式 v4 的直接生产者来源（kind 前缀保留
 * 插件名 + form:'notice' + summary≤120；前任 dsh-advisor-flow delivery.js
 * 实证的当前宿主契约——旧 kind:'plugin' 包装已被 v4 退役）。
 *
 * STOP 走 steer（打断当前步）但绝不硬取消会话；ADJUST/PLAN 走 inject
 * （尾上下文，不打断）。投递失败只记日志，绝不炸宿主流程。
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'

/** v4 直接生产者来源：插件名编进 kind 前缀 */
export const ADVICE_SOURCE_KIND = 'plugin:dsh-mastermind'

const SUMMARY_MAX_CHARS = 120

function boundSummary(summary: string): string {
  return summary.length <= SUMMARY_MAX_CHARS ? summary : `${summary.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

/** 构造顾问通知 user 消息（v4 直接来源 + notice 形态） */
export function advisorNotice(text: string, summary: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: ADVICE_SOURCE_KIND, form: 'notice', summary: boundSummary(summary) },
  })
}

export type DeliveryKind = 'ADJUST' | 'STOP' | 'PLAN'

/**
 * 投递一条顾问文本：
 *  - STOP → agent.steer（打断当前步，注入"停下重新评估"；不硬取消）
 *  - ADJUST / PLAN → agent.inject（排入下一步请求的尾上下文，不打断）
 * 返回是否投递成功；任何异常吞掉成 false（投递失败不影响其余链路）。
 */
export function deliverAdvice(agent: Agent, kind: DeliveryKind, text: string, summary: string): boolean {
  const message = advisorNotice(text, summary)
  try {
    if (kind === 'STOP') agent.steer(message)
    else agent.inject(message)
    return true
  } catch (error) {
    console.warn('[dsh-mastermind] 投递失败（已吞掉）：', error)
    return false
  }
}
