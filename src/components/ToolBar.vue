<script setup lang="ts">
import { CANVAS_SIZES } from '../core/constants'
import type { ToolType } from '../core/types'
import { useEditorStore } from '../editor/useEditorStore'
import PalettePanel from './PalettePanel.vue'

const store = useEditorStore()

const tools: { id: ToolType; label: string; hint: string }[] = [
  { id: 'brush', label: '画笔', hint: '单格上色' },
  { id: 'eraser', label: '橡皮', hint: '恢复透明' },
  { id: 'bucket', label: '油漆桶', hint: '区域填充' },
  { id: 'eyedropper', label: '吸管', hint: '吸取颜色' },
  { id: 'line', label: '直线', hint: '两点连线' },
]
</script>

<template>
  <aside class="toolbar">
    <header class="brand">
      <span class="logo">▦</span>
      <span class="title">像素编辑器</span>
    </header>

    <section class="panel">
      <h3>工具</h3>
      <div class="tool-list">
        <button
          v-for="t in tools"
          :key="t.id"
          type="button"
          class="tool-btn"
          :class="{ active: store.prefs.activeTool === t.id }"
          :title="t.hint"
          @click="store.setTool(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
      <p v-if="store.prefs.activeTool === 'line' && store.linePending" class="hint line-hint">
        已选起点，点击终点完成直线
      </p>
    </section>

    <section class="panel">
      <h3>画布尺寸</h3>
      <div class="size-list">
        <button
          v-for="size in CANVAS_SIZES"
          :key="size"
          type="button"
          class="size-btn"
          :class="{ active: store.canvasSize === size }"
          @click="store.setCanvasSize(size)"
        >
          {{ size }}×{{ size }}
        </button>
      </div>
    </section>

    <PalettePanel />

    <section class="panel export-panel">
      <h3>导出</h3>
      <button type="button" class="action" @click="store.exportCurrentFrame">导出当前帧 PNG</button>
      <button type="button" class="action" @click="store.exportAllFrames">导出全部帧 PNG</button>

      <div class="gif-options">
        <label class="gif-check">
          <input
            type="checkbox"
            :checked="store.gifPreserveTransparency"
            @change="store.setGifPreserveTransparency(($event.target as HTMLInputElement).checked)"
          />
          保留透明像素
        </label>
        <label v-if="!store.gifPreserveTransparency" class="gif-matte">
          垫底色
          <input
            type="color"
            :value="store.gifMatteColor"
            @input="store.setGifMatteColor(($event.target as HTMLInputElement).value)"
          />
        </label>
        <button
          type="button"
          class="action primary"
          :disabled="store.isExportingGif"
          @click="store.exportAnimationAsGif"
        >
          {{ store.isExportingGif ? `导出中 ${Math.round(store.gifExportProgress * 100)}%` : '导出动画 GIF' }}
        </button>
        <div v-if="store.isExportingGif" class="progress-track">
          <div class="progress-fill" :style="{ width: `${store.gifExportProgress * 100}%` }" />
        </div>
        <p v-if="store.gifExportError" class="hint gif-error">{{ store.gifExportError }}</p>
      </div>
    </section>
  </aside>
</template>
