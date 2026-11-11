<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../editor/useEditorStore'

const store = useEditorStore()
const newName = ref('')

function create() {
  store.createNewProject(newName.value || undefined)
  newName.value = ''
}

function save() {
  store.saveCurrentProject()
}
</script>

<template>
  <section class="panel side-panel project-panel">
    <h3>项目</h3>
    <p class="hint">数据保存在浏览器 localStorage</p>

    <div class="project-actions">
      <input v-model="newName" type="text" placeholder="新项目名称" />
      <button type="button" class="action" @click="create">新建</button>
      <button type="button" class="action primary" @click="save">保存</button>
    </div>

    <ul class="project-list">
      <li
        v-for="project in store.projects"
        :key="project.id"
        class="project-item"
        :class="{ active: store.activeProject?.id === project.id }"
      >
        <button type="button" class="name" @click="store.loadProject(project.id)">
          {{ project.name }}
        </button>
        <button
          type="button"
          class="icon danger"
          :disabled="store.projects.length <= 1"
          @click="store.deleteProject(project.id)"
        >
          删
        </button>
      </li>
    </ul>
  </section>
</template>
