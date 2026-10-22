import { connect, type ChannelModel, type ConfirmChannel } from 'amqplib'
import type { SubmissionMessage, SubmissionPublisher } from './publisher.js'

const QUEUE = 'birthday.submissions'

// Must match the coordinator's declaration exactly, or RabbitMQ refuses the
// second one. Declaring it here too matters: RabbitMQ confirms and then drops a
// message sent to a queue that doesn't exist yet.
const QUEUE_OPTIONS = {
  durable: true,
  deadLetterExchange: '',
  deadLetterRoutingKey: 'birthday.submissions.dlq',
}

/** Publishes submissions on a confirm channel, reconnecting on the next publish after the broker goes away. */
export class RabbitMqPublisher implements SubmissionPublisher {
  #channel: Promise<ConfirmChannel> | undefined
  #connection: ChannelModel | undefined

  constructor(private readonly url: string) {}

  async publish(message: SubmissionMessage) {
    const channel = await this.connect()
    const content = Buffer.from(JSON.stringify(message))
    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(QUEUE, content, { persistent: true, contentType: 'application/json' }, (error) =>
        error ? reject(error) : resolve(),
      )
    })
  }

  /** Opens the connection and declares the queue, or reuses the open channel. */
  connect() {
    if (!this.#channel) {
      const channel = this.#open(() => {
        if (this.#channel === channel) this.#channel = undefined
      })
      this.#channel = channel
      channel.catch(() => {
        if (this.#channel === channel) this.#channel = undefined
      })
    }
    return this.#channel
  }

  async close() {
    await this.#connection?.close()
  }

  async #open(onClosed: () => void) {
    const connection = await connect(this.url)
    this.#connection = connection
    // Without 'error' listeners, a dropped connection would crash the process.
    connection.on('error', (error) => console.error('RabbitMQ connection error', error))
    connection.on('close', onClosed)
    try {
      const channel = await connection.createConfirmChannel()
      channel.on('error', (error) => console.error('RabbitMQ channel error', error))
      channel.on('close', () => {
        onClosed()
        connection.close().catch(() => {})
      })
      await channel.assertQueue(QUEUE, QUEUE_OPTIONS)
      return channel
    } catch (error) {
      await connection.close().catch(() => {})
      throw error
    }
  }
}
