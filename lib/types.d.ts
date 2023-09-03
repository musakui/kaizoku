export interface VideoOptions {
	/** max retries per chunk */
	retries?: number

	/** DRM key */
	key?: string | ArrayBufferLike

	/** custom decryptor function */
	decrypt?: (buf: ArrayBuffer) => Promise<ArrayBuffer>

	/** parse chunks from chunklist */
	parseChunks?: (cl: string) => string[]

	/** function to select chunklist */
	selectChunklist?: (cls: string[]) => string

	/** parse chunklist urls from playlist */
	parseChunklists?: (pl: string) => string[]
}

export interface VideoChunk {
	/** chunk src */
	url: string

	/** size (bytes) */
	size?: number
}
