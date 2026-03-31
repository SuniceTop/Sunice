import { prepare, layout, prepareWithSegments, walkLineRanges } from '@chenglou/pretext'

// ═══════════════════════════════════════════════════════════════
// DEMO 1: Text height predictor
// ═══════════════════════════════════════════════════════════════

const d1Text = document.getElementById('d1-text')
const d1Font = document.getElementById('d1-font')
const d1Width = document.getElementById('d1-width')
const d1WidthVal = document.getElementById('d1-width-val')
const d1Lh = document.getElementById('d1-lh')
const d1LhVal = document.getElementById('d1-lh-val')
const d1HeightEl = document.getElementById('d1-height')
const d1LinesEl = document.getElementById('d1-lines')
const d1DomHeightEl = document.getElementById('d1-dom-height')
const d1LayoutTimeEl = document.getElementById('d1-layout-time')
const d1DomTimeEl = document.getElementById('d1-dom-time')
const textPreviewBox = document.getElementById('text-preview-box')
const domMeasure = document.getElementById('dom-measure')

let d1Prepared = null
let d1PreparedFont = ''
let d1PreparedText = ''

function getD1State() {
  return {
    text: d1Text.value,
    font: d1Font.value,
    width: parseInt(d1Width.value, 10),
    lineHeight: parseInt(d1Lh.value, 10),
  }
}

function runDemo1() {
  const { text, font, width, lineHeight } = getD1State()

  d1WidthVal.textContent = `${width}px`
  d1LhVal.textContent = `${lineHeight}px`

  // Re-prepare only when text or font changes
  if (text !== d1PreparedText || font !== d1PreparedFont) {
    d1Prepared = prepare(text, font)
    d1PreparedText = text
    d1PreparedFont = font
  }

  // ── pretext layout (zero reflow) ──
  const t0 = performance.now()
  const { height, lineCount } = layout(d1Prepared, width, lineHeight)
  const t1 = performance.now()

  d1HeightEl.textContent = `${height.toFixed(1)}px`
  d1LinesEl.textContent = `${lineCount} 行`
  d1LayoutTimeEl.textContent = `${(t1 - t0).toFixed(3)}ms`

  // ── DOM measurement (for comparison only) ──
  // Parse font size from the font string for the preview box
  const fontSizeMatch = font.match(/^(\d+)px/)
  const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1], 10) : 15
  const lineHeightRatio = lineHeight / fontSize

  textPreviewBox.style.width = `${width}px`
  textPreviewBox.style.fontSize = `${fontSize}px`
  textPreviewBox.style.lineHeight = `${lineHeightRatio}`
  textPreviewBox.textContent = text

  domMeasure.style.width = `${width}px`
  domMeasure.style.fontSize = `${fontSize}px`
  domMeasure.style.lineHeight = `${lineHeightRatio}`
  domMeasure.textContent = text

  const t2 = performance.now()
  const domH = domMeasure.offsetHeight // triggers reflow
  const t3 = performance.now()

  d1DomHeightEl.textContent = `${domH}px (DOM)`
  d1DomTimeEl.textContent = `${(t3 - t2).toFixed(3)}ms`
}

d1Text.addEventListener('input', runDemo1)
d1Font.addEventListener('change', runDemo1)
d1Width.addEventListener('input', runDemo1)
d1Lh.addEventListener('input', runDemo1)


// ═══════════════════════════════════════════════════════════════
// DEMO 2: Chat bubble shrink-wrap
// ═══════════════════════════════════════════════════════════════

const CHAT_MESSAGES = [
  { text: 'Hi!', me: false },
  { text: '下午好 👋', me: true },
  { text: 'AGI 春天到了吗？', me: false },
  { text: '感觉已经开始了 🚀', me: true },
  { text: 'This library is really cool.', me: false },
  { text: '对，pretext 彻底解决了 reflow 问题', me: true },
  { text: 'بدأت الرحلة', me: false },
  { text: '期待下一步！', me: true },
  { text: 'Short msg', me: false },
  { text: 'K', me: true },
]

const BUBBLE_FONT = '14px Inter, PingFang SC, sans-serif'
const BUBBLE_LINE_HEIGHT = 21

