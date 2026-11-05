// Generate Play Store / marketing screenshots and the README screenshots
// against a running dev/preview build.
//
// Seeds a fresh browser profile with a rich, realistic demo dataset directly
// into the app's IndexedDB: categories, subcategories, chores and ~a year of
// varied completion history, plus People (circles, people with cadences and
// dates, and ~a year of logged contacts). Then it drives Chromium to capture
// dark-mode shots. Nothing is written to your real profile; each shot uses a
// throwaway browser context.
//
// Usage:
//   1. Start the app in another terminal:  npm run dev   (or `npm run preview`)
//   2. Run one of:
//        npm run gen:screenshots          store shots -> ./store-screenshots
//        npm run gen:readme-screenshots   README shots -> ./docs/screenshots (overwrites)
//
// Env overrides:
//   BASE_URL     app URL to shoot            (default http://localhost:5173)
//   OUT_DIR      output directory            (default ./store-screenshots, or
//                ./docs/screenshots with --readme; kept out of public/ so
//                the app build and the PWA precache never carry them)
//   CHROME_PATH  Chromium executable path    (default: auto-resolved by
//                playwright-core, honouring PLAYWRIGHT_BROWSERS_PATH)
//
// Store output (dark mode): phone-1-dashboard, phone-2-detail, phone-3a-editmode,
// phone-3b-editform, phone-4-people, phone-5-person (1200x2370),
// tablet-1-dashboard, tablet-2-detail, tablet-3-people, tablet-4-journal
// (2560x1600).
//
// README output (dark mode, the names README.md references): screenshot,
// screenshot_details, screenshot_journal, screenshot_people (3828x2580), and
// screenshot_phone_dashboard, screenshot_phone_detail, screenshot_phone_people,
// screenshot_phone_person (1200x2370).

import { chromium } from 'playwright-core'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const README = process.argv.includes('--readme')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173/'
const OUT = resolve(process.env.OUT_DIR ?? (README ? 'docs/screenshots' : 'store-screenshots'))
mkdirSync(OUT, { recursive: true })

// playwright-core does not ship a browser. Prefer CHROME_PATH, else look for a
// Chromium under PLAYWRIGHT_BROWSERS_PATH (how this repo's dev image ships it),
// else undefined -> let playwright-core resolve its own managed download.
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue
      for (const bin of [
        'chrome-linux/chrome',
        'chrome-linux/headless_shell',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      ]) {
        const p = resolve(root, dir, bin)
        if (existsSync(p)) return p
      }
    }
  }
  return undefined
}
const EXEC = resolveChrome()

