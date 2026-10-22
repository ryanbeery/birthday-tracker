import express, { type Express } from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createApp } from '../src/app.js'
import { errorHandler } from '../src/errors.js'
import type { SubmissionPublisher } from '../src/publisher.js'

const NOW = new Date('2026-10-22T00:30:00Z')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const required = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  birthday: '1990-12-10',
  reminderWindowDays: 7,
}
const valid = { ...required, giftIdeas: 'A first edition of her notes' }

let publish: Mock<SubmissionPublisher['publish']>
let app: Express

beforeEach(() => {
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  publish = vi.fn<SubmissionPublisher['publish']>().mockResolvedValue(undefined)
  app = createApp({ publisher: { publish } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function post(body: object) {
  return request(app).post('/api/birthdays').send(body)
}

/** Checks the status and the error shape, { error, details }. */
function expectError(res: request.Response, status: number) {
  expect(res.status).toBe(status)
  expect(res.body).toEqual({ error: expect.any(String), details: expect.any(Array) })
}

describe('POST /api/birthdays', () => {
  it('returns 202 with only a UUID id', async () => {
    const res = await post(valid)

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ id: expect.stringMatching(UUID) })
  })

  it('publishes one message with the same id, the trimmed name and submittedAt', async () => {
    const res = await post({ ...valid, name: '  Ada Lovelace  ' })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({ ...valid, id: res.body.id, submittedAt: '2026-10-22T00:30:00.000Z' })
  })

  it('publishes no giftIdeas when none are given', async () => {
    const res = await post(required)

    expect(publish).toHaveBeenCalledWith({ ...required, id: res.body.id, submittedAt: '2026-10-22T00:30:00.000Z' })
  })

  it('gives the same body sent twice two ids and two messages', async () => {
    const first = await post(valid)
    const second = await post(valid)

    expect(first.body.id).not.toBe(second.body.id)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it.each([
    { label: 'a blank name', body: { ...valid, name: '' } },
    { label: 'Feb 30', body: { ...valid, birthday: '2023-02-30' } },
    { label: 'a future date', body: { ...valid, birthday: '2026-10-23' } },
    { label: 'a window of 0', body: { ...valid, reminderWindowDays: 0 } },
    { label: 'a window of 15', body: { ...valid, reminderWindowDays: 15 } },
    { label: 'a window of 7.5', body: { ...valid, reminderWindowDays: 7.5 } },
    { label: 'a bad email', body: { ...valid, email: 'not-an-email' } },
    { label: '501 characters of gift ideas', body: { ...valid, giftIdeas: 'x'.repeat(501) } },
  ])('returns 400 for $label and never publishes', async ({ body }) => {
    expectError(await post(body), 400)
    expect(publish).not.toHaveBeenCalled()
  })

  it('lists every bad field in the 400', async () => {
    const res = await post({ ...valid, email: 'not-an-email', birthday: '2023-02-30' })

    expect(res.body.error).toBe('Invalid submission')
    expect(res.body.details).toHaveLength(2)
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        { field: 'email', message: expect.any(String) },
        { field: 'birthday', message: expect.any(String) },
      ]),
    )
  })

  it('returns 400 for malformed JSON and never publishes', async () => {
    const res = await request(app).post('/api/birthdays').type('json').send('{"name": ')

    expectError(res, 400)
    expect(publish).not.toHaveBeenCalled()
  })

  it('returns 400 for a body sent as text/plain and never publishes', async () => {
    const res = await request(app).post('/api/birthdays').type('text').send(JSON.stringify(valid))

    expectError(res, 400)
    expect(publish).not.toHaveBeenCalled()
  })

  it('returns 413 for a body over 100 KB and never publishes', async () => {
    expectError(await post({ ...valid, giftIdeas: 'x'.repeat(101 * 1024) }), 413)
    expect(publish).not.toHaveBeenCalled()
  })

  it('returns 503 when publishing fails, logging the error instead of returning it', async () => {
    publish.mockRejectedValue(new Error('broker connection closed'))
    const res = await post(valid)

    expectError(res, 503)
    expect(res.text).not.toContain('broker connection closed')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('errors outside the route', () => {
  it('returns 404 in the error shape for an unknown route', async () => {
    expectError(await request(app).get('/api/unknown'), 404)
  })

  it('returns a generic 500 for an unexpected error, logging it instead of returning it', async () => {
    const broken = express()
    broken.get('/boom', () => {
      throw new Error('secret internals')
    })
    broken.use(errorHandler)
    const res = await request(broken).get('/boom')

    expectError(res, 500)
    expect(res.text).not.toContain('secret internals')
    expect(console.error).toHaveBeenCalled()
  })
})
