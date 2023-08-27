export interface VideoOptions {
	/** max retries per chunk */
	retries?: number

	/** DRM key */
	key?: string | ArrayBufferLike

	/** function to get chunks from chunklist */
	getChunks?: (cl: string) => string[]

	/** function to get chunklist url from playlist */
	getChunkList?: (pl: string) => string
}
