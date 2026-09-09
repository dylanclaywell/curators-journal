<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import { panelById } from '@/panels/registry'

const route = useRoute()
const activePanel = computed(() => panelById(String(route.meta.panelId ?? '')))
</script>

<template>
  <!-- The rail: a fixed-height column that never scrolls as a whole. Only the
       panel body scrolls, so the header and tab bar stay put while the game
       keeps the rest of the screen. The beveled frame is the direction's
       signature — light on the top/left, dark on the bottom/right. -->
  <div
    class="rail-shell bevel flex h-full flex-col overflow-hidden bg-parchment"
  >
    <header
      class="shrink-0 border-b-2 border-bevel-dk bg-brown px-3 pb-2.5 pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <h1 class="m-0 font-display text-[22px] font-normal text-gold engraved">
        {{ activePanel?.title ?? 'StageScape' }}
      </h1>
    </header>

    <main class="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <RouterView />
    </main>

    <TabBar />
  </div>
</template>