// ── Demo taxonomy ────────────────────────────────────────────────────────────
// Icons are restricted to names that survive the app's ICON_REGISTRY dedup
// (lucide aliases like Wind/WashingMachine/Pill/Scissors collapse to another
// component and render blank), so every chore/category below shows an icon.
const CATS = [
  { k: 'home', name: 'Home', icon: 'Home' },
  { k: 'clean', name: 'Cleaning', icon: 'Brush', parent: 'home' },
  { k: 'kitchen', name: 'Kitchen', icon: 'CookingPot', parent: 'home' },
  { k: 'health', name: 'Health', icon: 'HeartPulse' },
  { k: 'fitness', name: 'Fitness', icon: 'Dumbbell', parent: 'health' },
  { k: 'medical', name: 'Medical', icon: 'BriefcaseMedical', parent: 'health' },
  { k: 'vehicle', name: 'Vehicle', icon: 'Car' },
  { k: 'finances', name: 'Finances', icon: 'Coins' },
  { k: 'garden', name: 'Garden', icon: 'Flower' },
  { k: 'pets', name: 'Pets', icon: 'Bone' },
]
// [categoryKey, name, icon, cadenceDays, lastDoneDaysAgo]
const CHORES = [
  ['clean', 'Vacuum', 'Fan', 7, 9],
  ['clean', 'Mop floors', 'Droplets', 14, 14],
  ['clean', 'Clean bathrooms', 'Bath', 7, 6],
  ['clean', 'Do laundry', 'Droplet', 7, 12],
  ['clean', 'Change bed sheets', 'BedDouble', 14, 15],
  ['kitchen', 'Clean kitchen', 'CookingPot', 10, 9],
  ['kitchen', 'Wipe counters', 'Droplet', 3, 6],
  ['kitchen', 'Take out trash', 'Brush', 3, 5],
  ['fitness', 'Morning workout', 'Dumbbell', 2, 2],
  ['fitness', 'Evening walk', 'Footprints', 1, 0],
  ['fitness', 'Bike ride', 'Bike', 7, 6],
  ['medical', 'Take vitamins', 'Cross', 1, 1],
  ['medical', 'Dentist cleaning', 'Cross', 180, 55],
  ['medical', 'Annual physical', 'Activity', 365, 70],
  ['medical', 'Eye exam', 'Eye', 365, 90],
  ['medical', 'Haircut', 'Brush', 30, 25],
  ['vehicle', 'Wash car', 'Droplets', 30, 15],
  ['vehicle', 'Oil change', 'Fuel', 120, 16],
  ['vehicle', 'Check tire pressure', 'Gauge', 30, 28],
  ['finances', 'Review budget', 'BadgeDollarSign', 30, 25],
  ['finances', 'Pay bills', 'Banknote', 30, 19],
  ['finances', 'Check bank statements', 'DollarSign', 30, 25],
  ['finances', 'Check credit score', 'CreditCard', 90, 15],
  ['garden', 'Water plants', 'Droplet', 7, 7],
  ['garden', 'Mow lawn', 'Leaf', 14, 12],
  ['garden', 'Weed garden', 'Flower2', 21, 19],
  ['garden', 'Fertilize lawn', 'FlaskConical', 60, 54],
  ['pets', 'Feed cats', 'Fish', 1, 0],
  ['pets', 'Clean litter box', 'Cat', 7, 7],
  ['pets', 'Brush cats', 'Brush', 14, 13],
  ['pets', 'Vet checkup', 'Cross', 365, 90],
]

