/**
 * editorial-engine.js
 *
 * 演示 pretext 最核心的能力：
 *   「文字环绕任意形状的动态障碍物，每帧重新布局，全程零 DOM 读取」
 *
 * 核心思路（三行概括）：
 *   1. prepareWithSegments(text, font)  → 一次性测量所有字符宽度（用 Canvas，不触发 reflow）
 *   2. 每帧循环：对每一行文字计算「被球体遮挡的区间」→ 剩余空隙 → layoutNextLine 填入文字
 *   3. 把算好的 (x, y, text) 写进 DOM div — 只写，不读
 */

import {
  prepareWithSegments,  // 预处理：测量每个字的宽度，缓存起来
  layoutNextLine,       // 布局一行：从 cursor 位置开始，填满给定宽度
  layoutWithLines,      // 布局全文：返回所有行（标题用）
  walkLineRanges,       // 遍历行范围：用来量「一段文字最少需要多宽」
} from '@chenglou/pretext'

// ─────────────────────────────────────────────
// 一、常量配置
// ─────────────────────────────────────────────

const FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", Georgia, serif'
const BODY_FONT = `18px ${FONT_FAMILY}`   // 正文字体（同 CSS font shorthand）
const BODY_LINE_HEIGHT = 30               // 行高（px），需与字体大小匹配

const HEADLINE_TEXT = 'THE FUTURE OF TEXT LAYOUT IS NOT CSS'

const GUTTER = 48           // 页面左右留白
const COL_GAP = 40          // 多列之间的间距
const MIN_SLOT_WIDTH = 50   // 小于此宽度的缝隙直接忽略，避免塞入零星文字

// 正文内容（英文，方便演示断行）
const BODY_TEXT = `The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. Every step requires the rendering engine to consult its internal layout tree — a structure so expensive to maintain that browsers guard access to it behind synchronous reflow barriers that can freeze the main thread for tens of milliseconds at a time.

For a paragraph in a blog post, this pipeline is invisible. The browser loads, lays out, and paints before the reader's eye has traveled from the address bar to the first word. But the web is no longer a collection of static documents. It is a platform for applications, and those applications need to know about text in ways the original pipeline never anticipated.

A messaging application needs to know the exact height of every message bubble before rendering a virtualized list. A masonry layout needs the height of every card to position them without overlap. An editorial page needs text to flow around images, advertisements, and interactive elements. A responsive dashboard needs to resize and reflow text in real time as the user drags a panel divider.

Every one of these operations requires text measurement. And every text measurement on the web today requires a synchronous layout reflow. The cost is devastating. Measuring the height of a single text block forces the browser to recalculate the position of every element on the page. When you measure five hundred text blocks in sequence, you trigger five hundred full layout passes.

This is what changes when text measurement becomes free. Not slightly better — categorically different. The interfaces that were too expensive to build become trivial. The layouts that existed only in print become interactive. The text that sat in boxes begins to flow.

Fifteen kilobytes. Zero dependencies. Zero DOM reads. And the text flows.`

// 球体定义（位置用「占全屏宽高比例」表示，方便不同屏幕适配）
const ORB_DEFS = [
  { fx: 0.52, fy: 0.28, r: 110, vx: 24,  vy: 16,  color: [196, 163, 90]  },
  { fx: 0.18, fy: 0.52, r: 85,  vx: -19, vy: 26,  color: [100, 140, 255] },
  { fx: 0.76, fy: 0.60, r: 95,  vx: 16,  vy: -21, color: [232, 100, 130] },
  { fx: 0.38, fy: 0.75, r: 75,  vx: -26, vy: -14, color: [80,  200, 140] },
  { fx: 0.86, fy: 0.20, r: 65,  vx: -13, vy: 19,  color: [150, 100, 220] },
]

// ─────────────────────────────────────────────
// 二、等待字体加载（关键！字体未就绪时测量结果不准）
// ─────────────────────────────────────────────

await document.fonts.ready

