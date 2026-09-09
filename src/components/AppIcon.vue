<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from '@/lib/icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    /** Rendered size in px. Icons are square. */
    size?: number
    /** Set when the icon carries meaning no adjacent text already gives. */
    label?: string
  }>(),
  { size: 18 },
)

const icon = computed(() => icons[props.name])
</script>

<template>
  <!-- The two packs draw on different grids (512 vs 256), so the viewBox
       travels with the icon rather than being assumed here. -->
  <svg
    :viewBox="icon.viewBox"
    :width="size"
    :height="size"
    fill="currentColor"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    class="shrink-0"
  >
    <path :d="icon.path" />
  </svg>
</template>
