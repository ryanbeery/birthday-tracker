import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { QUEUE, QUEUE_OPTIONS } from '../src/rabbitmq-publisher.js'

// The one written copy of the queue's declaration. The coordinator's tests check it too.
const contract = JSON.parse(readFileSync(new URL('../../contracts/submission-queue.json', import.meta.url), 'utf8'))

it('declares the submissions queue as contracts/submission-queue.json describes', () => {
  expect(QUEUE).toBe(contract.queue)
  expect(QUEUE_OPTIONS).toEqual({ durable: contract.durable, arguments: contract.arguments })
})
