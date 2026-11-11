<script setup lang="ts">
import { computed } from 'vue'
import { MAX_FRAMES } from '../core/constants'
import { useEditorStore } from '../editor/useEditorStore'

const store = useEditorStore()

const frames = computed(() => store.activeProject?.frames ?? [])
const canAdd = computed(() => frames.value.length < MAX_FRAMES)

const displayIndex = computed(
  () => store.previewFrameIndex ?? store.activeProject?.activeFrameIndex ?? 0,
)
</script>

<template>
  <section class="panel side-panel">
    <h3>动画帧 <small>(最多 {{ MAX_FRAMES }} 帧)</small></h3>
    <ul class="frame-list">
      <li
        v-for="(frame, index) in frames"
        :key="frame.id"
        class="frame-item"
        :class="{
          active: displayIndex === index && !store.isPlaying,
          preview: store.previewFrameIndex === index,
        }"
      >
        <button
          type="button"
          class="name"
          :disabled="store.isPlaying"
          @click="store.setActiveFrame(index)"
        >
          {{ frame.name }}
        </button>
        <button
          type="button"
          class="icon danger"
          :disabled="frames.length <= 1 || store.isPlaying"
          @click="store.deleteFrame(index)"
        >
          ✕
        </button>
      </li>
    </ul>
    <button type="button" class="action" :disabled="!canAdd || store.isPlaying" @click="store.addFrame">
      新建帧
    </button>

    <label class="delay-field">
      帧间隔 (ms)
      <input
        type="number"
        min="50"
        max="5000"
        step="50"
        :value="store.activeProject?.frameDelayMs"
        :disabled="store.isPlaying"
        @change="store.setFrameDelay(Number(($event.target as HTMLInputElement).value))"
      />
    </label>

    <button type="button" class="action primary" @click="store.togglePlayback">
      {{ store.isPlaying ? '停止播放' : '播放动画' }}
    </button>
  </section>
</template>