// Pre-prepare all bubble texts once
const preparedBubbles = CHAT_MESSAGES.map(m =>
  prepareWithSegments(m.text, BUBBLE_FONT)
)

const d2MaxW = document.getElementById('d2-maxw')
const d2MaxWVal = document.getElementById('d2-maxw-val')
const d2Chat = document.getElementById('d2-chat')
const d2Before = document.getElementById('d2-before')
const d2After = document.getElementById('d2-after')
const d2Saved = document.getElementById('d2-saved')

// Build DOM nodes once
const bubbleNodes = CHAT_MESSAGES.map((msg, i) => {
  const wrapper = document.createElement('div')
  wrapper.className = `chat-msg${msg.me ? ' me' : ''}`

  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  avatar.textContent = msg.me ? '😄' : '🤖'
  avatar.style.background = msg.me ? '#3d3580' : '#2a2a3a'

  const bubble = document.createElement('div')
  bubble.className = `bubble ${msg.me ? 'me' : 'other'}`
  bubble.textContent = msg.text
  bubble.dataset.index = i

  wrapper.appendChild(avatar)
  wrapper.appendChild(bubble)
  d2Chat.appendChild(wrapper)

  return bubble
})

/**
 * Binary search: find the tightest width where the text fits in exactly
 * the same number of lines as at maxWidth.
 */
function shrinkWrapWidth(prepared, maxWidth) {
  // Count lines at maxWidth
  let refLines = 0
  walkLineRanges(prepared, maxWidth, () => { refLines++ })
  if (refLines === 0) return maxWidth

  // Binary search for the smallest width that gives the same line count
  let lo = 0
  let hi = maxWidth
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    let lines = 0
    walkLineRanges(prepared, mid, () => { lines++ })
    if (lines === refLines) {
      hi = mid
    } else {
      lo = mid
    }
  }
  // Add a tiny pixel buffer to avoid edge-case pixel rounding issues
  return hi + 2
}

function runDemo2() {
  const maxW = parseInt(d2MaxW.value, 10)
  d2MaxWVal.textContent = `${maxW}px`

  let totalBefore = 0
  let totalAfter = 0

  for (let i = 0; i < CHAT_MESSAGES.length; i++) {
    const node = bubbleNodes[i]
    const prepared = preparedBubbles[i]

    // "Before" = maxWidth (CSS only, no shrink)
    totalBefore += maxW

    // "After" = shrink-wrapped tight width
    const tightW = shrinkWrapWidth(prepared, maxW)
    totalAfter += tightW

    node.style.maxWidth = `${maxW}px`
    node.style.width = `${tightW}px`
  }

  const avgBefore = Math.round(totalBefore / CHAT_MESSAGES.length)
  const avgAfter = Math.round(totalAfter / CHAT_MESSAGES.length)
  const savedPct = Math.round((1 - avgAfter / avgBefore) * 100)

  d2Before.textContent = `${avgBefore}px`
  d2After.textContent = `${avgAfter}px`
  d2Saved.textContent = `${savedPct}%`
}

d2MaxW.addEventListener('input', runDemo2)


// ═══════════════════════════════════════════════════════════════
// DEMO 3: Resize hot path comparison
// ═══════════════════════════════════════════════════════════════

const DEMO3_TEXTS = [
  'Pretext 用 Canvas measureText 替代 DOM 读取，彻底绕过浏览器排版引擎。',
  'Every resize call is pure arithmetic — no layout thrashing.',
  'AGI 春天到了 🌸 — 这一行混合了中英文和 emoji，依然测量精准。',
  'The hot path runs in ~0.09ms for 500 text blocks.',
  'بدأت الرحلة — Arabic RTL text is also fully supported.',
]

const DEMO3_FONT = '13px Inter, PingFang SC, sans-serif'
const DEMO3_LH = 20

const preparedDemo3 = DEMO3_TEXTS.map(t => prepareWithSegments(t, DEMO3_FONT))
const preparedDemo3Simple = DEMO3_TEXTS.map(t => prepare(t, DEMO3_FONT))

