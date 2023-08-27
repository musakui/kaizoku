const name = 'AES-CBC'
const DECRYPT = ['decrypt']

const iv = new ArrayBuffer(16)
const algo = { name, length: 128 }

let subtle = globalThis.crypto?.subtle

import('node:crypto').then(
	(c) => {
		subtle = c.subtle
	},
	() => {}
)

/**
 * specify SubtleCrypto instance
 *
 * @param {SubtleCrypto} sub
 */
export const useSubtle = (sub) => {
	subtle = sub
}

/**
 * convert base64 encoded data into buffer
 *
 * @param {string} data
 */
const fromB64 = (data) => {
	try {
		return Buffer.from(data, 'base64')
	} catch (err) {
		const s = atob(data)
		return Uint8Array.from(s, (_, i) => s.charCodeAt(i)).buffer
	}
}

/**
 * create a decryptor for given DRM key
 *
 * @param {string | ArrayBufferLike} key
 */
const decryptor = async (key) => {
	const buf = typeof key === 'string' ? fromB64(key) : key
	const dKey = await subtle.importKey('raw', buf, algo, false, DECRYPT)

	/** @param {ArrayBuffer} data */
	return (data) => subtle.decrypt({ name, iv }, dKey, data)
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
	 * chunk base url
	 */
	#baseurl = ''

	/**
	 * chunks for found playlist
	 *
	 * @type {string[]}
	 */
	#chunks = []

	/**
	 * decrypt chunk
	 *
	 * @param {ArrayBuffer} buf
	 */
	#decrypt = async (buf) => buf

	/**
	 * @param {string} url
	 * @param {import('./types').VideoOptions} [opts]
	 */
	constructor(url, opts) {
		this.#url = url
		this.#trys = (opts?.retries ?? 3) + 1

		if (opts?.getChunkList) {
			this.getChunkList = opts.getChunkList
		}

		if (opts?.getChunks) {
			this.getChunks = opts.getChunks
		}

		if (opts?.key) {
			decryptor(opts.key).then((d) => {
				this.#decrypt = d
			})
		}
	}

	/**
	 * video src url
	 */
	get url() {
		return this.#url
	}

	/**
	 * chunks for found playlist
	 */
	get chunks() {
		return [...this.#chunks]
	}

	/**
	 * function to get chunklist url from playlist
	 *
	 * @param {string} playlist
	 */
	getChunkList(playlist) {
		return playlist?.split('\n').findLast((_) => _.startsWith('chunklist'))
	}

	/**
	 * function to get chunks from chunklist
	 *
	 * @param {string} chunklist
	 */
	getChunks(chunklist) {
		return chunklist?.split('\n').filter((_) => _.startsWith('media'))
	}

	/**
	 * load chunk info
	 *
	 * @param {string | ArrayBufferLike} [key] DRM key
	 */
	async load(key) {
		const plResp = await fetch(this.#url)
		const plText = await plResp.text()
		const chunklist = this.getChunkList(plText)
		if (!chunklist) throw new Error(`cannot find chunklist: ${plText}`)

		const clResp = await fetch(`${dirname(plResp.url)}/${chunklist}`)
		const clText = await clResp.text()
		const chunks = this.getChunks(clText)
		if (!chunks.length) throw new Error(`no chunks found: ${clText}`)

		this.#chunks = chunks
		this.#baseurl = dirname(clResp.url)

		if (key) {
			this.#decrypt = await decryptor(key)
		}

		return chunks.length
	}

	/**
	 * download and decrypt media chunk
	 *
	 * @param {string} chunk
	 */
	async #getChunk(chunk) {
		const tries = this.#trys
		for (let i = 0; i < tries; ++i) {
			try {
				const r = await fetch(`${this.#baseurl}/${chunk}`)
				return await this.#decrypt(await r.arrayBuffer())
			} catch (err) {}
		}
		throw new Error(`exceeded max retries for chunk "${chunk}"`)
	}

	/**
	 * download chunks
	 *
	 * @param {number} [start] starting chunk
	 */
	async *downloadChunks(start = 0) {
		for (const c of this.#chunks.slice(start)) {
			yield await this.#getChunk(c)
		}
	}

	async *[Symbol.asyncIterator]() {
		for await (const c of this.downloadChunks()) {
			yield c
		}
	}
}
