/**
 * 自动清理纯逻辑自检。
 *
 *   node docs/cleanup-selftest.mjs
 *
 * 覆盖三块：配置规范化、清理时刻判定、过期会话筛选。
 * 零依赖，全部通过时退出码为 0。
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_CLEAN_AT,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  createDefaultConfig,
  isDue,
  isExpired,
  localDateKey,
  normalizeConfig,
  parseCleanAt,
  selectExpired
} from '../lib/cleanup-policy.js'

const DAY = 24 * 60 * 60 * 1000

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

/** 本机时区下的具体时刻。 */
function at(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

console.log('配置规范化')

test('默认配置：关闭、无类型、保留 1 天、09:30', () => {
  const cfg = createDefaultConfig()
  assert.equal(cfg.autoClean.enabled, false)
  assert.deepEqual(cfg.autoClean.labels, [])
  assert.equal(cfg.autoClean.retentionDays, DEFAULT_RETENTION_DAYS)
  assert.equal(cfg.autoClean.retentionDays, 1)
  assert.equal(cfg.autoClean.cleanAt, DEFAULT_CLEAN_AT)
  assert.equal(cfg.autoClean.cleanAt, '09:30')
  assert.equal(cfg.autoClean.lastRunDate, null)
  assert.equal(cfg.autoClean.lastResult, null)
})

test('空值与垃圾输入回退到默认配置', () => {
  for (const raw of [undefined, null, 0, 'x', [], { autoClean: 'nope' }]) {
    const cfg = normalizeConfig(raw)
    assert.equal(cfg.autoClean.enabled, false)
    assert.deepEqual(cfg.autoClean.labels, [])
    assert.equal(cfg.autoClean.retentionDays, 1)
    assert.equal(cfg.autoClean.cleanAt, '09:30')
  }
})

test('保留天数夹在 1 到 3650 之间，非整数取整', () => {
  assert.equal(normalizeConfig({ autoClean: { retentionDays: 0 } }).autoClean.retentionDays, MIN_RETENTION_DAYS)
  assert.equal(normalizeConfig({ autoClean: { retentionDays: -5 } }).autoClean.retentionDays, MIN_RETENTION_DAYS)
  assert.equal(normalizeConfig({ autoClean: { retentionDays: 1e9 } }).autoClean.retentionDays, MAX_RETENTION_DAYS)
  assert.equal(normalizeConfig({ autoClean: { retentionDays: 7.6 } }).autoClean.retentionDays, 7)
  assert.equal(normalizeConfig({ autoClean: { retentionDays: '30' } }).autoClean.retentionDays, 30)
  assert.equal(normalizeConfig({ autoClean: { retentionDays: 'abc' } }).autoClean.retentionDays, 1)
})

test('清理时刻接受 7:05 这种写法并补零，非法值回退 09:30', () => {
  assert.equal(normalizeConfig({ autoClean: { cleanAt: '7:05' } }).autoClean.cleanAt, '07:05')
  assert.equal(normalizeConfig({ autoClean: { cleanAt: '23:59' } }).autoClean.cleanAt, '23:59')
  for (const bad of ['24:00', '09:60', '930', '', 'a:b', null]) {
    assert.equal(normalizeConfig({ autoClean: { cleanAt: bad } }).autoClean.cleanAt, '09:30')
  }
  assert.deepEqual(parseCleanAt('09:30'), { hour: 9, minute: 30 })
  assert.deepEqual(parseCleanAt('0:00'), { hour: 0, minute: 0 })
  assert.equal(parseCleanAt('25:00'), null)
})

test('类型清单去重、去空、剔除非字符串', () => {
  const cfg = normalizeConfig({
    autoClean: { labels: ['A', 'A', '', '  ', 'B', 42, null, '  C  '] }
  })
  assert.deepEqual(cfg.autoClean.labels, ['A', 'B', 'C'])
})

test('保留上上次运行结果，但坏掉的记录不残留', () => {
  const cfg = normalizeConfig({
    autoClean: { lastRunDate: '2026-11-02', lastRunAt: 1793413812559, lastResult: { removed: 3, bytes: 2048 } }
  })
  assert.equal(cfg.autoClean.lastRunDate, '2026-11-02')
  assert.equal(cfg.autoClean.lastRunAt, 1793413812559)
  assert.equal(cfg.autoClean.lastResult.removed, 3)
  assert.equal(normalizeConfig({ autoClean: { lastRunDate: 42 } }).autoClean.lastRunDate, null)
  assert.equal(normalizeConfig({ autoClean: { lastResult: 'x' } }).autoClean.lastResult, null)
})

console.log('日期与时刻')

test('本地日期键按本机时区生成', () => {
  assert.equal(localDateKey(at(2026, 11, 3, 9, 30)), '2026-11-03')
  assert.equal(localDateKey(at(2026, 1, 9, 0, 5)), '2026-01-09')
  assert.equal(localDateKey(at(2026, 12, 31, 23, 59)), '2026-12-31')
})

console.log('清理时刻判定')

const enabled = (extra) =>
  normalizeConfig({ autoClean: { enabled: true, labels: ['A'], cleanAt: '09:30', ...extra } }).autoClean

test('未启用时不触发', () => {
  const cfg = normalizeConfig({ autoClean: { enabled: false, labels: ['A'] } })
  assert.equal(isDue(cfg, at(2026, 11, 3, 10, 0)), false)
})

test('未勾选任何类型时不触发', () => {
  const cfg = normalizeConfig({ autoClean: { enabled: true, labels: [] } })
  assert.equal(isDue(cfg, at(2026, 11, 3, 10, 0)), false)
})

test('到点前不触发，到点当分钟即触发', () => {
  const ac = enabled({ lastRunDate: null })
  assert.equal(isDue(ac, at(2026, 11, 3, 9, 29)), false)
  assert.equal(isDue(ac, at(2026, 11, 3, 9, 30)), true)
  assert.equal(isDue(ac, at(2026, 11, 3, 23, 0)), true)
})

test('同一天已跑过不再触发，跨天后恢复', () => {
  const ac = enabled({ lastRunDate: '2026-11-03' })
  assert.equal(isDue(ac, at(2026, 11, 3, 10, 0)), false)
  assert.equal(isDue(ac, at(2026, 11, 3, 23, 59)), false)
  assert.equal(isDue(ac, at(2026, 11, 4, 9, 30)), true)
})

test('当天已过点而宿主刚启动时补跑', () => {
  const ac = enabled({ lastRunDate: '2026-11-02' })
  assert.equal(isDue(ac, at(2026, 11, 3, 14, 20)), true)
})

test('isDue 接收规范化后的 autoClean 或整份配置', () => {
  const full = normalizeConfig({ autoClean: { enabled: true, labels: ['A'], lastRunDate: null } })
  assert.equal(isDue(full, at(2026, 11, 3, 10, 0)), true)
  assert.throws(() => isDue(enabled({}), null), /now/)
})

console.log('过期筛选')

test('最后活动时间早于保留线即过期，等于也算过期', () => {
  const now = at(2026, 11, 3, 9, 30).getTime()
  assert.equal(isExpired({ mtime: now - 2 * DAY }, now, 1), true)
  assert.equal(isExpired({ mtime: now - DAY }, now, 1), true)
  assert.equal(isExpired({ mtime: now - DAY + 1000 }, now, 1), false)
  assert.equal(isExpired({ mtime: now }, now, 1), false)
})

test('最后活动时间缺失时不判过期', () => {
  const now = at(2026, 11, 3, 9, 30).getTime()
  for (const item of [{}, { mtime: null }, { mtime: undefined }, { mtime: 'x' }]) {
    assert.equal(isExpired(item, now, 1), false)
  }
})

test('只有被勾选的类型参与清理', () => {
  const now = at(2026, 11, 3, 9, 30).getTime()
  const cfg = normalizeConfig({ autoClean: { enabled: true, labels: ['A'], retentionDays: 1 } })
  const items = [
    { id: 'a-old', label: 'A', mtime: now - 3 * DAY },
    { id: 'a-new', label: 'A', mtime: now - 60 * 1000 },
    { id: 'b-old', label: 'B', mtime: now - 30 * DAY },
    { id: 'a-null', label: 'A' }
  ]
  assert.deepEqual(
    selectExpired(items, cfg, now).map((i) => i.id),
    ['a-old']
  )
})

test('保留天数为 30 时同一批数据不再过期', () => {
  const now = at(2026, 11, 3, 9, 30).getTime()
  const cfg = normalizeConfig({ autoClean: { enabled: true, labels: ['A', 'B'], retentionDays: 30 } })
  const items = [
    { id: 'a-old', label: 'A', mtime: now - 3 * DAY },
    { id: 'b-old', label: 'B', mtime: now - 30 * DAY }
  ]
  assert.deepEqual(
    selectExpired(items, cfg, now).map((i) => i.id),
    ['b-old']
  )
})

console.log('')
if (failures.length > 0) {
  console.log(`${passed} 项通过，${failures.length} 项失败：`)
  for (const name of failures) console.log(`  - ${name}`)
  process.exitCode = 1
} else {
  console.log(`全部 ${passed} 项通过`)
}
