<script setup lang="ts">
import { mentionedLevel } from '@/lib/quests'
import type { SkillLevels } from '@/lib/quests'
import type { QuestItemLine } from '@/lib/types'

/*
 * Renders one of a quest's two item lists (4d′). Inert by design: nothing here
 * is a tap target, because there is no inventory to check these against — they
 * are the wiki's prose, shown as the wiki writes it.
 *
 * Three shapes have to survive, all from real pages:
 *
 *   - **Headings** ("If you are a Phoenix Gang member:") introduce the lines
 *     below them and are frequently *alternatives*. They're drawn as journal
 *     headings — letterspaced bold against a hairline rule — so a branch can't
 *     be misread as one continuous list. Their weight sits below the section's
 *     own `<h2>`: at body size they outranked it and put the hierarchy upside
 *     down. Not uppercased, though it suits the shorter ones: Heroes' Quest's
 *     Black Arm Gang heading is a 160-character sentence, and in caps it reads
 *     as shouting rather than as a label.
 *   - **Depth** indents a sub-bullet under its parent rather than promoting it
 *     to a sibling, which would read as a separate item.
 *   - **A level named at the start of a line** ("Combat 95") gets tinted
 *     against the player's actual levels — see the colour note below.
 *
 * Indent is an inline style, not a class: depth is a runtime value and Tailwind
 * only generates classes it can see at build time.
 */
const props = defineProps<{
  lines: QuestItemLine[]
  levels: SkillLevels
  muted?: boolean
  /**
   * Off for the rewards list: `mentionedLevel` reads a line's *first* number
   * as a level to check, but a reward line's leading number is usually an XP
   * amount ("Smithing 80,000 experience") — its comma stops the digit match
   * at "80", which would then get tinted as if 80 Smithing were a requirement
   * the player has or hasn't met. Defaults on for items/recommended, where
   * that reading is correct.
   */
  colorLevels?: boolean
}>()

/** Deep enough to show structure, shallow enough to survive a 375px rail. */
const INDENT_PX = 14

/**
 * Green when you meet it, amber when you don't, nothing when the level is
 * unknown.
 *
 * **Amber, not red, and the distinction is load-bearing.** Red is this app's
 * "blocked", and nothing in these lists blocks anything — they're advice. An
 * unmet recommendation painted red would say "you can't do this" about a quest
 * you can in fact start, which is the exact failure the engine is written to
 * avoid. Amber already means "not there yet" in the journal vocabulary.
 *
 * The uncoloured third state matters as much: with no hiscores snapshot every
 * line must read as unknown, never as unmet.
 */
function levelClass(line: QuestItemLine): string {
  if (line.heading || props.colorLevels === false) return ''
  const level = mentionedLevel(line.text, props.levels)
  if (!level || level.met === null) return ''
  return level.met ? 'text-done' : 'text-doing'
}
</script>

<template>
  <ul class="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
    <li
      v-for="(line, i) in lines"
      :key="i"
      class="flex gap-1.5"
      :class="[
        line.heading
          ? 'mt-2 items-center gap-2 text-[12px] font-bold tracking-[0.06em] text-ink-soft first:mt-0'
          : '',
        muted && !line.heading ? 'text-ink-soft' : '',
      ]"
      :style="{ paddingLeft: `${(line.depth ?? 0) * INDENT_PX}px` }"
    >
      <template v-if="line.heading">
        <span>{{ line.text.replace(/:$/, '') }}</span>
        <!-- The rule runs to the right margin, the way a ledger heading does.
             It carries no meaning, so it's hidden from the accessibility tree
             and the heading text keeps its trailing colon off-screen only. -->
        <span class="h-px min-w-4 flex-1 bg-bevel-dk/30" aria-hidden="true" />
      </template>

      <template v-else>
        <!-- A rotated square, not "◆" (U+25C6): the body face doesn't carry
             that glyph, so it falls back to another font and lands as a
             four-point asterisk at this size. A box is a solid diamond at
             exactly the size asked for, in every font. -->
        <span
          class="mt-[0.5em] size-[5px] shrink-0 rotate-45 bg-bevel-dk/70"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1" :class="levelClass(line)">{{
          line.text
        }}</span>
      </template>
    </li>
  </ul>
</template>
