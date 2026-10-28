import { useCallback, useEffect, useState } from 'react'
import { getAllPersonDates, getCircles, getPeople, PEOPLE_CHANGED_EVENT } from './queries'
import type { PersonCircle, PersonDate, PersonWithLastInteraction } from './types'

export interface PeopleData {
  people: PersonWithLastInteraction[]
  circles: PersonCircle[]
  dates: PersonDate[]
  loading: boolean
  refresh: () => Promise<void>
}

// Everything the People home draws, reloaded whenever a local write or a
// remote apply announces a change.
export function usePeopleData(): PeopleData {
  const [people, setPeople] = useState<PersonWithLastInteraction[]>([])
  const [circles, setCircles] = useState<PersonCircle[]>([])
  const [dates, setDates] = useState<PersonDate[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [p, c, d] = await Promise.all([getPeople({ includeArchived: true }), getCircles(), getAllPersonDates()])
    setPeople(p)
    setCircles(c)
    setDates(d)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
    const onChange = () => { void refresh() }
    window.addEventListener(PEOPLE_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(PEOPLE_CHANGED_EVENT, onChange)
  }, [refresh])

  return { people, circles, dates, loading, refresh }
}
