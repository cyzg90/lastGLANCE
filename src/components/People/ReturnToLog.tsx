import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { logInteraction } from '@/people/queries'
import type { ContactAction } from '@/native/contacts'
import { takeReturn, type PendingReturn } from '@/people/returnToLog'
import type { InteractionChannel } from '@/people/types'

// The one-tap log offered on coming back from Call, Text or Email (docs: the
// People spec, Person detail). Logged as outbound without asking: the app
// knows who dialled.
const CHANNEL: Record<ContactAction, InteractionChannel> = { call: 'call', text: 'text', email: 'email' }

export function ReturnToLogPrompt() {
  const { t } = useTranslation()
  const [shown, setShown] = useState<PendingReturn | null>(null)

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const p = takeReturn()
      if (p) setShown(p)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!shown) return null
  const log = async () => {
    setShown(null)
    await logInteraction({
      person_sync_ids: [shown.personSyncId], channel: CHANNEL[shown.action], direction: 'outbound', source: 'quick_action',
    })
  }
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-[80] flex justify-center p-4 app-safe-bottom pointer-events-none">
      <div className="pointer-events-auto w-full sm:max-w-sm flex items-center gap-3 rounded-2xl px-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl">
        <p className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-200">
          {t(`people.contacts.logPrompt.${shown.action}`, { name: shown.name })}
        </p>
        <button
          onClick={log}
          className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium text-green-400 border border-green-400/40 hover:bg-green-400/10 transition-colors"
        >
          {t('people.contacts.logIt')}
        </button>
        <button onClick={() => setShown(null)} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label={t('people.close')}>
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
