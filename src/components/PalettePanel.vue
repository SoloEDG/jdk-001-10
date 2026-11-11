<script setup lang="ts">
import { ref } from 'vue'
import { PRESET_COLORS } from '../core/constants'
import { useEditorStore } from '../editor/useEditorStore'

const store = useEditorStore()
const customPicker = ref('#ff004d')

function select(color: string) {
  store.setActiveColor(color)
}

function addCustom() {
  store.addCustomPaletteColor(customPicker.value)
}
</script>

<template>
  <section class="panel palette-panel">
    <h3>调色板</h3>
    <p class="hint">24 种预设颜色</p>
    <div class="swatches preset">
      <button
        v-for="color in PRESET_COLORS"
        :key="color"
        type="button"
        class="swatch"
        :class="{ active: store.prefs.activeColor === color }"
        :style="{ backgroundColor: color }"
        :title="color"
        @click="select(color)"
      />
    </div>

    <div v-if="store.activeProject?.customColors.length" class="block">
      <p class="hint">自定义颜色</p>
      <div class="swatches">
        <button
          v-for="color in store.activeProject.customColors"
          :key="color"
          type="button"
          class="swatch"
          :class="{ active: store.prefs.activeColor === color }"
          :style="{ backgroundColor: color }"
          @click="select(color)"
        />
      </div>
    </div>

    <div class="custom-add">
      <input v-model="customPicker" type="color" aria-label="自定义颜色" />
      <button type="button" @click="addCustom">添加到调色板</button>
    </div>

    <div v-if="store.activeProject?.recentColors.length" class="block">
      <p class="hint">最近使用（最多 8 种）</p>
      <div class="swatches recent">
        <button
          v-for="color in store.activeProject.recentColors"
          :key="'recent-' + color"
          type="button"
          class="swatch"
          :class="{ active: store.prefs.activeColor === color }"
          :style="{ backgroundColor: color }"
          @click="select(color)"
        />
      </div>
    </div>

    <div class="current-color">
      当前颜色
      <span class="preview" :style="{ backgroundColor: store.prefs.activeColor }" />
      <code>{{ store.prefs.activeColor }}</code>
    </div>
  </section>
</template>
