/**
 * retry function
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [tries]
 */
const retrier = async (fn, tries = 3) => {
	let final = null
	for (let i = 0; i < tries; ++i) {
		try {
			return await fn()
		} catch (err) {
			final = err
		}
	}
	throw new Error(`exceeded max retries ${final}`)
}

/**
 * convert base64 encoded data into buffer
 *
 * @param {string} data
 */
const fromB64 = (data) => {
	try {
		/** @type {ArrayBufferLike} */
		const buf = Buffer.from(data, 'base64')
		return buf
	} catch (err) {
		const s = atob(data)
		return Uint8Array.from(s, (_, i) => s.charCodeAt(i)).buffer
	}
}

/**
 * get the directory path of a url
 *
 * @param {string} url
 */
const dirname = (url) => {
	const u = new URL(url)
	return `${u.origin}${u.pathname.split('/').slice(0, -1).join('/')}`
}

/**
 * create a decryptor for given DRM key
 *
 * @param {string | ArrayBufferLike} key
 */
export const decryptor = async (key, subtle = globalThis.crypto?.subtle) => {
	const name = 'AES-CBC'
	const iv = new ArrayBuffer(16)
	const algo = { name, length: 128 }

	if (!subtle) {
		const c = await import('node:crypto')
		subtle = c.subtle
	}

	const buf = typeof key === 'string' ? fromB64(key) : key
	const dKey = await subtle.importKey('raw', buf, algo, false, ['decrypt'])

	/** @param {ArrayBuffer} data */
	return (data) => subtle.decrypt({ name, iv }, dKey, data)
}

export class HlsVideo {
	/**
	 * video src url
	 */
	#url = ''

	/**
	 * tries per chunk
	 */
	#trys = 1

	/**
	 * chunklists
	 *
	 * @type {string[]}
	 */
	#chunklists = []

	/**
	 * chunks for selected chunklist
	 *
	 * @type {import('./types').VideoChunk[]}
	 */
	#chunks = []

	/**
	 * decrypt chunk
	 *
	 * @param {ArrayBuffer} buf
	 */
	#decrypt = async (buf) => buf

	/**
	 * promise if key was provided in constructor
	 *
	 * @type {ReturnType<typeof decryptor> | null}
	 */
	#decryptorPromise = null

	/**
	 * @param {string} url
	 * @param {import('./types').VideoOptions} [opts]
	 */
	constructor(url, opts) {
		this.#url = url
		this.#trys = (opts?.retries ?? 3) + 1

		if (opts?.parseChunklists) {
			this.parseChunklists = opts.parseChunklists
		}

		if (opts?.selectChunklist) {
			this.selectChunklist = opts.selectChunklist
		}

		if (opts?.parseChunks) {
			this.parseChunks = opts.parseChunks
		}

		if (opts?.decrypt) {
			this.#decrypt = opts.decrypt
		} else if (opts?.key) {
			this.#decryptorPromise = decryptor(opts.key)
		}
	}

	/**
	 * video src url
	 */
	get url() {
		return this.#url
	}

	/**
	 * chunklists for playlist
	 */
	get chunklists() {
		return [...this.#chunklists]
	}

	/**
	 * chunks for selected chunklist
	 */
	get chunks() {
		return [...this.#chunks]
	}

	/**
	 * parse chunklist urls from playlist
	 *
	 * @param {string} playlist
	 */
	parseChunklists(playlist) {
		return playlist?.split('\n').filter((_) => _.startsWith('chunklist'))
	}

	/**
	 * function to select chunklist (default: last)
	 *
	 * @param {string[]} chunklists
	 */
	selectChunklist(chunklists) {
		return chunklists.at(-1)
	}

	/**
	 * parse chunks from chunklist
	 *
	 * @param {string} chunklist
	 */
	parseChunks(chunklist) {
		return chunklist?.split('\n').filter((_) => _.startsWith('media'))
	}

	/**
	 * load info
	 *
	 * @param {string | ArrayBufferLike} [key] DRM key
	 */
	async load(key) {
		const cls = this.#chunklists.length
			? this.#chunklists
			: await this.#loadChunklists()
		const chunks = await this.#loadChunks(this.selectChunklist(cls) || cls[0])

		if (key) {
			this.#decrypt = await decryptor(key)
		} else if (this.#decryptorPromise) {
			this.#decrypt = await this.#decryptorPromise
		}

		return chunks.length
	}

	/**
	 * download and decrypt media chunk
	 *
	 * @param {number} chunk chunk index
	 */
	async getChunk(chunk) {
		const c = this.#chunks[chunk]
		if (!c) throw new Error(`no chunk ${chunk}`)
		return await retrier(async () => {
			const r = await fetch(c.url)
			if (!r.ok) throw new Error(r.statusText)
			const buf = await this.#decrypt(await r.arrayBuffer())
			return buf
		}, this.#trys)
	}

	/**
	 * download chunks
	 *
	 * @param {number} [start] starting chunk
	 */
	async *downloadChunks(start = 0) {
		const len = this.#chunks.length || (await this.load())
		for (let i = start; i < len; ++i) {
			yield await this.getChunk(i)
		}
	}

	async *[Symbol.asyncIterator]() {
		for await (const c of this.downloadChunks()) {
			yield c
		}
	}

	/**
	 * load chunklists from url
	 */
	async #loadChunklists() {
		const plResp = await fetch(this.#url)
		const plText = await plResp.text()
		const chls = this.parseChunklists(plText) ?? []
		if (!chls.length) throw new Error(`no chunklists found: ${plText}`)

		const plUrl = dirname(plResp.url)
		this.#chunklists = chls.map((c) => `${plUrl}/${c}`)
		return this.#chunklists
	}

	/**
	 * load chunks of chunklist
	 *
	 * @param {string} chunklist
	 */
	async #loadChunks(chunklist) {
		const clResp = await fetch(chunklist)
		const clText = await clResp.text()
		const chunks = this.parseChunks(clText) ?? []
		if (!chunks.length) throw new Error(`no chunks found: ${clText}`)

		const clUrl = dirname(clResp.url)
		this.#chunks = chunks.map((c) => ({ url: `${clUrl}/${c}` }))
		return this.#chunks
	}
}