const d3Width = document.getElementById('d3-width')
const d3WidthVal = document.getElementById('d3-width-val')
const d3PretextBody = document.getElementById('d3-pretext-body')
const d3DomBody = document.getElementById('d3-dom-body')
const d3PretextReflow = document.getElementById('d3-pretext-reflow')
const d3DomReflow = document.getElementById('d3-dom-reflow')
const d3PretextAvg = document.getElementById('d3-pretext-avg')
const d3DomAvg = document.getElementById('d3-dom-avg')

// Build card nodes for both sides once
const pretextCards = DEMO3_TEXTS.map((text, i) => {
  const card = document.createElement('div')
  card.className = 'fake-card'
  card.textContent = text

  // Height label badge
  const badge = document.createElement('div')
  badge.style.cssText = 'font-size:11px;color:var(--accent2);margin-top:6px;font-variant-numeric:tabular-nums;'
  badge.dataset.role = 'badge'
  card.appendChild(badge)
  d3PretextBody.appendChild(card)
  return { card, badge }
})

const domCards = DEMO3_TEXTS.map((text, i) => {
  const card = document.createElement('div')
  card.className = 'fake-card'
  card.dataset.index = i
  card.textContent = text

  const badge = document.createElement('div')
  badge.style.cssText = 'font-size:11px;color:var(--yellow);margin-top:6px;font-variant-numeric:tabular-nums;'
  badge.dataset.role = 'badge'
  card.appendChild(badge)
  d3DomBody.appendChild(card)
  return { card, badge }
})

// Hidden DOM measure nodes for demo3
const demo3MeasureNodes = DEMO3_TEXTS.map((text, i) => {
  const node = document.createElement('div')
  node.style.cssText = `
    position:absolute;visibility:hidden;pointer-events:none;
    top:-9999px;left:0;
    word-break:break-word;overflow-wrap:break-word;white-space:normal;
    font-size:13px;line-height:${DEMO3_LH / 13};
    font-family:Inter, PingFang SC, sans-serif;
  `
  node.textContent = text
  document.body.appendChild(node)
  return node
})

let d3PretextReflowCount = 0
let d3DomReflowCount = 0
let d3PretextTotalTime = 0
let d3DomTotalTime = 0
let d3RunCount = 0

function runDemo3() {
  const w = parseInt(d3Width.value, 10)
  d3WidthVal.textContent = `${w}px`

  // ── pretext side ──
  const tp0 = performance.now()
  for (let i = 0; i < preparedDemo3Simple.length; i++) {
    const { height, lineCount } = layout(preparedDemo3Simple[i], w, DEMO3_LH)
    pretextCards[i].badge.textContent = `pretext → ${height.toFixed(0)}px · ${lineCount} 行`
  }
  const tp1 = performance.now()
  d3PretextTotalTime += tp1 - tp0
  // pretext: zero reflow (counter stays 0)

  // ── DOM side ──
  for (let i = 0; i < domCards.length; i++) {
    demo3MeasureNodes[i].style.width = `${w}px`
  }
  const td0 = performance.now()
  for (let i = 0; i < domCards.length; i++) {
    const h = demo3MeasureNodes[i].offsetHeight // forces reflow
    domCards[i].badge.textContent = `DOM → ${h}px`
    d3DomReflowCount++
  }
  const td1 = performance.now()
  d3DomTotalTime += td1 - td0
  d3RunCount++

  d3PretextReflow.textContent = '0'
  d3DomReflow.textContent = d3DomReflowCount
  d3PretextAvg.textContent = `${(d3PretextTotalTime / d3RunCount).toFixed(3)}ms`
  d3DomAvg.textContent = `${(d3DomTotalTime / d3RunCount).toFixed(3)}ms`
}

d3Width.addEventListener('input', runDemo3)


// ═══════════════════════════════════════════════════════════════
// Init — run all demos once fonts are ready
// ═══════════════════════════════════════════════════════════════
document.fonts.ready.then(() => {
  runDemo1()
  runDemo2()
  runDemo3()
})

// Also run immediately in case fonts are already loaded
runDemo1()
runDemo2()
runDemo3()
