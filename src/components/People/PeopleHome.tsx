import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { BookUser, Plus, UserPlus, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUsersContext } from '@/multiuser/UsersContext'
import { createCircle } from '@/people/queries'
import { groupByCircle, reachOutList, upcomingDates, visibleToMe } from '@/people/home'
import type { ReachOutItem, UpcomingDate } from '@/people/home'
import { usePeopleData } from '@/people/usePeopleData'
import { usePeopleContacts } from '@/people/useContacts'
import { useShowReciprocity } from '@/people/settings'
import type { InteractionDirection, PersonWithLastInteraction } from '@/people/types'
import { formatMonthShort } from '@/utils/datetime'
import { clearPendingOpenPerson, OPEN_PERSON_PENDING_EVENT, peekPendingOpenPerson } from '@/native/pendingOpenPerson'
import { CircleManagerModal } from './CircleManagerModal'
import { ContactsModal } from './ContactsModal'
import { ContactsNotices } from './ContactsNotices'
import { ReturnToLogPrompt } from './ReturnToLog'
import { PersonDetailModal } from './PersonDetailModal'
import { PersonFormModal } from './PersonFormModal'
import { PersonRow } from './PersonRow'
import { QuickLogSheet } from './QuickLogSheet'
import { dateKindLabel, daysUntilLabel, reachOutReasonLabel } from './labels'

// The header's Circles and Add person buttons live in App.tsx, outside this
// tree; they reach the sheets here through these events.
export const PEOPLE_ADD_EVENT = 'lg:people-add-person'
export const PEOPLE_CIRCLES_EVENT = 'lg:people-manage-circles'

const STARTER_CIRCLES = ['family', 'friends', 'work'] as const
const COMING_UP_TILES = 9
// Masonry: a column per this much width, like the chores grid's cards.
const MIN_CARD_WIDTH = 340
const GAP = 20

// The same card the chores grid draws for a category.
function Card({ title, count, action, children }: {
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-bold text-green-400 tracking-tight truncate flex-1">
          {title}
          {count !== undefined && <span className="ml-2 text-xs font-medium text-slate-400 dark:text-slate-500">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function DateTile({ u, onOpen }: { u: UpcomingDate; onOpen: () => void }) {
  const { t } = useTranslation()
  const soon = u.daysUntil <= 7
  return (
    <button
      onClick={onOpen}
      className={`aspect-square min-w-0 flex flex-col justify-between rounded-xl border p-2.5 text-left transition-colors ${
        soon
          ? 'bg-pink-400/10 border-pink-400/40 hover:border-pink-400/70'
          : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/40 hover:border-slate-300 dark:hover:border-slate-600/60'
      }`}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="flex flex-col leading-none">
          <span className={`text-xl font-bold tabular-nums ${soon ? 'text-pink-400' : 'text-slate-700 dark:text-slate-200'}`}>{u.on.date()}</span>
          <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{formatMonthShort(u.on)}</span>
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums shrink-0 mt-0.5">{daysUntilLabel(t, u.daysUntil)}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-800 dark:text-slate-100 leading-tight line-clamp-2 break-words">{u.person.name}</span>
        <span className="block text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
          {dateKindLabel(t, u.date)}{u.turning !== null ? ` (${u.turning})` : ''}
        </span>
      </span>
    </button>
  )
}

// How many masonry columns fit the element's width.
function useColumns(el: HTMLDivElement | null): number {
  const [cols, setCols] = useState(1)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth + GAP) / (MIN_CARD_WIDTH + GAP))))
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => obs.disconnect()
  }, [el])
  return cols
}

