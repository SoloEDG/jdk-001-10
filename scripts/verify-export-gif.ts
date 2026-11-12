/**
 * 端到端验证：用最小 canvas mock 驱动 exportAnimationGif，
 * 校验输出 GIF 的像素、透明处理、垫底色与帧顺序。
 * 运行：node --experimental-strip-types scripts/verify-export-gif.ts
 */
import { writeFileSync } from 'node:fs'
import { exportAnimationGif } from '../src/core/exportGif.ts'
import type { Frame } from '../src/core/types.ts'

// ---- 最小 Canvas 2D mock：支持 fillRect 记录像素、getImageData 读取 ----
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
    const hex = /^#([0-9a-f]{6})$/i.exec(this.fillStyle)
    if (!hex) throw new Error(`unsupported fillStyle ${this.fillStyle}`)
    const int = Number.parseInt(hex[1]!, 16)
    const r = (int >> 16) & 0xff
    const g = (int >> 8) & 0xff
    const b = int & 0xff
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
  getImageData(x: number, y: number, w: number, h: number) {
    // mock 画布始终返回完整数据（导出代码只读取 0,0,width,height）
    void x
    void y
    void w
    void h
    return { data: this.data, width: this.w, height: this.h }
  }
}

class MockCanvas {
  private ctx2d: MockCtx
  private _width = 0
  private _height = 0
  get width(): number {
    return this._width
  }
  set width(v: number) {
    this._width = v
    this.ctx2d = new MockCtx(v, this._height)
  }
  get height(): number {
    return this._height
  }
  set height(v: number) {
    this._height = v
    this.ctx2d = new MockCtx(this._width, v)
  }
  constructor(width: number, height: number) {
    this._width = width
    this._height = height
    this.ctx2d = new MockCtx(width, height)
  }
  getContext(): MockCtx {
    return this.ctx2d
  }
}

const capturedBlobs: { blob: Blob; filename: string }[] = []

function installDomMocks(): void {
  ;(globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new MockCanvas(0, 0)
      if (tag === 'a') return { click() {} }
      throw new Error(`unexpected element ${tag}`)
    },
  }
  ;(globalThis as Record<string, unknown>).URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => {},
  }
  ;(globalThis as Record<string, unknown>).Blob = class MockBlob {
    size: number
    type: string
    private buffer: Uint8Array
    constructor(parts: Uint8Array[], options: { type: string }) {
      const total = parts.reduce((s, p) => s + p.length, 0)
      this.buffer = new Uint8Array(total)
      let off = 0
      for (const p of parts) {
        this.buffer.set(p, off)
        off += p.length
      }
      this.size = total
      this.type = options.type
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
      return this.buffer.buffer.slice(0)
    }
  }
  // 拦截下载
  const originalCreate = (globalThis as Record<string, unknown>).URL as {
    createObjectURL: () => string
  }
  void originalCreate
  const doc = (globalThis as Record<string, unknown>).document as {
    createElement: (tag: string) => { click: () => void; href?: string; download?: string }
  }
  const realCreateElement = doc.createElement.bind(doc)
  doc.createElement = (tag: string) => {
    const el = realCreateElement(tag)
    if (tag === 'a') {
      el.click = () => {
        const href = el.href ?? ''
        const blob = (blobMap as Map<string, Blob>).get(href)
        if (blob) capturedBlobs.push({ blob, filename: el.download ?? '' })
      }
    }
    return el
  }
  const blobMap = new Map<string, Blob>()
  const urlNs = (globalThis as Record<string, unknown>).URL as {
    createObjectURL: (b: Blob) => string
    revokeObjectURL: () => void
  }
  urlNs.createObjectURL = (b: Blob) => {
    const url = `blob:mock/${blobMap.size}`
    blobMap.set(url, b)
    return url
  }
}