async function seedRichData(page) {
  return page.evaluate(async ({ cats, chores }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('lastglance')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const tx = db.transaction(['categories', 'chores', 'completionEvents'], 'readwrite')
    const catStore = tx.objectStore('categories')
    const choreStore = tx.objectStore('chores')
    const evtStore = tx.objectStore('completionEvents')
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

    await req(catStore.clear())
    await req(choreStore.clear())
    await req(evtStore.clear())

    const now = Date.now()
    const DAY = 86400000
    const uuid = () => crypto.randomUUID()
    const iso = (ms) => new Date(ms).toISOString()

    // Global activity level shared by ALL chores (so quiet/busy days line up in the
    // aggregate header grid). Built from irregular random-length blocks with random
    // intensities — including scattered near-empty stretches — plus per-day jitter,
    // so the result looks genuinely random rather than a periodic sine (no stripes).
    const gf = new Array(382)
    {
      let d = 0
      while (d <= 381) {
        const len = 3 + Math.floor(Math.random() * 16)
        const r = Math.random()
        const level = r < 0.18 ? 0.02 + Math.random() * 0.08   // near-empty stretch
          : r < 0.45 ? 0.20 + Math.random() * 0.30             // low
          : r < 0.80 ? 0.50 + Math.random() * 0.45             // medium
          : 0.95 + Math.random() * 0.55                        // busy
        for (let i = 0; i < len && d <= 381; i++, d++) {
          gf[d] = Math.max(0, level * (0.65 + Math.random() * 0.7))
        }
      }
    }

    // categories: parents first so children can reference the numeric id
    const catId = {}, catSync = {}
    for (const c of cats.filter(c => !c.parent)) {
      const sync = uuid(); catSync[c.k] = sync
      catId[c.k] = await req(catStore.add({
        sync_id: sync, name: c.name, sort_order: cats.indexOf(c), icon: c.icon,
        parent_sync_id: null, parent_category_id: null, assigned_user_sync_ids: [],
        updated_at: iso(now),
      }))
    }
    for (const c of cats.filter(c => c.parent)) {
      const sync = uuid(); catSync[c.k] = sync
      catId[c.k] = await req(catStore.add({
        sync_id: sync, name: c.name, sort_order: cats.indexOf(c), icon: c.icon,
        parent_sync_id: catSync[c.parent], parent_category_id: catId[c.parent],
        assigned_user_sync_ids: [], updated_at: iso(now),
      }))
    }

    let totalEvents = 0
    let order = 0
    for (const [catKey, name, icon, cadence, last] of chores) {
      const choreId = await req(choreStore.add({
        sync_id: uuid(), name, category_id: catId[catKey], category_sync_id: catSync[catKey],
        sort_order: order++, target_cadence_days: cadence, notify_when_overdue: true,
        auto_schedule_to_dayglance: false, preferred_schedule_behavior: null,
        seasonal_start: null, seasonal_end: null, details: null, icon: icon ?? undefined,
        assigned_user_sync_ids: [], created_at: iso(now - 400 * DAY), updated_at: iso(now),
      }))
      // Day-by-day history so density fluctuates: genuine gaps (0), single days (1),
      // and occasional multi-per-day bursts (2-3). The most-recent completion is pinned
      // at exactly `last` days ago so the card's recency colour/elapsed text stays right.
      const mkEvent = async (ms) => {
        const at = new Date(ms)
        at.setHours(6 + Math.floor(Math.random() * 16), Math.floor(Math.random() * 60), 0, 0)
        await req(evtStore.add({
          sync_id: uuid(), chore_id: choreId, completed_at: at.toISOString(),
          note: null, source: 'manual', completed_by_user_sync_id: null,
        }))
        totalEvents++
      }
      await mkEvent(now - last * DAY)
      const base = Math.min(0.9, Math.max(0.03, 1 / cadence))
      const phase = Math.random() * Math.PI * 2
      for (let d = last + 1; d <= 380; d++) {
        const intensity = 0.35 + 0.85 * (0.5 + 0.5 * Math.sin(d / 26 + phase)) + (Math.random() - 0.5) * 0.35
        const p = Math.min(0.95, Math.max(0, base * intensity * gf[d] * 1.4))
        if (Math.random() < p) {
          const dayMs = now - d * DAY
          await mkEvent(dayMs)
          if (Math.random() < 0.22) await mkEvent(dayMs)                  // some days: 2
          if (cadence <= 3 && Math.random() < 0.10) await mkEvent(dayMs)  // frequent chores: occasional 3
        }
      }
    }
    await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
    return { cats: cats.length, chores: chores.length, events: totalEvents }
  }, { cats: CATS, chores: CHORES })
}

