/**
 * 面板渲染冒烟自检：用一个极简 React 替身把 client.js 的 Panel 渲染成树，
 * 检查关键文案是否都在。
 *
 *   node docs/render-selftest.mjs
 *
 * 覆盖：类型条目上的「自动清理」标签、过期数量提示、配置卡的输入项与按钮。
 * 捕获的是渲染期错误（引用不存在的变量、拼错的 props 之类），不做样式校验。
 */
import assert from 'node:assert/strict'

const PANEL_URL = new URL('../lib/client.js', import.meta.url).href

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`  FAIL ${name}\n       ${error && error.message}`)
  }
}

// —— 极简 React 替身：useState 按调用顺序存值，useEffect 收集起来手动 flush ——

const store = { values: [], index: 0, effects: [] }

const React = {
  createElement: (type, props, ...children) => {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const slot = store.index++
    if (!(slot in store.values)) store.values[slot] = typeof initial === 'function' ? initial() : initial
    const setter = (next) => {
      store.values[slot] = typeof next === 'function' ? next(store.values[slot]) : next
    }
    return [store.values[slot], setter]
  },
  useEffect(fn) {
    store.effects.push(fn)
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  }
}

const jsx = (type, props) => React.createElement(type, props)
const jsxs = (type, props) => React.createElement(type, props)

/** 把渲染树里的文字按顺序收集出来。 */
function collectText(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out)
    return
  }
  if (typeof node === 'object' && typeof node.type === 'function') {
    collectText(node.type(node.props), out)
    return
  }
  if (typeof node === 'object' && node.props && node.props.children !== undefined) {
    collectText(node.props.children, out)
  }
}

/** 找出所有 type 为 button 的节点，返回它们的文字。 */
function collectButtonText(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const item of node) collectButtonText(item, out)
    return
  }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') {
    collectButtonText(node.type(node.props), out)
    return
  }
  if (node.type === 'button') {
    const text = []
    collectText(node, text)
    out.push(text.join(''))
  }
  if (node.props && node.props.children !== undefined) collectButtonText(node.props.children, out)
}

// —— 载入 client.js ——

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    }
  }
}

await import(PANEL_URL)

const listPayload = {
  ok: true,
  now: Date.now(),
  total: 4,
  bytes: 8 * 1024 * 1024,
  retentionDays: 1,
  config: {
    enabled: true,
    labels: ['审计线程队列与设备句柄泄漏'],
    retentionDays: 1,
    cleanAt: '09:30',
    lastRunDate: '2026-11-02',
    lastRunAt: Date.now() - 86400000,
    lastResult: { at: Date.now() - 86400000, trigger: 'schedule', removed: 5, bytes: 4096, failed: 0, rejected: 0, error: null }
  },
  groups: [
    { label: '审计线程队列与设备句柄泄漏', count: 2, bytes: 2048, orphanCount: 0, expiredCount: 2, expiredBytes: 2048, ids: ['s1', 's2'] },
    { label: '刚刚跑完的任务', count: 2, bytes: 1024, orphanCount: 1, expiredCount: 0, expiredBytes: 0, ids: ['s3', 's4'] }
  ],
  items: [
    { id: 's1', label: '审计线程队列与设备句柄泄漏', size: 1024, createdAt: 1, mtime: 2, cwd: 'D:\\代码\\AIR1', parentId: null, parentLive: true, workspaceDir: 'ws', expired: true }
  ]
}

globalThis.fetch = async (url) => {
  const path = String(url).replace('/api/dsh-subagent-manager', '')
  if (path === '/list') {
    return { ok: true, status: 200, json: async () => listPayload }
  }
  return { ok: false, status: 404, json: async () => ({ ok: false, error: `未预期的请求 ${path}` }) }
}

const Panel = (() => {
  let captured = null
  const moduleExports = loaded.factory((name) => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return { jsx, jsxs }
    throw new Error(`未预期的 require：${name}`)
  })
  moduleExports.apply({
    slots: {
      inject(_name, callback) {
        callback()
      },
      register(_spec, component) {
        captured = component
        return () => {}
      }
    }
  })
  return captured
})()

console.log('渲染冒烟')

test('注册出了设置页面板组件', () => {
  assert.equal(typeof Panel, 'function')
})

// 首轮渲染：加载态；然后 flush useEffect 里的请求，再渲染一次拿正式界面
Panel({ t: (key) => key })
for (const effect of store.effects) effect()
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
store.index = 0
store.effects = []
const tree = Panel({ t: (key) => key })

const text = []
collectText(tree, text)
const joined = text.join(' | ')

test('渲染出了自动清理卡片与它的输入项', () => {
  assert.ok(joined.includes('自动清理'), '缺少「自动清理」标题')
  assert.ok(joined.includes('保留'), '缺少保留时间标签')
  assert.ok(joined.includes('之后清理一次'), '缺少定时清理说明')
})

test('显示已纳入的类型数量与上次清理结果', () => {
  assert.ok(joined.includes('已纳入 1 个'), `实际文案：${joined}`)
  assert.ok(joined.includes('上次定时清理'), '缺少上次清理记录')
  assert.ok(joined.includes('删除 5 个'), '缺少上次删除数量')
})

test('类型条目上带自动清理开关与过期提示', () => {
  const buttons = []
  collectButtonText(tree, buttons)
  const autoButtons = buttons.filter((label) => label === '自动清理')
  assert.equal(autoButtons.length, 2, `两个类型各应有一个开关，实际 ${autoButtons.length} 个`)
  assert.ok(joined.includes('超过 1 天的有 2 个'), '缺少过期数量提示')
  assert.ok(joined.includes('其中 1 个父会话已删除'), '缺少孤儿会话提示')
})

test('配置卡上的按钮齐全', () => {
  const buttons = []
  collectButtonText(tree, buttons)
  for (const expected of ['全部纳入', '全部移出', '已保存', '立即清理一次']) {
    assert.ok(buttons.includes(expected), `缺少按钮「${expected}」，实际：${buttons.join('、')}`)
  }
})

console.log('')
if (failures.length > 0) {
  console.log(`${passed} 项通过，${failures.length} 项失败：`)
  for (const name of failures) console.log(`  - ${name}`)
  process.exitCode = 1
} else {
  console.log(`全部 ${passed} 项通过`)
}
