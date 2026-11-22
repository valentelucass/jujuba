import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const [from, to] = process.argv.slice(2)
const until = async read => {
  const end = Date.now() + 60000
  do {
    const result = await read()
    if (result) return result
    await delay(250)
  } while (Date.now() < end)
  throw new Error('Tempo esgotado aguardando a janela do aplicativo.')
}

const tab = await until(async () => {
  try {
    const response = await fetch('http://127.0.0.1:9613/json/list')
    return (await response.json()).find(page => page.type === 'page' && /tauri\.localhost/.test(page.url) && !page.url.includes('splash.html'))
  } catch { return null }
})
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
const pending = new Map()
let next = 0
socket.onmessage = ({ data }) => {
  const { id, result, error } = JSON.parse(data)
  const callback = pending.get(id)
  if (!callback) return
  pending.delete(id)
  if (error || result.exceptionDetails) callback.reject(new Error(JSON.stringify(error || result.exceptionDetails)))
  else callback.resolve(result.result.value)
}
function evaluate(expression) {
  return new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}
try {
  await until(() => evaluate('Boolean(document.querySelector("button.update-button"))'))
  await evaluate('document.querySelector("button.update-button").click()')
  await until(() => evaluate('Boolean(document.querySelector(".update-actions .primary"))'))
  const dialog = await evaluate('document.querySelector(".update-dialog").innerText')
  assert.ok(dialog.includes(from) && dialog.includes(to), dialog)
  await evaluate('document.querySelector(".update-actions .primary").click()')
  console.log('Atualizar agora acionado na interface instalada.')
} finally { socket.close() }
