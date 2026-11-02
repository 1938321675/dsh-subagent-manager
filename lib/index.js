/**
 * dsh-subagent-manager — 子代理会话管理插件。
 *
 * 宿主侧：
 * - 扫描 ~/.dsh/sessions 下所有子代理会话（origin === "subagent"）
 * - 按 label 归类，提供按类型批量删除
 * - 经 webServer 暴露 /api/dsh-subagent-manager/* 接口
 *
 * 安全约束：
 * - 只处理 origin === "subagent" 的会话，主会话永不进入删除候选
 * - 删除前校验 label 与 id 的对应关系
 * - 删除时同步清理投影缓存与 workspace 残留引用
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const PROJCACHE_ROOT = join(DSH_HOME, 'storages', 'session_projcache', 'sessions')
const WORKSPACE_FILE = join(DSH_HOME, 'storages', 'workspace.json')

const API_PREFIX = '/api/dsh-subagent-manager'
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 从 subagent/descriptor 事件里抓 label 字段（捕获组为 JSON 转义后的原文）。 */
const LABEL_PATTERN = /"type":"subagent\/descriptor"[^}]*"label":"((?:[^"\\]|\\.)*)"/

/** 解压会话日志的第一帧（头行）。 */
function readHeaderFrame(buf) {
  const next = buf.indexOf(ZSTD_MAGIC, 4)
  const frame = next === -1 ? buf : buf.subarray(0, next)
  return zstdDecompressSync(frame).toString('utf8')
}

/** 解压整份会话日志（多帧 zstd 拼接）。 */
function readWholeLog(buf) {
  let cursor = 0
  const offsets = []
  while ((cursor = buf.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
    offsets.push(cursor)
    cursor += 4
  }
  if (offsets.length === 0) {
    try {
      return zstdDecompressSync(buf).toString('utf8')
    } catch {
      return ''
    }
  }
  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i]
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
    try {
      parts.push(zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
    } catch {
      // 单帧损坏不影响其余帧
    }
  }
  return parts.join('')
}

/** 会话文件路径（会话目录内以 session.v*.jsonl.zstd 命名）。 */
function locateLog(dirPath) {
  let names
  try {
    names = readdirSync(dirPath)
  } catch {
    return undefined
  }
  const name = names.find((n) => n.startsWith('session.v') && n.endsWith('.zstd'))
  return name === undefined ? undefined : join(dirPath, name)
}

/**
 * 从日志里取 subagent/descriptor 的 label。
 *
 * 日志可能很大（上兆字节），label 通常出现在开头几帧内，
 * 因此先解前若干帧，找到即停；找不到再退化为全文扫描。
 */
function readLabel(logPath, headerFrame) {
  try {
    const buf = readFileSync(logPath)
    let cursor = 0
    const offsets = []
    while ((cursor = buf.indexOf(ZSTD_MAGIC, cursor)) !== -1) {
      offsets.push(cursor)
      cursor += 4
      if (offsets.length > 6) break
    }
    const parts = [headerFrame]
    for (let i = 0; i < offsets.length; i += 1) {
      const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
      try {
        parts.push(zstdDecompressSync(buf.subarray(offsets[i], end)).toString('utf8'))
      } catch {
        // 单帧损坏不影响其余
      }
      const matched = LABEL_PATTERN.exec(parts.join(''))
      if (matched !== null) return JSON.parse(`"${matched[1]}"`)
    }
    if (offsets.length <= 6) return '(无 label)'
    // 长日志且前几帧没命中，再扫全文
    const matched = LABEL_PATTERN.exec(readWholeLog(buf) || headerFrame)
    return matched === null ? '(无 label)' : JSON.parse(`"${matched[1]}"`)
  } catch {
    return '(无 label)'
  }
}
/**
 * 扫描全部子代理会话。
 * @returns 每个子代理的类型、大小、创建时间、父会话等。
 */
