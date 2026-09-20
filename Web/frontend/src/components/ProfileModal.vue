<script setup>
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useToast } from '@/composables/useToast'
const auth = useAuth(); const notifications = useToast(); const token = ref(''); const show = ref(false); const saving = ref(false)
const close = () => window.dispatchEvent(new CustomEvent('nordgen:close-profile'))
const save = async () => {
  if (!/^[a-fA-F0-9]{64}$/.test(token.value)) { notifications.show('Bitte einen gültigen 64-stelligen NordVPN Access Token eingeben.', 'error'); return }
  saving.value = true
  try { await auth.saveToken(token.value); token.value = ''; notifications.show('Access Token lokal gespeichert.', 'success') }
  catch (e) { notifications.show(e.message || 'Token konnte nicht gespeichert werden.', 'error') }
  finally { saving.value = false }
}
const remove = async () => {
  if (!confirm('Gespeicherten Access Token wirklich löschen?')) return
  try { await auth.deleteToken(); notifications.show('Access Token gelöscht.', 'success') }
  catch (e) { notifications.show(e.message || 'Token konnte nicht gelöscht werden.', 'error') }
}
</script>
<template>
  <div class="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" @click.self="close">
    <section class="w-full max-w-lg bg-app-surface border border-app-border rounded-lg shadow-2xl">
      <header class="flex items-center justify-between p-4 border-b border-app-border"><div><h2 class="font-semibold">Mein Profil</h2><p class="text-xs text-nord-text-secondary mt-0.5">{{ auth.username.value }}</p></div><button type="button" class="px-3 py-1 rounded hover:bg-nord-bg-hover" @click="close">×</button></header>
      <div class="p-5 space-y-5">
        <div>
          <h3 class="text-sm font-medium mb-1">NordVPN Access Token</h3>
          <p class="text-xs text-nord-text-secondary mb-3">Der Token wird verschlüsselt auf deinem lokalen Docker-System gespeichert und nicht im Browser abgelegt.</p>
          <div class="relative"><input v-model="token" :type="show ? 'text' : 'password'" autocomplete="off" maxlength="64" class="w-full h-10 bg-app-bg border border-app-border rounded px-3 pr-10 text-sm font-mono" placeholder="64-stelliger hexadezimaler Token"><button type="button" class="absolute right-0 top-0 h-10 w-10" @click="show = !show">{{ show ? '●' : '○' }}</button></div>
          <div class="flex flex-wrap gap-2 mt-3"><button type="button" :disabled="saving || !token" class="px-4 py-2 rounded bg-nord-button-primary text-white text-sm font-semibold disabled:opacity-50" @click="save">{{ saving ? 'Speichern...' : 'Token speichern' }}</button><button v-if="auth.tokenStored.value" type="button" class="px-4 py-2 rounded border border-nord-text-error text-nord-text-error text-sm" @click="remove">Token löschen</button></div>
          <p v-if="auth.tokenStored.value" class="text-xs text-green-400 mt-3">✓ Access Token ist gespeichert</p><p v-else class="text-xs text-nord-text-secondary mt-3">Noch kein Access Token gespeichert.</p>
        </div>
        <div class="pt-4 border-t border-app-border flex justify-between"><button type="button" class="px-4 py-2 rounded border border-nord-text-error text-nord-text-error text-sm" @click="auth.logout().then(close)">Abmelden</button><button type="button" class="px-4 py-2 rounded border border-app-border text-sm" @click="close">Schließen</button></div>
      </div>
    </section>
  </div>
</template>
