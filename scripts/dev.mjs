import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const webPort = String(process.env.WEB_PORT || '3000')
const apiPort = String(process.env.API_PORT || '3001')
const webOrigin = `http://localhost:${webPort}`
const apiOrigin = `http://localhost:${apiPort}`

const backend = spawn(process.execPath, ['backend/server.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: apiPort,
    HOST: '127.0.0.1',
    APP_ORIGIN: webOrigin,
    KITE_REDIRECT_URL: process.env.KITE_REDIRECT_URL || `${webOrigin}/`,
  },
  stdio: 'inherit',
})

const frontend = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', webPort], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    NEXT_PUBLIC_KILL_SWITCH_API_BASE: process.env.NEXT_PUBLIC_KILL_SWITCH_API_BASE || apiOrigin,
  },
  stdio: 'inherit',
})

const children = [backend, frontend]
let stopping = false

function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Development process failed: ${error.message}`)
    process.exitCode = 1
    stop()
  })
  child.on('exit', (code, signal) => {
    if (!stopping) {
      if (code !== 0) console.error(`Development process exited with ${signal || `code ${code}`}`)
      process.exitCode = code || (signal ? 1 : 0)
      stop()
    }
  })
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

await Promise.all(children.map((child) => new Promise((resolveExit) => child.once('exit', resolveExit))))
