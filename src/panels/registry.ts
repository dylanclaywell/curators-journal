import type { Component } from 'vue'
import type { IconName } from '@/lib/icons'

/**
 * A panel is the unit of composition in Curator's Journal: one screen in the rail,
 * one tab in the tab bar. Panels read data only through stores — they never
 * fetch directly — which is what will let a future plugin contribute a panel
 * through this same registry instead of needing app changes.
 *
 * Keep this shape additive and serializable. Anything a plugin manifest would
 * have to declare belongs here, which is why `icon` is a name looked up in the
 * vendored icon set rather than a component: a manifest is JSON, and JSON can
 * carry a key but not a Vue component.
 */
export interface PanelDefinition {
  /** Stable identifier. Also the persistence key for per-panel state. */
  id: string
  /** Shown in the tab bar and the rail header. */
  title: string
  /** Route path. One panel is visible at a time. */
  path: string
  icon: IconName
  /**
   * Narrowest width in px at which the panel still renders usefully. Panels
   * lay themselves out with container queries, so this is a declaration for
   * the shell (and later, layout modes), not an enforced minimum.
   */
  minWidth: number
  component: () => Promise<Component>
}

export const panels: PanelDefinition[] = [
  {
    id: 'queue',
    title: 'Queue',
    path: '/queue',
    icon: 'scroll',
    minWidth: 320,
    component: () => import('@/views/QueueView.vue'),
  },
  {
    id: 'quests',
    title: 'Quests',
    path: '/quests',
    icon: 'openBook',
    minWidth: 320,
    component: () => import('@/views/QuestsView.vue'),
  },
  {
    id: 'stats',
    title: 'Stats',
    path: '/stats',
    icon: 'progression',
    minWidth: 320,
    component: () => import('@/views/StatsView.vue'),
  },
  {
    id: 'about',
    title: 'About',
    path: '/about',
    icon: 'cog',
    minWidth: 300,
    component: () => import('@/views/AboutView.vue'),
  },
]

export function panelById(id: string): PanelDefinition | undefined {
  return panels.find((p) => p.id === id)
}
