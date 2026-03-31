import { prepareWithSegments, layoutNextLine, type LayoutCursor } from '@chenglou/pretext'

// ─────────────────────────────────────────────────────────────────────────────────
// 富文本数据定义：文本片段（普通/链接/代码） + 标签（chip）
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * 内联元素类型：
 * - text: 普通文本片段，带有样式（body/link/code）
 * - chip: 标签（chips），如 @username、状态、优先级等
 */
const INLINE_SPECS = [
  { kind: 'text', text: 'Ship ', style: 'body' },
  { kind: 'chip', label: '@maya', tone: 'mention' },
  { kind: 'text', text: "'s ", style: 'body' },
  { kind: 'text', text: 'rich-note', style: 'code' },
  { kind: 'text', text: ' card once ', style: 'body' },
  { kind: 'text', text: 'pre-wrap', style: 'code' },
  { kind: 'text', text: ' lands. Status ', style: 'body' },
  { kind: 'chip', label: 'blocked', tone: 'status' },
  { kind: 'text', text: ' by ', style: 'body' },
  { kind: 'text', text: 'vertical text', style: 'link' },
  { kind: 'text', text: ' research, but 北京 copy and Arabic QA are both green ✅. Keep ', style: 'body' },
  { kind: 'chip', label: 'جاهز', tone: 'status' },
  { kind: 'text', text: ' for ', style: 'body' },
  { kind: 'text', text: 'Cmd+K', style: 'code' },
  { kind: 'text', text: ' docs; review bundle now includes 中文 labels, عربي fallback, and one more launch pass 🚀 for ', style: 'body' },
  { kind: 'chip', label: 'Fri 2:30 PM', tone: 'time' },
  { kind: 'text', text: '. Keep ', style: 'body' },
  { kind: 'text', text: 'layoutNextLine()', style: 'code' },
  { kind: 'text', text: ' public, tag this ', style: 'body' },
  { kind: 'chip', label: 'P1', tone: 'priority' },
  { kind: 'text', text: ', keep ', style: 'body' },
  { kind: 'chip', label: '3 reviewers', tone: 'count' },
  { kind: 'text', text: ', and route feedback to ', style: 'body' },
  { kind: 'text', text: 'design sync', style: 'link' },
  { kind: 'text', text: '.', style: 'body' },
]

// ─────────────────────────────────────────────────────────────────────────────────
// 字体和样式配置
// ─────────────────────────────────────────────────────────────────────────────────

const TEXT_STYLES = {
  body: { className: 'frag frag--body', font: '500 17px "Helvetica Neue", Helvetica, Arial, sans-serif' },
  link: { className: 'frag frag--link', font: '600 17px "Helvetica Neue", Helvetica, Arial, sans-serif' },
  code: { className: 'frag frag--code', font: '600 14px "SF Mono", ui-monospace, Menlo, monospace' },
}

const CHIP_STYLES = {
  mention: 'frag chip chip--mention',
  status: 'frag chip chip--status',
  priority: 'frag chip chip--priority',
  time: 'frag chip chip--time',
  count: 'frag chip chip--count',
}

const CHIP_FONT = '700 12px "Helvetica Neue", Helvetica, Arial, sans-serif'
const CHIP_CHROME_WIDTH = 22 // 标签左右 padding 宽度

const LINE_HEIGHT = 34
const LAST_LINE_HEIGHT = 24
const NOTE_SHELL_CHROME_X = 40 // 左右 padding
const UNBOUNDED_WIDTH = 100_000

// ─────────────────────────────────────────────────────────────────────────────────
// 预处理阶段：将 INLINE_SPECS 转换为可渲染的 InlineItem 数组
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * 内联元素项（预处理后）：
 * - text: 普通文本片段，包含 prepared 对象和光标信息
 * - chip: 标签，包含预计算好的宽度
 */
const items = []

/**
 * 测量一段文本单行的最大宽度（不换行）
 */
function measureSingleLineWidth(prepared) {
  let maxWidth = 0
  // 用一个足够大的宽度让文本不换行，测量每行宽度
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  while (true) {
    const line = layoutNextLine(prepared, cursor, UNBOUNDED_WIDTH)
    if (!line) break
    if (line.width > maxWidth) maxWidth = line.width
    cursor = line.end
  }
  return maxWidth
}

