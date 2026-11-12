/**
 * 测试用 ESM loader：把无扩展名的相对导入解析到 .ts 源文件。
 * 仅被 scripts/ 下的验证脚本使用，不影响 Vite 构建。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[a-zA-Z0-9]+$/.test(specifier)
  ) {
    const candidate = new URL(specifier + '.ts', context.parentURL)
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context)
    }
  }
  return nextResolve(specifier, context)
}
