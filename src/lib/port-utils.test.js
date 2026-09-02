import { describe, expect, it } from 'vitest'
import { MAX_PORT, nextPort, portClimbedNotice } from './port-utils.js'

describe('nextPort', () => {
  it('climbs by one within range', () => {
    expect(nextPort(4173)).toBe(4174)
    expect(nextPort(5173)).toBe(5174)
  })

  it('returns null when the valid port range is exhausted', () => {
    expect(nextPort(MAX_PORT)).toBe(null)
  })

  it('honors a custom max ceiling', () => {
    expect(nextPort(65534, 65535)).toBe(65535)
    expect(nextPort(65535, 65535)).toBe(null)
  })

  it('normalizes invalid inputs', () => {
    expect(nextPort(-5)).toBe(1)
    expect(nextPort(NaN)).toBe(1)
  })
})

describe('portClimbedNotice', () => {
  it('describes the from->to climb', () => {
    expect(portClimbedNotice(4173, 4174)).toContain('Port 4173')
    expect(portClimbedNotice(4173, 4174)).toContain('4174')
  })
})
