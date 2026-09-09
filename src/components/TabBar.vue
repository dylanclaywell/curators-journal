<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { panels } from '@/panels/registry'

const route = useRoute()
</script>

<template>
  <!-- Bottom-anchored: in a docked rail the bottom edge is where the thumb
       already is, and it keeps the tabs clear of the iPad status bar.

       The active tab is set by binding one class, not by RouterLink's
       `active-class`: `text-gold` and a base `text-parchment-3` are both plain
       single-class selectors, so whichever Tailwind emits last wins and the
       active color silently loses.

       Labels collapse and the strip scrolls as the rail narrows — see the
       .tab-strip rules. The accessible name comes from aria-label either way,
       so a tab that drops its label doesn't drop its meaning. -->
  <nav
    class="tab-strip flex shrink-0 gap-1 border-t-2 border-bevel-dk bg-brown p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    aria-label="Panels"
  >
    <RouterLink
      v-for="panel in panels"
      :key="panel.id"
      :to="panel.path"
      :aria-label="panel.title"
      class="tab tap pressable engraved flex flex-col items-center justify-center gap-0.5 text-[13px] font-bold no-underline"
      :class="
        route.path === panel.path
          ? 'bevel-oak-in bg-brown text-gold'
          : 'bevel-oak bg-brown-lt text-parchment-3'
      "
    >
      <AppIcon :name="panel.icon" :size="20" />
      <span class="tab-label">{{ panel.title }}</span>
    </RouterLink>
  </nav>
</template>
