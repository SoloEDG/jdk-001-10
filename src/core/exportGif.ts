import { quantizeColors, rgbKey, type Rgb } from './colorQuantizer'
import { EXPORT_PIXEL_SCALE } from './constants'
import { downloadBlob, renderFrameToCanvas } from './exportPng'
import { GifWriter } from './gifEncoder'
import type { Frame } from './types'

export interface GifExportOptions {
  /** 每个逻辑像素放大为多少物理像素，与 PNG 导出保持同一比例 */
  scale?: number
  /** true：保留透明像素；false：透明区域垫成 matteColor 底色 */
  preserveTransparency: boolean
  /** 垫底色（不保留透明时使用），#rrggbb 格式 */
  matteColor: string
  /** 进度回调，参数为 0~1 */
  onProgress?: (progress: number) => void
}

/** 把 #rgb / #rrggbb 解析为 RGB，非法输入回退为白色 */
function parseHexColor(hex: string): Rgb {
  const matched = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!matched) return { r: 255, g: 255, b: 255 }
  let value = matched[1]
  if (value.length === 3) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  const int = Number.parseInt(value, 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 从画布读取 RGBA，并按导出选项转换为「调色板键 -> 出现次数」。
 * - 保留透明：alpha < 128 的像素跳过（由透明索引表示），半透明按不透明处理
 * - 垫底色：先与底色做 alpha 合成，再纳入统计，避免边缘出现杂色
 */
function collectColorsFromCanvas(
  canvas: HTMLCanvasElement,
  preserveTransparency: boolean,
  matte: Rgb,
  counts: Map<number, number>,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    if (preserveTransparency && alpha < 128) continue

    let r: number
    let g: number
    let b: number
    if (alpha === 255 || (!preserveTransparency && alpha === 0)) {
      r = data[i]!
      g = data[i + 1]!
      b = data[i + 2]!
      if (!preserveTransparency && alpha === 0) {
        r = matte.r
        g = matte.g
        b = matte.b
      }
    } else {
      // 半透明像素与底色合成
      const base = preserveTransparency ? { r: 0, g: 0, b: 0 } : matte
      const t = alpha / 255
      r = Math.round(data[i]! * t + base.r * (1 - t))
      g = Math.round(data[i + 1]! * t + base.g * (1 - t))
      b = Math.round(data[i + 2]! * t + base.b * (1 - t))
    }

    const key = rgbKey(r, g, b)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
}

/** 读取画布并转换为全局调色板索引；透明像素写入 transparentIndex */
function canvasToIndices(
  canvas: HTMLCanvasElement,
  preserveTransparency: boolean,
  matte: Rgb,
  indexByKey: Map<number, number>,
  transparentIndex: number | null,
): Uint8Array {
  const ctx = canvas.getContext('2d')
  const total = canvas.width * canvas.height
  const indices = new Uint8Array(total)
  if (!ctx) return indices

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let write = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!
    if (preserveTransparency && alpha < 128) {
      indices[write++] = transparentIndex ?? 0
      continue
    }

    let r: number
    let g: number
    let b: number
    if (alpha === 255 || (!preserveTransparency && alpha === 0)) {
      r = data[i]!
      g = data[i + 1]!
      b = data[i + 2]!
      if (!preserveTransparency && alpha === 0) {
        r = matte.r
        g = matte.g
        b = matte.b
      }
    } else {
      const base = preserveTransparency ? { r: 0, g: 0, b: 0 } : matte
      const t = alpha / 255
      r = Math.round(data[i]! * t + base.r * (1 - t))
      g = Math.round(data[i + 1]! * t + base.g * (1 - t))
      b = Math.round(data[i + 2]! * t + base.b * (1 - t))
    }

    const mapped = indexByKey.get(rgbKey(r, g, b))
    indices[write++] = mapped ?? 0
  }
  return indices
}

/**
 * 导出循环播放的动画 GIF。
 *
 * 帧顺序与编辑器预览一致（frames 数组顺序），每帧时长取项目 frameDelayMs，
 * 通过 NETSCAPE 扩展实现无限循环。
 */
export async function exportAnimationGif(
  frames: Frame[],
  size: number,
  frameDelayMs: number,
  projectName: string,
  options: GifExportOptions,
): Promise<void> {
  if (frames.length === 0) throw new Error('没有可导出的帧')

  const scale = Math.max(1, Math.floor(options.scale ?? EXPORT_PIXEL_SCALE))
  const preserveTransparency = options.preserveTransparency
  const matte = parseHexColor(options.matteColor)
  const width = size * scale
  const height = size * scale

  // ---- 第一遍：渲染每帧并统计全部不透明颜色 ----
  const colorCounts = new Map<number, number>()
  const renderedCanvases: HTMLCanvasElement[] = []
  for (let i = 0; i < frames.length; i++) {
    const canvas = renderFrameToCanvas(frames[i]!, size, scale)
    renderedCanvases.push(canvas)
    collectColorsFromCanvas(canvas, preserveTransparency, matte, colorCounts)
    options.onProgress?.((i + 1) / (frames.length * 2))
    await yieldToEventLoop() // 大画布时让浏览器保持响应
  }

  // ---- 建立全局调色板（透明模式预留一个透明索引） ----
  const uniqueColors: Rgb[] = []
  for (const key of colorCounts.keys()) {
    uniqueColors.push({ r: (key >> 16) & 0xff, g: (key >> 8) & 0xff, b: key & 0xff })
  }

  let paletteColors: Rgb[]
  let indexByKey: Map<number, number>
  let transparentIndex: number | null = null

  if (preserveTransparency) {
    const quantized = quantizeColors(uniqueColors, 255)
    // 透明索引追加在调色板末尾，不参与任何不透明像素的映射
    transparentIndex = quantized.colors.length
    paletteColors = [
      ...quantized.colors,
      { r: 0, g: 0, b: 0 }, // 透明槽位的 RGB 不会被显示，固定为黑色占位
    ]
    indexByKey = quantized.indexByKey
  } else {
    // 垫底色保证底色一定在调色板中（整帧全透明时也有颜色可用）
    if (!colorCounts.has(rgbKey(matte.r, matte.g, matte.b))) {
      uniqueColors.push(matte)
    }
    const quantized = quantizeColors(uniqueColors, 256)
    paletteColors = quantized.colors
    indexByKey = quantized.indexByKey
  }

  const writer = new GifWriter({ width, height, palette: paletteColors, transparentIndex })

  // GIF 帧时长单位为 1/100 秒，与编辑器帧间隔保持一致
  const delayCs = Math.max(2, Math.round(frameDelayMs / 10))

  // ---- 第二遍：逐帧索引化并编码，完成后立即释放画布 ----
  for (let i = 0; i < renderedCanvases.length; i++) {
    const canvas = renderedCanvases[i]!
    const indices = canvasToIndices(
      canvas,
      preserveTransparency,
      matte,
      indexByKey,
      transparentIndex,
    )
    writer.addFrame({ indices, delayCs })
    options.onProgress?.(0.5 + (i + 1) / (frames.length * 2))
    await yieldToEventLoop()
  }

  const bytes = writer.finish()
  const blob = new Blob([bytes], { type: 'image/gif' })
  const safe = projectName.replace(/[^\w一-龥-]+/g, '_') || 'animation'
  downloadBlob(blob, `${safe}.gif`)
}
