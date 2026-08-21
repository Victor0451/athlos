import { createServer } from 'node:net'
import { cp, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nextCli = join(webRoot, 'node_modules/next/dist/bin/next')
const tempRoot = await mkdtemp(join(webRoot, '.runtime-feature-flags-'))
let activeServer

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolvePromise(output)
      else reject(new Error(`${command} ${args.join(' ')} failed (${code ?? signal})\n${output}`))
    })
  })
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
  return port
}

async function stopServer() {
  if (!activeServer) return
  const { child, exited } = activeServer
  activeServer = undefined
  if (child.exitCode !== null) return

  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))])
  if (child.exitCode === null) process.kill(-child.pid, 'SIGKILL')
}

async function startServer(flags) {
  const port = await reservePort()
  const environment = { ...process.env, ...flags, NODE_ENV: 'production' }
  const child = spawn(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: tempRoot,
      detached: true,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
  activeServer = { child, exited }
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    if (child.exitCode !== null) throw new Error(`next start exited early\n${output}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/dashboard`)
      if (response.status < 500) {
        return response
      }
    } catch {
      // The server is still booting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for next start\n${output}`)
}

function assertRuntimeFlags(body, expected) {
  for (const [name, value] of Object.entries(expected)) {
    const match = body.match(new RegExp(`${name}[^a-zA-Z0-9]*(true|false)`))
    if (!match) throw new Error(`Response did not serialize ${name}; inspect /dashboard output`)
    if (match[1] !== String(value)) {
      throw new Error(`Response serialized ${name}=${match[1]}, expected ${value}`)
    }
  }
}

try {
  for (const entry of ['src', 'public'])
    await cp(join(webRoot, entry), join(tempRoot, entry), { recursive: true })
  for (const entry of [
    'next-env.d.ts',
    'next.config.ts',
    'package.json',
    'postcss.config.cjs',
    'tailwind.config.ts',
    'tsconfig.json',
  ]) {
    await cp(join(webRoot, entry), join(tempRoot, entry))
  }
  await cp(resolve(webRoot, '../../tsconfig.base.json'), join(tempRoot, 'tsconfig.base.json'))
  const tempTsconfig = JSON.parse(await readFile(join(tempRoot, 'tsconfig.json'), 'utf8'))
  tempTsconfig.extends = './tsconfig.base.json'
  await writeFile(join(tempRoot, 'tsconfig.json'), `${JSON.stringify(tempTsconfig, null, 2)}\n`)
  await symlink(join(webRoot, 'node_modules'), join(tempRoot, 'node_modules'), 'dir')

  const buildEnvironment = { ...process.env, NODE_ENV: 'production' }
  delete buildEnvironment.DUES_CASH_ENABLED
  delete buildEnvironment.NATIVE_COLLECTIONS_WEB_ENABLED
  await run(process.execPath, [nextCli, 'build'], { cwd: tempRoot, env: buildEnvironment })

  const staticArtifacts = (await readdir(join(tempRoot, '.next/server/app'))).filter((entry) =>
    /^(collections|tesoreria)\.(html|rsc)$/.test(entry),
  )
  if (staticArtifacts.length > 0) {
    throw new Error(
      `Dynamic routes still have static flag artifacts: ${staticArtifacts.join(', ')}`,
    )
  }
  console.log('static artifacts: none for collections/tesoreria')

  for (const [label, flags, expected] of [
    [
      'runtime true',
      { DUES_CASH_ENABLED: 'true', NATIVE_COLLECTIONS_WEB_ENABLED: 'true' },
      { cashEnabled: true, collectionsEnabled: true },
    ],
    [
      'runtime false',
      { DUES_CASH_ENABLED: 'false', NATIVE_COLLECTIONS_WEB_ENABLED: 'false' },
      { cashEnabled: false, collectionsEnabled: false },
    ],
  ]) {
    const response = await startServer(flags)
    const body = await response.text()
    assertRuntimeFlags(body, expected)
    console.log(`${label}: serialized ${JSON.stringify(expected)}`)
    await stopServer()
  }
} finally {
  await stopServer()
  await rm(tempRoot, { recursive: true, force: true })
}
