import { prepare, layout } from '@chenglou/pretext'

// ─────────────────────────────────────────────────────────────
// 第一步：准备文本
// 只需要做一次，之后重复利用。输入：文本内容 + 字体
// ─────────────────────────────────────────────────────────────
const text = 'AGI 春天到了 🌸 — 这里是一段中文、英文和 emoji 混排的文字。'
const font = '16px sans-serif'        // 字体格式同 canvas context.font
const prepared = prepare(text, font)  // 返回一个不透明的预处理对象

// ─────────────────────────────────────────────────────────────
// 第二步：计算布局
// 纯算术，零 DOM 读取，随时调用。输入：prepared + 容器宽度 + 行高
// ─────────────────────────────────────────────────────────────
const maxWidth = 400                    // 容器最大宽度（像素）
const lineHeight = 24                  // 每行高度（像素）
const { height, lineCount } = layout(prepared, maxWidth, lineHeight)

// ─────────────────────────────────────────────────────────────
// 第三步：渲染到页面
// 用算出的 height 和 lineCount 来设置容器样式，内容用普通 HTML 渲染
// ─────────────────────────────────────────────────────────────

// 1. 显示计算结果（调试用）
document.getElementById('result').innerHTML = `
  文本：<em>${text}</em><br>
  容器宽度：<strong>${maxWidth}px</strong><br>
  行高：<strong>${lineHeight}px</strong><br>
  pretext 算出的高度：<strong style="color:#56cfba">${height.toFixed(1)}px</strong><br>
  行数：<strong>${lineCount} 行</strong>
`

// 2. 创建容器，用算出的高度和宽度
const container = document.getElementById('container')
container.style.width = `${maxWidth}px`           // 容器宽度
container.style.height = `${height}px`          // 用 pretext 的高度（精准！）
container.style.lineHeight = `${lineHeight}px`  // 行高
container.style.fontSize = '16px'               // 对应 prepare 里的字体大小
container.style.wordBreak = 'break-word'        // 允许单词换行
container.style.overflow = 'hidden'             // 隐藏溢出内容
container.textContent = text                     // 内容
