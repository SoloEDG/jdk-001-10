/**
 * GIF 解析 + LZW 解码验证脚本（仅用于测试，不参与应用构建）。
 * 运行：node --experimental-strip-types scripts/verify-gif.ts
 */
import { writeFileSync } from 'node:fs'
import { quantizeColors, rgbKey } from '../src/core/colorQuantizer.ts'
import { GifWriter } from '../src/core/gifEncoder.ts'

interface DecodedFrame {
  delayCs: number
  disposal: number
  transparentIndex: number | null
  pixels: number[]
}

interface DecodedGif {
  width: number
  height: number
  palette: [number, number, number][]
  loopCount: number | null
  frames: DecodedFrame[]
}

class Reader {
  pos = 0
  private data: Uint8Array
  constructor(data: Uint8Array) {
    this.data = data
  }
  byte(): number {
    return this.data[this.pos++]!
  }
  u16(): number {
    return this.byte() | (this.byte() << 8)
  }
  bytes(n: number): Uint8Array {
    const out = this.data.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n))
  }
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): number[] {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1

  // LSB 优先位读取
  let accumulator = 0
  let bitCount = 0
  let dataPos = 0
  const readCode = (): number => {
    while (bitCount < codeSize) {
      accumulator |= data[dataPos++]! << bitCount
      bitCount += 8
    }
    const code = accumulator & ((1 << codeSize) - 1)
    accumulator >>>= codeSize
    bitCount -= codeSize
    return code
  }

  const output: number[] = []
  let dictionary: number[][] = []
  const resetDict = () => {
    dictionary = []
    for (let i = 0; i < clearCode; i++) dictionary.push([i])
    dictionary.push([]) // clear
    dictionary.push([]) // end
    codeSize = minCodeSize + 1
  }
  resetDict()

  let prev: number[] | null = null
  while (output.length < pixelCount) {
    const code = readCode()
    if (code === clearCode) {
      resetDict()
      prev = null
      continue
    }
    if (code === endCode) break

    let entry: number[]
    if (code < dictionary.length) {
      entry = dictionary[code]!
    } else {
      // 标准 GIF 的 KwKwK 情形
      entry = [...prev!, prev![0]!]
    }
    output.push(...entry)

    if (prev !== null) {
      dictionary.push([...prev, entry[0]!])
      if (dictionary.length === 1 << codeSize && codeSize < 12) codeSize++
    }
    prev = entry
  }
  return output.slice(0, pixelCount)
}

