<script setup lang="ts">
import type { QuestGuideSection } from '@/lib/types'

/*
 * The wiki's quick-guide walkthrough for one quest.
 *
 * Inert, like `QuestItemLines`, and for a stronger reason: a step here looks
 * exactly like something to tick off, and there is nowhere to put that tick
 * yet. A checkbox that forgets its state the moment iOS kills the backgrounded
 * PWA would be worse than none — see ROADMAP.md, where per-step state is the
 * open question waiting on the plugin rather than something to improvise.
 *
 * Three shapes, all from real pages:
 *
 *   - **Sections** chapter the long quests. Desert Treasure II is 249 bullets
 *     across 12 of them, and undivided that is not a guide, it's a wall. Short
 *     quests have none at all, which is why `title` is nullable and an untitled
 *     section renders its steps with no heading rather than an empty one.
 *   - **Depth** indents a sub-bullet under its parent, the same reading as the
 *     item lists: a detail hanging off the line above, not a step of its own.
 *   - **Chat options** are the dialogue to pick. They get their own row rather
 *     than being folded into the sentence — they're what you look at while the
 *     dialogue box is open, so they have to be findable at a glance rather than
 *     read for — but they're set in colour rather than boxed. See the note at
 *     the markup.
 *
 * Indent is an inline style because depth is a runtime value and Tailwind only
 * generates classes it can see at build time.
 */
defineProps<{ sections: QuestGuideSection[] }>()

/** Shallower than the item lists': these nest inside a numbered step already. */
const INDENT_PX = 12
</script>

<template>
  <div class="flex flex-col gap-4">
    <section
      v-for="(section, s) in sections"
      :key="s"
      class="flex flex-col gap-1.5"
    >
      <!-- Sub-sections (`====` on the wiki) are a real level down — Dragon
           Slayer II puts four key pieces under one chapter — so they keep the
           hierarchy rather than flattening into their parent. -->
      <h3
        v-if="section.title"
        class="m-0 flex items-center gap-2 text-ink-soft"
        :class="
          section.depth
            ? 'text-[12px] font-bold tracking-[0.06em]'
            : 'font-display text-[16px] text-ink'
        "
      >
        <span>{{ section.title }}</span>
        <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
      </h3>

      <!-- Per-section prose: almost always "Items required", which exists
           nowhere else — the quest's own item list is the union for the whole
           quest, and the point of this one is that you can bank between
           chapters. Inset rather than bulleted, so it reads as a standing
           condition for the steps below rather than as the first of them. -->
      <p
        v-for="(note, n) in section.notes"
        :key="`n${n}`"
        class="bevel-in m-0 bg-parchment-2 px-2.5 py-1.5 text-[14px] text-ink-soft"
      >
        {{ note }}
      </p>

      <ol class="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
        <li
          v-for="(step, i) in section.steps"
          :key="i"
          class="flex flex-col gap-1"
          :style="{ paddingLeft: `${(step.depth ?? 0) * INDENT_PX}px` }"
        >
          <div class="flex gap-1.5">
            <!-- A rotated square rather than "◆" (U+25C6), for the reason
                 QuestItemLines.vue records: the body face lacks that glyph and
                 falls back to a four-point asterisk at this size. -->
            <span
              class="mt-[0.5em] size-[5px] shrink-0 rotate-45 bg-bevel-dk/70"
              :class="step.depth ? 'opacity-50' : ''"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">{{ step.text }}</span>
          </div>

          <!-- Colour, not a container.
               Boxing each option was tried and read badly: a long quest is
               mostly steps with dialogue, so the page became a column of
               outlined chips with prose squeezed between them, and the boxes
               drew more attention than the steps they belonged to. One tinted
               run does the same job — it separates the words you *say* from the
               words telling you what to do — at no visual weight and no extra
               height.

               **Never underlined, never a link.** Blue text in a UI promises a
               tap, and there is nothing to tap here; the attribution below is
               the only real link in this component and it keeps the underline
               that says so. The "Say" label carries the meaning instead, which
               the colour alone can't: "2. 36" is an option number and a riddle
               answer, and nothing about a bare blue run says which half is
               which. -->
          <p
            v-if="step.chat"
            class="m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pl-[11px] text-[14px]"
          >
            <span class="text-[12px] font-bold tracking-[0.06em] text-ink-soft">
              Say
            </span>
            <span
              v-for="(option, c) in step.chat"
              :key="`c${c}`"
              class="text-dialogue"
            >
              {{ option
              }}<span
                v-if="c < step.chat.length - 1"
                class="text-ink-soft/50"
                aria-hidden="true"
              >
                ·</span
              >
            </span>
          </p>
        </li>
      </ol>
    </section>
  </div>
</template>
