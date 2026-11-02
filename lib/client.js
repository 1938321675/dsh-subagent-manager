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
      bar: { height: '6px', borderRadius: '999px', background: 'rgba(128,128,128,.22)', overflow: 'hidden' },
      barFill: function (pct) { return { height: '100%', width: pct + '%', background: 'var(--dsw-alias-state-business-primary, #4b7bec)' } }
    }

    function Group({ group, selected, onToggle, totalBytes }) {
      var pct = totalBytes > 0 ? Math.max(1, Math.round((group.bytes / totalBytes) * 100)) : 0
      return jsxs('div', {
        style: styles.card,
        children: [
          jsxs('div', {
            style: styles.row,
            children: [
              jsx('input', { type: 'checkbox', checked: selected, onChange: onToggle, style: { width: '15px', height: '15px', cursor: 'pointer' } }),
              jsx('div', { style: { ...styles.grow, display: 'flex', flexDirection: 'column', gap: '3px' }, children: [
                jsx('div', { style: styles.label, title: group.label, children: group.label }),
                jsxs('div', { style: styles.meta, children: [
                  group.count + ' 个 · ' + fmtBytes(group.bytes),
                  group.orphanCount > 0 ? ' · 其中 ' + group.orphanCount + ' 个父会话已删除' : ''
                ] })
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

      var load = useCallback(async function () {
        setPhase('loading')
        setError(null)
        try {
          var result = await callApi('/list')
          setData(result)
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
          await load()
        } catch (e) {
          setNotice({ kind: 'err', text: '删除失败：' + String(e && e.message ? e.message : e) })
        } finally {
          setBusy(false)
        }
      }, [selectedIds, selectedBytes, busy, load])

      if (phase === 'loading') {
        return jsx('div', { style: styles.page, children: jsx('div', { style: styles.empty, children: '正在扫描子代理会话…' }) })
      }

      if (phase === 'error') {
        return jsxs('div', { style: styles.page, children: [
          jsx('div', { style: styles.empty, children: '读取失败：' + error }),
          jsx('div', { style: styles.row, children: jsx('button', { style: styles.btn('primary'), onClick: load, children: '重试' }) })
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
              jsx('button', { style: styles.btn(), onClick: load, disabled: busy, children: '重新扫描' })
            ] })
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
                  totalBytes: data.bytes
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
