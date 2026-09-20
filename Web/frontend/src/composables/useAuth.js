import { ref } from 'vue'
import { authApi } from '@/services/authService'

let instance = null

export function useAuth() {
  if (instance) return instance
  const loading = ref(true)
  const authenticated = ref(false)
  const setupRequired = ref(false)
  const username = ref('')
  const tokenStored = ref(false)
  const refresh = async () => {
    loading.value = true
    try {
      const status = await authApi.status()
      setupRequired.value = !!status.setupRequired
      authenticated.value = !!status.authenticated
      username.value = status.username || ''
      tokenStored.value = !!status.tokenStored
    } finally { loading.value = false }
  }
  const login = async (name, password) => { await authApi.login(name, password); await refresh() }
  const register = async (name, password) => { await authApi.register(name, password); await refresh() }
  const logout = async () => { await authApi.logout(); authenticated.value = false; username.value = ''; tokenStored.value = false }
  const saveToken = async token => { await authApi.saveToken(token); tokenStored.value = true }
  const deleteToken = async () => { await authApi.deleteToken(); tokenStored.value = false }
  instance = { loading, authenticated, setupRequired, username, tokenStored, refresh, login, register, logout, saveToken, deleteToken }
  return instance
}
