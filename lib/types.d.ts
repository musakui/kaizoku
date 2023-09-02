export interface VideoOptions {
	/** max retries per chunk */
	retries?: number

	/** DRM key */
	key?: string | ArrayBufferLike

	/** function to get chunks from chunklist */
	getChunks?: (cl: string) => string[]

	/** function to select chunklist */
	selectChunklist?: (cls: string[]) => string

	/** function to get chunklist urls from playlist */
	getChunkLists?: (pl: string) => string[]
}
