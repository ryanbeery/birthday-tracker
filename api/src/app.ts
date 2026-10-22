import { randomUUID } from 'node:crypto'
import express from 'express'
import { z } from 'zod'
import { findBirthday, listBirthdays } from './birthdays.js'
import type { Database } from './db.js'
import { errorHandler, notFound, sendError } from './errors.js'
import { PublisherConfigError, type SubmissionPublisher } from './publisher.js'
import { parseSubmission, todayUtc } from './submission.js'

/** How long a submission waits for the broker's confirm before the API answers 503. */
const PUBLISH_TIMEOUT_MS = 5000

export function createApp({ publisher, db }: { publisher: SubmissionPublisher; db: Database }) {
  const app = express()
  app.use(express.json({ limit: '100kb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.post('/api/birthdays', async (req, res) => {
    const result = parseSubmission(req.body)
    if (!result.success) {
      sendError(res, 400, 'Invalid submission', result.errors)
      return
    }

    const message = { id: randomUUID(), ...result.data, submittedAt: new Date().toISOString() }
    try {
      await withTimeout(publisher.publish(message), PUBLISH_TIMEOUT_MS)
    } catch (error) {
      // A setup problem won't fix itself, so the error handler turns it into a 500.
      if (error instanceof PublisherConfigError) throw error
      // The broker may still have the message, so a 503 doesn't prove it was lost.
      console.error('Publishing a submission failed', error)
      sendError(res, 503, 'Submissions are unavailable, try again shortly')
      return
    }
    // Accepted, not saved yet: the coordinator saves it from the queue.
    res.status(202).json({ id: message.id })
  })

  // Database errors reach errorHandler, which answers 503 or 500 (Express 5
  // passes a rejected promise from an async handler on to it).
  app.get('/api/birthdays', async (_req, res) => {
    res.json(await listBirthdays(db, todayUtc()))
  })

  app.get('/api/birthdays/:id', async (req, res) => {
    // Checked first, so a malformed id never reaches the database.
    if (!z.uuid().safeParse(req.params.id).success) {
      sendError(res, 400, 'Invalid id', [{ field: 'id', message: 'Must be a UUID' }])
      return
    }
    const birthday = await findBirthday(db, req.params.id, todayUtc())
    if (!birthday) {
      // Expected for a moment after a POST, while the message is still in flight.
      sendError(res, 404, 'Birthday not found')
      return
    }
    res.json(birthday)
  })

  app.use(notFound)
  app.use(errorHandler)
  return app
}

/** Rejects if the promise hasn't settled within `ms`, so a stuck broker can't hang a request. */
function withTimeout(promise: Promise<void>, ms: number) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No confirm within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
