// Ask the existing daemon for the same data as "pm2 jlist", without the
// PM2 CLI bootstrap (which can launch a daemon after a disconnect).
const path = require('node:path')
const { createRequire } = require('node:module')
const [root, pipe] = process.argv.slice(1)
const fromPm2 = createRequire(path.resolve(root, 'package.json'))
if (fromPm2('./package.json').name !== 'pm2') process.exit(1)
function transport(name) {
    let resolved
    try { resolved = fromPm2.resolve('./modules/' + name) }
    catch { resolved = fromPm2.resolve(name) }
    return fromPm2(resolved)
}
const socket = transport('pm2-axon').socket('req')
const client = new (transport('pm2-axon-rpc').Client)(socket)
const fail = () => process.exit(1)
setTimeout(fail, 7000).unref()
socket.on('error', fail)
socket.once('connect', () => {
    client.call('getMonitorData', {}, (err, list) => {
        if (err || !Array.isArray(list) || list.length > 65536) return fail()
        const pids = new Set()
        for (const item of list) {
            if (Number.isInteger(item?.pid) && item.pid > 0 && item.pid <= 0xffffffff) pids.add(item.pid)
            else if (!(item && (item.pid === 0 || item.pid == null) &&
                ['stopped','errored','waiting restart'].includes(item.pm2_env?.status))) return fail()
        }
        process.stdout.write(JSON.stringify([...pids]), () => process.exit(0))
    })
})
socket.connect(pipe)
