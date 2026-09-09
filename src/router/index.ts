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
    // Unknown paths land on the first panel rather than a dead end — a PWA
    // relaunched on a stale URL should just open.
    { path: '/:pathMatch(.*)*', redirect: panels[0].path },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
