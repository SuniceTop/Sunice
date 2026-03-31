# MEMORY.md — 项目长期记忆

## 项目信息
- 仓库：`/Users/sunicetop/Project/git/Sunice`（个人仓库 SuniceTop/Sunice）
- 构建工具：**bun**（`bun run start` 启动开发服务器，端口 3000）
- 包管理：bun（有 `bun.lock`）

## 已安装的关键依赖
- `@chenglou/pretext@0.0.3`：文本测量库，无 DOM reflow，核心 API：`prepare()` + `layout()`

## 文件约定
- HTML 文件放在项目根目录，`bun *.html` 自动 serve
- `start` 脚本会清理 3000 端口后启动

## pretext 使用要点（2026-03-31）
- `prepare(text, font)` 做一次性预处理（~几毫秒）
- `layout(prepared, maxWidth, lineHeight)` 是热路径（~0.09ms），纯算术无 DOM
- `prepareWithSegments` + `walkLineRanges` 可用于气泡收缩包裹（shrink-wrap）
- `layoutNextLine` 支持按行不同宽度布局（绕图文字流）
- font 参数格式同 canvas context.font，如 `'15px Inter, PingFang SC, sans-serif'`
- 字体加载后需重新调用（`document.fonts.ready.then(...)`）
