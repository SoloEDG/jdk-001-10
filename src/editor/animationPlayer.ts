import type { Ref } from 'vue'
import type { PixelProject } from '../core/types'

export interface PlaybackHandles {
  isPlaying: Ref<boolean>
  previewFrameIndex: Ref<number | null>
}

export function createAnimationPlayer(handles: PlaybackHandles) {
  let playTimer: ReturnType<typeof setInterval> | null = null

  function stop() {
    handles.isPlaying.value = false
    handles.previewFrameIndex.value = null
    if (playTimer) {
      clearInterval(playTimer)
      playTimer = null
    }
  }

  function toggle(project: PixelProject | null) {
    if (!project) return
    if (handles.isPlaying.value) {
      stop()
      return
    }
    handles.isPlaying.value = true
    let idx = 0
    handles.previewFrameIndex.value = idx
    playTimer = setInterval(() => {
      idx = (idx + 1) % project.frames.length
      handles.previewFrameIndex.value = idx
    }, project.frameDelayMs)
  }

  return { stop, toggle }
}
