/** @import { BoxInfo, SencInfo, TrunInfo } from './types' */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const BOX_NAME_REG = /^[\x20-\x7E]{4}$/

/** @param {string} s */
const encd = (s) => encoder.encode(s)

const sinf = encd('sinf')
const skip = encd('skip')
const audioCodecs = ['mp4a', 'fLaC', 'Opus', 'raw '].map((s) => encd(s))
const videoCodecs = ['avc1', 'avc2', 'avc3', 'avc4', 'mp4v'].map((s) => encd(s))

const flagBoxNames = new Set([
	'mvhd',
	'mehd',
	'trex',
	'tkhd',
	'mdhd',
	'hdlr',
	'vmhd',
	'dref',
	'stsd',
	'stsz',
	'stsc',
	'stts',
	'stco',
	'sidx',
	'mfhd',
	'tfhd',
	'tfdt',
	'trun',
	'saiz',
	'saio',
	'senc',
])

const subBoxNames = new Set([
	'moof',
	'traf',
	'moov',
	'mvex',
	'trak',
	'mdia',
	'minf',
	'dinf',
	'stbl',
])

const wBox = new Set(['moov', 'moof', 'mdat', 'tfhd', 'trun', 'stsd', 'senc'])

/** @type {Map<string, (a: Uint8Array, b: BoxInfo) => Record<string, unknown>} */
const transformBox = new Map([
	['tfhd', parseTFHD],
	['trun', parseTRUN],
	['stsd', parseSTSD],
	['senc', (arr, box) => parseSENC(arr, box) ?? parseSENC(arr, box, 16)],
])

/**
 * @param {Uint8Array} buf
 */
export function parseBoxes(buf) {
	const view = new DataView(buf.buffer)

	/**
	 * @param {number} pos
	 * @param {number} limit
	 * @param {boolean} fbox
	 */
	function readBox(pos, limit, fbox) {
		const c8 = pos + 8
		if (c8 > limit) return // cannot read box header
		const len = view.getUint32(pos)
		const extd = len === 1
		const c16 = pos + 16
		if (extd && c16 > limit) return // cannot read extended size

		const end = len
			? pos +
			  (extd ? view.getUint32(c8) * 2 ** 32 + view.getUint32(cur + 12) : len)
			: NaN

		if (end > limit) return // box extends beyond buffer

		const n = extd ? c16 : c8
		if (fbox && n + 4 > limit) return // cannot read version and flags

		return {
			cur: fbox ? n + 4 : n,
			end,
			...(fbox
				? {
						ver: view.getUint8(n),
						flags: view.getUint8(n + 1) * 2 ** 16 + view.getUint16(n + 2),
				  }
				: null),
		}
	}

	/**
	 * @param {number} pos
	 * @param {number} end
	 * @return {Generator<BoxInfo, void, unknown>}
	 */
	function* getBoxes(pos, end) {
		while (pos < end) {
			const name = decoder.decode(buf.subarray(pos + 4, pos + 8))
			if (!BOX_NAME_REG.test(name)) throw new Error(`invalid box name: ${name}`)
			const box = readBox(pos, end, flagBoxNames.has(name))
			if (!box) break
			const data = transformBox.get(name)?.(buf, box)
			yield {
				name,
				...box,
				...(data ? { data } : null),
			}

			if (subBoxNames.has(name)) {
				yield* getBoxes(box.cur, box.end)
			}

			pos = box.end
		}
	}

	return [...getBoxes(0, buf.length)]
}

/**
 * @param {Uint8Array} buf
 * @param {(c: Uint8Array, d: Uint8Array) => Promise<ArrayBuffer>} decr
 */
export async function decrypt(buf, decr) {
	const boxes = parseBoxes(buf)
	const bMap = new Map(
		boxes.flatMap((b) => (wBox.has(b.name) ? [[b.name, b]] : []))
	)

	if (bMap.has('moov') && !bMap.has('moof')) return buf

	let pos = bMap.get('mdat')?.cur
	if (!pos) throw new Error('no mdat box')

	/** @type {TrunInfo[]} */
	const TRUN = bMap.get('trun')?.data
	if (!TRUN) throw new Error('no trun box')

	/** @type {SencInfo[]} */
	const SENC = bMap.get('senc')?.data
	if (!SENC) throw new Error('no senc box')

	if (SENC.length !== TRUN.length) {
		throw new Error(`sample count mismatch: ${TRUN.length} != ${SENC.length}`)
	}

	/** @type {TrunInfo} */
	const TFHD = bMap.get('tfhd')?.data
	if (!TFHD) throw new Error('no tfhd box')

	for (const [i, ss] of SENC.entries()) {
		const sz = TRUN[i].sz || TFHD.sz || 0
		if (!ss.sub.length) ss.sub.push([0, sz])
		if (!ss.sub.some((u) => u[1])) {
			pos += sz
			continue
		}

		let dtPos = 0
		let encPos = 0
		const encData = new Uint8Array(ss.sub.reduce((a, s) => a + s[1], 0))

		/** @type {[enc: number, offset: number, encPos: number][]} */
		const posCache = []
		for (const [clear, encr] of ss.sub) {
			dtPos += clear
			if (!encr) continue
			const off = pos + dtPos
			encData.set(buf.subarray(off, off + encr), encPos)
			posCache.push([encr, off, encPos])
			dtPos += encr
			encPos += encr
		}

		const dec = new Uint8Array(await decr(ss.iv, encData))
		for (const [encr, off, ep] of posCache) {
			buf.set(dec.subarray(ep, ep + encr), off)
		}

		pos += sz
	}

	return buf
}

