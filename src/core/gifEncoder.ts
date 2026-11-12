/**
 * 纯 TypeScript 的 GIF89a 编码器。
 *
 * 支持：
 * - 全局颜色表（1/2/4/.../256 项，不足 2 的幂时补零）
 * - NETSCAPE2.0 循环扩展（无限循环）
 * - 每帧图形控制扩展（帧时长、透明索引、disposal 方式）
 * - LZW 压缩（最小码长 8，LSB 优先打包，自动清字典）
 *
 * 数据按块累积，避免大画布下反复整体扩容拷贝。
 */
import type { Rgb } from './colorQuantizer'

export interface GifFrameInput {
  /** 索引像素，长度 = width * height，取值为全局调色板索引 */
  indices: Uint8Array
  /** 帧时长，单位 1/100 秒 */
  delayCs: number
}

export interface GifWriterOptions {
  width: number
  height: number
  palette: Rgb[]
  /** 透明色在调色板中的索引；null 表示不透明（垫底色模式） */
  transparentIndex: number | null
}

const BLOCK_CAPACITY = 0xff // GIF 数据子块最大有效载荷
const LZW_MIN_CODE_SIZE = 8
const CLEAR_CODE = 1 << LZW_MIN_CODE_SIZE // 256
const END_CODE = CLEAR_CODE + 1 // 257
const FIRST_DICT_CODE = END_CODE + 1 // 258
const MAX_CODE = 0xfff // 4095

class ByteSink {
  private chunks: Uint8Array[] = []
  private current = new Uint8Array(64 * 1024)
  private offset = 0
  /** LZW 子块缓冲，攒满 255 字节后带长度前缀整体冲刷 */
  private subBlock = new Uint8Array(BLOCK_CAPACITY)
  private subBlockLen = 0

  private ensure(extra: number): void {
    if (this.offset + extra > this.current.length) {
      this.chunks.push(this.current.subarray(0, this.offset))
      this.current = new Uint8Array(Math.max(this.current.length, extra))
      this.offset = 0
    }
  }

  writeByte(value: number): void {
    this.ensure(1)
    this.current[this.offset] = value & 0xff
    this.offset++
  }

  writeBytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.writeByte(values[i])
  }

  writeString(value: string): void {
    for (let i = 0; i < value.length; i++) this.writeByte(value.charCodeAt(i))
  }

  writeUint16(value: number): void {
    this.writeByte(value & 0xff)
    this.writeByte((value >> 8) & 0xff)
  }

  /** 开始一个 LZW 数据子块序列 */
  beginSubBlocks(): void {
    this.subBlockLen = 0
  }

  /** 向当前子块写入一个数据字节，满 255 字节自动冲刷 */
  writeDataByte(value: number): void {
    this.subBlock[this.subBlockLen] = value & 0xff
    this.subBlockLen++
    if (this.subBlockLen === BLOCK_CAPACITY) this.flushSubBlock()
  }

  private flushSubBlock(): void {
    if (this.subBlockLen === 0) return
    this.writeByte(this.subBlockLen)
    this.writeBytes(this.subBlock.subarray(0, this.subBlockLen))
    this.subBlockLen = 0
  }

  /** 结束子块序列（冲刷残余字节并写入块终止符 0x00） */
  endSubBlocks(): void {
    this.flushSubBlock()
    this.writeByte(0)
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    const parts = [...this.chunks, this.current.subarray(0, this.offset)]
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const merged = new Uint8Array(new ArrayBuffer(total))
    let pos = 0
    for (const part of parts) {
      merged.set(part, pos)
      pos += part.length
    }
    return merged
  }
}

function paletteSizeField(paletteLength: number): number {
  // GIF 颜色表大小字段：实际表项数 = 2^(field + 1)
  let entries = 2
  let field = 0
  while (entries < paletteLength) {
    entries <<= 1
    field++
  }
  return field
}

