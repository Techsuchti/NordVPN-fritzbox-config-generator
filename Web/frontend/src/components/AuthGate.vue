<script setup>
import { onMounted, ref } from 'vue'
import { useAuth } from '@/composables/useAuth'

const auth = useAuth()
const username = ref('')
const password = ref('')
const password2 = ref('')
const registerMode = ref(false)
const loading = ref(false)
const error = ref('')
onMounted(() => { registerMode.value = auth.setupRequired.value })
const submit = async () => {
  error.value = ''
  if (!username.value.trim() || password.value.length < 10) { error.value = 'Benutzername und Passwort sind erforderlich. Das Passwort muss mindestens 10 Zeichen haben.'; return }
  if (registerMode.value && password.value !== password2.value) { error.value = 'Die Passwörter stimmen nicht überein.'; return }
  loading.value = true
  try {
    if (registerMode.value) await auth.register(username.value.trim(), password.value)
    else await auth.login(username.value.trim(), password.value)
    password.value = ''; password2.value = ''
  } catch (e) { error.value = e.message || 'Anmeldung fehlgeschlagen.' }
  finally { loading.value = false }
}
</script>
<template>
  <main class="min-h-screen bg-app-bg text-app-text flex items-center justify-center p-4">
    <section class="w-full max-w-md bg-app-surface border border-app-border rounded-lg shadow-xl p-6">
      <h1 class="text-xl font-semibold">NordVPN FRITZ!Box Generator</h1>
      <p class="text-xs text-nord-text-secondary mt-1 mb-6">Lokale Anmeldung</p>
      <h2 class="text-base font-medium mb-1">{{ registerMode ? 'Ersteinrichtung' : 'Anmelden' }}</h2>
      <p class="text-sm text-nord-text-secondary mb-5">{{ registerMode ? 'Lege den lokalen Benutzer für diese Installation an.' : 'Deine Zugangsdaten bleiben auf diesem lokalen Server.' }}</p>
      <form class="space-y-4" @submit.prevent="submit">
        <input v-model="username" autocomplete="username" maxlength="32" class="w-full h-10 bg-app-bg border border-app-border rounded px-3 text-sm" placeholder="Benutzername">
        <input v-model="password" type="password" autocomplete="current-password" maxlength="256" class="w-full h-10 bg-app-bg border border-app-border rounded px-3 text-sm" placeholder="Passwort (mindestens 10 Zeichen)">
        <input v-if="registerMode" v-model="password2" type="password" autocomplete="new-password" maxlength="256" class="w-full h-10 bg-app-bg border border-app-border rounded px-3 text-sm" placeholder="Passwort wiederholen">
        <p v-if="error" class="text-sm text-nord-text-error">{{ error }}</p>
        <button :disabled="loading" type="submit" class="w-full h-10 rounded bg-nord-button-primary text-white font-semibold disabled:opacity-50">{{ loading ? 'Bitte warten...' : (registerMode ? 'Benutzer anlegen' : 'Anmelden') }}</button>
      </form>
    </section>
  </main>
</template>