// ── People demo data ─────────────────────────────────────────────────────────
const PEOPLE_CIRCLES = [
  { k: 'family', name: 'Family', icon: 'Home' },
  { k: 'close', name: 'Close friends', icon: 'Heart' },
  { k: 'friends', name: 'Friends', icon: 'Users' },
  { k: 'work', name: 'Work', icon: 'Briefcase' },
]
// [circleKey, name, nickname, cadenceDays|null, preferredChannel, lastDaysAgo, lastDirection]
// Chosen so Reach out has a few people due for different reasons (past
// cadence, an unanswered "they got in touch", a run of reach-outs) and the
// recency bars span fresh to overdue.
const PEOPLE = [
  ['family', 'Mom', null, 7, 'call', 9, 'outbound'],
  ['family', 'Dad', null, 7, 'call', 3, 'inbound'],
  ['family', 'Rose Alvarez', 'Grandma', 14, 'call', 18, 'outbound'],
  ['family', 'Leo Alvarez', null, 14, 'text', 4, 'mutual'],
  ['close', 'Sam Rivera', null, 10, 'text', 13, 'outbound'],
  ['close', 'Maya Chen', null, 14, 'in_person', 6, 'mutual'],
  ['close', 'Jordan Lee', null, 21, 'video', 26, 'inbound'],
  ['friends', 'Alex Kim', null, 30, 'text', 12, 'inbound'],
  ['friends', 'Priya Shah', null, 30, 'in_person', 41, 'inbound'],
  ['friends', 'Chris Novak', null, 60, 'email', 22, 'outbound'],
  ['friends', 'Taylor Brooks', null, 45, 'call', 19, 'inbound'],
  ['work', 'Dana Ortiz', null, 30, 'email', 8, 'outbound'],
  ['work', 'Ben Walsh', null, null, 'in_person', 3, 'mutual'],
]
// [personName, kind, label|null, daysFromToday, birthYear|null]
const PEOPLE_DATES = [
  ['Maya Chen', 'birthday', null, 3, 1991],
  ['Rose Alvarez', 'birthday', null, 9, 1944],
  ['Mom', 'anniversary', null, 16, 1982],
  ['Alex Kim', 'birthday', null, 24, 1989],
  ['Dad', 'birthday', null, 47, 1956],
  ['Sam Rivera', 'birthday', null, 88, 1990],
  ['Leo Alvarez', 'custom', 'Graduation', 120, 2024],
  ['Jordan Lee', 'birthday', null, 160, null],
]
const PEOPLE_NOTES = [
  'Caught up on the new job', 'Coffee downtown', 'Sent photos from the trip',
  'Planning the summer visit', 'Quick check-in', 'Birthday call',
  'Talked about the move', 'Lunch near the office', 'Shared a book recommendation',
]

async function seedPeople(page) {
  return page.evaluate(async ({ circles, people, dates, notes }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('lastglance')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    const stores = ['people', 'interactions', 'personDates', 'personCircles']
    const tx = db.transaction(stores, 'readwrite')
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    for (const n of stores) await req(tx.objectStore(n).clear())

    const DAY = 86400000
    const now = Date.now()
    const iso = (ms) => new Date(ms).toISOString()
    const uuid = () => crypto.randomUUID()
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

    const circleSync = {}
    circles.forEach((c, i) => {
      circleSync[c.k] = uuid()
      tx.objectStore('personCircles').add({ sync_id: circleSync[c.k], name: c.name, icon: c.icon, sort_order: i, updated_at: iso(now) })
    })

    const personSync = {}
    for (const [circle, name, nickname, cadence, channel] of people) {
      personSync[name] = uuid()
      tx.objectStore('people').add({
        sync_id: personSync[name], name, nickname, circle_sync_id: circleSync[circle],
        target_cadence_days: cadence, preferred_channel: channel, details: null,
        archived: false, snoozed_until: null, notify_when_overdue: cadence != null,
        add_to_dayglance_when_overdue: false, send_to_lifeglance: false,
        owner_user_sync_id: null, created_at: iso(now - 400 * DAY), updated_at: iso(now),
      })
    }

    const today = new Date(); today.setHours(12, 0, 0, 0)
    for (const [name, kind, label, inDays, year] of dates) {
      const d = new Date(today.getTime() + inDays * DAY)
      tx.objectStore('personDates').add({
        sync_id: uuid(), person_sync_id: personSync[name], kind, label,
        month: d.getMonth() + 1, day: d.getDate(), year, remind_days_before: kind === 'birthday' ? 3 : 0,
        updated_at: iso(now),
      })
    }

    // History: roughly one contact per cadence (or every ~3 weeks without one)
    // for a year, mostly on the preferred channel, with the most recent pinned
    // at lastDaysAgo so the recency bar and Reach out read as designed.
    let total = 0
    const at = (daysAgo) => {
      const t = new Date(now - daysAgo * DAY)
      t.setHours(8 + Math.floor(Math.random() * 13), Math.floor(Math.random() * 60), 0, 0)
      return iso(Math.min(t.getTime(), now - 60000))
    }
    const add = (ids, daysAgo, channel, direction, note = null) => {
      tx.objectStore('interactions').add({
        sync_id: uuid(), person_sync_ids: ids, occurred_at: at(daysAgo), channel,
        direction, note, source: 'manual', updated_at: iso(now),
      })
      total++
    }
    const directions = ['outbound', 'outbound', 'outbound', 'inbound', 'inbound', 'mutual']
    const channels = ['in_person', 'call', 'video', 'text', 'email']
    for (const [, name, , cadence, channel, last, lastDir] of people) {
      const id = personSync[name]
      add([id], last, channel, lastDir, Math.random() < 0.5 ? pick(notes) : null)
      // A run of exactly three reach-outs with nothing back, so one card shows
      // that reason: two more outbound, then the inbound the run started after.
      let start = last
      if (name === 'Sam Rivera') {
        add([id], last + 6, 'text', 'outbound'); add([id], last + 12, 'call', 'outbound')
        add([id], last + 17, 'text', 'inbound'); start = last + 17
      }
      const step = cadence ?? 20
      for (let d = start + step; d <= 365; ) {
        add([id], d, Math.random() < 0.7 ? channel : pick(channels), pick(directions), Math.random() < 0.3 ? pick(notes) : null)
        d += Math.max(1, Math.round(step * (0.6 + Math.random() * 0.9)))
      }
    }
    // A few get-togethers that cover several people at once.
    add([personSync['Maya Chen'], personSync['Jordan Lee'], personSync['Alex Kim']], 33, 'in_person', 'mutual', "Dinner at Maya's")
    add([personSync['Mom'], personSync['Dad'], personSync['Leo Alvarez']], 52, 'in_person', 'mutual', 'Sunday lunch')

    await new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
    return { circles: circles.length, people: people.length, dates: dates.length, interactions: total }
  }, { circles: PEOPLE_CIRCLES, people: PEOPLE, dates: PEOPLE_DATES, notes: PEOPLE_NOTES })
}

