<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useServers } from '@/composables/useServers'
import { useConfig } from '@/composables/useConfig'
import { useUI } from '@/composables/useUI'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/composables/useAuth'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import ServerGrid from '@/components/ServerGrid.vue'
import Toast from '@/components/Toast.vue'
import Icon from '@/components/Icon.vue'
import ConfigCustomizer from '@/components/ConfigCustomizer.vue'
import KeyGenerator from '@/components/KeyGenerator.vue'
import QrModal from '@/components/QrModal.vue'
import AuthGate from '@/components/AuthGate.vue'
import ProfileModal from '@/components/ProfileModal.vue'

const servers = useServers()
const config = useConfig()
const ui = useUI()
const notifications = useToast()
const auth = useAuth()
const profileOpen = ref(false)
let initialized = false
let scrollFrameId = 0

const initializeApp = () => {
  if (initialized || !auth.authenticated.value) return
  initialized = true
  config.load()
  servers.initialize()
}

const onScroll = () => {
  if (scrollFrameId) return
  scrollFrameId = window.requestAnimationFrame(() => {
    ui.topButtonVisible.value = window.scrollY > 500
    scrollFrameId = 0
  })
}
const openProfile = () => { profileOpen.value = true }
const closeProfile = () => { profileOpen.value = false }

onMounted(async () => {
  window.scrollTo(0, 0)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('nordgen:open-profile', openProfile)
  window.addEventListener('nordgen:close-profile', closeProfile)
  await auth.refresh()
  initializeApp()
})

watch(() => auth.authenticated.value, value => {
  if (value) initializeApp()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('nordgen:open-profile', openProfile)
  window.removeEventListener('nordgen:close-profile', closeProfile)
  window.cancelAnimationFrame(scrollFrameId)
  ui.closeQr()
})
</script>

<template>
  <AuthGate v-if="!auth.loading.value && !auth.authenticated.value" />

  <div v-else-if="auth.authenticated.value" class="min-h-screen bg-app-bg text-app-text">
    <Toast
      v-if="notifications.toast.value"
      :key="notifications.toast.value.id"
      :msg="notifications.toast.value.message"
      :type="notifications.toast.value.type"
      @close="notifications.toast.value = null"
    />

    <QrModal v-if="ui.modals.value.qr" />
    <KeyGenerator v-if="ui.modals.value.key" />
    <ConfigCustomizer v-if="ui.modals.value.custom" />
    <ProfileModal v-if="profileOpen" />

    <div v-show="!ui.modals.value.key && !ui.modals.value.custom" class="min-h-screen bg-app-bg text-app-text">
      <AppHeader />
      <div
        class="fixed inset-0 bg-nord-bg-overlay/30 z-30 transition-opacity"
        :class="ui.panel.value ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        @click="ui.close"
      />
      <AppSidebar />
      <ServerGrid />
      <button
        v-show="ui.topButtonVisible.value"
        type="button"
        aria-label="Scroll to top"
        class="fixed bottom-4 right-4 p-2 rounded-full bg-app-surface/90 border border-app-accent z-50 hover:bg-app-surface"
        @click="ui.scrollToTop"
      >
        <Icon name="arrowUp" class="w-5 h-5" />
      </button>
    </div>
  </div>
</template>