import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { directAccessTransport, type DirectAccessTransport } from '@/sync/directAccess'
import { isIOS } from '@/native/platform'

// On iPhone and iPad the Direct Access bookmark is of a file, not a folder,
// since Files hands over no folder: the household roster and the intents
// event set are bookmarked files of their own, each picked (the one another
// device already created) or created (a first device) from the settings
// section that uses it: the roster from the Household panel, the event set
// from the Direct Access intents opt-in. Renders nothing off iOS, and
// nothing until the sync file is connected, since it is the same folder tree.

const button = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors'

export function DirectAccessFileRow({ slot, transport = directAccessTransport }: { slot: 'users' | 'events'; transport?: DirectAccessTransport }) {
  const { t } = useTranslation()
  const status = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getSnapshot)
  const [busy, setBusy] = useState(false)
  if (!isIOS() || !status.supported || !status.connected) return null
  const file = slot === 'users' ? status.roster : status.events
  if (!file) return null

  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  const pick = run(() => (slot === 'users' ? transport.pickUsersFile() : transport.pickEventsFile()))
  const create = run(() => (slot === 'users' ? transport.createUsersFile() : transport.createEventsFile()))
  const forget = run(() => (slot === 'users' ? transport.forgetUsersFile() : transport.forgetEventsFile()))
  const k = slot === 'users' ? 'roster' : 'events'
  const chosen = file.configured
    ? t(`sync.directAccess.${k}Chosen`, { name: file.name ?? '' })
    : t(`sync.directAccess.${k}NotChosen`)

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-slate-400 dark:text-slate-500">{t(`sync.directAccess.${k}Hint`)}</p>
      <p className="text-sm text-slate-700 dark:text-slate-300">{chosen}</p>
      <div className="flex items-center gap-3 flex-wrap">
        {file.configured ? (
          <>
            <button type="button" onClick={pick} disabled={busy} className={button}>{t('sync.directAccess.fileChange')}</button>
            <button type="button" onClick={forget} disabled={busy} className={button}>{t('sync.directAccess.fileForget')}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={pick} disabled={busy} className={button}>{t('sync.directAccess.fileChoose')}</button>
            <button type="button" onClick={create} disabled={busy} className={button}>{t('sync.directAccess.fileCreate')}</button>
          </>
        )}
      </div>
    </div>
  )
}
