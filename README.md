# kaizoku

> download HLS video

[![npm](https://img.shields.io/npm/v/@musakui/kaizoku.svg)](https://www.npmjs.com/package/@musakui/kaizoku)

## usage

```js
import { Readable } from 'node:stream'
import { createWriteStream } from 'node:fs'
import { HlsVideo } from '@musakui/kaizoku'

const video = new HlsVideo('[playlist url]', { key: '[key]' })
Readable.from(video).pipe(createWriteStream('video.m2ts'))

// iterate manually to track progress
const writeStream = createWriteStream('video.m2ts')

for await (const chunk of video) {
	writeStream.write(Buffer.from(chunk))

	// notify progress
	// ...
}
```
