import { randomUUID } from 'node:crypto'
import express from 'express'
import { errorHandler, notFound, sendError } from './errors.js'
import { PublisherConfigError, type SubmissionPublisher } from './publisher.js'
import { parseSubmission } from './submission.js'

/** How long a submission waits for the broker's confirm before the API answers 503. */
const PUBLISH_TIMEOUT_MS = 5000

export function createApp({ publisher }: { publisher: SubmissionPublisher }) {
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