// ─────────────────────────────────────────────
// 三、一次性预处理（prepare 阶段）
// ─────────────────────────────────────────────
// prepareWithSegments 内部用 Canvas measureText 测量每个字/词的宽度，
// 结果缓存在返回的对象里。之后每帧的布局只需纯算术，不再访问 Canvas/DOM。

const preparedBody = prepareWithSegments(BODY_TEXT, BODY_FONT)

// 首字下沉：取正文第一个字母，放大 3 行
const DROP_CAP_CHAR = BODY_TEXT[0]  // 'T'
const DROP_CAP_SIZE = BODY_LINE_HEIGHT * 3 - 4
const DROP_CAP_FONT = `700 ${DROP_CAP_SIZE}px ${FONT_FAMILY}`
const preparedDropCap = prepareWithSegments(DROP_CAP_CHAR, DROP_CAP_FONT)

// 算出首字下沉的实际宽度（walkLineRanges 遍历每行，这里只有一行）
let dropCapWidth = 0
walkLineRanges(preparedDropCap, 9999, line => { dropCapWidth = line.width })
const DROP_CAP_W = Math.ceil(dropCapWidth) + 10  // 加 10px 内边距

// ─────────────────────────────────────────────
// 四、DOM 初始化
// ─────────────────────────────────────────────

const stage = document.getElementById('stage')

// 首字下沉元素（固定，只位置会变）
const dropCapEl = document.createElement('div')
dropCapEl.className = 'drop-cap'
dropCapEl.textContent = DROP_CAP_CHAR
dropCapEl.style.font = DROP_CAP_FONT
dropCapEl.style.lineHeight = `${DROP_CAP_SIZE}px`
stage.appendChild(dropCapEl)

// DOM 元素池：避免每帧创建/销毁，只改内容和显隐
// 正文行池、标题行池 — 不够就创建，多余就隐藏
const bodyLinePool = []    // 放正文 .line 元素
const headlinePool = []    // 放标题 .headline-line 元素

/**
 * syncPool — 确保池里有 count 个元素，多余的隐藏
 * 这是 pretext 示例里的标准模式：预分配 DOM 元素，只写不删
 */
function syncPool(pool, count, className) {
  while (pool.length < count) {
    const el = document.createElement('div')
    el.className = className
    stage.appendChild(el)
    pool.push(el)
  }
  for (let i = 0; i < pool.length; i++) {
    pool[i].style.display = i < count ? '' : 'none'
  }
}

// 创建球体 DOM 元素
const orbEls = ORB_DEFS.map(def => {
  const el = document.createElement('div')
  el.className = 'orb'
  const [r, g, b] = def.color
  // 径向渐变模拟发光球体
  el.style.background = `radial-gradient(circle at 35% 35%,
    rgba(${r},${g},${b},0.35),
    rgba(${r},${g},${b},0.12) 55%,
    transparent 72%)`
  el.style.boxShadow = `
    0 0 60px 15px rgba(${r},${g},${b},0.18),
    0 0 120px 40px rgba(${r},${g},${b},0.07)`
  stage.appendChild(el)
  return el
})

// ─────────────────────────────────────────────
// 五、球体运动状态
// ─────────────────────────────────────────────

const orbs = ORB_DEFS.map(def => ({
  x: def.fx * window.innerWidth,
  y: def.fy * window.innerHeight,
  r: def.r,
  vx: def.vx,   // 像素/秒
  vy: def.vy,
  paused: false,
}))

// 鼠标拖拽状态
let drag = null  // { orbIndex, startPx, startPy, startOrbX, startOrbY }

stage.addEventListener('pointerdown', e => {
  const hit = hitTestOrbs(e.clientX, e.clientY)
  if (hit !== -1) {
    drag = {
      orbIndex: hit,
      startPx: e.clientX,
      startPy: e.clientY,
      startOrbX: orbs[hit].x,
      startOrbY: orbs[hit].y,
    }
    e.preventDefault()
  }
  scheduleRender()
})

