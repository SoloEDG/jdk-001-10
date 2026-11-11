import type { Layer, Pixel } from './types'

export function createEmptyGrid(size: number): Pixel[] {
  return Array.from({ length: size * size }, () => null)
}

export function indexFor(x: number, y: number, size: number): number {
  return y * size + x
}

export function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size
}

export function getPixel(pixels: Pixel[], x: number, y: number, size: number): Pixel {
  if (!inBounds(x, y, size)) return null
  return pixels[indexFor(x, y, size)] ?? null
}

export function setPixel(pixels: Pixel[], x: number, y: number, size: number, color: Pixel): Pixel[] {
  const next = pixels.slice()
  next[indexFor(x, y, size)] = color
  return next
}

export function colorsMatch(a: Pixel, b: Pixel): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.toLowerCase() === b.toLowerCase()
}

export function floodFill(
  pixels: Pixel[],
  size: number,
  startX: number,
  startY: number,
  fillColor: Pixel,
): Pixel[] {
  const target = getPixel(pixels, startX, startY, size)
  if (colorsMatch(target, fillColor)) return pixels

  const next = pixels.slice()
  const stack: [number, number][] = [[startX, startY]]

  while (stack.length > 0) {
    const [x, y] = stack.pop()!
    if (!inBounds(x, y, size)) continue
    const idx = indexFor(x, y, size)
    if (!colorsMatch(next[idx], target)) continue
    next[idx] = fillColor
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  return next
}

export function drawLine(
  pixels: Pixel[],
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: Pixel,
): Pixel[] {
  let next = pixels
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0
  let y = y0

  while (true) {
    if (inBounds(x, y, size)) {
      next = setPixel(next, x, y, size, color)
    }
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }

  return next
}

/** Bottom-to-top composite of visible layers for display and eyedropper. */
export function compositeLayers(layers: Layer[], size: number): Pixel[] {
  const result = createEmptyGrid(size)
  for (const layer of layers) {
    if (!layer.visible) continue
    for (let i = 0; i < layer.pixels.length; i++) {
      const c = layer.pixels[i]
      if (c !== null) result[i] = c
    }
  }
  return result
}

export function resizeGrid(pixels: Pixel[], oldSize: number, newSize: number): Pixel[] {
  const next = createEmptyGrid(newSize)
  const limit = Math.min(oldSize, newSize)
  for (let y = 0; y < limit; y++) {
    for (let x = 0; x < limit; x++) {
      next[indexFor(x, y, newSize)] = getPixel(pixels, x, y, oldSize)
    }
  }
  return next
}
