window.__ModuleLoader__.load({
  id: 'dsh-subagent-manager',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var jsxRuntime = require('react/jsx-runtime')
    var jsx = jsxRuntime.jsx
    var jsxs = jsxRuntime.jsxs

    var ReactHooks = React
    var useState = ReactHooks.useState
    var useEffect = ReactHooks.useEffect
    var useMemo = ReactHooks.useMemo
    var useCallback = ReactHooks.useCallback

    var h = React.createElement

    var API = '/api/dsh-subagent-manager'

    function fmtBytes(n) {
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(2) + ' MB'
    }

    function fmtDate(ms) {
      if (!ms) return '-'
      var d = new Date(ms)
      var p = function (v) { return String(v).padStart(2, '0') }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    /** 服务端配置 → 可编辑草稿。 */
    function draftFromConfig(cfg) {
      return {
        enabled: cfg.enabled === true,
        labels: (cfg.labels || []).slice(),
        retentionDays: cfg.retentionDays,
        cleanAt: cfg.cleanAt
      }
    }

    /** 两次配置是否等价，用于决定「保存设置」按钮是否可点。 */
    function sameConfig(a, b) {
      if (!a || !b) return true
      return a.enabled === b.enabled &&
        a.retentionDays === b.retentionDays &&
        a.cleanAt === b.cleanAt &&
        a.labels.slice().sort().join('\u0000') === b.labels.slice().sort().join('\u0000')
    }

    /** 「上次清理」那一行文字。 */
    function lastRunText(cfg, retentionDays) {
      var head = '保留 ' + retentionDays + ' 天'
      if (!cfg || !cfg.lastResult) return head + ' · 还没执行过自动清理'
      var r = cfg.lastResult
      var scope = r.trigger === 'manual' ? '手动' : '定时'
      if (r.error) return head + ' · 上次' + scope + '清理失败：' + r.error
      return head + ' · 上次' + scope + '清理 ' + fmtDate(r.at) + '：删除 ' + r.removed + ' 个（' + fmtBytes(r.bytes) + '）' +
        (r.failed > 0 ? '，' + r.failed + ' 个失败' : '')
    }

    async function callApi(path, init) {
      var res = await fetch(API + path, init)
      var body = await res.json().catch(function () { return null })
      if (!res.ok || (body && body.ok === false)) {
        var msg = (body && body.error) || ('HTTP ' + res.status)
        throw new Error(msg)
      }
      return body
    }

    var styles = {
      page: { padding: '4px 0 24px', display: 'flex', flexDirection: 'column', gap: '14px' },
      hero: { display: 'flex', flexDirection: 'column', gap: '6px' },
      title: { fontSize: '20px', fontWeight: 600, margin: 0 },
      muted: { fontSize: '13px', opacity: 0.72, margin: 0, lineHeight: '20px' },
      card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.24))', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      grow: { flex: 1, minWidth: 0 },
      label: { fontSize: '14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      meta: { fontSize: '12px', opacity: 0.68 },
      btn: function (kind) {
        var base = { fontSize: '13px', padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))', cursor: 'pointer', background: 'transparent', color: 'inherit' }
        if (kind === 'danger') { base.borderColor = 'rgba(220,80,80,.5)'; base.color = 'rgb(214,84,84)' }
        if (kind === 'primary') { base.background = 'var(--dsw-alias-state-business-primary, #4b7bec)'; base.borderColor = 'transparent'; base.color = '#fff' }
        return base
      },
      input: { fontSize: '13px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28))', background: 'transparent', color: 'inherit', outline: 'none', minWidth: '220px' },
      empty: { fontSize: '13px', opacity: 0.6, padding: '20px 0', textAlign: 'center' },
      chip: function (on) {
        return {
          fontSize: '12px',
          padding: '3px 10px',
          borderRadius: '999px',
          cursor: 'pointer',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          border: '1px solid ' + (on ? 'transparent' : 'var(--dsw-alias-border-l2, rgba(128,128,128,.28))'),
          background: on ? 'var(--dsw-alias-state-business-primary, #4b7bec)' : 'transparent',
          color: on ? '#fff' : 'inherit'
        }
      },

      bar: { height: '6px', borderRadius: '999px', background: 'rgba(128,128,128,.22)', overflow: 'hidden' },
      barFill: function (pct) { return { height: '100%', width: pct + '%', background: 'var(--dsw-alias-state-business-primary, #4b7bec)' } }
    }

    function Group({ group, selected, onToggle, totalBytes, autoClean, retentionDays, onToggleAuto }) {
      var pct = totalBytes > 0 ? Math.max(1, Math.round((group.bytes / totalBytes) * 100)) : 0
      var meta = group.count + ' 个 · ' + fmtBytes(group.bytes)
      if (group.orphanCount > 0) meta += ' · 其中 ' + group.orphanCount + ' 个父会话已删除'
      if (group.expiredCount > 0) meta += ' · 超过 ' + retentionDays + ' 天的有 ' + group.expiredCount + ' 个（' + fmtBytes(group.expiredBytes) + '）'
      return jsxs('div', {
        style: styles.card,
        children: [
          jsxs('div', {
            style: styles.row,
            children: [
              jsx('input', { type: 'checkbox', checked: selected, onChange: onToggle, style: { width: '15px', height: '15px', cursor: 'pointer' } }),
              jsx('div', { style: { ...styles.grow, display: 'flex', flexDirection: 'column', gap: '3px' }, children: [
                jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }, children: [
                  jsx('div', { style: styles.label, title: group.label, children: group.label }),
                  jsx('button', {
                    style: styles.chip(autoClean),
                    title: autoClean ? '点击移出自动清理' : '点击纳入自动清理',
                    onClick: onToggleAuto,
                    children: '自动清理'
                  })
                ] }),
                jsx('div', { style: styles.meta, children: meta })
              ] }),
              jsx('div', { style: styles.bar, children: jsx('div', { style: styles.barFill(pct) }) })
            ]
          })
        ]
      })
    }

    function Panel(props) {
      var locale = props.t
      var [phase, setPhase] = useState('loading')
      var [error, setError] = useState(null)
      var [data, setData] = useState(null)
      var [selected, setSelected] = useState(function () { return new Set() })
      var [busy, setBusy] = useState(false)
      var [notice, setNotice] = useState(null)
      var [filter, setFilter] = useState('')
      var [draft, setDraft] = useState(null)
      var [cleanBusy, setCleanBusy] = useState(false)
      var [cleanNotice, setCleanNotice] = useState(null)

      // silent 为真时保留当前内容刷新，避免保存后整页闪回加载态
      var load = useCallback(async function (silent) {
        if (silent !== true) setPhase('loading')
        setError(null)
        try {
          var result = await callApi('/list')
          setData(result)
          // 草稿只在首次填一次，之后的「重新扫描」不覆盖未保存的编辑
          setDraft(function (prev) { return prev === null ? draftFromConfig(result.config) : prev })
          setPhase('ready')
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
          setPhase('error')
        }
      }, [])

      useEffect(function () { load() }, [load])

      var groups = useMemo(function () {
        if (!data) return []
        var q = filter.trim().toLowerCase()
        if (!q) return data.groups
        return data.groups.filter(function (g) { return g.label.toLowerCase().indexOf(q) !== -1 })
      }, [data, filter])

      var selectedIds = useMemo(function () {
        var ids = []
        for (var i = 0; i < groups.length; i += 1) {
          if (selected.has(groups[i].label)) ids = ids.concat(groups[i].ids)
        }
        return ids
      }, [groups, selected])

      var selectedBytes = useMemo(function () {
        var n = 0
        for (var i = 0; i < groups.length; i += 1) {
          if (selected.has(groups[i].label)) n += groups[i].bytes
        }
        return n
      }, [groups, selected])

      var toggle = useCallback(function (label) {
        setSelected(function (prev) {
          var next = new Set(prev)
          if (next.has(label)) next.delete(label)
          else next.add(label)
          return next
        })
      }, [])

      var doDelete = useCallback(async function () {
        if (selectedIds.length === 0 || busy) return
        var ok = window.confirm('将永久删除 ' + selectedIds.length + ' 个子代理会话（' + fmtBytes(selectedBytes) + '）。\n\n删除不可撤销，确定继续？')
        if (!ok) return
        setBusy(true)
        setNotice(null)
        try {
          var result = await callApi('/delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: selectedIds })
          })
          setNotice({ kind: 'ok', text: '已删除 ' + result.dirsRemoved + ' 个会话目录、' + result.cachesRemoved + ' 条缓存' + (result.prunedRefs > 0 ? '，清理 ' + result.prunedRefs + ' 条残留引用' : '') + (result.failed && result.failed.length ? '，' + result.failed.length + ' 个失败' : '') })
          setSelected(new Set())
          await load(true)
        } catch (e) {
          setNotice({ kind: 'err', text: '删除失败：' + String(e && e.message ? e.message : e) })
        } finally {
          setBusy(false)
        }
      }, [selectedIds, selectedBytes, busy, load])

      /** 草稿与服务端配置是否不一致。 */
      var dirty = useMemo(function () {
        if (!data || !draft) return false
        return !sameConfig(draft, data.config)
      }, [data, draft])

      var toggleAutoLabel = useCallback(function (label) {
        setDraft(function (prev) {
          if (prev === null) return prev
          var labels = prev.labels.slice()
          var at = labels.indexOf(label)
          if (at === -1) labels.push(label)
          else labels.splice(at, 1)
          return Object.assign({}, prev, { labels: labels })
        })
      }, [])

      /** 写回配置，返回服务端规范化后的结果。 */
      var pushConfig = useCallback(async function (next) {
        var result = await callApi('/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config: next })
        })
        setDraft(draftFromConfig(result.config))
        return result.config
      }, [])

      var saveConfig = useCallback(async function () {
        if (draft === null || cleanBusy) return
        setCleanBusy(true)
        setCleanNotice(null)
        try {
          var saved = await pushConfig(draft)
          setCleanNotice({
            kind: 'ok',
            text: saved.enabled
              ? '已保存：每天 ' + saved.cleanAt + ' 起清理最后活动时间超过 ' + saved.retentionDays + ' 天的已勾选类型'
              : '已保存：自动清理处于关闭状态'
          })
          await load(true)
        } catch (e) {
          setCleanNotice({ kind: 'err', text: '保存失败：' + String(e && e.message ? e.message : e) })
        } finally {
          setCleanBusy(false)
        }
      }, [draft, cleanBusy, pushConfig, load])

      var cleanNow = useCallback(async function () {
        if (draft === null || cleanBusy) return
        setCleanBusy(true)
        setCleanNotice(null)
        try {
          // 先按草稿保存，再清理，避免「改完没保存就点清理」用到旧设置
          if (!sameConfig(draft, data.config)) await pushConfig(draft)
          var preview = await callApi('/clean-now', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRun: true })
          })
          if (preview.candidates === 0) {
            setCleanNotice({ kind: 'ok', text: '按当前设置，没有超过保留期的会话' })
            return
          }
          var ok = window.confirm('将永久删除 ' + preview.candidates + ' 个过期子代理会话（' + fmtBytes(preview.bytes) + '）。\n\n删除不可撤销，确定继续？')
          if (!ok) return
          var result = await callApi('/clean-now', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRun: false })
          })
          setCleanNotice({
            kind: 'ok',
            text: '已删除 ' + result.dirsRemoved + ' 个会话（' + fmtBytes(result.bytes) + '）' + (result.failed.length > 0 ? '，' + result.failed.length + ' 个失败' : '')
          })
          await load(true)
        } catch (e) {
          setCleanNotice({ kind: 'err', text: '清理失败：' + String(e && e.message ? e.message : e) })
        } finally {
          setCleanBusy(false)
        }
      }, [draft, data, cleanBusy, pushConfig, load])

      if (phase === 'loading') {
        return jsx('div', { style: styles.page, children: jsx('div', { style: styles.empty, children: '正在扫描子代理会话…' }) })
      }

      if (phase === 'error') {
        return jsxs('div', { style: styles.page, children: [
          jsx('div', { style: styles.empty, children: '读取失败：' + error }),
          jsx('div', { style: styles.row, children: jsx('button', { style: styles.btn('primary'), onClick: function () { load() }, children: '重试' }) })
        ] })
      }

      return jsxs('div', {
        style: styles.page,
        children: [
          jsxs('div', { style: styles.hero, children: [
            jsx('h2', { style: styles.title, children: '子代理会话' }),
            jsx('p', { style: styles.muted, children: '这里汇总磁盘上的全部子代理会话（含 dsh-mnemon 的记忆维护、sidechat 线程、专家子任务等）。主会话不在本页范围。' })
          ] }),

          jsxs('div', { style: styles.card, children: [
            jsxs('div', { style: styles.row, children: [
              jsx('div', { style: { ...styles.grow, display: 'flex', gap: '18px', flexWrap: 'wrap' }, children: [
                jsxs('div', { children: [
                  jsx('div', { style: styles.meta, children: '子代理总数' }),
                  jsx('div', { style: { fontSize: '18px', fontWeight: 600 }, children: data.total })
                ] }),
                jsxs('div', { children: [
                  jsx('div', { style: styles.meta, children: '占用空间' }),
                  jsx('div', { style: { fontSize: '18px', fontWeight: 600 }, children: fmtBytes(data.bytes) })
                ] }),
                jsxs('div', { children: [
                  jsx('div', { style: styles.meta, children: '类型数' }),
                  jsx('div', { style: { fontSize: '18px', fontWeight: 600 }, children: data.groups.length })
                ] })
              ] }),
              jsx('button', { style: styles.btn(), onClick: function () { load() }, disabled: busy, children: '重新扫描' })
            ] })
          ] }),

          draft === null ? null : jsxs('div', { style: styles.card, children: [
            jsxs('div', { style: styles.row, children: [
              jsxs('div', { style: { ...styles.grow, display: 'flex', flexDirection: 'column', gap: '3px' }, children: [
                jsx('div', { style: { fontSize: '14px', fontWeight: 600 }, children: '自动清理' }),
                jsx('div', { style: styles.meta, children: '到点后删除已勾选类型中最后活动时间超过保留期的子会话' })
              ] }),
              jsxs('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }, children: [
                jsx('input', {
                  type: 'checkbox',
                  checked: draft.enabled,
                  style: { width: '15px', height: '15px', cursor: 'pointer' },
                  onChange: function () { setDraft(Object.assign({}, draft, { enabled: !draft.enabled })) }
                }),
                '启用'
              ] })
            ] }),

            jsxs('div', { style: styles.row, children: [
              jsx('span', { style: styles.meta, children: '保留' }),
              jsx('input', {
                type: 'number',
                min: 1,
                max: 3650,
                value: draft.retentionDays,
                style: Object.assign({}, styles.input, { minWidth: '80px', width: '90px' }),
                onChange: function (e) {
                  var n = parseInt(e.target.value, 10)
                  setDraft(Object.assign({}, draft, { retentionDays: isNaN(n) ? 1 : Math.min(3650, Math.max(1, n)) }))
                }
              }),
              jsx('span', { style: styles.meta, children: '天' }),
              jsx('span', { style: Object.assign({}, styles.meta, { marginLeft: '10px' }), children: '每天' }),
              jsx('input', {
                type: 'time',
                value: draft.cleanAt,
                style: Object.assign({}, styles.input, { minWidth: '110px', width: '120px' }),
                onChange: function (e) { setDraft(Object.assign({}, draft, { cleanAt: e.target.value })) }
              }),
              jsx('span', { style: styles.meta, children: '之后清理一次' })
            ] }),

            jsxs('div', { style: styles.row, children: [
              jsx('span', { style: Object.assign({}, styles.meta, { flex: 1, minWidth: '260px' }), children: '适用类型：已纳入 ' + draft.labels.length + ' 个。在下方类型条目上点「自动清理」标签增减，' + lastRunText(data.config, data.retentionDays) }),
              jsxs('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [
                jsx('button', {
                  style: styles.btn(),
                  onClick: function () { setDraft(Object.assign({}, draft, { labels: data.groups.map(function (g) { return g.label }) })) },
                  children: '全部纳入'
                }),
                jsx('button', {
                  style: styles.btn(),
                  onClick: function () { setDraft(Object.assign({}, draft, { labels: [] })) },
                  children: '全部移出'
                })
              ] })
            ] }),

            jsxs('div', { style: styles.row, children: [
              jsx('span', { style: Object.assign({}, styles.meta, { flex: 1, minWidth: '220px' }) }),
              jsxs('div', { style: { display: 'flex', gap: '8px' }, children: [
                jsx('button', {
                  style: Object.assign({}, styles.btn('primary'), dirty || cleanBusy ? {} : { opacity: 0.5 }),
                  onClick: saveConfig,
                  disabled: cleanBusy || !dirty,
                  children: dirty ? '保存设置' : '已保存'
                }),
                jsx('button', {
                  style: styles.btn('danger'),
                  onClick: cleanNow,
                  disabled: cleanBusy,
                  children: cleanBusy ? '执行中…' : '立即清理一次'
                })
              ] })
            ] }),
            cleanNotice === null ? null : jsx('div', {
              style: { fontSize: '13px', color: cleanNotice.kind === 'ok' ? 'inherit' : 'rgb(214,84,84)' },
              children: cleanNotice.text
            })
          ] }),

          jsxs('div', { style: styles.row, children: [
            jsx('input', {
              style: styles.input,
              placeholder: '按类型名称筛选…',
              value: filter,
              onChange: function (e) { setFilter(e.target.value) }
            }),
            jsx('span', { style: styles.meta, children: '共 ' + groups.length + ' 个类型' })
          ] }),

          jsxs('div', { style: styles.card, children: [
            jsxs('div', { style: styles.row, children: [
              jsx('div', { style: { ...styles.grow, display: 'flex', alignItems: 'center', gap: '8px' }, children: [
                jsx('input', {
                  type: 'checkbox',
                  style: { width: '15px', height: '15px', cursor: 'pointer' },
                  checked: groups.length > 0 && groups.every(function (g) { return selected.has(g.label) }),
                  onChange: function () {
                    var allOn = groups.every(function (g) { return selected.has(g.label) })
                    setSelected(allOn ? new Set() : new Set(groups.map(function (g) { return g.label })))
                  }
                }),
                jsx('span', { style: { fontSize: '13px' }, children: '全选当前筛选结果' })
              ] }),
              jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [
                jsx('span', { style: styles.meta, children: selectedIds.length > 0 ? ('已选 ' + selectedIds.length + ' 个 · ' + fmtBytes(selectedBytes)) : '未选择' }),
                jsx('button', {
                  style: Object.assign({}, styles.btn('danger'), selectedIds.length === 0 || busy ? { opacity: 0.45, cursor: 'default' } : {}),
                  disabled: selectedIds.length === 0 || busy,
                  onClick: doDelete,
                  children: busy ? '删除中…' : '删除选中'
                })
              ] })
            ] }),
            notice !== null && jsx('div', {
              style: { fontSize: '13px', color: notice.kind === 'ok' ? 'inherit' : 'rgb(214,84,84)' },
              children: notice.text
            })
          ] }),

          groups.length === 0
            ? jsx('div', { style: styles.empty, children: filter ? '没有匹配的类型' : '没有子代理会话' })
            : jsxs('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: groups.map(function (g) {
                return jsx(Group, {
                  group: g,
                  selected: selected.has(g.label),
                  onToggle: function () { toggle(g.label) },
                  totalBytes: data.bytes,
                  autoClean: draft !== null && draft.labels.indexOf(g.label) !== -1,
                  retentionDays: data.retentionDays,
                  onToggleAuto: function () { toggleAutoLabel(g.label) }
                }, g.label)
              }) })
        ]
      })
    }

    var NS = 'dsh-subagent-manager'

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        try {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'subagent-manager',
            order: 46,
            label: function () { return '子代理会话' },
            icon: 'layers',
            locale: NS
          }, Panel)
        } catch (e) {
          console.warn('dsh-subagent-manager: register settings.section failed:', e)
          return function () {}
        }
      })
    }

    // inject 列的是 ctx 上暴露的服务名，不是包名：slots 提供 register/inject，locale 提供 bind。
    var inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