/**
 * @param {Uint8Array} arr
 * @param {Uint8Array[]} list
 * @param {number} off
 * @param {number} end
 */
const detectCodec = (arr, list, off, end) => {
	for (const cd of list) {
		const idx = indexOf(arr, cd, off)
		if (idx >= 0 && idx < end) return cd
	}
	return null
}

/**
 * @param {Uint8Array} arr
 * @param {BoxInfo} box
 */
function parseSTSD(arr, box) {
	const off = box.cur + 8

	const idx = indexOf(arr, sinf)
	if (idx > -1) arr.set(skip, idx)

	const vidx = indexOf(arr, encd('encv'), off)
	if (vidx > -1) {
		const codec = detectCodec(arr, videoCodecs, vidx + 4, box.end)
		if (codec) return arr.set(codec, vidx)
	}

	const aidx = indexOf(arr, encd('enca'), off)
	if (aidx > -1) {
		const codec = detectCodec(arr, audioCodecs, aidx + 4, box.end)
		if (codec) return arr.set(codec, aidx)
	}
}

/**
 * @param {Uint8Array} arr
 * @param {BoxInfo} box
 */
function parseTFHD(arr, box) {
	let pos = box.cur + 4
	/** @type {{ dur?: number; sz?: number }} */
	const ff = box.flags
	const out = {}
	if (!ff) return pos === box.end ? out : null
	const v = new DataView(arr.buffer)

	pos += (ff & 1 ? 8 : 0) + (ff & 2 ? 4 : 0)
	ff & 8 && ((out.dur = v.getUint32(pos)), (pos += 4))
	ff & 16 && ((out.sz = v.getUint32(pos)), (pos += 4))
	ff & 32 && (pos += 4)
	ff & 65536 && ((out.dur = 0), (pos += 4))
	return pos === box.end ? out : null
}

/**
 * @param {Uint8Array} arr
 * @param {BoxInfo} box
 */
function parseTRUN(arr, box) {
	const v = new DataView(arr.buffer)
	const ff = box.flags
	const len = v.getUint32(box.cur)
	/** @type {{ dur?: number, sz?: number }[]} */
	const trun = []
	let pos = box.cur + 4 + (ff ? (ff & 1 ? 4 : 0) + (ff & 4 ? 4 : 0) : 0)
	for (let i = 0; i < len; ++i) {
		if (!ff) {
			trun.push({})
			continue
		}
		const o = {}
		ff & 256 && ((o.dur = v.getUint32(pos)), (pos += 4))
		ff & 512 && ((o.sz = v.getUint32(pos)), (pos += 4))
		ff & 1024 && (pos += 4)
		ff & 2048 && (pos += 4)
		trun.push(o)
	}
	return pos === box.end ? trun : null
}

/**
 * @param {Uint8Array} arr
 * @param {BoxInfo} box
 */
function parseSENC(arr, box, sz = 8) {
	let pos = box.cur
	const v = new DataView(arr.buffer)
	const len = v.getUint32(pos)
	const enc = box.flags && box.flags & 2
	const out = []
	pos += 4
	for (let i = 0; i < len; ++i) {
		/** @type {[clearBytes: number, encryptedBytes: number][]} */
		const sub = []
		const iv = new Uint8Array(16)
		iv.set(arr.subarray(pos, pos + sz))
		pos += sz
		out.push({ iv, sub })
		if (!enc) continue
		const nSub = v.getUint16(pos)
		pos += 2
		for (let j = 0; j < nSub; ++j) {
			sub.push([v.getUint16(pos), v.getUint32(pos + 2)])
			pos += 6
		}
	}
	return pos === box.end ? out : null
}

/**
 * @param {Uint8Array} array
 * @param {Uint8Array} value
 * @param {number} offset
 */
function indexOf(array, value, offset = 0) {
	const arrLen = array.length - offset
	const valLen = value.length

	if (valLen === 0) return -1
	if (valLen > arrLen) return -1

	const valid = arrLen - valLen

	for (let i = 0; i <= valid; ++i) {
		const idx = i + offset
		let isMatch = true
		for (let j = 0; j < valLen; ++j) {
			if (array[idx + j] !== value[j]) {
				isMatch = false
				break
			}
		}

		if (isMatch) return idx
	}

	return -1
}
