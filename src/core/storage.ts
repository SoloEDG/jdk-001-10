import { STORAGE_KEYS } from './constants'
import { createProject, defaultActiveColor } from './projectFactory'
import type { EditorPreferences, PixelProject } from './types'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadProjects(): PixelProject[] {
  return readJson<PixelProject[]>(STORAGE_KEYS.projects, [])
}

export function saveProjects(projects: PixelProject[]): void {
  writeJson(STORAGE_KEYS.projects, projects)
}

export function loadPreferences(): EditorPreferences {
  return readJson<EditorPreferences>(STORAGE_KEYS.preferences, {
    activeColor: defaultActiveColor(),
    activeTool: 'brush',
    activeProjectId: null,
  })
}

export function savePreferences(prefs: EditorPreferences): void {
  writeJson(STORAGE_KEYS.preferences, prefs)
}

export function upsertProject(projects: PixelProject[], project: PixelProject): PixelProject[] {
  const idx = projects.findIndex((p) => p.id === project.id)
  const next = projects.slice()
  if (idx >= 0) next[idx] = project
  else next.push(project)
  return next
}

export function removeProject(projects: PixelProject[], id: string): PixelProject[] {
  return projects.filter((p) => p.id !== id)
}

export function ensureDefaultProject(projects: PixelProject[]): PixelProject[] {
  if (projects.length > 0) return projects
  const initial = createProject('未命名项目')
  saveProjects([initial])
  return [initial]
}
