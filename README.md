# jdk-001 像素画编辑器

基于 **Vue 3 + TypeScript + Vite** 的纯前端像素画编辑器，数据保存在浏览器 `localStorage`。

## 功能概览

- **画布**：16×16 / 32×32 / 64×64，点击上色
- **调色板**：24 色预设、自定义颜色、最近 8 色
- **工具**：画笔、橡皮、油漆桶、吸管、直线（两点）
- **图层**：最多 3 层，显示/隐藏/删除
- **动画**：最多 8 帧，可调间隔并循环预览
- **导出**：当前帧或全部帧 PNG；按当前帧间隔导出无限循环的动画 GIF（颜色量化到 GIF 调色板，透明像素可保留或垫成指定底色）
- **项目**：新建 / 保存 / 加载多个项目

## 架构

| 目录 | 职责 |
|------|------|
| `src/core/` | 纯领域逻辑：网格算法、存储、导出、工厂方法 |
| `src/editor/` | 编辑状态编排：工具、命令、动画播放 |
| `src/components/` | UI 组件，仅消费 `useEditorStore` |

## 本地开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
npm run preview
```

## 验证脚本

`scripts/` 下为纯 Node 验证脚本（不参与应用构建），覆盖 GIF 编码器往返、量化器与端到端导出：

```bash
node --experimental-strip-types scripts/verify-gif.ts
node --experimental-strip-types --loader ./scripts/ts-loader.mjs scripts/verify-export-gif.ts
node --experimental-strip-types --loader ./scripts/ts-loader.mjs scripts/stress-gif.ts
```

## Docker 一键启动

```bash
docker compose up --build
```

浏览器访问：<http://localhost:8080>
