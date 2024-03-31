let subtle = globalThis.crypto?.subtle

const DECRYPT = ['decrypt']

/**
 * retry function
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [tries]
 */
export const retrier = async (fn, tries = 3) => {
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
export const fromB64 = (data) => {
	const s = atob(data)
	return Uint8Array.from(s, (x) => x.codePointAt(0))
}

/**
 * get the directory path of a url
 *
 * @param {string} url
 */
export const dirname = (url) => {
	const u = new URL(url)
	return `${u.origin}${u.pathname.split('/').slice(0, -1).join('/')}`
}

/**
 * create a CBC decryptor for given key
 *
 * @param {string | BufferSource} rawKey
 */
export const cbcDecryptor = async (rawKey) => {
	const name = 'AES-CBC'
	const iv = new ArrayBuffer(16)
	const algo = { name, length: 128 }

	const buf = typeof rawKey === 'string' ? fromB64(rawKey) : rawKey
	const key = await subtle.importKey('raw', buf, algo, false, DECRYPT)

	/** @param {BufferSource} data */
	return (data) => subtle.decrypt({ name, iv }, key, data)
}

if (!subtle) {
	import('node:crypto')
		.then((c) => {
			subtle = c.subtle
		})
		.catch(() => {})
}
