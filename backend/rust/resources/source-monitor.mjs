import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { complete, inventory, readJson, sync, writeJson } from './source-worker.mjs'

export const interval = 5 * 60 * 1000
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

async function discover(dir) {
  const links = []
  for (const name of await fs.readdir(dir)) {
    if (!name.endsWith('.link.json')) continue
    const id = name.slice(0, -'.link.json'.length)
    if (!uuid.test(id)) continue
    const link = await readJson(path.join(dir, name), null).catch(() => null)
    if (link && uuid.test(link.key) && await fs.stat(path.join(dir, '..', id + '.json')).then(s => s.isFile(), () => false)) {
      links.push({ ...link, id })
    }
  }
  return links
}

export function createMonitor(dir, { now = Date.now, generate = sync, signal } = {}) {
  const states = new Map()
  const jobs = new Map()
  const date = time => new Date(time).toISOString()

  async function check(project) {
    const base = path.join(dir, project.key)
    const statusFile = base + '.status.json'
    const checkFile = base + '.check.json'
    const stamp = await readJson(checkFile, null).catch(() => null)
    let checkedAt = stamp?.checkedAt ?? null
    try {
      const result = await readJson(base + '.result.json', null)
      const current = await inventory(project.folder, result?.files)
      checkedAt = date(now())
      const generating = jobs.get(project.id)?.key === project.key
      project.pending = !generating && (current.hash !== result?.hash || !complete(result))
      if (!jobs.has(project.id)) {
        const phase = project.pending ? 'pending' : 'ready'
        if ((await readJson(statusFile, null))?.phase !== phase) {
          const message = project.pending ? 'Mudanças ou detalhamento pendentes. Geração agendada.' : 'Fluxograma atualizado.'
          await writeJson(statusFile, { phase, message, at: checkedAt })
        }
      }
    } catch (error) {
      project.pending = false
      if (!jobs.has(project.id)) {
        const message = error.code === 'ENOENT' ? 'Pasta indisponível. Confira o caminho vinculado.' : error.message
        await writeJson(statusFile, { phase: 'error', message, at: date(now()) })
      }
    }
    project.due = now() + interval
    await writeJson(checkFile, { checkedAt, nextCheckAt: date(project.due) })
  }

  function start(project) {
    project.pending = false
    project.lastStarted = now()
    const job = generate(dir, project.id, undefined, signal)
      .catch(() => {}) // The worker publishes a readable error and retains its draft.
      .finally(() => { jobs.delete(project.id) })
    jobs.set(project.id, { key: project.key, job })
  }

  async function tick() {
    const focus = await readJson(path.join(dir, 'focus.json'), null).catch(() => null)
    const links = await discover(dir)
    const ids = new Set(links.map(link => link.id))
    for (const id of states.keys()) if (!ids.has(id)) states.delete(id)
    const ordered = links.sort((a, b) => Number(b.id === focus) - Number(a.id === focus)
      || (states.get(a.id)?.lastStarted ?? 0) - (states.get(b.id)?.lastStarted ?? 0))
    for (const link of ordered) {
      if (signal?.aborted) return
      let project = states.get(link.id)
      if (project?.key !== link.key) {
        project = { ...link, due: 0, pending: false }
        states.set(link.id, project)
      }
      if (now() >= project.due) {
        try { await check(project) }
        catch {
          // A disappearing or inaccessible binding must not suspend the other folders.
          project.pending = false
          project.due = now() + interval
          continue
        }
      }
      if (!project.pending || jobs.has(link.id) || signal?.aborted) continue
      // Keep one place available for the project the user opens during a long generation.
      if (jobs.size === 0 || (jobs.size === 1 && (focus === link.id || jobs.has(focus)))) start(project)
    }
  }
  return { tick, settled: () => Promise.all([...jobs.values()].map(({ job }) => job)) }
}

async function run(dir) {
  const lifetime = new AbortController()
  process.stdin.once('end', () => lifetime.abort())
  process.stdin.resume()
  const monitor = createMonitor(dir, { signal: lifetime.signal })
  try {
    while (!lifetime.signal.aborted) {
      await monitor.tick()
      await delay(2000, undefined, { signal: lifetime.signal }).catch(() => {})
    }
  } finally {
    lifetime.abort()
    await monitor.settled()
  }
}

if (process.argv[1] && path.relative(path.toNamespacedPath(path.resolve(process.argv[1])),
  path.toNamespacedPath(fileURLToPath(import.meta.url))) === '') {
  run(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; process.stdin.destroy() })
}
