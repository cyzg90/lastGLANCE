import { useCallback, useEffect, useState } from 'react'
import { contactsPermission, contactsSupported, readDeviceContacts } from '@/native/contacts'
import { birthdayChange, type ContactDate } from './contacts'
import {
  getAllPersonDates, getContactLinks, PEOPLE_CHANGED_EVENT, removeContactLink, setContactLink, updatePersonDate,
} from './queries'
import { useContactsEnabled } from './settings'
import type { ContactLink, PersonDate } from './types'

export interface BirthdayOffer {
  personSyncId: string
  date: PersonDate
  next: ContactDate
}

// Offers the user turned down, so a "Keep" sticks until the contact changes
// again.
const DISMISSED_KEY = 'lg-people-contact-offers-dismissed'

export function offerId(o: BirthdayOffer): string {
  return `${o.personSyncId}|${o.next.year ?? ''}-${o.next.month}-${o.next.day}`
}

function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[] } catch { return [] }
}

export interface PeopleContacts {
  // The setting is on and this device has contacts (Android or iOS).
  available: boolean
  links: ContactLink[]
  offers: BirthdayOffer[]
  // Keep the person's date and stop offering this one.
  dismissOffer: (o: BirthdayOffer) => void
  // Take the contact's date.
  acceptOffer: (o: BirthdayOffer) => Promise<void>
}

// Contact links for this device, kept fresh: on open and whenever the app
// comes back to the foreground, linked contacts are re-read. A deleted
// contact drops its link (the person stays), a moved key is followed, and a
// changed birthday becomes an offer.
export function usePeopleContacts(): PeopleContacts {
  const enabled = useContactsEnabled()
  const available = enabled && contactsSupported()
  const [links, setLinks] = useState<ContactLink[]>([])
  const [offers, setOffers] = useState<BirthdayOffer[]>([])

  const loadLinks = useCallback(async () => { setLinks(await getContactLinks()) }, [])

  const refresh = useCallback(async () => {
    if (!available || (await contactsPermission()) !== 'granted') return
    const current = await getContactLinks()
    if (current.length === 0) { setOffers([]); return }
    const [details, dates] = await Promise.all([
      readDeviceContacts(current.map(l => l.device_contact_key)).catch(() => null),
      getAllPersonDates(),
    ])
    if (!details) return
    const byKey = new Map(details.map(d => [d.key, d]))
    const dismissed = readDismissed()
    const found: BirthdayOffer[] = []
    for (const link of current) {
      const d = byKey.get(link.device_contact_key)
      if (!d) continue
      if (!d.found) { await removeContactLink(link.person_sync_id); continue }
      if (d.currentKey && d.currentKey !== link.device_contact_key) await setContactLink(link.person_sync_id, d.currentKey)
      const change = birthdayChange(dates.filter(x => x.person_sync_id === link.person_sync_id), d.events ?? [])
      if (change) {
        const offer = { personSyncId: link.person_sync_id, ...change }
        if (!dismissed.includes(offerId(offer))) found.push(offer)
      }
    }
    setOffers(found)
  }, [available])

  useEffect(() => {
    if (!available) return
    void loadLinks()
    void refresh()
    const onChange = () => { void loadLinks() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener(PEOPLE_CHANGED_EVENT, onChange)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(PEOPLE_CHANGED_EVENT, onChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [available, loadLinks, refresh])

  const dismissOffer = useCallback((o: BirthdayOffer) => {
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...readDismissed(), offerId(o)])) } catch { /* storage blocked */ }
    setOffers(os => os.filter(x => offerId(x) !== offerId(o)))
  }, [])

  const acceptOffer = useCallback(async (o: BirthdayOffer) => {
    await updatePersonDate(o.date.sync_id, { month: o.next.month, day: o.next.day, year: o.next.year })
    setOffers(os => os.filter(x => offerId(x) !== offerId(o)))
  }, [])

  return { available, links: available ? links : [], offers: available ? offers : [], dismissOffer, acceptOffer }
}
