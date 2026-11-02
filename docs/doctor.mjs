#!/usr/bin/env node
/**
 * doctor.mjs — 检查本机是否具备运行/调试这个插件的条件。
 *
 * 设计意图：把「环境对不对」变成一条命令的输出，而不是让人对着文档
 * 一条条比对。每一行都说清检查了什么、结果如何、不对时该怎么修。
 *
 * 用法：
 *   node docs/doctor.mjs            只检查
 *   node docs/doctor.mjs --fix      检查并尝试修复能自动修的部分
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PROFILES_ROOT = join(DSH_HOME, 'profiles')
const PACKAGE_NAME = 'dsh-subagent-manager'

const results = []

function record(name, ok, detail, fixHint) {
  results.push({ name, ok, detail, fixHint })
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    ...opts
  }).trim()
}

// ── 1. git 可用 ────────────────────────────────────────────────
let gitOk = false
try {
  const version = run('git', ['--version'])
  record('git 可用', true, version)
  gitOk = true
} catch {
  record('git 可用', false, '未找到 git', '安装 Git 后重试')
}

// ── 2. 当前目录确实是本仓库 ─────────────────────────────────────
{
  const pkgPath = join(REPO_ROOT, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      record('仓库结构完整', pkg.name === PACKAGE_NAME, `package.json name = ${pkg.name}`)
    } catch (error) {
      record('仓库结构完整', false, 'package.json 解析失败：' + String(error.message))
    }
  } else {
    record('仓库结构完整', false, '找不到 package.json', '确认在仓库根目录下运行')
  }
}

// ── 3. DSH 安装位置 ────────────────────────────────────────────
let profiles = []
if (existsSync(PROFILES_ROOT)) {
  profiles = readdirSync(PROFILES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  record('DSH 已安装', true, `找到 ${profiles.length} 个 profile：${profiles.join(', ') || '(无)'}`)
} else {
  record('DSH 已安装', false, `找不到 ${PROFILES_ROOT}`, '先安装并至少启动一次 DSH')
}

// ── 4. 挑选目标 profile ────────────────────────────────────────
function pickProfile() {
  let best
  let bestCount = -1
  for (const name of profiles) {
    const nm = join(PROFILES_ROOT, name, 'node_modules')
    if (!existsSync(nm)) continue
    let count = 0
    try {
      count = readdirSync(nm, { withFileTypes: true }).length
    } catch {
      continue
    }
    if (count > bestCount) {
      bestCount = count
      best = name
    }
  }
  return best
}

const profile = pickProfile()
if (profile !== undefined) {
  record('目标 profile', true, `选中 "${profile}"（node_modules 内容最多）`)
} else {
  record('目标 profile', false, '没有可用的 profile', '先启动一次 DSH，让它生成 profile 结构')
}

// ── 5. 依赖声明 ────────────────────────────────────────────────
const profileRoot = profile === undefined ? undefined : join(PROFILES_ROOT, profile)
if (profileRoot !== undefined) {
  const pkgPath = join(profileRoot, 'package.json')
  const relPath = '../../' + REPO_ROOT.split(/[\\/]/).pop()
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const declared = pkg.dependencies?.[PACKAGE_NAME]
      record(
        '依赖已声明',
        declared !== undefined,
        declared === undefined ? 'dependencies 里没有这一项' : `${PACKAGE_NAME} = ${declared}`,
        `在 ${pkgPath} 的 dependencies 里加入 "${PACKAGE_NAME}": "${relPath}"`
      )
    } catch (error) {
      record('依赖已声明', false, 'package.json 解析失败：' + String(error.message))
    }
  }
}

// ── 6. 符号链接 ────────────────────────────────────────────────
if (profileRoot !== undefined) {
  const linkPath = join(profileRoot, 'node_modules', PACKAGE_NAME)
  let ok = false
  let detail = '链接不存在'
  if (existsSync(linkPath)) {
    try {
      const real = run('node', ['-e', `console.log(require('fs').realpathSync(${JSON.stringify(linkPath)}))`])
      ok = resolve(real) === resolve(REPO_ROOT)
      detail = ok ? `指向 ${real}` : `指向 ${real}，与仓库目录 ${REPO_ROOT} 不一致`
    } catch {
      detail = '存在但无法解析'
    }
  }
  record(
    '符号链接正确',
    ok,
    detail,
    `创建链接：node_modules\\${PACKAGE_NAME} → ${REPO_ROOT}`
  )
}

// ── 7. cordis.patch.yml 挂载条目 ───────────────────────────────
if (profileRoot !== undefined) {
  const patchPath = join(profileRoot, 'cordis.patch.yml')
  let ok = false
  let detail = '找不到 cordis.patch.yml'
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, 'utf8')
    const hasEntry = text.includes(PACKAGE_NAME)
    const disabled = new RegExp(`-\\s*id:\\s*subagent-manager[\\s\\S]{0,200}?disabled:\\s*true`).test(text)
    ok = hasEntry && !disabled
    detail = !hasEntry ? '没有挂载条目' : disabled ? '有条目但被 disabled' : '挂载条目就绪'
  }
  record('挂载条目', ok, detail, `在 ${patchPath} 末尾追加 insert 条目`)
}

// ── 8. 插件模块能否加载 ────────────────────────────────────────
{
  const entry = join(REPO_ROOT, 'lib', 'index.js')
  if (!existsSync(entry)) {
    record('宿主端可加载', false, '找不到 lib/index.js')
  } else {
    try {
      const out = run('node', [
        '-e',
        `import(${JSON.stringify(pathToFileURL(entry).href)}).then(m=>console.log(JSON.stringify(Object.keys(m)))).catch(e=>{console.error(e.message);process.exit(1)})`
      ])
      record('宿主端可加载', true, '导出 ' + out)
    } catch (error) {
      record('宿主端可加载', false, String(error.stderr ?? error.message).trim().split('\n')[0])
    }
  }
}

// ── 9. 客户端 inject 是否写成服务名 ────────────────────────────
{
  const clientPath = join(REPO_ROOT, 'lib', 'client.js')
  if (!existsSync(clientPath)) {
    record('客户端 inject', false, '找不到 lib/client.js')
  } else {
    const text = readFileSync(clientPath, 'utf8')
    const matched = /var inject = \[([^\]]*)\]/.exec(text)
    const raw = matched === null ? '' : matched[1]
    const bad = raw.includes('@deepseek-ai/')
    record(
      '客户端 inject',
      matched !== null && !bad,
      matched === null ? '找不到 inject 声明' : `[${raw}]`,
      'inject 应写 ctx 上的服务名（slots、locale 等），写成包名会让 DSH 启动失败'
    )
  }
}

// ── 输出 ──────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
console.log('')
console.log('DSH 插件环境自检')
console.log('仓库目录: ' + REPO_ROOT)
console.log('DSH home: ' + DSH_HOME)
console.log('')

for (const r of results) {
  const mark = r.ok ? '[ OK ]' : '[FAIL]'
  console.log(`${mark} ${r.name}：${r.detail}`)
  if (!r.ok && r.fixHint !== undefined) console.log(`         → ${r.fixHint}`)
}

console.log('')
if (failed.length === 0) {
  console.log('全部通过。重启 DSH 后，设置页左侧应出现「子代理会话」。')
  process.exit(0)
}
console.log(`${failed.length} 项待处理，按上面的箭头提示逐项修复。`)
process.exit(1)
