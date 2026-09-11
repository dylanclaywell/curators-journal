import { createRouter, createWebHistory } from 'vue-router'
import { panels } from '@/panels/registry'

/**
 * Routes are generated from the panel registry, so registering a panel is the
 * only step needed to make it reachable.
 */
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: panels[0].path },
    ...panels.map((panel) => ({
      path: panel.path,
      name: panel.id,
      component: panel.component,
      meta: { panelId: panel.id },
    })),
    // Quest detail isn't a registry panel — it never appears in the tab bar —
    // but `meta.panelId` still points at 'quests' so the tab bar keeps that
    // tab highlighted and the shell knows which panel it was reached from.
    // `/queue/:id` joins this once the Queue panel has real rows to tap (4e).
    {
      path: '/quests/:id',
      name: 'quest-detail',
      component: () => import('@/views/QuestDetailView.vue'),
      meta: { panelId: 'quests' },
      props: true,
    },
    // Unknown paths land on the first panel rather than a dead end — a PWA
    // relaunched on a stale URL should just open.
    { path: '/:pathMatch(.*)*', redirect: panels[0].path },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
