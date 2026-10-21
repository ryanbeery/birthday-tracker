import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)

const server = createApp().listen(port, (error) => {
  if (error) throw error
  console.log(`API listening on port ${port}`)
})

// Docker stops containers with SIGTERM. Close the server so in-flight requests
// finish, instead of waiting to be killed after the timeout.
process.on('SIGTERM', () => {
  server.close()
})
