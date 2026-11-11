import { MAX_LAYERS } from './constants'
import { createEmptyGrid } from './pixelGrid'
import type { Layer } from './types'

let layerCounter = 0

export function createLayer(size: number, name?: string): Layer {
  layerCounter += 1
  return {
    id: `layer-${Date.now()}-${layerCounter}`,
    name: name ?? `图层 ${layerCounter}`,
    visible: true,
    pixels: createEmptyGrid(size),
  }
}

export function canAddLayer(layers: Layer[]): boolean {
  return layers.length < MAX_LAYERS
}

export function defaultLayerStack(size: number): Layer[] {
  return [createLayer(size, '图层 1')]
}
