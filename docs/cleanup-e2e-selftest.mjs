/**
 * 自动清理的端到端自检：在临时目录里造一份会话树，跑真实的扫描与删除。
 *
 *   node docs/cleanup-e2e-selftest.mjs
 *
 * 全程只操作 %TEMP% 下的临时目录，真实 ~/.dsh/sessions 不参与。
 * 覆盖：主会话不入候选、只删已勾选类型、保留期内的会话保留、
 *       主会话 id 被拒绝删除、运行结果写回配置。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

const DAY = 24 * 60 * 60 * 1000
const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-manager-e2e-'))
process.env.DSH_HOME = root

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

/** 写一份多帧 zstd 会话日志，返回日志路径。 */
function writeSession(workspace, id, header, events, mtimeMs) {
  const dir = join(root, 'sessions', workspace, id)
  mkdirSync(dir, { recursive: true })
  const frames = [zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'))]
  for (const event of events) {
    frames.push(zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')))
  }
  const logPath = join(dir, 'session.v1.jsonl.zstd')
  writeFileSync(logPath, Buffer.concat(frames))
  const when = new Date(mtimeMs)
  utimesSync(logPath, when, when)
  return logPath
}

function writeConfig(config) {
  mkdirSync(join(root, 'storages', 'subagent-manager'), { recursive: true })
  writeFileSync(join(root, 'storages', 'subagent-manager', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

const now = Date.now()
const WS = '--D-~4EE3~7801-AIR1--'

writeSession(WS, 'session-main', { origin: 'main', createdAt: now - 5 * DAY, cwd: 'D:\\代码\\AIR1' }, [], now - 5 * DAY)
writeSession(
  WS,
  'session-sub-old',
  { origin: 'subagent', createdAt: now - 4 * DAY, cwd: 'D:\\代码\\AIR1', parentSession: 'session-main' },
  [{ type: 'subagent/descriptor', label: 'TestOld' }],
  now - 3 * DAY
)
writeSession(
  WS,
  'session-sub-new',
  { origin: 'subagent', createdAt: now - 2 * DAY, cwd: 'D:\\代码\\AIR1', parentSession: 'session-main' },
  [{ type: 'subagent/descriptor', label: 'TestOld' }],
  now - 60 * 1000
)
writeSession(
  WS,
  'session-sub-other',
  { origin: 'subagent', createdAt: now - 4 * DAY, cwd: 'D:\\代码\\AIR1', parentSession: 'session-main' },
  [{ type: 'subagent/descriptor', label: 'TestOther' }],
  now - 3 * DAY
)

writeConfig({
  autoClean: { enabled: true, labels: ['TestOld'], retentionDays: 1, cleanAt: '09:30' }
})

const { __internals } = await import('../lib/index.js')
const { scanSubagents, purgeSessions, runClean, readConfig } = __internals

console.log('扫描')

test('主会话不进候选，子代理按 label 归类', () => {
  const items = scanSubagents()
  const ids = items.map((item) => item.id).sort()
  assert.deepEqual(ids, ['session-sub-new', 'session-sub-old', 'session-sub-other'])
  const old = items.find((item) => item.id === 'session-sub-old')
  assert.equal(old.label, 'TestOld')
  assert.equal(old.parentLive, true)
  assert.ok(Math.abs(old.mtime - (now - 3 * DAY)) < 2000, `mtime 应接近三天前，实际 ${old.mtime}`)
})

console.log('过期筛选')

test('只挑已勾选类型中超过保留期的会话', () => {
  const preview = runClean('manual', true)
  assert.equal(preview.candidates, 1)
  assert.deepEqual(preview.ids, ['session-sub-old'])
  assert.ok(preview.bytes > 0)
})

test('未勾选的类型与保留期内的会话都不在候选里', () => {
  const ids = runClean('manual', true).ids
  assert.equal(ids.includes('session-sub-other'), false)
  assert.equal(ids.includes('session-sub-new'), false)
})

console.log('删除保护')

test('主会话 id 被拒绝删除', () => {
  const outcome = purgeSessions(['session-main'])
  assert.deepEqual(outcome.rejected, ['session-main'])
  assert.equal(outcome.dirsRemoved, 0)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-main')), true)
})

test('混合列表里有主会话时整体拒绝', () => {
  const outcome = purgeSessions(['session-sub-old', 'session-main'])
  assert.deepEqual(outcome.rejected, ['session-main'])
  assert.equal(outcome.dirsRemoved, 0)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-sub-old')), true)
})

console.log('执行清理')

test('到期会话被删掉，其余原样保留', () => {
  const result = runClean('manual', false)
  assert.equal(result.dirsRemoved, 1)
  assert.equal(result.rejected.length, 0)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-sub-old')), false)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-sub-new')), true)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-sub-other')), true)
  assert.equal(existsSync(join(root, 'sessions', WS, 'session-main')), true)
})

test('运行结果写回配置，供面板展示', () => {
  const config = readConfig()
  assert.equal(config.autoClean.lastResult.removed, 1)
  assert.equal(config.autoClean.lastResult.trigger, 'manual')
  assert.ok(config.autoClean.lastResult.at > 0)
  assert.ok(typeof config.autoClean.lastRunDate === 'string')
  assert.equal(config.autoClean.enabled, true)
  assert.deepEqual(config.autoClean.labels, ['TestOld'])
})

test('同一天再跑一次没有可删的，且仍能正常记账', () => {
  const result = runClean('manual', false)
  assert.equal(result.candidates, 0)
  assert.equal(result.dirsRemoved, 0)
  assert.equal(readConfig().autoClean.lastResult.removed, 0)
})

test('配置写盘后仍能被规范读回', () => {
  const raw = JSON.parse(readFileSync(join(root, 'storages', 'subagent-manager', 'config.json'), 'utf8'))
  assert.equal(raw.autoClean.retentionDays, 1)
  assert.equal(raw.autoClean.cleanAt, '09:30')
})

console.log('')
if (failures.length > 0) {
  console.log(`${passed} 项通过，${failures.length} 项失败：`)
  for (const name of failures) console.log(`  - ${name}`)
  console.log(`临时目录保留在 ${root}`)
  process.exitCode = 1
} else {
  console.log(`全部 ${passed} 项通过`)
  rmSync(root, { recursive: true, force: true })
}