function parseGif(bytes: Uint8Array): DecodedGif {
  const r = new Reader(bytes)
  const signature = r.ascii(6)
  if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error('bad signature')

  const width = r.u16()
  const height = r.u16()
  const packed = r.byte()
  const hasGct = (packed & 0x80) !== 0
  const gctSize = 2 ** ((packed & 0x07) + 1)
  r.byte() // bg
  r.byte() // aspect

  const palette: [number, number, number][] = []
  if (hasGct) {
    for (let i = 0; i < gctSize; i++) palette.push([r.byte(), r.byte(), r.byte()])
  }

  let loopCount: number | null = null
  const frames: DecodedFrame[] = []
  let pendingGce: { delayCs: number; disposal: number; transparentIndex: number | null } | null =
    null

  const readSubBlocks = (): Uint8Array => {
    const chunks: number[] = []
    let size = r.byte()
    while (size !== 0) {
      for (const b of r.bytes(size)) chunks.push(b)
      size = r.byte()
    }
    return Uint8Array.from(chunks)
  }

  for (;;) {
    const introducer = r.byte()
    if (introducer === 0x3b) break // trailer

    if (introducer === 0x21) {
      // extension
      const label = r.byte()
      if (label === 0xf9) {
        // GCE
        r.byte() // block size 4
        const gcePacked = r.byte()
        const disposal = (gcePacked >> 2) & 0x07
        const delayCs = r.u16()
        const transIdx = r.byte()
        const hasTrans = (gcePacked & 0x01) !== 0
        r.byte() // terminator
        pendingGce = {
          delayCs,
          disposal,
          transparentIndex: hasTrans ? transIdx : null,
        }
      } else if (label === 0xff) {
        // application extension
        const blockSize = r.byte()
        const appId = r.ascii(blockSize)
        const rest = readSubBlocks()
        if (appId === 'NETSCAPE2.0' && rest.length >= 3 && rest[0] === 1) {
          loopCount = rest[1]! | (rest[2]! << 8)
        }
      } else {
        readSubBlocks()
      }
    } else if (introducer === 0x2c) {
      // image descriptor
      r.u16() // left
      r.u16() // top
      r.u16() // w
      r.u16() // h
      const imagePacked = r.byte()
      if (imagePacked & 0x80) {
        const lctSize = 2 ** ((imagePacked & 0x07) + 1)
        r.bytes(lctSize * 3)
      }
      const minCodeSize = r.byte()
      const lzwData = readSubBlocks()
      const pixels = lzwDecode(lzwData, minCodeSize, width * height)
      frames.push({
        delayCs: pendingGce?.delayCs ?? 0,
        disposal: pendingGce?.disposal ?? 0,
        transparentIndex: pendingGce?.transparentIndex ?? null,
        pixels,
      })
      pendingGce = null
    } else {
      throw new Error(`unexpected block 0x${introducer.toString(16)} at ${r.pos - 1}`)
    }
  }

  return { width, height, palette, loopCount, frames }
}

let failures = 0
function assert(cond: boolean, message: string): void {
  if (!cond) {
    failures++
    console.error(`  ✗ ${message}`)
  } else {
    console.log(`  ✓ ${message}`)
  }
}

function makeFrame(pattern: (i: number) => number, total: number): Uint8Array {
  const out = new Uint8Array(total)
  for (let i = 0; i < total; i++) out[i] = pattern(i)
  return out
}

// ---------- 测试 1：小图、透明、多帧、循环与帧时长 ----------
{
  console.log('测试 1：透明 GIF 结构 / 时长 / 循环')
  const w = 4
  const h = 4
  const palette = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ]
  const transIndex = 3
  const writer = new GifWriter({
    width: w,
    height: h,
    palette: [...palette, { r: 0, g: 0, b: 0 }],
    transparentIndex: transIndex,
  })
  const f1 = makeFrame((i) => (i % 3 === 0 ? transIndex : i % 3), w * h)
  const f2 = makeFrame((i) => (i % 2 === 0 ? 1 : transIndex), w * h)
  writer.addFrame({ indices: f1, delayCs: 20 })
  writer.addFrame({ indices: f2, delayCs: 7 })
  const bytes = writer.finish()
  writeFileSync('/tmp/gif-test-1.gif', bytes)
  const decoded = parseGif(bytes)

  assert(decoded.width === w && decoded.height === h, `尺寸 ${decoded.width}x${decoded.height}`)
  assert(decoded.palette.length === 4, `GCT 补齐到 4 项（实际 ${decoded.palette.length}）`)
  assert(
    decoded.palette[0]!.join(',') === '255,0,0' &&
      decoded.palette[1]!.join(',') === '0,255,0' &&
      decoded.palette[2]!.join(',') === '0,0,255',
    '调色板颜色顺序正确',
  )
  assert(decoded.loopCount === 0, `无限循环字段为 0（实际 ${decoded.loopCount}）`)
  assert(decoded.frames.length === 2, `帧数 2（实际 ${decoded.frames.length}）`)
  assert(
    decoded.frames[0]!.delayCs === 20 && decoded.frames[1]!.delayCs === 7,
    `帧时长 20/7 cs（实际 ${decoded.frames[0]!.delayCs}/${decoded.frames[1]!.delayCs}）`,
  )
  assert(
    decoded.frames.every((f) => f.transparentIndex === transIndex && f.disposal === 2),
    '透明索引与 disposal=2 正确',
  )
  const p1match = decoded.frames[0]!.pixels.every((v, i) => v === f1[i])
  const p2match = decoded.frames[1]!.pixels.every((v, i) => v === f2[i])
  assert(p1match && p2match, 'LZW 往返解码像素完全一致')
}