// 遍历每个 spec，转换为 InlineItem
for (const spec of INLINE_SPECS) {
  if (spec.kind === 'chip') {
    // 标签：预处理文字 + 计算宽度
    const prepared = prepareWithSegments(spec.label, CHIP_FONT)
    const textWidth = measureSingleLineWidth(prepared)
    items.push({
      kind: 'chip',
      className: CHIP_STYLES[spec.tone],
      text: spec.label,
      width: Math.ceil(textWidth) + CHIP_CHROME_WIDTH, // 文字宽度 + padding
    })
  } else {
    // 普通文本：预处理 + 保存必要信息
    const style = TEXT_STYLES[spec.style]
    const prepared = prepareWithSegments(spec.text, style.font)

    // 获取整段文本单行宽度
    const wholeLine = layoutNextLine(prepared, { segmentIndex: 0, graphemeIndex: 0 }, UNBOUNDED_WIDTH)
    if (!wholeLine) continue

    items.push({
      kind: 'text',
      className: style.className,
      prepared,  // 预处理对象，用于后续按行切割
      text: spec.text,
      fullText: wholeLine.text,
      fullWidth: wholeLine.width,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// 布局阶段：将 InlineItem 切分为多行
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * 对 InlineItem 数组进行布局，返回行列表
 * 每行包含若干片段（fragments）
 */
function layoutInlineItems(items, maxWidth) {
  const lines = []
  let itemIndex = 0
  let textCursor = null // 当前文本片段的光标位置

  while (itemIndex < items.length) {
    const fragments = [] // 当前行的片段
    let lineWidth = 0
    let remainingWidth = maxWidth

    // 填充当前行
    while (itemIndex < items.length) {
      const item = items[itemIndex]

      if (item.kind === 'chip') {
        // 标签：原子元素，不能拆分，要么整行放下，要么换行
        const itemWidth = item.width
        if (fragments.length > 0 && itemWidth > remainingWidth) break // 放不下，换行

        fragments.push({
          className: item.className,
          text: item.text,
          leadingGap: fragments.length === 0 ? 0 : 6, // 前导间距
        })
        lineWidth += itemWidth
        remainingWidth -= itemWidth
        textCursor = null
        itemIndex++
      } else {
        // 普通文本：可以被拆分到多行
        const startCursor = textCursor ?? { segmentIndex: 0, graphemeIndex: 0 }

        // 如果这个片段之前已经全部用完，跳过
        if (textCursor && item.endCursor && cursorEq(textCursor, item.endCursor)) {
          textCursor = null
          itemIndex++
          continue
        }

        const availableWidth = remainingWidth
        const line = layoutNextLine(item.prepared, startCursor, availableWidth)

        if (!line) {
          // 文本片段为空或异常，跳过
          itemIndex++
          textCursor = null
          continue
        }

        // 如果这行刚好是整个文本片段，直接用 fullText
        if (cursorEq(startCursor, item.endCursor)) {
          fragments.push({
            className: item.className,
            text: item.fullText,
            leadingGap: fragments.length === 0 ? 0 : 0,
          })
          lineWidth += item.fullWidth
          remainingWidth -= item.fullWidth
          itemIndex++
          textCursor = null
          continue
        }

        // 否则，用这行切分后的文本
        fragments.push({
          className: item.className,
          text: line.text,
          leadingGap: fragments.length === 0 ? 0 : 0,
        })
        lineWidth += line.width
        remainingWidth -= line.width

        // 更新光标位置
        textCursor = line.end

        // 如果这行刚好用到文本片段结尾，跳到下一个片段
        if (cursorEq(line.end, item.endCursor)) {
          itemIndex++
          textCursor = null
        } else {
          // 还有剩余文本，换行继续
          break
        }
      }
    }

    if (fragments.length === 0) break
    lines.push({ fragments })
  }

  return lines
}

function cursorEq(a, b) {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
}

// ─────────────────────────────────────────────────────────────────────────────────
// 渲染阶段：将布局结果渲染到 DOM
// ─────────────────────────────────────────────────────────────────────────────────

const noteBody = document.getElementById('note-body')
const widthSlider = document.getElementById('width-slider')
const widthValue = document.getElementById('width-value')
const root = document.documentElement

let requestedWidth = 516

function renderBody(lines) {
  noteBody.textContent = ''
  const fragment = document.createDocumentFragment()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const row = document.createElement('div')
    row.className = 'line-row'
    row.style.top = `${i * LINE_HEIGHT}px`

    for (const part of line.fragments) {
      const span = document.createElement('span')
      span.className = part.className
      span.textContent = part.text
      if (part.leadingGap) span.style.marginLeft = `${part.leadingGap}px`
      row.appendChild(span)
    }

    fragment.appendChild(row)
  }

  noteBody.appendChild(fragment)
}

function render() {
  // 计算可用宽度
  const viewportWidth = document.documentElement.clientWidth
  const bodyWidth = Math.max(260, Math.min(760, requestedWidth, viewportWidth - 96 - NOTE_SHELL_CHROME_X))

  // 布局
  const lines = layoutInlineItems(items, bodyWidth)
  const lineCount = lines.length
  const noteWidth = bodyWidth + NOTE_SHELL_CHROME_X
  const noteBodyHeight = lineCount === 0 ? LAST_LINE_HEIGHT : (lineCount - 1) * LINE_HEIGHT + LAST_LINE_HEIGHT

  // 更新 CSS 变量和 UI
  widthSlider.min = 260
  widthSlider.max = Math.min(760, viewportWidth - 96 - NOTE_SHELL_CHROME_X)
  widthSlider.value = bodyWidth
  widthValue.textContent = `${Math.round(bodyWidth)}px`
  root.style.setProperty('--note-width', `${noteWidth}px`)
  root.style.setProperty('--note-content-width', `${bodyWidth}px`)
  noteBody.style.height = `${noteBodyHeight}px`

  renderBody(lines)
}

// 事件监听
widthSlider.addEventListener('input', () => {
  requestedWidth = +widthSlider.value
  requestAnimationFrame(render)
})

window.addEventListener('resize', () => requestAnimationFrame(render))

// 初始化
document.fonts.ready.then(render)
render()
