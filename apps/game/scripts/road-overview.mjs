// Renders a top-down PNG of the world and the main road, without running the game.
// Usage: pnpm --filter @slowtrip/game overview [--seed 1337] [--length 12000] [--width 6000]
//        [--scale 16] [--layer terrain|biomes] [--out overview/seed-1337.png]
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/)),
)
const seed = Number(args.seed ?? 1337) >>> 0
const length = Number(args.length ?? 12000)
// From 1 km south of the spawn to `length` meters north of it.
const area = {
  centerX: 0,
  centerZ: -(length - 1000) / 2,
  width: Number(args.width ?? 6000),
  height: length + 1000,
  scale: Number(args.scale ?? 16),
  layer: args.layer === 'biomes' ? 'biomes' : 'terrain',
}
const out = resolve(root, args.out ?? `overview/seed-${seed}.png`)

// Vite's SSR loader runs the game's TypeScript modules as-is.
const server = await createServer({
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})
const t0 = performance.now()
try {
  const { renderOverview } = await server.ssrLoadModule('/src/world/road/overview.ts')
  const { createWorldGen } = await server.ssrLoadModule('/src/world/terrain/heightSampler.ts')
  const img = renderOverview(createWorldGen(seed), area)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, png(img.width, img.height, img.rgb))
  const s = ((performance.now() - t0) / 1000).toFixed(1)
  process.stdout.write(`${out} (${img.width}x${img.height}, ${area.scale} m/px, ${s} s)\n`)
} finally {
  await server.close()
}

/** Minimal RGB PNG encoder. */
function png(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1,
    )
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