// ---------- 测试 2：不透明、非 2 次幂调色板（255 色）----------
{
  console.log('测试 2：255 色不透明 GIF')
  const w = 64
  const h = 32
  const palette = Array.from({ length: 255 }, (_, i) => ({ r: i, g: (i * 7) % 256, b: 255 - i }))
  const writer = new GifWriter({ width: w, height: h, palette, transparentIndex: null })
  const f = makeFrame((i) => (i * 131 + 17) % 255, w * h)
  writer.addFrame({ indices: f, delayCs: 5 })
  const bytes = writer.finish()
  const decoded = parseGif(bytes)

  assert(decoded.palette.length === 256, `GCT 补齐到 256 项（实际 ${decoded.palette.length}）`)
  assert(decoded.frames[0]!.transparentIndex === null, '不透明模式无透明索引')
  assert(decoded.frames[0]!.disposal === 1, '不透明帧 disposal=1')
  assert(
    decoded.frames[0]!.pixels.every((v, i) => v === f[i]),
    '255 色随机索引 LZW 往返一致',
  )
}

// ---------- 测试 3：大画布 + 字典清空路径（4096 码后自动清字典）----------
{
  console.log('测试 3：大画布触发 LZW 字典重置')
  const w = 512
  const h = 512
  const palette = Array.from({ length: 256 }, (_, i) => ({
    r: i,
    g: (i * 37) % 256,
    b: (i * 71) % 256,
  }))
  const writer = new GifWriter({ width: w, height: h, palette, transparentIndex: null })
  // 高熵随机数据，迫使字典不断填满并重置
  let seed = 42
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed
  }
  const f = makeFrame(() => rand() % 256, w * h)
  writer.addFrame({ indices: f, delayCs: 10 })
  const bytes = writer.finish()
  const decoded = parseGif(bytes)
  let mismatches = 0
  for (let i = 0; i < f.length; i++) if (decoded.frames[0]!.pixels[i] !== f[i]) mismatches++
  assert(mismatches === 0, `512x512 随机数据往返一致（不一致 ${mismatches} 个像素）`)
  console.log(`    编码后大小 ${(bytes.length / 1024).toFixed(1)} KiB`)
}

// ---------- 测试 4：纯色大图（极简压缩）与单像素图边界 ----------
{
  console.log('测试 4：纯色图与 1x1 边界')
  const writer1 = new GifWriter({
    width: 256,
    height: 256,
    palette: [{ r: 10, g: 20, b: 30 }],
    transparentIndex: null,
  })
  writer1.addFrame({ indices: makeFrame(() => 0, 256 * 256), delayCs: 3 })
  const b1 = writer1.finish()
  const d1 = parseGif(b1)
  assert(d1.frames[0]!.pixels.every((v) => v === 0), '65536 个同色像素往返一致')
  assert(b1.length < 700, `纯色图压缩效果良好（${b1.length} 字节）`)

  const writer2 = new GifWriter({
    width: 1,
    height: 1,
    palette: [{ r: 1, g: 2, b: 3 }],
    transparentIndex: 0,
  })
  writer2.addFrame({ indices: Uint8Array.from([0]), delayCs: 2 })
  const d2 = parseGif(writer2.finish())
  assert(d2.width === 1 && d2.height === 1 && d2.frames[0]!.pixels[0] === 0, '1x1 透明图正常')
}

