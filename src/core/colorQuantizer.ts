/**
 * GIF 调色板量化：把任意数量的 RGB 颜色压缩到最多 maxColors 种。
 *
 * - 颜色数不超上限时原样保留（像素画常见情形，量化无损）。
 * - 超出上限时使用中位切分（median cut），并为每一种实际出现的颜色
 *   缓存最近的调色板索引，避免逐像素重复计算。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface QuantizedPalette {
  /** 调色板颜色，长度 <= maxColors */
  colors: Rgb[]
  /** 32 位打包 RGB -> 调色板索引，覆盖所有输入颜色 */
  indexByKey: Map<number, number>
}

export function rgbKey(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)
}

function distanceSquared(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

function averageColor(bucket: Rgb[]): Rgb {
  let r = 0
  let g = 0
  let b = 0
  for (const c of bucket) {
    r += c.r
    g += c.g
    b += c.b
  }
  const n = bucket.length
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

/**
 * @param uniqueColors 去重后的全部颜色
 * @param maxColors    调色板容量上限（需要保留透明索引时调用方应传 255）
 */
export function quantizeColors(uniqueColors: Rgb[], maxColors: number): QuantizedPalette {
  const limit = Math.max(1, Math.min(256, Math.floor(maxColors)))
  const indexByKey = new Map<number, number>()

  if (uniqueColors.length <= limit) {
    uniqueColors.forEach((color, i) => indexByKey.set(rgbKey(color.r, color.g, color.b), i))
    return { colors: uniqueColors.slice(), indexByKey }
  }

  // 中位切分：每次沿最长通道在中位数处切开，直到得到 limit 个桶。
  const buckets: Rgb[][] = [uniqueColors.slice()]
  while (buckets.length < limit) {
    // 找到可切分（颜色数 > 1）且包围盒最长的桶。
    let target = -1
    let targetRange = -1
    let targetChannel: 'r' | 'g' | 'b' = 'r'
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]
      if (bucket.length < 2) continue
      let minR = 255
      let maxR = 0
      let minG = 255
      let maxG = 0
      let minB = 255
      let maxB = 0
      for (const c of bucket) {
        if (c.r < minR) minR = c.r
        if (c.r > maxR) maxR = c.r
        if (c.g < minG) minG = c.g
        if (c.g > maxG) maxG = c.g
        if (c.b < minB) minB = c.b
        if (c.b > maxB) maxB = c.b
      }
      const rangeR = maxR - minR
      const rangeG = maxG - minG
      const rangeB = maxB - minB
      const range = Math.max(rangeR, rangeG, rangeB)
      if (range > targetRange) {
        targetRange = range
        target = i
        targetChannel = rangeR >= rangeG && rangeR >= rangeB ? 'r' : rangeG >= rangeB ? 'g' : 'b'
      }
    }

    if (target < 0) break // 所有桶都只剩一种颜色，无法继续切分

    const bucket = buckets[target]
    bucket.sort((a, b) => a[targetChannel] - b[targetChannel])
    const mid = bucket.length >> 1
    buckets.splice(target, 1, bucket.slice(0, mid), bucket.slice(mid))
  }

  const colors: Rgb[] = buckets.map(averageColor)

  // 为每个输入颜色建立到最近调色板颜色的索引映射。
  for (const color of uniqueColors) {
    let bestIndex = 0
    let bestDistance = Infinity
    for (let i = 0; i < colors.length; i++) {
      const d = distanceSquared(color, colors[i]!)
      if (d < bestDistance) {
        bestDistance = d
        bestIndex = i
      }
    }
    indexByKey.set(rgbKey(color.r, color.g, color.b), bestIndex)
  }

  return { colors, indexByKey }
}
