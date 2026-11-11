import {
  compositeLayers,
  drawLine,
  floodFill,
  getPixel,
  setPixel,
} from '../core/pixelGrid'
import type { Layer, Pixel, ToolType } from '../core/types'

export interface LinePending {
  x: number
  y: number
}

export interface ToolContext {
  size: number
  layers: Layer[]
  activeLayerIndex: number
  activeColor: string
  tool: ToolType
  linePending: LinePending | null
}

export interface ToolResult {
  layers: Layer[]
  activeColor?: string
  linePending: LinePending | null
  consumed: boolean
}

function updateActiveLayer(ctx: ToolContext, mutate: (pixels: Pixel[]) => Pixel[]): Layer[] {
  const layers = ctx.layers.map((l, i) =>
    i === ctx.activeLayerIndex ? { ...l, pixels: mutate(l.pixels) } : l,
  )
  return layers
}

export function applyToolAt(ctx: ToolContext, x: number, y: number): ToolResult {
  const { tool, activeColor, size, linePending } = ctx
  let layers = ctx.layers
  let color = activeColor
  let pending = linePending

  if (tool === 'eyedropper') {
    const composite = compositeLayers(ctx.layers, size)
    const picked = getPixel(composite, x, y, size)
    if (picked) color = picked
    return { layers, activeColor: color, linePending: null, consumed: true }
  }

  if (tool === 'line') {
    if (!pending) {
      pending = { x, y }
      return { layers, linePending: pending, consumed: true }
    }
    const colorForLine = activeColor
    layers = updateActiveLayer(ctx, (pixels) =>
      drawLine(pixels, size, pending!.x, pending!.y, x, y, colorForLine),
    )
    pending = null
    return { layers, linePending: pending, consumed: true }
  }

  if (tool === 'brush') {
    layers = updateActiveLayer(ctx, (pixels) => setPixel(pixels, x, y, size, activeColor))
    return { layers, linePending: null, consumed: true }
  }

  if (tool === 'eraser') {
    layers = updateActiveLayer(ctx, (pixels) => setPixel(pixels, x, y, size, null))
    return { layers, linePending: null, consumed: true }
  }

  if (tool === 'bucket') {
    layers = updateActiveLayer(ctx, (pixels) => floodFill(pixels, size, x, y, activeColor))
    return { layers, linePending: null, consumed: true }
  }

  return { layers, linePending: pending, consumed: false }
}

export function cancelLineTool(): LinePending | null {
  return null
}
