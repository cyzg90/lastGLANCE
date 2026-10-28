import { registerPlugin } from '@capacitor/core'
import { isNativeShell } from './platform'

// The phone's address book, read-only (ContactsPlugin.java on Android,
// ContactsPlugin.swift on iOS, with the same shapes back). The web has no
// contacts access, so every entry point is hidden where contactsSupported()
// is false.

export type ContactsPermission = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

export interface RawContactEvent {
  date: string
  // ContactsContract Event.TYPE: 0 custom, 1 anniversary, 2 other, 3 birthday.
  // iOS sends the same numbers.
  type: number
  label: string | null
}

export interface DeviceContactSummary {
  key: string
  name: string
  hasPhone: boolean
  events: RawContactEvent[]
}

export interface ContactMethod {
  value: string
  label: string
}

export interface DeviceContactDetail {
  key: string
  found: boolean
  // Set when the contact's key moved (a merge or re-sync); the link follows it.
  currentKey?: string
  name?: string
  phones?: ContactMethod[]
  emails?: ContactMethod[]
  events?: RawContactEvent[]
  photo?: string | null
}

export type ContactAction = 'call' | 'text' | 'email'

interface ContactsPlugin {
  checkPermission(): Promise<{ state: ContactsPermission }>
  requestPermission(): Promise<{ state: ContactsPermission }>
  list(): Promise<{ contacts: DeviceContactSummary[] }>
  read(options: { keys: string[]; photos?: boolean }): Promise<{ contacts: DeviceContactDetail[] }>
  open(options: { action: ContactAction; value: string }): Promise<void>
}

const Contacts = registerPlugin<ContactsPlugin>('Contacts')

export function contactsSupported(): boolean {
  return isNativeShell()
}

export async function contactsPermission(): Promise<ContactsPermission> {
  if (!contactsSupported()) return 'denied'
  try {
    return (await Contacts.checkPermission()).state
  } catch {
    // An older native shell without the plugin.
    return 'denied'
  }
}

export async function requestContactsPermission(): Promise<ContactsPermission> {
  return (await Contacts.requestPermission()).state
}

export async function listDeviceContacts(): Promise<DeviceContactSummary[]> {
  return (await Contacts.list()).contacts
}

export async function readDeviceContacts(keys: string[], photos = false): Promise<DeviceContactDetail[]> {
  if (keys.length === 0) return []
  return (await Contacts.read({ keys, photos })).contacts
}

export async function openContactAction(action: ContactAction, value: string): Promise<void> {
  await Contacts.open({ action, value })
}
