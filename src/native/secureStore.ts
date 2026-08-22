import { registerPlugin } from '@capacitor/core'
import { isNativeShell } from './platform'

// Native bridge to hardware-backed secret storage (issue #210), so secrets are
// no longer plaintext-at-rest in WebView storage. Both shells implement the
// same three-method interface with the same contract — material that cannot be
// read on THIS device reports as absent, and the app falls back to asking for
// credentials again:
//  - Android (SecureStorePlugin.java): AES-GCM ciphertext in private prefs,
//    key in the Android Keystore.
//  - iOS (SecureStorePlugin.swift): Keychain items stored with
//    AfterFirstUnlockThisDeviceOnly, encrypted under device-bound keys.
// On web/PWA callers keep their existing storage.
export interface SecureStorePlugin {
  // Resolve the stored value, or null when absent or undecryptable.
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  delete(options: { key: string }): Promise<void>
}

const SecureStore = registerPlugin<SecureStorePlugin>('SecureStore')

// The shim and key hooks must only engage where the plugin exists — anywhere
// else the fallback is the status quo (localStorage / IndexedDB).
export const isSecureStoreAvailable = isNativeShell()

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