async function newPage(browser, { width, height, dsf }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: dsf,
    colorScheme: 'dark', isMobile: dsf >= 3, hasTouch: dsf >= 3,
  })
  await ctx.addInitScript(() => {
    // A seeded Math.random (mulberry32), so every run seeds the same demo
    // history and the shots only change when the app does. Re-seeded on each
    // load, which is fine: the data is seeded exactly once per context.
    let seed = 0x1a57
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // Dark theme + skip the first-run welcome so it never covers a shot.
    localStorage.setItem('theme', 'dark')
    localStorage.setItem('lg-welcome-dismissed', '1')
  })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  return { ctx, page }
}

// Hide transient overlays that clutter store shots: the overdue toast stack
// (z-[60]) and the mobile FAB cluster (fixed bottom-6 right-6 z-40).
async function hideChrome(page) {
  await page.addStyleTag({ content:
    '[class*="z-[60]"]{display:none!important}' +
    '[class*="z-40"][class*="bottom-6"]{display:none!important}' })
}

async function loadSeeded(browser, size) {
  const { ctx, page } = await newPage(browser, size)
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.getByText('Vacuum').first().waitFor({ state: 'attached', timeout: 15000 }) // default seed -> DB exists
  const stats = await seedRichData(page)
  const peopleStats = await seedPeople(page)
  console.log('seeded', JSON.stringify(stats), JSON.stringify(peopleStats))
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Morning workout').first().waitFor({ state: 'attached', timeout: 15000 })
  await page.waitForTimeout(2200) // let the header grid's ~1.5s load "wave" settle to true colours
  await hideChrome(page)
  return { ctx, page }
}

// Switch workspace the way a returning user lands in it: the remembered mode.
async function switchMode(page, mode, waitText) {
  await page.evaluate((m) => localStorage.setItem('lg-mode', m), mode)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText(waitText).first().waitFor({ state: 'attached', timeout: 15000 })
  await page.waitForTimeout(2200) // header grid wave
  await hideChrome(page)
  await settlePointer(page)
}

async function openChoreDetail(page) {
  await page.getByRole('button', { name: /Morning workout/ }).first().click()
  await page.getByText('Past year').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
}

async function openJournal(page) {
  await page.getByRole('button', { name: 'Journal' }).first().click()
  await page.getByRole('heading', { name: 'Journal' }).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(800) // entries load from IndexedDB after the shell
}

