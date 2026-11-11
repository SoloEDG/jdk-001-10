import { MAX_FRAMES } from './constants'
import { defaultLayerStack } from './layerFactory'
import type { Frame } from './types'

let frameCounter = 0

export function createFrame(size: number, name?: string): Frame {
  frameCounter += 1
  return {
    id: `frame-${Date.now()}-${frameCounter}`,
    name: name ?? `帧 ${frameCounter}`,
    layers: defaultLayerStack(size),
  }
}

export function canAddFrame(frames: Frame[]): boolean {
  return frames.length < MAX_FRAMES
}

export function defaultFrames(size: number): Frame[] {
  return [createFrame(size, '帧 1')]
}
