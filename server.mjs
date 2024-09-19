import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readdir, mkdir, rename, readFile } from 'node:fs/promises'

const BIN_PATH = '/usr/local/bin/dash-mpd'

const port = parseInt(process.env.PORT || '0') || 4128

const cwd = process.cwd()
const confFile = `${cwd}/config.json`
const queueDir = `${cwd}/${process.env.QUEUE_DIR || 'queue'}`
const progressDir = `${cwd}/${process.env.PROGRESS_DIR || 'progress'}`
const completeDir = `${cwd}/${process.env.COMPLETE_DIR || 'complete'}`

/** @type {Map<string, { msgs: string[] }>} */
const progress = new Map()

/**
 * @param {string} msg
 * @param {string | number} cn
 */
const col = (msg, cn) => `\x1b[${cn}m${msg}\x1b[0m`

/**
 * @param {string} path
 * @return {Promise<Record<string, string> | null>}
 */
const readJson = async (path) => {
	try {
		return JSON.parse(await readFile(path, 'utf8'))
	} catch (err) {
		return null
	}
}

/** @type {number | null} */
let timer = null

/** @param {number} seconds */
const queueRefresh = (seconds) => {
	if (timer !== null) {
		clearTimeout(timer)
	}
	timer = setTimeout(refresh, seconds * 1000)
}

const server = createServer(async (req, res) => {
	if (req.method.toUpperCase() !== 'GET') {
		res.writeHead(405).end('not allowed')
		return
	}
	try {
		const info = [...progress.entries()].map(([cid, pg]) => [
			cid, { info: pg.info, logs: pg.msgs.slice(-3) }
		])
		const ret = JSON.stringify({
			status: 'ok',
			info: Object.fromEntries(info),
		})
		res.writeHead(200, { 'content-type': 'application/json' }).end(ret)
	} catch (err) {
		res.writeHead(400).end(`${err}`)
	}
})

server.listen(port, '0.0.0.0', () => {
	console.info(`[SV] server running on port ${port}`)
	const dirp = [queueDir, progressDir, completeDir]
		.map((dn) => mkdir(dn, { recursive: true }))
	Promise.allSettled(dirp).then(() => refresh())
})

const close = () => {
	console.info('\nshutting down...')
	server.close()
	process.exit()
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

async function refresh() {
	const conf = await readJson(confFile)
	if (!conf?.run || !(progress.size < parseInt(conf.max))) return
	const files = await readdir(queueDir)
	const fn = files.find((s) => s.endsWith('.json'))
	if (!fn) return queueRefresh(9)
	const qpath = `${queueDir}/${fn}`
	const ppath = `${progressDir}/${fn}`
	const cpath = `${completeDir}/${fn}`
	try {
		await rename(qpath, ppath)
	} catch (err) {
		return
	}
	const state = { msgs: [], start: new Date(), error: null }
	progress.set(fn, state)
	try {
		const item = await readJson(ppath)
		if (!item) throw new Error(`invalid`)
		if (!item.url) throw new Error(`no url`)
		if (!item.kid) throw new Error(`no kid`)
		if (!item.key) throw new Error(`no key`)
		if (!item.out) throw new Error(`no out`)
		console.info(`${col('[DL]', 36)} ${fn} (${item.out})`)
		state.info = item
		const dash = spawn(BIN_PATH, [item.kid, item.key, item.out, item.url])
		await new Promise((resolve, reject) => {
			dash.on('spawn', () => resolve())
			dash.on('error', (err) => reject(err))
		})
		dash.stderr.on('data', (dt) => {
			state.error = dt
			console.error(`${col(fn, 31)} ${dt}`)
		})
		dash.stdout.on('data', (dt) => state.msgs.push(`${dt}`))
		dash.on('close', async () => {
			const dt = (new Date() - state.start) / 1000 / 60
			if (!state.error) await rename(ppath, cpath)
			const hd = state.error ? col('[ND]', 31) : col('[OK]', 32)
			console.info(`${hd} ${fn} (${dt.toFixed(2)} mins)`)
			progress.delete(fn)
			if ((await readJson(confFile))?.run) queueRefresh(3)
		})
		state.proc = dash
		queueRefresh(9)
	} catch (err) {
		console.error(`${col(fn, 31)} ${err}`)
		progress.delete(fn)
		await rename(ppath, cpath)
		queueRefresh(3)
	}
}