/** LZW 压缩并按 GIF 子块格式写出（LSB 优先） */
function writeLzwData(sink: ByteSink, indices: Uint8Array): void {
  sink.writeByte(LZW_MIN_CODE_SIZE)
  sink.beginSubBlocks()

  let accumulator = 0
  let bitCount = 0

  const emitCode = (code: number, size: number): void => {
    accumulator |= code << bitCount
    bitCount += size
    while (bitCount >= 8) {
      sink.writeDataByte(accumulator & 0xff)
      accumulator >>>= 8
      bitCount -= 8
    }
  }

  let codeSize = LZW_MIN_CODE_SIZE + 1 // 初始 9 位
  // 字典键：(前缀码 << 12) | 后继像素值；单像素无需入字典，可直接作为码输出
  const dictionary = new Map<number, number>()
  let nextCode = FIRST_DICT_CODE

  const resetDictionary = (): void => {
    dictionary.clear()
    codeSize = LZW_MIN_CODE_SIZE + 1
    nextCode = FIRST_DICT_CODE
  }

  emitCode(CLEAR_CODE, codeSize)

  if (indices.length > 0) {
    let prefix = indices[0]!
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i]!
      const key = (prefix << 12) | k
      const found = dictionary.get(key)
      if (found !== undefined) {
        prefix = found
        continue
      }

      emitCode(prefix, codeSize)

      if (nextCode <= MAX_CODE) {
        dictionary.set(key, nextCode)
        if (nextCode === 1 << codeSize && codeSize < 12) codeSize++
        nextCode++
      } else {
        // 字典已满：清字典后重新开始，保证任意长度输入都能稳定编码
        emitCode(CLEAR_CODE, codeSize)
        resetDictionary()
      }
      prefix = k
    }
    emitCode(prefix, codeSize)
  }

  emitCode(END_CODE, codeSize)
  if (bitCount > 0) sink.writeDataByte(accumulator & 0xff)
  sink.endSubBlocks()
}

export class GifWriter {
  private readonly sink = new ByteSink()
  private readonly width: number
  private readonly height: number
  private readonly palette: Rgb[]
  private readonly transparentIndex: number | null
  private frameCount = 0

  constructor(options: GifWriterOptions) {
    this.width = options.width
    this.height = options.height
    this.palette = options.palette
    this.transparentIndex = options.transparentIndex

    if (this.palette.length < 1 || this.palette.length > 256) {
      throw new Error('GIF 调色板必须包含 1~256 种颜色')
    }
    this.writeHeader()
    this.writeLogicalScreen()
    this.writeLoopExtension()
  }

  private writeHeader(): void {
    this.sink.writeString('GIF89a')
  }

  private writeLogicalScreen(): void {
    const field = paletteSizeField(this.palette.length)
    const tableEntries = 1 << (field + 1)

    this.sink.writeUint16(this.width)
    this.sink.writeUint16(this.height)
    // 打包字节：全局颜色表标志(1) + 颜色分辨率(011 -> 8 位) + 原色数(0) + 表大小字段
    this.sink.writeByte(0x80 | (0b111 << 4) | field)
    this.sink.writeByte(0) // 背景色索引
    this.sink.writeByte(0) // 像素宽高比 0 = 未知

    for (let i = 0; i < tableEntries; i++) {
      const color = this.palette[i]
      this.sink.writeByte(color?.r ?? 0)
      this.sink.writeByte(color?.g ?? 0)
      this.sink.writeByte(color?.b ?? 0)
    }
  }

  private writeLoopExtension(): void {
    // NETSCAPE2.0 应用扩展：循环次数 0 表示无限循环
    this.sink.writeByte(0x21)
    this.sink.writeByte(0xff)
    this.sink.writeByte(0x0b)
    this.sink.writeString('NETSCAPE2.0')
    this.sink.writeByte(0x03)
    this.sink.writeByte(0x01)
    this.sink.writeUint16(0)
    this.sink.writeByte(0)
  }

  addFrame(frame: GifFrameInput): void {
    if (frame.indices.length !== this.width * this.height) {
      throw new Error('帧像素数量与画布尺寸不匹配')
    }

    const useTransparency = this.transparentIndex !== null
    // 透明模式用 restore-to-background(2)，保证每帧从干净画布开始；
    // 不透明帧用 do-not-dispose(1)，兼容性最好。
    const disposal = useTransparency ? 2 : 1
    const packed = (disposal << 2) | (useTransparency ? 1 : 0)
    const delayCs = Math.max(0, Math.min(0xffff, Math.round(frame.delayCs)))

    // 图形控制扩展
    this.sink.writeByte(0x21)
    this.sink.writeByte(0xf9)
    this.sink.writeByte(0x04)
    this.sink.writeByte(packed)
    this.sink.writeUint16(delayCs)
    this.sink.writeByte(useTransparency ? this.transparentIndex! : 0)
    this.sink.writeByte(0)

    // 图像描述符（使用全局颜色表，无局部颜色表，逐行扫描）
    this.sink.writeByte(0x2c)
    this.sink.writeUint16(0)
    this.sink.writeUint16(0)
    this.sink.writeUint16(this.width)
    this.sink.writeUint16(this.height)
    this.sink.writeByte(0)

    writeLzwData(this.sink, frame.indices)
    this.frameCount++
  }

  finish(): Uint8Array<ArrayBuffer> {
    if (this.frameCount === 0) throw new Error('GIF 至少需要一帧')
    this.sink.writeByte(0x3b) // trailer
    return this.sink.toUint8Array()
  }
}