// ---- 极简 GIF 解析（仅取需要的字段） ----
function parseGif(bytes: Uint8Array) {
  let pos = 0
  const read = () => bytes[pos++]!
  const u16 = () => read() | (read() << 8)
  const sig = String.fromCharCode(...bytes.subarray(pos, (pos += 6)))
  const width = u16()
  const height = u16()
  const packed = read()
  read()
  read()
  const gctEntries = 2 ** ((packed & 7) + 1)
  const palette: [number, number, number][] = []
  for (let i = 0; i < gctEntries; i++) palette.push([read(), read(), read()])

  let loopCount: number | null = null
  const frames: { delayCs: number; transIdx: number | null; indices: number[] }[] = []
  let gce: { delayCs: number; transIdx: number | null } | null = null

  const subBlocks = (): Uint8Array => {
    const out: number[] = []
    let size = read()
    while (size) {
      for (const b of bytes.subarray(pos, pos + size)) out.push(b)
      pos += size
      size = read()
    }
    return Uint8Array.from(out)
  }

  const lzw = (data: Uint8Array, min: number, count: number): number[] => {
    const clear = 1 << min
    const end = clear + 1
    let size = min + 1
    let acc = 0
    let bits = 0
    let dp = 0
    const next = () => {
      while (bits < size) {
        acc |= data[dp++]! << bits
        bits += 8
      }
      const c = acc & ((1 << size) - 1)
      acc >>>= size
      bits -= size
      return c
    }
    const out: number[] = []
    let dict: number[][] = []
    const reset = () => {
      dict = Array.from({ length: clear }, (_, i) => [i])
      dict.push([], [])
      size = min + 1
    }
    reset()
    let prev: number[] | null = null
    while (out.length < count) {
      const code = next()
      if (code === clear) {
        reset()
        prev = null
        continue
      }
      if (code === end) break
      const entry = code < dict.length ? dict[code]! : [...prev!, prev![0]!]
      out.push(...entry)
      if (prev) {
        dict.push([...prev, entry[0]!])
        if (dict.length === 1 << size && size < 12) size++
      }
      prev = entry
    }
    return out.slice(0, count)
  }

  for (;;) {
    const intro = read()
    if (intro === 0x3b) break
    if (intro === 0x21) {
      const label = read()
      if (label === 0xf9) {
        read()
        const gp = read()
        const delayCs = u16()
        const ti = read()
        read()
        gce = { delayCs, transIdx: gp & 1 ? ti : null }
      } else if (label === 0xff) {
        const bs = read()
        const app = String.fromCharCode(...bytes.subarray(pos, pos + bs))
        pos += bs
        const rest = subBlocks()
        if (app === 'NETSCAPE2.0') loopCount = rest[1]! | (rest[2]! << 8)
      } else {
        subBlocks()
      }
    } else if (intro === 0x2c) {
      u16()
      u16()
      const w = u16()
      const h = u16()
      const ip = read()
      if (ip & 0x80) pos += 3 * 2 ** ((ip & 7) + 1)
      const min = read()
      const data = subBlocks()
      frames.push({ ...(gce ?? { delayCs: 0, transIdx: null }), indices: lzw(data, min, w * h) })
      gce = null
    }
  }
  return { sig, width, height, palette, loopCount, frames }
}

let failures = 0
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++
    console.error(`  ✗ ${msg}`)
  } else console.log(`  ✓ ${msg}`)
}

// ---- 构造测试项目：2x2 逻辑像素，2 帧，scale=3 -> 6x6 输出 ----
const frame = (cells: (string | null)[]): Frame => ({
  id: Math.random().toString(36),
  name: 'f',
  layers: [
    {
      id: 'l',
      name: 'l',
      visible: true,
      // 2x2：cells 按行排列
      pixels: cells,
    },
  ],
})

// 帧 1：红、绿 / 透明、蓝；帧 2：全透明、白 等
const frame1 = frame(['#ff0000', '#00ff00', null, '#0000ff'])
const frame2 = frame(['#ffffff', null, null, '#ffff00'])
const frames = [frame1, frame2]
const size = 2
const scale = 3