// ---------- 测试 5：量化器 ----------
{
  console.log('测试 5：中位切分量化')
  const few = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 0, b: 0 },
  ]
  const q1 = quantizeColors(few, 256)
  assert(q1.colors.length === 3, '颜色数 <= 上限时无损保留')
  assert(q1.indexByKey.get(rgbKey(255, 0, 0)) === 2, '无损路径索引映射正确')

  // 生成 1000 个互不重复的颜色（r/g 各 32 档，b 取唯一值）
  const many: { r: number; g: number; b: number }[] = []
  for (let r = 0; r < 32 && many.length < 1000; r++) {
    for (let g = 0; g < 32 && many.length < 1000; g++) {
      many.push({ r: r * 8, g: g * 8, b: many.length % 256 })
    }
  }
  const uniqueCount = new Set(many.map((c) => rgbKey(c.r, c.g, c.b))).size
  assert(uniqueCount === 1000, `测试夹具生成 1000 个唯一颜色（实际 ${uniqueCount}）`)
  const q2 = quantizeColors(many, 255)
  assert(q2.colors.length === 255, `超过上限时压缩到 255 色（实际 ${q2.colors.length}）`)
  assert(q2.indexByKey.size === 1000, '每个输入颜色都有索引映射')
  // 映射到的索引都在调色板范围内
  assert(
    [...q2.indexByKey.values()].every((v) => v >= 0 && v < 255),
    '全部映射索引合法',
  )
  // 单一颜色量化到自身
  const q3 = quantizeColors(
    many.map((c) => ({ ...c })),
    1,
  )
  assert(q3.colors.length === 1, 'maxColors=1 时全部归并为一个桶')

  // 量化误差：把已知颜色映射回去，距离不应过大（中位切分下每通道误差有界）
  const sample = many[500]!
  const idx = q2.indexByKey.get(rgbKey(sample.r, sample.g, sample.b))!
  const nearest = q2.colors[idx]!
  const dist =
    (nearest.r - sample.r) ** 2 + (nearest.g - sample.g) ** 2 + (nearest.b - sample.b) ** 2
  assert(dist < 60 ** 2 * 3, `量化距离合理（平方距离 ${dist}）`)
}

// ---------- 测试 7：字典精确填满到 4095 的对抗序列（码长 9->12 全档位）----------
{
  console.log('测试 7：LZW 字典边界对抗序列')
  // 构造超长、模式缓慢变化的数据，使字典条目稳定增长到 4095 上限并反复清空，
  // 覆盖 codeSize 9/10/11/12 每个档位的边界。
  const w = 300
  const h = 300
  const palette = Array.from({ length: 256 }, (_, i) => ({ r: i, g: 0, b: 0 }))
  const indices = new Uint8Array(w * h)
  let seed = 7
  for (let i = 0; i < indices.length; i++) {
    // 低变化率：让相邻像素大概率重复，字典能长到很大才被重置
    seed = (seed * 1103515245 + 12345) >>> 0
    indices[i] = (seed >>> 16) % 4
  }
  const writer = new GifWriter({ width: w, height: h, palette, transparentIndex: null })
  writer.addFrame({ indices, delayCs: 4 })
  const bytes = writer.finish()
  writeFileSync('/tmp/gif-test-7.gif', bytes)
  const decoded = parseGif(bytes)
  let mismatches = 0
  for (let i = 0; i < indices.length; i++) if (decoded.frames[0]!.pixels[i] !== indices[i]) mismatches++
  assert(mismatches === 0, `字典填满 4095 路径往返一致（不一致 ${mismatches}）`)
}
{
  console.log('测试 6：边界保护')
  const writer = new GifWriter({
    width: 2,
    height: 2,
    palette: [{ r: 0, g: 0, b: 0 }],
    transparentIndex: null,
  })
  let threw = false
  try {
    writer.finish()
  } catch {
    threw = true
  }
  assert(threw, '无帧时 finish 抛错')

  let threw2 = false
  try {
    new GifWriter({ width: 2, height: 2, palette: [], transparentIndex: null })
  } catch {
    threw2 = true
  }
  assert(threw2, '空调色板抛错')
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`)
process.exit(failures === 0 ? 0 : 1)