function scanSubagents() {
  const items = []
  let workspaces
  try {
    workspaces = readdirSync(SESSIONS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return items
  }

  for (const wsEntry of workspaces) {
    const wsPath = join(SESSIONS_ROOT, wsEntry.name)
    let sessionDirs
    try {
      sessionDirs = readdirSync(wsPath, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }

    for (const dir of sessionDirs) {
      const sessionDir = join(wsPath, dir.name)
      const logPath = locateLog(sessionDir)
      if (logPath === undefined) continue

      let header
      let headerFrame
      let size
      try {
        size = statSync(logPath).size
        headerFrame = readHeaderFrame(readFileSync(logPath))
        header = JSON.parse(headerFrame.split('\n')[0])
      } catch {
        continue
      }

      // 只收子代理，主会话一律跳过
      if (header.origin !== 'subagent') continue

      const label = readLabel(logPath, headerFrame)
      let parentLive = false

      const parentId = header.parentSession
      if (typeof parentId === 'string') {
        // 父会话目录是否还在任一工作区下
        parentLive = workspaces.some((ws) => existsSync(join(SESSIONS_ROOT, ws.name, parentId)))
      }

      items.push({
        id: dir.name,
        label,
        size,
        createdAt: header.createdAt ?? 0,
        cwd: header.cwd ?? '',
        parentId: parentId ?? null,
        parentLive,
        workspaceDir: wsEntry.name
      })
    }
  }

  items.sort((a, b) => b.createdAt - a.createdAt)
  return items
}

/** 按 label 聚合成类型。 */
function groupByLabel(items) {
  const groups = new Map()
  for (const item of items) {
    let group = groups.get(item.label)
    if (group === undefined) {
      group = { label: item.label, count: 0, bytes: 0, orphanCount: 0, ids: [] }
      groups.set(item.label, group)
    }
    group.count += 1
    group.bytes += item.size
    if (!item.parentLive) group.orphanCount += 1
    group.ids.push(item.id)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.bytes - a.bytes)
}

/** 删除前二次校验：确认这些 id 确实都是子代理会话。 */
function assertAllSubagent(ids) {
  const bad = []
  for (const id of ids) {
    let found = false
    let ok = false
    for (const ws of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
      if (!ws.isDirectory()) continue
      const sessionDir = join(SESSIONS_ROOT, ws.name, id)
      if (!existsSync(sessionDir)) continue
      found = true
      const logPath = locateLog(sessionDir)
      if (logPath !== undefined) {
        try {
          const header = JSON.parse(readHeaderFrame(readFileSync(logPath)).split('\n')[0])
          ok = header.origin === 'subagent'
        } catch {
          ok = false
        }
      }
      break
    }
    if (!found || !ok) bad.push(id)
  }
  return bad
}

/** 删除一个子代理会话：日志目录 + 投影缓存。 */
function removeSessionFiles(id) {
  let removedDir = false
  for (const ws of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const sessionDir = join(SESSIONS_ROOT, ws.name, id)
    if (!existsSync(sessionDir)) continue
    rmSync(sessionDir, { recursive: true, force: true })
    removedDir = true
    break
  }
  const cacheFile = join(PROJCACHE_ROOT, `${id}.json`)
  let removedCache = false
  if (existsSync(cacheFile)) {
    rmSync(cacheFile, { force: true })
    removedCache = true
  }
  return { removedDir, removedCache }
}

/** 从 workspace.json 摘掉引用（子代理本不在成员里，主要清归档集）。 */
function pruneWorkspaceRefs(ids) {
  const set = new Set(ids)
  let touched = 0
  try {
    const doc = JSON.parse(readFileSync(WORKSPACE_FILE, 'utf8'))
    const before =
      doc.global.archivedSessionIds.length + doc.global.pinnedSessionIds.length
    doc.global.archivedSessionIds = doc.global.archivedSessionIds.filter((id) => !set.has(id))
    doc.global.pinnedSessionIds = doc.global.pinnedSessionIds.filter((id) => !set.has(id))
    for (const ws of Object.values(doc.tables.workspaces)) {
      ws.sessionIds = ws.sessionIds.filter((id) => !set.has(id))
    }
    const after = doc.global.archivedSessionIds.length + doc.global.pinnedSessionIds.length
    touched = before - after
    const tmp = join(dirname(WORKSPACE_FILE), `.subagent-purge-${Date.now()}.tmp`)
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
    renameSyncSafe(tmp, WORKSPACE_FILE)
  } catch {
    // workspace.json 由宿主内存权威，写不进去就留给宿主自重算
  }
  return touched
}

function renameSyncSafe(from, to) {
  try {
    renameSync(from, to)
  } catch {
    // 宿主可能正持有该文件；放弃写回，接受下次启动自重算
    rmSync(from, { force: true })
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  response.end(JSON.stringify(value))
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 1 << 20) return
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => resolve(null))
  })
}

const inject = ['webServer']

function apply(ctx) {
  ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const route = url.pathname.slice(API_PREFIX.length)

      try {
        if (route === '/list' && request.method === 'GET') {
          const items = scanSubagents()
          sendJson(response, 200, {
            ok: true,
            total: items.length,
            bytes: items.reduce((sum, i) => sum + i.size, 0),
            groups: groupByLabel(items),
            items
          })
          return
        }

        if (route === '/delete' && request.method === 'POST') {
          const body = await readJsonBody(request)
          const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : []
          if (ids.length === 0) {
            sendJson(response, 400, { ok: false, error: 'ids 不能为空' })
            return
          }
          // 二次校验：只允许删子代理
          const bad = assertAllSubagent(ids)
          if (bad.length > 0) {
            sendJson(response, 403, {
              ok: false,
              error: `拒绝删除：${bad.length} 个 id 不是子代理会话`,
              rejected: bad
            })
            return
          }
          let dirs = 0
          let caches = 0
          const failed = []
          for (const id of ids) {
            try {
              const r = removeSessionFiles(id)
              if (r.removedDir) dirs += 1
              if (r.removedCache) caches += 1
            } catch (error) {
              failed.push({ id, error: String(error?.message ?? error) })
            }
          }
          const prunedRefs = pruneWorkspaceRefs(ids)
          sendJson(response, 200, {
            ok: true,
            requested: ids.length,
            dirsRemoved: dirs,
            cachesRemoved: caches,
            prunedRefs,
            failed
          })
          return
        }

        sendJson(response, 404, { ok: false, error: 'unknown route' })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    }
  })
}

export { apply, inject }