window.addEventListener('pointermove', e => {
  if (drag !== null) {
    orbs[drag.orbIndex].x = drag.startOrbX + (e.clientX - drag.startPx)
    orbs[drag.orbIndex].y = drag.startOrbY + (e.clientY - drag.startPy)
  }
  scheduleRender()
})

window.addEventListener('pointerup', e => {
  if (drag !== null) {
    const dx = e.clientX - drag.startPx
    const dy = e.clientY - drag.startPy
    // 移动距离 < 4px 认为是点击 → 切换暂停
    if (dx * dx + dy * dy < 16) {
      orbs[drag.orbIndex].paused = !orbs[drag.orbIndex].paused
    }
    drag = null
  }
  scheduleRender()
})

window.addEventListener('resize', () => scheduleRender())

function hitTestOrbs(px, py) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i]
    const dx = px - o.x, dy = py - o.y
    if (dx * dx + dy * dy <= o.r * o.r) return i
  }
  return -1
}

// ─────────────────────────────────────────────
// 六、核心几何函数：圆形遮挡区间计算
// ─────────────────────────────────────────────

/**
 * circleIntervalForBand
 * 给定一个水平「扫描带」[bandTop, bandBottom]，
 * 计算圆 (cx, cy, r) 在这个带内的水平遮挡区间 [left, right]。
 *
 * 原理：
 *   圆在扫描带内的最大水平宽度 = 2 * sqrt(r² - minDy²)
 *   其中 minDy = 圆心到扫描带最近点的垂直距离
 */
function circleIntervalForBand(cx, cy, r, bandTop, bandBottom, hPad = 14, vPad = 4) {
  const top = bandTop - vPad
  const bottom = bandBottom + vPad
  // 完全不相交
  if (top >= cy + r || bottom <= cy - r) return null
  // 圆心到扫描带最近点的垂直距离
  const minDy = cy >= top && cy <= bottom ? 0 : cy < top ? top - cy : cy - bottom
  if (minDy >= r) return null
  const maxDx = Math.sqrt(r * r - minDy * minDy)
  return { left: cx - maxDx - hPad, right: cx + maxDx + hPad }
}

/**
 * carveTextLineSlots
 * 从「可用区间 base」中，减去所有「被遮挡区间 blocked」，
 * 返回文字可以放置的空隙列表（过滤掉太窄的）。
 *
 * 举例：
 *   base = [0, 800]
 *   blocked = [{left:200, right:400}]
 *   → slots = [{left:0, right:200}, {left:400, right:800}]
 *
 * 这样文字就会同时出现在障碍物左侧和右侧！
 */
function carveTextLineSlots(base, blocked) {
  let slots = [base]
  for (const interval of blocked) {
    const next = []
    for (const slot of slots) {
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(s => s.right - s.left >= MIN_SLOT_WIDTH)
}

// ─────────────────────────────────────────────
// 七、标题自适应字号（二分搜索）
// ─────────────────────────────────────────────
// 目标：在 maxWidth 内，找到最大的字号，使标题不断词换行，高度不超 maxHeight

let cachedHeadline = null  // { w, h, fontSize, lines }

function fitHeadline(maxWidth, maxHeight) {
  // 缓存命中
  if (cachedHeadline && cachedHeadline.w === maxWidth && cachedHeadline.h === maxHeight) {
    return cachedHeadline
  }
  let lo = 20, hi = 92, bestSize = 20, bestLines = []

  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2)
    const font = `700 ${size}px ${FONT_FAMILY}`
    const lineH = Math.round(size * 0.93)
    const prepared = prepareWithSegments(HEADLINE_TEXT, font)

    let breaksWord = false, lineCount = 0
    walkLineRanges(prepared, maxWidth, line => {
      lineCount++
      if (line.end.graphemeIndex !== 0) breaksWord = true  // 断到词中间了
    })

    if (!breaksWord && lineCount * lineH <= maxHeight) {
      bestSize = size
      bestLines = layoutWithLines(prepared, maxWidth, lineH).lines.map((l, i) => ({
        x: 0, y: i * lineH, text: l.text,
      }))
      lo = size + 1
    } else {
      hi = size - 1
    }
  }

  cachedHeadline = { w: maxWidth, h: maxHeight, fontSize: bestSize, lines: bestLines }
  return cachedHeadline
}

