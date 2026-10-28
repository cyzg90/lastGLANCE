import { useEffect, useState } from 'react'

// A per-device on/off People preference in localStorage, readable outside
// React and live inside it: every hook instance updates when it changes.
export interface LocalSetting {
  get(): boolean
  set(on: boolean): void
  use(): boolean
}

export function localSetting(key: string, defaultOn: boolean): LocalSetting {
  const event = `lg:setting:${key}`
  const get = () => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? defaultOn : v === 'true'
    } catch {
      return defaultOn
    }
  }
  const set = (on: boolean) => {
    try { localStorage.setItem(key, on ? 'true' : 'false') } catch { /* storage blocked */ }
    window.dispatchEvent(new Event(event))
  }
  function use(): boolean {
    const [value, setValue] = useState(get)
    useEffect(() => {
      const onChange = () => setValue(get())
      window.addEventListener(event, onChange)
      return () => window.removeEventListener(event, onChange)
    }, [])
    return value
  }
  return { get, set, use }
}

// A per-device time of day in localStorage, as minutes after midnight, with
// the same live hook. Anything unreadable falls back to the default.
export interface LocalTimeSetting {
  get(): number
  set(minutes: number): void
  use(): number
}

export function localTimeSetting(key: string, defaultMinutes: number): LocalTimeSetting {
  const event = `lg:setting:${key}`
  const get = () => {
    try {
      const v = Number(localStorage.getItem(key))
      return localStorage.getItem(key) !== null && Number.isInteger(v) && v >= 0 && v < 24 * 60 ? v : defaultMinutes
    } catch {
      return defaultMinutes
    }
  }
  const set = (minutes: number) => {
    try { localStorage.setItem(key, String(minutes)) } catch { /* storage blocked */ }
    window.dispatchEvent(new Event(event))
  }
  function use(): number {
    const [value, setValue] = useState(get)
    useEffect(() => {
      const onChange = () => setValue(get())
      window.addEventListener(event, onChange)
      return () => window.removeEventListener(event, onChange)
    }, [])
    return value
  }
  return { get, set, use }
}
