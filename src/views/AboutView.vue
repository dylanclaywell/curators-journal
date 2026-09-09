<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * Doubles as the required Fan Content Policy notice and as a ruler.
 *
 * Stage Manager's minimum window width isn't something we can look up
 * reliably — it varies by iPad model and iPadOS version — so the panel just
 * reports the live width. Dock the app, drag it as narrow as it will go, and
 * read the number.
 */
/* Templates resolve names against the component instance, not globals, so the
   build-time define has to be surfaced as a binding. */
const version = __APP_VERSION__

const width = ref(0)
const height = ref(0)
const dpr = ref(1)
const installed = ref(false)

function measure() {
  width.value = window.innerWidth
  height.value = window.innerHeight
  dpr.value = window.devicePixelRatio
  installed.value = window.matchMedia('(display-mode: standalone)').matches
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
  // iOS reports interface-driven size changes here rather than on `resize`.
  window.visualViewport?.addEventListener('resize', measure)
})

onUnmounted(() => {
  window.removeEventListener('resize', measure)
  window.visualViewport?.removeEventListener('resize', measure)
})
</script>

<template>
  <div class="flex flex-col gap-4 p-3">
    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">This window</h2>

      <!-- The width is the headline figure: it's the number the whole layout
           is designed against, and the reason this readout exists. -->
      <div class="bevel-in flex items-baseline gap-2 bg-parchment-2 px-3 py-2">
        <span class="nums font-display text-[32px] leading-none">{{
          width
        }}</span>
        <span class="text-ink-soft">&times;</span>
        <span class="nums font-display text-[32px] leading-none">{{
          height
        }}</span>
        <span class="text-ink-soft">px</span>
      </div>

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
        <dt class="text-ink-soft">Pixel ratio</dt>
        <dd class="nums m-0">{{ dpr }}&times;</dd>
        <dt class="text-ink-soft">Installed</dt>
        <dd class="m-0">
          {{ installed ? 'Yes, running standalone' : 'No, running in Safari' }}
        </dd>
        <dt class="text-ink-soft">Version</dt>
        <dd class="nums m-0">{{ version }}</dd>
      </dl>

      <p v-if="!installed" class="m-0 text-[15px] text-ink-soft">
        Add StageScape to your home screen. Safari clears storage for
        uninstalled sites after about a week idle, and your quest completions
        live in it.
      </p>
    </section>

    <hr class="m-0 h-0 border-0 border-t-2 border-t-bevel-dk" />

    <section class="flex flex-col gap-2">
      <h2 class="m-0 font-display text-[19px] leading-tight">Credits</h2>

      <!-- Fan Content Policy §8.1 requires this wording verbatim, in a
           prominent and visible place. Do not paraphrase it. -->
      <p class="m-0 max-w-[52ch] text-[15px]">
        Created using intellectual property belonging to Jagex Limited under the
        terms of Jagex's Fan Content Policy. This content is not endorsed by or
        affiliated with Jagex.
      </p>

      <ul
        class="m-0 flex list-none flex-col gap-1 p-0 text-[15px] text-ink-soft"
      >
        <li>Quest and skill data from the OSRS Wiki, CC BY-NC-SA 3.0</li>
        <li>Icons from game-icons.net, CC BY 3.0, and Phosphor, MIT</li>
        <li>IM Fell English and Alegreya Sans, SIL Open Font License</li>
      </ul>

      <p class="m-0 max-w-[52ch] text-[15px] text-ink-soft">
        StageScape reads public data only. It is not a third-party client and
        never touches the game.
      </p>
    </section>
  </div>
</template>