// ─────────────────────────────────────────────
// 八、单列布局（文字环绕障碍物的核心循环）
// ─────────────────────────────────────────────

/**
 * layoutColumn
 * 对一个矩形区域（regionX/Y/W/H）进行文字布局，
 * 绕开 circleObstacles（球体）和 rectObstacles（矩形障碍，如首字下沉）。
 *
 * 返回：所有已布局行的 {x, y, text}，以及剩余文字的游标 cursor。
 * cursor 可以传给下一列继续接排（多列排版的关键！）
 */
function layoutColumn(prepared, startCursor, regionX, regionY, regionW, regionH, lineH, circleObstacles, rectObstacles) {
  let cursor = startCursor
  let lineTop = regionY
  const lines = []

  while (lineTop + lineH <= regionY + regionH) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineH
    const blocked = []

    // 计算每个球体在当前扫描带的遮挡区间
    for (const obs of circleObstacles) {
      const interval = circleIntervalForBand(obs.cx, obs.cy, obs.r, bandTop, bandBottom)
      if (interval) blocked.push(interval)
    }

    // 计算矩形障碍（首字下沉）的遮挡区间
    for (const rect of rectObstacles) {
      if (bandBottom <= rect.y || bandTop >= rect.y + rect.h) continue
      blocked.push({ left: rect.x, right: rect.x + rect.w })
    }

    // 从可用区间中剔除遮挡，得到可放文字的空隙
    const slots = carveTextLineSlots({ left: regionX, right: regionX + regionW }, blocked)

    if (slots.length === 0) {
      // 这一行完全被遮挡，跳过
      lineTop += lineH
      continue
    }

    // 按从左到右顺序填充各个空隙
    // 注意：同一行可能有多个空隙（球体左侧 + 右侧同时放文字）
    let textExhausted = false
    for (const slot of slots.sort((a, b) => a.left - b.left)) {
      const slotWidth = slot.right - slot.left

      // layoutNextLine：「从 cursor 位置开始，在 slotWidth 宽度内能放多少文字？」
      // 返回 { text, end（新 cursor）} 或 null（文字用完了）
      const line = layoutNextLine(prepared, cursor, slotWidth)
      if (!line) {
        textExhausted = true
        break
      }

      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        text: line.text,
      })
      cursor = line.end  // 游标前进，下一次从这里接着排
    }

    if (textExhausted) break
    lineTop += lineH
  }

  return { lines, cursor }
}

// ─────────────────────────────────────────────
// 九、渲染循环
// ─────────────────────────────────────────────

let lastFrameTime = null
let rafId = null

function scheduleRender() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(frame => {
    rafId = null
    const keepGoing = render(frame)
    if (keepGoing) scheduleRender()
  })
}

