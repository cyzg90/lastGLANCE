import { Capacitor, registerPlugin } from '@capacitor/core'

// Native bridge to Keystore-backed secret storage (issue #210). Values are
// AES-GCM ciphertext in a private SharedPreferences file with the key in the
// Android Keystore, so secrets are no longer plaintext-at-rest in WebView
// storage. Ciphertext restored onto a different device cannot decrypt and
// reads as absent — the app falls back to asking for credentials again.
// Android-only; on web/PWA and iOS callers keep their existing storage.
export interface SecureStorePlugin {
  // Resolve the stored value, or null when absent or undecryptable.
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  delete(options: { key: string }): Promise<void>
}

const SecureStore = registerPlugin<SecureStorePlugin>('SecureStore')

// The shim and key hooks must only engage where the plugin exists — anywhere
// else the fallback is the status quo (localStorage / IndexedDB).
export const isSecureStoreAvailable = Capacitor.getPlatform() === 'android'

export async function secureGet(key: string): Promise<string | null> {
  const res = await SecureStore.get({ key })
  return res.value ?? null
}

export async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.set({ key, value })
}

export async function secureDelete(key: string): Promise<void> {
  await SecureStore.delete({ key })
}
