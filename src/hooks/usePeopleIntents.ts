import { useEffect } from 'react'
import dayjs from 'dayjs'
import i18n from 'i18next'
import { emitCreate } from '@/intents/emitter'
import { getMeUserSyncId, getMultiUserEnabled } from '@/multiuser/settings'
import { visibleToMe } from '@/people/home'
import { getAllPersonDates, getPeople, INTERACTION_LOGGED_EVENT, PEOPLE_CHANGED_EVENT } from '@/people/queries'
import { DATES_TO_DAYGLANCE_KEY, isDatesToDayglanceOn } from '@/people/settings'
import {
  dateItem, datesToday, overdueEpisode, peopleDueForTask, reachOutTask, timelineEntry,
} from '@/people/glanceIntents'
import type { Interaction } from '@/people/types'
import { getActiveLocale } from '@/utils/datetime'

// What has gone to dayGLANCE already, per device like the chore auto-schedule
// marker: person sync_id -> the overdue stretch its task was for, and date
// item id -> the day it went.
const TASKS_SENT_KEY = 'lg-people-dg-tasks'
const DATES_SENT_KEY = 'lg-people-dg-dates'

function readMap(key: string): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}')
    return v && typeof v === 'object' ? v as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, map: Record<string, string>): void {
  try { localStorage.setItem(key, JSON.stringify(map)) } catch { /* storage blocked */ }
}

const t = i18n.t.bind(i18n)

// One pass over People for dayGLANCE. A marker is written only after the
// intent is durably queued, as with chores, so a failed enqueue retries on the
// next pass; emitCreate returns false with no transport on, sending nothing.
async function sendToDayglance(): Promise<void> {
  const [all, dates] = await Promise.all([getPeople(), getAllPersonDates()])
  const people = visibleToMe(all, getMultiUserEnabled(), getMeUserSyncId())
  const now = dayjs()

  const tasks = readMap(TASKS_SENT_KEY)
  for (const p of peopleDueForTask(people, now, id => tasks[id] ?? null)) {
    const fields = reachOutTask(t, p, now)
    const queued = await emitCreate(fields, `Queued "${fields.title}" for dayGLANCE`).catch(() => false)
    if (!queued) return
    tasks[p.sync_id] = overdueEpisode(p)
    writeMap(TASKS_SENT_KEY, tasks)
  }

  if (!isDatesToDayglanceOn()) return
  const today = now.format('YYYY-MM-DD')
  // Only today's ids matter; older ones would never match again.
  const sent = Object.fromEntries(Object.entries(readMap(DATES_SENT_KEY)).filter(([, day]) => day === today))
  for (const u of datesToday(dates, people, now)) {
    const fields = dateItem(t, u)
    if (sent[fields.source_entity_id!]) continue
    const queued = await emitCreate(fields, `Queued "${fields.title}" for dayGLANCE`).catch(() => false)
    if (!queued) break
    sent[fields.source_entity_id!] = today
  }
  writeMap(DATES_SENT_KEY, sent)
}

// One pass at a time across the app (React's dev double-mount included): two
// overlapping passes would both read the markers before either wrote them and
// send the same item twice. A request during a pass runs once more after it.
let inFlight = false
let again = false
function run(): void {
  if (inFlight) { again = true; return }
  inFlight = true
  sendToDayglance()
    .catch(() => { /* retried on the next pass */ })
    .finally(() => {
      inFlight = false
      if (again) { again = false; run() }
    })
}

async function sendToLifeglance(interaction: Interaction): Promise<void> {
  const people = await getPeople({ includeArchived: true })
  const fields = timelineEntry(t, interaction, people, getActiveLocale())
  if (!fields) return
  await emitCreate(fields, `Queued "${fields.title}" for lifeGLANCE`).catch(() => false)
}

// Sends People to the other GLANCE apps (docs: the People spec, Intents): the
// dayGLANCE pass on launch, on People changes, on return to the app and once
// an hour (someone tips past due with no change at all), and a lifeGLANCE
// entry for each contact logged on this device.
export function usePeopleIntents(): void {
  useEffect(() => {
    run()

    let timer: ReturnType<typeof setTimeout> | undefined
    const onPeople = () => {
      clearTimeout(timer)
      timer = setTimeout(run, 1000)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run()
    }
    const onLogged = (e: Event) => {
      const interaction = (e as CustomEvent<Interaction>).detail
      if (interaction) void sendToLifeglance(interaction)
    }
    const settingEvent = `lg:setting:${DATES_TO_DAYGLANCE_KEY}`
    const hourly = setInterval(run, 60 * 60 * 1000)

    window.addEventListener(PEOPLE_CHANGED_EVENT, onPeople)
    window.addEventListener('lg:sync-applied', onPeople)
    window.addEventListener(settingEvent, run)
    window.addEventListener(INTERACTION_LOGGED_EVENT, onLogged)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      clearInterval(hourly)
      window.removeEventListener(PEOPLE_CHANGED_EVENT, onPeople)
      window.removeEventListener('lg:sync-applied', onPeople)
      window.removeEventListener(settingEvent, run)
      window.removeEventListener(INTERACTION_LOGGED_EVENT, onLogged)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
