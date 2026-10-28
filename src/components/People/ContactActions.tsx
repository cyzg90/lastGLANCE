import { useEffect, useState } from 'react'
import { BookUser, Mail, MessageSquare, Phone, Unlink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openContactAction, readDeviceContacts, type ContactAction, type DeviceContactDetail } from '@/native/contacts'
import { removeContactLink } from '@/people/queries'
import { expectReturnFrom } from '@/people/returnToLog'
import type { ContactLink, PersonWithLastInteraction } from '@/people/types'

interface Props {
  person: PersonWithLastInteraction
  link: ContactLink | null
  onLink: () => void
  // The contact's photo, read live for the header and never stored.
  onPhoto: (photo: string | null) => void
}

const ACTIONS: { action: ContactAction; icon: typeof Phone; field: 'phones' | 'emails' }[] = [
  { action: 'call', icon: Phone, field: 'phones' },
  { action: 'text', icon: MessageSquare, field: 'phones' },
  { action: 'email', icon: Mail, field: 'emails' },
]

// Call, Text and Email for a linked person, with numbers and addresses read
// live from the contact each time (they are never stored or synced), or a
// Link to contact button when there is no link yet.
export function ContactActions({ person, link, onLink, onPhoto }: Props) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<DeviceContactDetail | null>(null)
  const [choosing, setChoosing] = useState<ContactAction | null>(null)
  const key = link?.device_contact_key ?? null

  useEffect(() => {
    let live = true
    setDetail(null)
    onPhoto(null)
    if (!key) return
    void readDeviceContacts([key], true).then(([d]) => {
      if (!live || !d?.found) return
      setDetail(d)
      onPhoto(d.photo ?? null)
    }).catch(() => {})
    return () => { live = false }
  }, [key, onPhoto])

  if (!link) {
    return (
      <button
        onClick={onLink}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
      >
        <BookUser size={15} /> {t('people.contacts.linkButton')}
      </button>
    )
  }

  async function go(action: ContactAction, value: string) {
    setChoosing(null)
    expectReturnFrom({ personSyncId: person.sync_id, name: person.nickname || person.name, action })
    await openContactAction(action, value).catch(() => {})
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {ACTIONS.map(({ action, icon: Icon, field }) => {
          const values = detail?.[field] ?? []
          return (
            <button
              key={action}
              disabled={values.length === 0}
              onClick={() => (values.length === 1 ? go(action, values[0].value) : setChoosing(c => (c === action ? null : action)))}
              aria-expanded={values.length > 1 ? choosing === action : undefined}
              className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-100 dark:disabled:hover:bg-slate-700/60 transition-colors"
            >
              <Icon size={16} />
              {t(`people.contacts.action.${action}`)}
            </button>
          )
        })}
      </div>
      {choosing && detail && (
        <ul className="rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
          {(detail[ACTIONS.find(a => a.action === choosing)!.field] ?? []).map(m => (
            <li key={m.value}>
              <button
                onClick={() => go(choosing, m.value)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40"
              >
                <span className="truncate">{m.value}</span>
                <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{m.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
        <BookUser size={12} />
        <span className="truncate">{t('people.contacts.linkedTo', { name: detail?.name ?? person.name })}</span>
        <span aria-hidden>·</span>
        <button
          onClick={() => removeContactLink(person.sync_id)}
          className="inline-flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <Unlink size={11} /> {t('people.contacts.unlink')}
        </button>
      </p>
    </div>
  )
}
