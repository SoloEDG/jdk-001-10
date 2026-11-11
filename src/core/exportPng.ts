import { EXPORT_PIXEL_SCALE } from './constants'
import { compositeLayers } from './pixelGrid'
import type { Frame } from './types'

function renderFrameToCanvas(
  frame: Frame,
  size: number,
  scale: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size * scale
  canvas.height = size * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const pixels = compositeLayers(frame.layers, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = pixels[y * size + x]
      if (color === null) continue
      ctx.fillStyle = color
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
  return canvas
}

export function downloadPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}

export function exportFramePng(
  frame: Frame,
  size: number,
  filename: string,
  scale = EXPORT_PIXEL_SCALE,
): void {
  const canvas = renderFrameToCanvas(frame, size, scale)
  downloadPng(canvas, filename)
}

export function exportAllFramesPng(
  frames: Frame[],
  size: number,
  projectName: string,
  scale = EXPORT_PIXEL_SCALE,
): void {
  const safe = projectName.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
  frames.forEach((frame, i) => {
    exportFramePng(frame, size, `${safe}_frame_${i + 1}.png`, scale)
  })
}
