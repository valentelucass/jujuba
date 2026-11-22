import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { sync } from '../../backend/rust/resources/source-worker.mjs'

test('cada diagrama publicado identifica uma única leitura, mesmo com o projeto em edição', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jujuba-snapshot-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const src = path.join(tmp, 'app'), links = path.join(tmp, 'sources')
  await Promise.all([fs.mkdir(src), fs.mkdir(links)])
  const id = randomUUID(), key = randomUUID(), file = path.join(src, 'pedidos.js')
  const read = async (suffix) => JSON.parse(await fs.readFile(path.join(links, key + suffix), 'utf8'))
  const change = (name) => fs.writeFile(file, 'export function ' + name + '() { return true }')
  await fs.writeFile(path.join(links, id + '.link.json'), JSON.stringify({ title: 'Pedidos', folder: src, key }))
  await change('regraInicial')
  let editDuring = 'overview'
  async function generate(_tmp, prompt, schema) {
    if (schema.properties.processes) {
      const label = prompt.includes('regraTerceira') ? 'Terceira regra' : 'Segunda regra'
      if (editDuring === 'detail') await change('regraTerceira')
      return { processes: [{ index: 0, steps: [{ label, detail: label, source: 1, choices: [] }] }] }
    }
    if (editDuring === 'overview') await change('regraSegunda')
    return { title: 'Pedidos', summary: 'Processamento de pedidos', requirements: [], openQuestions: [],
      nodes: [{ id: 'a', kind: 'start', label: 'Iniciar', detail: 'Iniciar' }, { id: 'z', kind: 'end', label: 'Fim', detail: 'Concluir' }],
      edges: [{ from: 'a', to: 'z', label: '' }],
      areas: [{ title: 'Pedidos', entry: 'a', steps: ['Aplicar regra'], files: ['pedidos.js'] }] }
  }
  await sync(links, id, generate)
  assert.equal((await read('.status.json')).phase, 'pending')
  await assert.rejects(read('.result.json'), { code: 'ENOENT' })
  editDuring = 'detail'
  await sync(links, id, generate)
  const first = await read('.result.json')
  assert.equal(first.answer.areas[0].flow.nodes[1].label, 'Segunda regra')
  assert.equal((await read('.status.json')).phase, 'pending')
  editDuring = null
  await sync(links, id, generate)
  const last = await read('.result.json')
  assert.notEqual(last.hash, first.hash)
  assert.equal(last.answer.areas[0].flow.nodes[1].label, 'Terceira regra')
  assert.equal((await read('.status.json')).phase, 'ready')
})
