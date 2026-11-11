<script setup lang="ts">
import FramePanel from './components/FramePanel.vue'
import LayerPanel from './components/LayerPanel.vue'
import PixelCanvas from './components/PixelCanvas.vue'
import ProjectPanel from './components/ProjectPanel.vue'
import ToolBar from './components/ToolBar.vue'
</script>

<template>
  <div class="app-shell">
    <ToolBar />
    <PixelCanvas />
    <aside class="right-rail">
      <ProjectPanel />
      <LayerPanel />
      <FramePanel />
    </aside>
  </div>
</template>