function render(now) {
  const W = document.documentElement.clientWidth
  const H = document.documentElement.clientHeight
  const dt = Math.min((now - (lastFrameTime ?? now)) / 1000, 0.05)  // 最大步长 50ms

  // — 更新球体位置 —
  let stillAnimating = false
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i]
    if (o.paused || i === drag?.orbIndex) continue
    stillAnimating = true
    o.x += o.vx * dt
    o.y += o.vy * dt
    // 边界弹射
    if (o.x - o.r < 0)      { o.x = o.r;     o.vx =  Math.abs(o.vx) }
    if (o.x + o.r > W)      { o.x = W - o.r; o.vx = -Math.abs(o.vx) }
    if (o.y - o.r < GUTTER) { o.y = o.r + GUTTER; o.vy = Math.abs(o.vy) }
    if (o.y + o.r > H - 20) { o.y = H - 20 - o.r; o.vy = -Math.abs(o.vy) }
  }
  lastFrameTime = stillAnimating ? now : null

  // — 计算布局参数 —
  const headlineMaxW = Math.min(W - GUTTER * 2, 1000)
  const headlineMaxH = Math.floor(H * 0.22)
  const { fontSize, lines: headlineLines } = fitHeadline(headlineMaxW, headlineMaxH)
  const headlineLineH = Math.round(fontSize * 0.93)
  const headlineHeight = headlineLines.length * headlineLineH

  const bodyTop = GUTTER + headlineHeight + 20
  const bodyH = H - bodyTop - 20

  // 列数：宽屏 3 列，中屏 2 列，窄屏 1 列
  const colCount = W > 1000 ? 3 : W > 640 ? 2 : 1
  const totalGutter = GUTTER * 2 + COL_GAP * (colCount - 1)
  const maxContentW = Math.min(W, 1500)
  const colW = Math.floor((maxContentW - totalGutter) / colCount)
  const contentLeft = Math.round((W - (colCount * colW + (colCount - 1) * COL_GAP)) / 2)

  // 把球体转为障碍物描述（供 layoutColumn 使用）
  const circleObstacles = orbs.map(o => ({ cx: o.x, cy: o.y, r: o.r }))

  // 首字下沉占据的矩形区域（作为矩形障碍物传入）
  const dropCapRect = {
    x: contentLeft - 2,
    y: bodyTop - 2,
    w: DROP_CAP_W,
    h: BODY_LINE_HEIGHT * 3 + 2,
  }

  // — 多列排版（游标接力）—
  // cursor 从第一列传到第二列，再传到第三列，实现无缝接排
  const allBodyLines = []
  // cursor 初始值跳过正文第一个字符（因为它是首字下沉，已单独渲染）
  let cursor = { segmentIndex: 0, graphemeIndex: 1 }

  for (let col = 0; col < colCount; col++) {
    const colX = contentLeft + col * (colW + COL_GAP)
    const rectObstacles = col === 0 ? [dropCapRect] : []  // 首字下沉只在第一列

    const result = layoutColumn(
      preparedBody,
      cursor,
      colX, bodyTop, colW, bodyH,
      BODY_LINE_HEIGHT,
      circleObstacles,
      rectObstacles,
    )
    allBodyLines.push(...result.lines)
    cursor = result.cursor  // 把这列的结束游标交给下一列
  }

  // — 把计算结果写入 DOM（只写，不读）—

  // 标题
  syncPool(headlinePool, headlineLines.length, 'headline-line')
  const headlineFont = `700 ${fontSize}px ${FONT_FAMILY}`
  for (let i = 0; i < headlineLines.length; i++) {
    const el = headlinePool[i]
    const l = headlineLines[i]
    el.textContent = l.text
    el.style.left = `${GUTTER}px`
    el.style.top = `${GUTTER + l.y}px`
    el.style.font = headlineFont
    el.style.lineHeight = `${headlineLineH}px`
  }

  // 首字下沉位置
  dropCapEl.style.left = `${contentLeft}px`
  dropCapEl.style.top = `${bodyTop}px`

  // 正文行
  syncPool(bodyLinePool, allBodyLines.length, 'line')
  for (let i = 0; i < allBodyLines.length; i++) {
    const el = bodyLinePool[i]
    const l = allBodyLines[i]
    el.textContent = l.text
    el.style.left = `${l.x}px`
    el.style.top = `${l.y}px`
    el.style.font = BODY_FONT
    el.style.lineHeight = `${BODY_LINE_HEIGHT}px`
  }

  // 球体
  for (let i = 0; i < orbs.length; i++) {
    const o = orbs[i]
    const el = orbEls[i]
    el.style.left = `${o.x - o.r}px`
    el.style.top = `${o.y - o.r}px`
    el.style.width = `${o.r * 2}px`
    el.style.height = `${o.r * 2}px`
    el.style.opacity = o.paused ? '0.4' : '1'
  }

  // 鼠标样式
  document.body.style.cursor = drag ? 'grabbing' : ''

  return stillAnimating  // 返回 true 时，下一帧继续渲染
}

// 启动！
scheduleRender()
