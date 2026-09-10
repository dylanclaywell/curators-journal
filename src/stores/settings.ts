import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { AccountType } from '@/lib/types'
import { read, write } from './persist'

const KEY = 'settings'

interface PersistedSettings {
  username: string
  accountType: AccountType
}

/**
 * Who we're looking up. Small, but it's the seed for everything else — the
 * quest queue's eligibility comes from these levels.
 */
export const useSettingsStore = defineStore('settings', () => {
  const username = ref('')
  const accountType = ref<AccountType>('normal')

  /**
   * False until the persisted values have loaded. Reads are async, so anything
   * that would auto-fetch on startup has to wait for this rather than acting on
   * the empty initial state.
   */
  const hydrated = ref(false)

  async function hydrate() {
    const saved = await read<PersistedSettings>(KEY)
    if (saved) {
      username.value = saved.username ?? ''
      accountType.value = saved.accountType ?? 'normal'
    }
    hydrated.value = true
  }

  // Persist after hydration only, or the empty defaults would overwrite the
  // saved values during startup.
  watch([username, accountType], () => {
    if (!hydrated.value) return
    void write(KEY, {
      username: username.value,
      accountType: accountType.value,
    })
  })

  void hydrate()

  return { username, accountType, hydrated }
})
