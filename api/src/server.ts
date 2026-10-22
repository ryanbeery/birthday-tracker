import { createApp } from './app.js'
import { createPool } from './db.js'
import { RabbitMqPublisher } from './rabbitmq-publisher.js'

const port = Number(process.env.PORT ?? 3000)
const rabbitmqUrl = process.env.RABBITMQ_URL
if (!rabbitmqUrl) {
  throw new Error('RABBITMQ_URL is not set (Compose sets it from .env)')
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set (Compose sets it from .env)')
}

const publisher = new RabbitMqPublisher(rabbitmqUrl)
const db = createPool(databaseUrl)

const server = createApp({ publisher, db }).listen(port, (error) => {
  if (error) throw error
  console.log(`API listening on port ${port}`)
})

// Connect now, so a queue declaration that doesn't match the coordinator's shows
// up in the log at startup. If RabbitMQ is down, the first POST retries.
publisher.connect().catch((error) => console.error('RabbitMQ is not reachable yet', error))

// Docker stops containers with SIGTERM. Close the server so in-flight requests
// finish, instead of waiting to be killed after the timeout.
process.on('SIGTERM', () => {
  server.close(() => {
    publisher.close().catch(() => {})
    db.end().catch(() => {})
  })
})
