import { createContext, useContext, useState, useSyncExternalStore } from 'react'
import { getIntentsConfig, type IntentsConfig } from './config'
import { anyIntentsTransportOn, intentsTransportsOn } from './intentsAvailable'
import { directAccessTransport } from '@/sync/directAccess'

interface IntentsContextValue {
  isConfigured: boolean
  config: IntentsConfig
  refreshConfig: () => void
}

const IntentsContext = createContext<IntentsContextValue | null>(null)

export function IntentsProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<IntentsConfig>(() => getIntentsConfig())

  function refreshConfig() {
    setConfig(getIntentsConfig())
  }

  // Intents are "configured" (so the send-to-dayGLANCE buttons show) when ANY
  // transport is enabled: the WebDAV intents config above, the GLANCEvault DB
  // intents transport, or the Direct Access event set. Gating on fewer hid the
  // buttons for setups that used only the other, twice. The Direct Access
  // folder is restored asynchronously after launch, so its status is
  // subscribed to rather than read once: the buttons appear when it connects.
  const directAccess = useSyncExternalStore(directAccessTransport.subscribe, directAccessTransport.getSnapshot, directAccessTransport.getSnapshot)
  const isConfigured = anyIntentsTransportOn(intentsTransportsOn(directAccess))

  return (
    <IntentsContext.Provider value={{ isConfigured, config, refreshConfig }}>
      {children}
    </IntentsContext.Provider>
  )
}

// Provider + hook live together by design; the fast-refresh hint doesn't apply.
// eslint-disable-next-line react-refresh/only-export-components
export function useIntents(): IntentsContextValue {
  const ctx = useContext(IntentsContext)
  if (!ctx) throw new Error('useIntents must be used inside IntentsProvider')
  return ctx
}
