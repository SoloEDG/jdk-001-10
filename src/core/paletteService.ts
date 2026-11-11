import { MAX_RECENT_COLORS } from './constants'

export function pushRecentColor(recent: string[], color: string): string[] {
  const normalized = color.toLowerCase()
  const filtered = recent.filter((c) => c.toLowerCase() !== normalized)
  return [color, ...filtered].slice(0, MAX_RECENT_COLORS)
}

export function addCustomColor(custom: string[], color: string): string[] {
  const normalized = color.toLowerCase()
  if (custom.some((c) => c.toLowerCase() === normalized)) return custom
  return [...custom, color]
}
