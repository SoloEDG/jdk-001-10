/**
 * 稳定性测试：最大规格项目（64x64、8 帧、scale=16 -> 1024x1024 GIF）
 * 以及超过 255 色时的量化压缩路径。
 * 运行：node --experimental-strip-types --loader ./scripts/ts-loader.mjs scripts/stress-gif.ts
 */
import { writeFileSync } from 'node:fs'
import { exportAnimationGif } from '../src/core/exportGif.ts'
import type { Frame } from '../src/core/types.ts'

class MockCtx {
  data: Uint8ClampedArray
  private w: number
  private h: number
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.data = new Uint8ClampedArray(w * h * 4)
  }
  fillStyle = ''
  fillRect(x: number, y: number, w: number, h: number): void {
    const m = /^#([0-9a-f]{6})$/i.exec(this.fillStyle)!
    const int = Number.parseInt(m[1], 16)
    const r = (int >> 16) & 255
    const g = (int >> 8) & 255
    const b = int & 255
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const i = (yy * this.w + xx) * 4
        this.data[i] = r
        this.data[i + 1] = g
        this.data[i + 2] = b
        this.data[i + 3] = 255
      }
    }
  }
  getImageData() {
    return { data: this.data, width: this.w, height: this.h }
  }
}

class MockCanvas {
  private ctx2d: MockCtx
  private _width = 0
  private _height = 0
  get width() {
    return this._width
  }
  set width(v: number) {
    this._width = v
    this.ctx2d = new MockCtx(v, this._height)
  }
  get height() {
    return this._height
  }
  set height(v: number) {
    this._height = v
    this.ctx2d = new MockCtx(this._width, v)
  }
  constructor(w: number, h: number) {
    this._width = w
    this._height = h
    this.ctx2d = new MockCtx(w, h)
  }
  getContext() {
    return this.ctx2d
  }
}

const blobs: Blob[] = []
function install(): void {
  const blobMap = new Map<string, Blob>()
  ;(globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new MockCanvas(0, 0)
      if (tag === 'a') {
        return {
          click() {
            const blob = blobMap.get(this.href)
            if (blob) blobs.push(blob)
          },
        }
      }
      throw new Error(tag)
    },
  }
  ;(globalThis as Record<string, unknown>).URL = {
    createObjectURL: (b: Blob) => {
      const u = `blob:${blobMap.size}`
      blobMap.set(u, b)
      return u
    },
    revokeObjectURL: () => {},
  }
  ;(globalThis as Record<string, unknown>).Blob = class {
    size: number
    type: string
    private buffer: Uint8Array
    constructor(parts: Uint8Array[], opts: { type: string }) {
      const total = parts.reduce((s, p) => s + p.length, 0)
      this.buffer = new Uint8Array(total)
      let off = 0
      for (const p of parts) {
        this.buffer.set(p, off)
        off += p.length
      }
      this.size = total
      this.type = opts.type
    }
    async arrayBuffer() {
      return this.buffer.buffer.slice(0)
    }
  }
}

install()

async function main() {
  // ---- 用例 1：最大规格 64x64 x 8 帧 x scale 16 ----
  const size = 64
  const frameCount = 8
  const scale = 16
  const frames: Frame[] = Array.from({ length: frameCount }, (_, f) => ({
    id: `f${f}`,
    name: `帧${f}`,
    layers: [
      {
        id: 'l',
        name: 'l',
        visible: true,
        // 每帧画不同颜色的条带，颜色数远大于 255
        pixels: Array.from({ length: size * size }, (_, i) => {
          const r = (i * 3 + f * 17) % 256
          const g = (i * 5 + f * 31) % 256
          const b = (i * 7 + f * 47) % 256
          const hex = (n: number) => n.toString(16).padStart(2, '0')
          // 部分像素留透明
          return (i + f) % 11 === 0 ? null : `#${hex(r)}${hex(g)}${hex(b)}`
        }),
      },
    ],
  }))

  const progressPoints: number[] = []
  const start = Date.now()
  await exportAnimationGif(frames, size, 130, 'stress', {
    scale,
    preserveTransparency: true,
    matteColor: '#ffffff',
    onProgress: (p) => progressPoints.push(p),
  })
  const elapsed = Date.now() - start
  const blob = blobs.pop()!
  const bytes = new Uint8Array(await blob.arrayBuffer())
  writeFileSync('/tmp/stress-large.gif', bytes)
  console.log(`最大规格导出完成：${blob.size} 字节，耗时 ${elapsed}ms`)
  console.log(`进度回调 ${progressPoints.length} 次，单调递增：${
    progressPoints.every((p, i) => i === 0 || p >= progressPoints[i - 1]!)
  }，终点 ${progressPoints.at(-1)}`)

  // 结构校验：头部、帧数（按 GIF 块结构解析，避免把 LZW 数据里的 0x2c 误算）、尾部
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  const trailer = bytes[bytes.length - 1]
  let pos = 13 // 跳过头部(6) + 逻辑屏幕描述符(7)；GCT 在下方跳过
  const gctEntries = 2 ** ((bytes[10]! & 7) + 1)
  pos += gctEntries * 3
  let imageCount = 0
  while (pos < bytes.length - 1) {
    const intro = bytes[pos++]!
    if (intro === 0x3b) break
    if (intro === 0x21) {
      pos++ // 扩展标签（0xf9 / 0xff / 0xfe ...）
      let blockSize = bytes[pos++]
      while (blockSize !== 0) {
        pos += blockSize
        blockSize = bytes[pos++]
      }
    } else if (intro === 0x2c) {
      pos += 8 // 图像描述符固定字段
      const packed = bytes[pos++]!
      if (packed & 0x80) pos += 3 * 2 ** ((packed & 7) + 1) // 局部颜色表
      pos++ // LZW 最小码长
      let sub = bytes[pos++]!
      while (sub !== 0) {
        pos += sub
        sub = bytes[pos++]!
      }
      imageCount++
    }
  }
  console.log(`签名 ${sig}，尾部 0x${trailer.toString(16)}，图像块数 ${imageCount}`)
  if (sig !== 'GIF89a' || trailer !== 0x3b || imageCount !== frameCount) {
    console.error('结构校验失败')
    process.exit(1)
  }

  // ---- 用例 2：同样数据但垫底模式，确认两条路径都能完成 ----
  await exportAnimationGif(frames, size, 130, 'stress2', {
    scale,
    preserveTransparency: false,
    matteColor: '#808080',
  })
  const blob2 = blobs.pop()!
  console.log(`垫底模式最大规格导出完成：${blob2.size} 字节`)

  // ---- 用例 3：极小帧间隔 clamp（50ms 下限以下也要稳定） ----
  await exportAnimationGif(frames.slice(0, 1), size, 1, 'fast', {
    scale: 1,
    preserveTransparency: true,
    matteColor: '#000000',
  })
  console.log(`极端帧间隔导出完成：${blobs.pop()!.size} 字节`)

  console.log('\n稳定性测试全部通过 ✅')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
