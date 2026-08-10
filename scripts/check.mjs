import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function run(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${args.join(' ')} failed with ${signal || `code ${code}`}`))
    })
  })
}

const backendFiles = (await readdir(resolve(root, 'backend')))
  .filter((name) => name.endsWith('.js'))
  .sort()
for (const file of backendFiles) await run(['--check', `backend/${file}`])

await run(['node_modules/typescript/bin/tsc', '--noEmit'])

const tests = (await readdir(resolve(root, 'test')))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => `test/${name}`)
await run(['--test', ...tests])
await run(['node_modules/eslint/bin/eslint.js', '.'])
await run(['node_modules/next/dist/bin/next', 'build'])
