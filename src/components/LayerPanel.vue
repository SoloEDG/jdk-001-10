<script setup lang="ts">
import { computed } from 'vue'
import { MAX_LAYERS } from '../core/constants'
import { useEditorStore } from '../editor/useEditorStore'

const store = useEditorStore()

const layers = computed(() => store.activeFrame?.layers ?? [])
const canAdd = computed(() => layers.value.length < MAX_LAYERS)
</script>

<template>
  <section class="panel side-panel">
    <h3>图层 <small>(最多 {{ MAX_LAYERS }} 层)</small></h3>
    <ul class="layer-list">
      <li
        v-for="(layer, index) in layers"
        :key="layer.id"
        class="layer-item"
        :class="{ active: store.activeProject?.activeLayerIndex === index }"
      >
        <button type="button" class="name" @click="store.setActiveLayer(index)">
          {{ layer.name }}
        </button>
        <button
          type="button"
          class="icon"
          :title="layer.visible ? '隐藏' : '显示'"
          @click="store.toggleLayerVisible(index)"
        >
          {{ layer.visible ? '👁' : '🚫' }}
        </button>
        <button
          type="button"
          class="icon danger"
          :disabled="layers.length <= 1"
          title="删除图层"
          @click="store.deleteLayer(index)"
        >
          ✕
        </button>
      </li>
    </ul>
    <button type="button" class="action" :disabled="!canAdd" @click="store.addLayer">
      新建图层
    </button>
  </section>
</template>
