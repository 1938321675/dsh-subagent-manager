/**
 * 自动清理的纯逻辑：配置规范化、清理时刻判定、过期会话筛选。
 *
 * 这里不触碰文件系统与定时器，宿主侧 lib/index.js 与自检脚本
 * docs/cleanup-selftest.mjs 共用同一份实现。
 */

export const DAY_MS = 24 * 60 * 60 * 1000
export const MIN_RETENTION_DAYS = 1
export const MAX_RETENTION_DAYS = 3650
export const DEFAULT_RETENTION_DAYS = 1
export const DEFAULT_CLEAN_AT = '09:30'

/** 全新配置：关闭自动清理、适用类型为空、保留 1 天、每天 09:30。 */
export function createDefaultConfig() {
  return {
    autoClean: {
      enabled: false,
      labels: [],
      retentionDays: DEFAULT_RETENTION_DAYS,
      cleanAt: DEFAULT_CLEAN_AT,
      lastRunDate: null,
      lastRunAt: null,
      lastResult: null
    }
  }
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 类型清单：只保留非空字符串，按首次出现顺序去重。 */
function normalizeLabels(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const labels = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const label = entry.trim()
    if (label === '' || seen.has(label)) continue
    seen.add(label)
    labels.push(label)
  }
  return labels
}

/** 保留天数夹在 1..3650，非整数取整，无法解析时用默认值。 */
export function normalizeRetentionDays(value) {
  const days = Number(value)
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS
  const whole = Math.trunc(days)
  if (whole < MIN_RETENTION_DAYS) return MIN_RETENTION_DAYS
  if (whole > MAX_RETENTION_DAYS) return MAX_RETENTION_DAYS
  return whole
}

/** 解析 HH:mm，接受 7:05 这类写法；无法解析时返回 null。 */
export function parseCleanAt(value) {
  const matched = /^(\d{1,2}):(\d{1,2})$/.exec(String(value ?? '').trim())
  if (matched === null) return null
  const hour = Number(matched[1])
  const minute = Number(matched[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** 规范成补零的 HH:mm。 */
export function normalizeCleanAt(value) {
  const parsed = parseCleanAt(value)
  if (parsed === null) return DEFAULT_CLEAN_AT
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`
}

function normalizeResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const count = (input) => (Number.isFinite(input) ? input : 0)
  return {
    at: Number.isFinite(value.at) ? value.at : null,
    trigger: typeof value.trigger === 'string' ? value.trigger : 'schedule',
    removed: count(value.removed),
    bytes: count(value.bytes),
    failed: count(value.failed),
    rejected: count(value.rejected),
    error: typeof value.error === 'string' ? value.error : null
  }
}

/** 把磁盘上的配置收拢成可用形状，坏字段逐个回退。 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const auto =
    source.autoClean !== null && typeof source.autoClean === 'object' && !Array.isArray(source.autoClean)
      ? source.autoClean
      : {}
  return {
    autoClean: {
      enabled: auto.enabled === true,
      labels: normalizeLabels(auto.labels),
      retentionDays: normalizeRetentionDays(auto.retentionDays),
      cleanAt: normalizeCleanAt(auto.cleanAt),
      lastRunDate: typeof auto.lastRunDate === 'string' && DATE_KEY_PATTERN.test(auto.lastRunDate) ? auto.lastRunDate : null,
      lastRunAt: Number.isFinite(auto.lastRunAt) ? auto.lastRunAt : null,
      lastResult: normalizeResult(auto.lastResult)
    }
  }
}

/** 本机时区下的日期键 YYYY-MM-DD。 */
export function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 此刻是否该跑一次自动清理。
 *
 * 条件：开关打开、有勾选类型、今天还没跑过、本机时间已过设定时刻。
 * 宿主当天没运行而错过时刻的情况，在这里表现为下次启动后的第一次判定为真。
 */
export function isDue(config, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('isDue 需要一个有效的 now 日期')
  }
  const auto = config !== null && typeof config === 'object' && config.autoClean ? config.autoClean : config
  if (auto === null || typeof auto !== 'object') return false
  if (auto.enabled !== true) return false
  if (!Array.isArray(auto.labels) || auto.labels.length === 0) return false
  if (auto.lastRunDate === localDateKey(now)) return false
  const parsed = parseCleanAt(auto.cleanAt)
  if (parsed === null) return false
  return now.getHours() * 60 + now.getMinutes() >= parsed.hour * 60 + parsed.minute
}

/** 单条会话是否已过期：最后活动时间早于 now − 保留期。时间缺失时不判过期。 */
export function isExpired(item, nowMs, retentionDays) {
  const mtime = item !== null && typeof item === 'object' ? item.mtime : undefined
  if (!Number.isFinite(mtime)) return false
  return mtime <= nowMs - normalizeRetentionDays(retentionDays) * DAY_MS
}

/** 从全部子代理里挑出「已勾选类型 + 已过期」的那些。 */
export function selectExpired(items, config, nowMs) {
  const auto = config !== null && typeof config === 'object' && config.autoClean ? config.autoClean : config
  if (auto === null || typeof auto !== 'object') return []
  const labels = new Set(Array.isArray(auto.labels) ? auto.labels : [])
  const days = normalizeRetentionDays(auto.retentionDays)
  const expired = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    if (!labels.has(item.label)) continue
    if (isExpired(item, nowMs, days)) expired.push(item)
  }
  return expired
}
