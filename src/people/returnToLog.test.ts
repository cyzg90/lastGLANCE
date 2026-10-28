import { describe, it, expect } from 'vitest'
import { expectReturnFrom, takeReturn } from './returnToLog'

describe('return to log', () => {
  it('offers once, and not after a long time away', () => {
    expectReturnFrom({ personSyncId: 'p', name: 'Sam', action: 'call' }, 1000)
    expect(takeReturn(5000)).toMatchObject({ name: 'Sam', action: 'call' })
    expect(takeReturn(6000)).toBeNull()
    expectReturnFrom({ personSyncId: 'p', name: 'Sam', action: 'text' }, 0)
    expect(takeReturn(3 * 60 * 60 * 1000)).toBeNull()
  })
})
