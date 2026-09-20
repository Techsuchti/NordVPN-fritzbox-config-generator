<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { api } from '@/services/apiService'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'

const config = useConfig()
const ui = useUI()
const notifications = useToast()
const loading = ref(false)
let requestController = null

const submit = async () => {
  if (loading.value) return
  const controller = new AbortController()
  requestController = controller
  loading.value = true
  try {
    const { key } = await api.genKey('', controller.signal)
    config.setKey(key)
    ui.modals.value.key = false
    notifications.show('Private Key generated', 'success')
  } catch (error) {
    if (!controller.signal.aborted) notifications.show(error.message || 'Generation failed', 'error')
  } finally {
    if (requestController === controller) requestController = null
    loading.value = false
  }
}

const cancel = () => {
  requestController?.abort()
  ui.modals.value.key = false
}
onBeforeUnmount(() => requestController?.abort())
</script>

<template>
  <div class="min-h-screen bg-app-bg text-app-text flex flex-col" role="dialog" aria-modal="true">
    <header class="sticky top-0 z-50 bg-app-surface border-b border-app-border flex-none">
      <div class="px-4 h-14 flex items-center"><h1 class="text-base font-medium">Generate Private Key</h1></div>
    </header>
    <main class="flex-1 container mx-auto px-4 py-6 max-w-xl">
      <div class="bg-app-bg/50 border border-app-border/50 rounded-md p-4 mb-6">
        <p class="text-sm text-app-text">Dein gespeicherter NordVPN Access Token wird automatisch verwendet.</p>
        <p class="text-xs text-nord-text-secondary mt-2">Der Token wird nicht an den Browser übertragen. Wenn kein Token hinterlegt ist, kannst du ihn unter <strong>Mein Profil</strong> speichern.</p>
      </div>
      <button type="button" :disabled="loading" class="w-full h-10 rounded bg-nord-button-primary text-white font-medium disabled:opacity-50" @click="submit">
        {{ loading ? 'Private Key wird erzeugt...' : 'Private Key generieren' }}
      </button>
    </main>
    <footer class="sticky bottom-0 bg-app-surface border-t border-app-border p-4 flex-none">
      <div class="container mx-auto max-w-xl flex justify-end">
        <button type="button" class="h-9 px-4 rounded border border-nord-button-secondary text-sm" @click="cancel">Abbrechen</button>
      </div>
    </footer>
  </div>
</template>