async function openPerson(page, name) {
  await page.getByRole('button', { name: new RegExp(`^${name}, last contact`) }).first().click()
  await page.getByRole('heading', { name }).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(600)
}

// Park the pointer and drop focus so no hover tooltip lingers into a shot.
async function settlePointer(page) {
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.waitForTimeout(250)
}

async function closeOverlay(page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await settlePointer(page)
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] })
const PHONE = { width: 400, height: 790, dsf: 3 }      // 1200x2370
const TABLET = { width: 1280, height: 800, dsf: 2 }    // 2560x1600
const DESKTOP = { width: 1914, height: 1290, dsf: 2 }  // 3828x2580, the README's web shots

if (README) {
  {
    const { ctx, page } = await loadSeeded(browser, DESKTOP)
    await page.screenshot({ path: `${OUT}/screenshot.png` })
    await openChoreDetail(page)
    await page.screenshot({ path: `${OUT}/screenshot_details.png` })
    await closeOverlay(page)
    await openJournal(page)
    await page.screenshot({ path: `${OUT}/screenshot_journal.png` })
    await closeOverlay(page)
    await switchMode(page, 'people', 'Reach out')
    await page.screenshot({ path: `${OUT}/screenshot_people.png` })
    await ctx.close()
  }
  {
    const { ctx, page } = await loadSeeded(browser, PHONE)
    await page.screenshot({ path: `${OUT}/screenshot_phone_dashboard.png` })
    await openChoreDetail(page)
    await page.screenshot({ path: `${OUT}/screenshot_phone_detail.png` })
    await closeOverlay(page)
    await switchMode(page, 'people', 'Reach out')
    await page.screenshot({ path: `${OUT}/screenshot_phone_people.png` })
    await openPerson(page, 'Maya Chen')
    await page.screenshot({ path: `${OUT}/screenshot_phone_person.png` })
    await ctx.close()
  }
  await browser.close()
  console.log('README screenshots written to', OUT)
  process.exit(0)
}

// ── Phone shots (portrait, 1200x2370) ────────────────────────────────────────
{
  const { ctx, page } = await loadSeeded(browser, PHONE)
  await page.screenshot({ path: `${OUT}/phone-1-dashboard.png` })

  await page.getByRole('button', { name: /Morning workout/ }).first().click()
  await page.getByText('Past year').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/phone-2-detail.png` })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Edit mode (candidate A for the 3rd shot): reorder / edit / delete affordances.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole('button', { name: 'Edit categories and chores' }).first().click()
  await page.waitForTimeout(500)
  await hideChrome(page)
  await page.screenshot({ path: `${OUT}/phone-3a-editmode.png` })

  // Edit-chore form (candidate B): the config surface (icon, cadence, reminders, seasonal).
  await page.getByRole('button', { name: 'Edit Vacuum' }).first().click()
  await page.getByText('Edit chore').waitFor({ timeout: 8000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/phone-3b-editform.png` })
  await closeOverlay(page)

  await switchMode(page, 'people', 'Reach out')
  await page.screenshot({ path: `${OUT}/phone-4-people.png` })
  await openPerson(page, 'Maya Chen')
  await page.screenshot({ path: `${OUT}/phone-5-person.png` })
  await ctx.close()
}

// ── Tablet shots (landscape, 2560x1600) ──────────────────────────────────────
{
  const { ctx, page } = await loadSeeded(browser, TABLET)
  await page.screenshot({ path: `${OUT}/tablet-1-dashboard.png` })

  await page.getByRole('button', { name: /Morning workout/ }).first().click()
  await page.getByText('Past year').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/tablet-2-detail.png` })
  await closeOverlay(page)

  await openJournal(page)
  await page.screenshot({ path: `${OUT}/tablet-4-journal.png` })
  await closeOverlay(page)

  await switchMode(page, 'people', 'Reach out')
  await page.screenshot({ path: `${OUT}/tablet-3-people.png` })
  await ctx.close()
}

await browser.close()
console.log('Screenshots written to', OUT)
