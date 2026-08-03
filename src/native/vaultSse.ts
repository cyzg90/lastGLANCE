import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// Native GLANCEvault SSE reader (Android today; the iOS shell will implement the
// same plugin surface). The WebView cannot stream /events (vault HTTP rides the
// buffered CapacitorHttp path), so the SHELL owns the socket — connecting while
// foreground, dropping on background, reconnecting with backoff — and pushes
// every reader message in as an `sseMessage` plugin event. The renderer's bridge
// client (createBridgeSseClient in src/sync/vaultEventStream.ts) funnels frames
// through the SAME parseSseFrame → coalescer → drains as the web transport.
//
// Message shapes (identical to dayGLANCE's shells, so the renderer logic is
// shared across the app family):
//   {type:'open'}                    a native (re)connection was established
//   {type:'frame', block:'…'}        one raw SSE event block
//   {type:'closed'}                  the stream dropped (native will reconnect)
//   {type:'error', message, code?}   coded errors are TERMINAL — native stopped
//                                    and will NOT reconnect ('auth' = rejected
//                                    token, 'insecure' = refused cleartext URL,
//                                    'unsupported' = server predates /events)

export interface VaultSseNativeMessage {
  type: 'open' | 'frame' | 'closed' | 'error'
  block?: string
  message?: string
  code?: string
}

export interface VaultSsePluginType {
  start(options: { vaultUrl: string; vaultToken: string; accountId: string }): Promise<void>
  stop(): Promise<void>
  addListener(
    eventName: 'sseMessage',
    listenerFunc: (msg: VaultSseNativeMessage) => void,
  ): Promise<PluginListenerHandle>
}

export const VaultSse = registerPlugin<VaultSsePluginType>('VaultSse')

// Strict capability probe: true only when a native shell actually registered
// the plugin. An older shell (APK predating the reader) answers false and the
// app keeps its polling behavior — the same degrade-to-polling contract
// dayGLANCE's shells established.
export function isVaultSseNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('VaultSse')
}
