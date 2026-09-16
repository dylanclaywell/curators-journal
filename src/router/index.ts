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
    // but `meta.panelId` still names the panel it was reached from, so the tab
    // bar keeps that tab highlighted and the view knows where "back" goes.
    //
    // The same component is mounted under both panels rather than sharing one
    // path, because the panel you came from is part of where you are: opening a
    // plan row from the Queue and landing back in a 214-row quest list is a
    // different screen than the one you left. The path carries that context so
    // it survives a reload and a relaunch, which a remembered variable
    // wouldn't — this is a home-screen PWA that gets killed in the background.
    {
      path: '/quests/:id',
      name: 'quest-detail',
      component: () => import('@/views/QuestDetailView.vue'),
      meta: { panelId: 'quests' },
      props: true,
    },
    {
      path: '/queue/:id',
      name: 'queue-quest-detail',
      component: () => import('@/views/QuestDetailView.vue'),
      meta: { panelId: 'queue' },
      props: true,
    },
    // The Settings panel was /about until it was renamed. An installed PWA
    // relaunches on the URL it was killed holding, so this has to outlive the
    // rename rather than fall through to the catch-all and open the Queue.
    { path: '/about', redirect: '/settings' },
    // Unknown paths land on the first panel rather than a dead end — a PWA
    // relaunched on a stale URL should just open.
    { path: '/:pathMatch(.*)*', redirect: panels[0].path },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
