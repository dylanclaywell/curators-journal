<script setup lang="ts">
import type { QuestItemLine } from '@/lib/types'

/*
 * Renders one of a quest's two item lists (4d′). Inert by design: nothing here
 * is a tap target or carries a status color, because there is no inventory to
 * check these against — they are the wiki's prose, shown as the wiki writes it.
 *
 * Two shapes have to survive, both from real pages:
 *
 *   - **Headings** ("If you are a Phoenix Gang member:") introduce the lines
 *     below them and are frequently *alternatives*. They lose the bullet and
 *     gain weight, so a branch can't be misread as one continuous list. They
 *     take the app's 13px-bold label size rather than staying at body size:
 *     at 15px bold they outweighed the section's own `<h2>`, which put the
 *     hierarchy upside down.
 *   - **Depth** indents a sub-bullet under its parent rather than promoting it
 *     to a sibling, which would read as a separate item.
 *
 * Indent is an inline style, not a class: depth is a runtime value and Tailwind
 * only generates classes it can see at build time.
 */
defineProps<{ lines: QuestItemLine[]; muted?: boolean }>()

/** Deep enough to show structure, shallow enough to survive a 375px rail. */
const INDENT_PX = 14
</script>

<template>
  <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
    <li
      v-for="(line, i) in lines"
      :key="i"
      class="flex gap-1.5"
      :class="[
        line.heading ? 'mt-1.5 text-[13px] font-bold first:mt-0' : '',
        muted && !line.heading ? 'text-ink-soft' : '',
      ]"
      :style="{ paddingLeft: `${(line.depth ?? 0) * INDENT_PX}px` }"
    >
      <span
        v-if="!line.heading"
        class="shrink-0 select-none text-ink-soft"
        aria-hidden="true"
        >&bull;</span
      >
      <span class="min-w-0 flex-1">{{ line.text }}</span>
    </li>
  </ul>
</template>
