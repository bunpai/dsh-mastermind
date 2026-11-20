/**
 * client 半 —— 设置页卡片注册（设计 §8 的 GUI 模型入口）。
 *
 * 照 fusion-next src/client/index.ts:25 活例：ctx.slots.inject 注册
 * 'settings.section' 槽位 → 渲染 AdvisorSettings 卡片；卡片数据通道是
 * host 半的 /api/dsh-mastermind（webServer 注册，见 src/api.ts）。
 *
 * 构建时 scripts/build.mjs 用 esbuild 把 src/client/** 打成一个 CJS bundle，
 * 包进 window.__ModuleLoader__ 壳（react/react/jsx-runtime 由宿主运行时提供）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { AdvisorSettings } from './AdvisorSettings'
import { AdvisorDock } from './AdvisorDock'
import { AdvisorView } from './AdvisorView'

export const name = 'dsh-mastermind/client'
export const inject = ['slots']

interface SlotsLike {
  inject(slot: string, register: () => unknown): void
  register(descriptor: Record<string, unknown>, component: unknown): unknown
}

export function apply(ctx: Context): void {
  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'dsh-mastermind',
    order: 19,
    label: () => '顾问模式',
    inject: () => ({}),
  }, AdvisorSettings))
  // 输入区右侧：顾问开关 pill——input.right 在草稿页与活跃会话都挂载
  // （composer.dock 只在活跃会话挂载，草稿页没有该槽位 → 换这里）
  slots.inject('conversation.input.right', () => slots.register({
    name: 'conversation.input.right',
    id: 'dsh-mastermind',
    order: 90,
    label: () => '顾问',
    inject: () => ({}),
  }, AdvisorDock))
  // 会话视图：顾问活动页（与 对话/轨迹/统计 并列的第四个 tab）
  slots.inject('conversation.view', () => slots.register({
    name: 'conversation.view',
    id: 'advisor',
    order: 90,
    label: () => '顾问',
    inject: () => ({}),
  }, AdvisorView))
}