export function PeopleHome() {
  const { t } = useTranslation()
  const { multiUserEnabled, meId } = useUsersContext()
  const { people: all, circles, dates, loading } = usePeopleData()
  const showReciprocity = useShowReciprocity()
  const contacts = usePeopleContacts()
  const [importing, setImporting] = useState<{ circleId: string | null } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [logFor, setLogFor] = useState<{ ids: string[]; direction: InteractionDirection | null } | null>(null)
  const [adding, setAdding] = useState<{ circleId: string | null } | null>(null)
  const [managingCircles, setManagingCircles] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  // A callback ref, so the grid is measured once it exists (it is absent
  // while loading and in the empty state).
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null)
  const cols = useColumns(gridEl)

  useEffect(() => {
    const onAdd = () => setAdding({ circleId: null })
    const onCircles = () => setManagingCircles(true)
    window.addEventListener(PEOPLE_ADD_EVENT, onAdd)
    window.addEventListener(PEOPLE_CIRCLES_EVENT, onCircles)
    return () => {
      window.removeEventListener(PEOPLE_ADD_EVENT, onAdd)
      window.removeEventListener(PEOPLE_CIRCLES_EVENT, onCircles)
    }
  }, [])

  const mine = useMemo(() => visibleToMe(all, multiUserEnabled, meId), [all, multiUserEnabled, meId])

  // A People notification tap (src/native/reminders.ts). Taken once People
  // has loaded, whether the tap came first (cold start) or later.
  useEffect(() => {
    if (loading) return
    const take = () => {
      const req = peekPendingOpenPerson()
      if (!req) return
      clearPendingOpenPerson()
      if (req.action === 'home') return
      if (req.action === 'add') { setAdding({ circleId: null }); return }
      if (!mine.some(p => p.sync_id === req.personSyncId)) return
      if (req.action === 'log') setLogFor({ ids: [req.personSyncId], direction: 'outbound' })
      else setOpenId(req.personSyncId)
    }
    take()
    window.addEventListener(OPEN_PERSON_PENDING_EVENT, take)
    return () => window.removeEventListener(OPEN_PERSON_PENDING_EVENT, take)
  }, [loading, mine])
  const active = useMemo(() => mine.filter(p => !p.archived), [mine])
  const archived = useMemo(() => mine.filter(p => p.archived), [mine])
  const reachOut = useMemo(
    () => reachOutList(active, dates, undefined, { showReciprocity }),
    [active, dates, showReciprocity],
  )
  const comingUp = useMemo(() => upcomingDates(dates, active).slice(0, COMING_UP_TILES), [dates, active])
  const groups = useMemo(() => groupByCircle(active, circles), [active, circles])
  const open = mine.find(p => p.sync_id === openId) ?? null

  const openPerson = (p: PersonWithLastInteraction) => setOpenId(p.sync_id)
  // Logging from a Reach out card presets "I reached out": that list is
  // where you go to do the reaching.
  const row = (p: PersonWithLastInteraction, fromReachOut = false, reason: string | null = null) => (
    <PersonRow
      key={p.sync_id}
      person={p}
      onOpen={openPerson}
      onQuickLog={() => setLogFor({ ids: [p.sync_id], direction: fromReachOut ? 'outbound' : null })}
      reason={reason}
      snoozable={fromReachOut}
    />
  )
  const reasonText = (item: ReachOutItem) => reachOutReasonLabel(t, item)

  async function addStarterCircles() {
    for (const key of STARTER_CIRCLES) await createCircle(t(`people.starterCircles.${key}`))
  }

  // Each card goes to the shortest column, estimated from its row count,
  // which keeps the circles' order reading left to right like the chores grid.
  const cards: { key: string; rows: number; node: () => React.ReactNode }[] = groups.map(g => ({
    key: g.circle?.sync_id ?? 'none',
    rows: Math.max(1, g.people.length),
    node: () => (
      <Card
        title={g.circle?.name ?? (circles.length ? t('people.home.noCircle') : t('people.home.everyone'))}
        count={g.people.length}
        action={
          <button
            onClick={() => setAdding({ circleId: g.circle?.sync_id ?? null })}
            className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-green-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={t('people.home.addToCircle', { circle: g.circle?.name ?? t('people.home.noCircle') })}
          >
            <Plus size={15} />
          </button>
        }
      >
        {g.people.length === 0
          ? <p className="text-sm text-slate-400 dark:text-slate-500">{t('people.home.emptyCircle')}</p>
          : <div className="space-y-2">{g.people.map(p => row(p))}</div>}
      </Card>
    ),
  }))
  if (archived.length) {
    cards.push({
      key: 'archived',
      rows: showArchived ? archived.length : 0,
      node: () => (
        <Card title={t('people.detail.archived')} count={archived.length}>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          >
            {showArchived ? t('people.home.hideArchived') : t('people.home.showArchived', { n: archived.length })}
          </button>
          {showArchived && <div className="space-y-2 mt-3 opacity-70">{archived.map(p => row(p))}</div>}
        </Card>
      ),
    })
  }
  const columns: typeof cards[] = Array.from({ length: cols }, () => [])
  const heights = new Array<number>(cols).fill(0)
  for (const c of cards) {
    const i = heights.indexOf(Math.min(...heights))
    columns[i].push(c)
    heights[i] += 2 + c.rows
  }

  if (loading) return <div className="flex-1" />

  const empty = active.length === 0 && archived.length === 0

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {empty ? (
        <div className="flex flex-col items-center text-center gap-3 py-16 px-4">
          <Users size={36} className="text-green-400/70" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t('people.empty.title')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">{t('people.empty.body')}</p>
          <button
            onClick={() => setAdding({ circleId: null })}
            className="mt-2 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-green-400 border border-green-400/40 hover:bg-green-400/10 transition-colors"
          >
            <UserPlus size={15} /> {t('people.empty.addFirst')}
          </button>
          {contacts.available && (
            <button
              onClick={() => setImporting({ circleId: null })}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors"
            >
              <BookUser size={15} /> {t('people.contacts.importButton')}
            </button>
          )}
          {circles.length === 0 && (
            <button
              onClick={addStarterCircles}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2"
            >
              {t('people.empty.starterCircles')}
            </button>
          )}
        </div>
      ) : (
        // Phone: one column, Reach out and Coming up first. Tablet: those two
        // side by side above the circles. Desktop: those two in a fixed side
        // column, the circles in a masonry grid beside it. The column's divider
        // runs the full height and meets the header's bottom border.
        <div className="grow shrink-0 p-4 min-[1060px]:p-0 flex flex-col min-[1060px]:flex-row gap-5 min-[1060px]:gap-0">
          <div className="w-full min-[1060px]:w-[429px] shrink-0 grid grid-cols-1 sm:grid-cols-2 min-[1060px]:grid-cols-1 items-start content-start gap-5 min-[1060px]:p-6 min-[1060px]:border-r border-slate-200 dark:border-slate-800/80">
            <ContactsNotices contacts={contacts} people={active} />
            <Card title={t('people.home.reachOut')}>
              {reachOut.length
                ? <div className="space-y-2">{reachOut.map(item => row(item.person, true, reasonText(item)))}</div>
                : <p className="text-sm text-slate-400 dark:text-slate-500">{t('people.home.reachOutEmpty')}</p>}
            </Card>
            <Card title={t('people.home.comingUp')}>
              {comingUp.length
                ? (
                  <div className="grid grid-cols-3 gap-2">
                    {comingUp.map(u => <DateTile key={u.date.sync_id} u={u} onOpen={() => openPerson(u.person)} />)}
                  </div>
                )
                : <p className="text-sm text-slate-400 dark:text-slate-500">{t('people.home.comingUpEmpty')}</p>}
            </Card>
          </div>

          <div className="flex-1 min-w-0 min-[1060px]:p-6">
            <div ref={setGridEl} className="flex items-start" style={{ gap: GAP }}>
              {columns.map((col, i) => (
                <div key={i} className="flex-1 min-w-0 flex flex-col" style={{ gap: GAP }}>
                  {col.map(c => <div key={c.key}>{c.node()}</div>)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {open && (
        <PersonDetailModal
          person={open}
          people={mine}
          circles={circles}
          contactsAvailable={contacts.available}
          links={contacts.links}
          onClose={() => setOpenId(null)}
        />
      )}
      {logFor && (
        <QuickLogSheet
          people={mine}
          initialPersonIds={logFor.ids}
          initialDirection={logFor.direction}
          onClose={() => setLogFor(null)}
        />
      )}
      {adding && (
        <PersonFormModal
          circles={circles}
          initialCircleId={adding.circleId}
          onImport={contacts.available ? () => { setImporting({ circleId: adding.circleId }); setAdding(null) } : undefined}
          onClose={() => setAdding(null)}
        />
      )}
      {importing && (
        <ContactsModal
          mode="import"
          initialCircleId={importing.circleId}
          links={contacts.links}
          circles={circles}
          onClose={() => setImporting(null)}
        />
      )}
      {contacts.available && <ReturnToLogPrompt />}
      {managingCircles && (
        <CircleManagerModal circles={circles} onClose={() => setManagingCircles(false)} />
      )}
    </div>
  )
}