async function main() {
  installDomMocks()

  // ===== 场景 A：保留透明 =====
  console.log('场景 A：保留透明像素')
  await exportAnimationGif(frames, size, 250, '测试项目', {
    scale,
    preserveTransparency: true,
    matteColor: '#ffffff',
  })
  const gifA = capturedBlobs.pop()!
  assert(gifA.filename === '测试项目.gif', `文件名 ${gifA.filename}`)
  assert(gifA.blob.type === 'image/gif', 'Blob MIME 为 image/gif')
  const bufA = new Uint8Array(await gifA.blob.arrayBuffer())
  writeFileSync('/tmp/e2e-transparent.gif', bufA)
  const a = parseGif(bufA)
  assert(a.sig === 'GIF89a', 'GIF89a 签名')
  assert(a.width === 6 && a.height === 6, `输出尺寸 6x6（实际 ${a.width}x${a.height}）`)
  assert(a.loopCount === 0, '无限循环')
  assert(a.frames.length === 2, `2 帧（实际 ${a.frames.length}）`)
  assert(a.frames.every((f) => f.delayCs === 25), `帧时长 250ms -> 25cs（实际 ${a.frames[0]!.delayCs}）`)
  const transIdx = a.frames[0]!.transIdx
  assert(transIdx !== null && a.frames[1]!.transIdx === transIdx, '两帧共用透明索引')

  // 量化会重排调色板顺序，因此按 RGB 值反查而不是假设固定索引
  const indexOfColor = (rgb: string) => a.palette.findIndex((c) => c.join(',') === rgb)
  const redIdx = indexOfColor('255,0,0')
  const whiteIdx = indexOfColor('255,255,255')
  const greenIdx = indexOfColor('0,255,0')
  assert(redIdx >= 0 && whiteIdx >= 0 && greenIdx >= 0, '调色板包含红/白/绿')

  // 帧 1 左上角物理块为红，左下块为透明
  assert(a.frames[0]!.indices[0] === redIdx, `帧1左上角像素为红色（索引 ${a.frames[0]!.indices[0]}）`)
  // 逻辑像素 (0,1) 在帧 1 为透明 -> 物理位置 (0,3)，索引 3*6+0
  const transparentPixel = a.frames[0]!.indices[3 * 6]!
  assert(transparentPixel === transIdx, `帧1透明位置写入透明索引（实际 ${transparentPixel}）`)
  // 帧 2 左上角为白
  assert(a.frames[1]!.indices[0] === whiteIdx, `帧2左上角为白色（索引 ${a.frames[1]!.indices[0]}）`)
  // 帧顺序：帧 1 的绿色只在帧 1 出现
  const greenExistsF1 = a.frames[0]!.indices.some((i) => i === greenIdx)
  const greenExistsF2 = a.frames[1]!.indices.some((i) => i === greenIdx)
  assert(greenExistsF1 && !greenExistsF2, '帧顺序与编辑器一致（绿仅在第 1 帧）')

  // ===== 场景 B：垫底色（关闭透明）=====
  console.log('场景 B：垫底色 #cccccc')
  await exportAnimationGif(frames, size, 100, 'matte', {
    scale,
    preserveTransparency: false,
    matteColor: '#cccccc',
  })
  const gifB = capturedBlobs.pop()!
  const b = parseGif(new Uint8Array(await gifB.blob.arrayBuffer()))
  writeFileSync('/tmp/e2e-matte.gif', new Uint8Array(await gifB.blob.arrayBuffer()))
  assert(b.frames.every((f) => f.transIdx === null), '垫底模式无透明索引')
  const matteKey = b.palette[b.frames[0]!.indices[3 * 6]!]!.join(',')
  assert(matteKey === '204,204,204', `原透明位置垫成 #cccccc（实际 ${matteKey}）`)
  assert(b.frames[0]!.delayCs === 10, `100ms -> 10cs（实际 ${b.frames[0]!.delayCs}）`)
  // 所有像素索引均在调色板范围内且无杂色：统计解码出的颜色集合
  const usedColors = new Set(b.frames[0]!.indices.map((i) => b.palette[i]!.join(',')))
  assert(
    [...usedColors].every((c) =>
      ['255,0,0', '0,255,0', '0,0,255', '204,204,204'].includes(c),
    ),
    `帧1只含预期颜色（实际 ${[...usedColors].join(' | ')}）`,
  )

  // ===== 场景 C：全透明帧 + 垫底色（兜底：调色板至少含底色）=====
  console.log('场景 C：全透明帧垫底色')
  const emptyFrame = frame([null, null, null, null])
  await exportAnimationGif([emptyFrame], size, 200, 'empty', {
    scale: 1,
    preserveTransparency: false,
    matteColor: '#000000',
  })
  const c = parseGif(new Uint8Array(await capturedBlobs.pop()!.blob.arrayBuffer()))
  assert(c.palette[0]!.join(',') === '0,0,0', '全透明帧垫黑色，调色板含黑色')
  assert(c.frames[0]!.indices.every((i) => i === 0), '全部像素映射到黑色')

  console.log(failures === 0 ? '\n端到端全部通过 ✅' : `\n${failures} 项失败 ❌`)
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
