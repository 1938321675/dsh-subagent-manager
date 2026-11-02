# dsh-subagent-manager

DeepSeek Harness 的子代理会话管理插件：把磁盘上的子代理会话按类型归类，支持按类型批量删除。

## 背景

DSH 的会话目录里同时存着两类记录：

| 类型 | `origin` | 在侧栏可见 |
| --- | --- | --- |
| 主会话 | `main` | 是 |
| 子代理会话 | `subagent` | 否 |

子代理由各类插件在后台产生 —— 记忆维护、边聊线程、专家子任务、代码审查等。官方前端在 `sessionVisible()` 里直接返回 `false` 把子代理挡在列表外，因此它们不会出现在日常界面，只会随时间不断累积。

这些记录在设置页里没有入口，也无法在侧栏操作。本插件补上这个缺口。

## 功能

- 扫描 `$DSH_HOME/sessions` 下的全部子代理会话，按 `subagent/descriptor` 的 label 归类
- 列出每个类型的数量、占用空间、父会话已删除的孤儿数
- 勾选类型后批量删除，删除前弹二次确认
- 按类型名称实时筛选
- 删除时同步清理会话目录、投影缓存与 `workspace.json` 里的残留引用

## 安全约束

删除接口对每个 id 单独校验，只有同时满足以下条件才会执行：

1. 会话目录存在
2. 日志头 `origin === "subagent"`

主会话、不存在的 id 一律拒绝并返回清单。即使传入混合列表，也只删除通过校验的部分。

`workspace.json` 的写入采用临时文件加改名替换；若宿主正持有该文件，写入会放弃，由宿主下次启动时自行重算。

## 在另一台电脑上修改

跨电脑拉取、挂载、修改、推送的完整步骤见 [docs/usage-on-another-machine.md](docs/usage-on-another-machine.md)。

装完不确定有没有配好，跑：

```bash
node docs/doctor.mjs
```

逐项检查环境并给出修复提示，全部通过时退出码为 0。

> **给 AI 助手的提示**：用户如果让你在这台机器上安装或排查本插件，先跑 `node docs/doctor.mjs` 看结果，再按失败项的提示操作，比从头读文档更快。挂载涉及修改 DSH 的 profile 配置（`package.json` 的 `dependencies`、`cordis.patch.yml` 的 insert 条目），改完需要重启 DSH 才生效。

## 安装

插件以 `link:` 方式挂载，不经过包管理器：

```bash
# 1. 把本仓库放到 $DSH_HOME 下，例如
#    C:\Users\<你>\.dsh\subagent-manager

# 2. 在 profile 的 package.json 里声明依赖
#    "dsh-subagent-manager": "link:../../subagent-manager"

# 3. 在 node_modules 下建立链接（Windows 用 mklink /D，POSIX 用 ln -s）
#    目标指向仓库目录

# 4. 在 profile 的 cordis.patch.yml 末尾追加
#    - insert:
#        - id: subagent-manager
#          name: 'dsh-subagent-manager'
#          config: {}

# 5. 重启 DSH
```

重启后，设置页左侧导航出现「子代理会话」入口。

## 接口

宿主侧注册一个前缀路由 `/api/dsh-subagent-manager`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/list` | 返回总数、占用字节、类型分组与明细 |
| `POST` | `/delete` | body 形如 `{ "ids": ["...","..."] }`，返回删除统计 |

`/list` 响应结构：

```json
{
  "ok": true,
  "total": 701,
  "bytes": 40227840,
  "groups": [
    {
      "label": "Mnemon idle checkpoint review",
      "count": 614,
      "bytes": 40227840,
      "orphanCount": 0,
      "ids": ["..."]
    }
  ],
  "items": [
    {
      "id": "...",
      "label": "...",
      "size": 65536,
      "createdAt": 1793413812559,
      "cwd": "D:\\代码\\AIR1",
      "parentId": "...",
      "parentLive": true,
      "workspaceDir": "--D-~4EE3~7801-AIR1--"
    }
  ]
}
```

## 实现说明

### 日志是多帧 zstd 拼接

会话日志按 `0x28 0xB5 0x2F 0xFD` 切成多帧，每帧独立压缩。直接对整个文件调 `zstdDecompressSync` 只会解出第一帧（仅头行），必须按偏移切帧后逐帧解压再拼接。

### label 的读取做了短路

`subagent/descriptor` 事件通常在日志开头附近。读取时先解前若干帧，命中即停；只有长日志且前几帧未命中时才回退到全文扫描。这一步把扫描 700 个子代理的耗时从 9.1 秒降到 1.8 秒。

### 客户端 inject 写服务名

`inject` 列的是 `ctx` 上暴露的服务名，不是包名。本插件声明 `['slots', 'locale']`：`slots` 提供 `register` / `inject`，`locale` 提供 `bind`。写成包名（如 `@deepseek-ai/dsh-client-locale`）会让宿主一直等待该服务，导致 web boot 报 `1 entry did not activate`，DSH 无法启动。

## 目录结构

```
.
├── cordis.patch.yml     插件挂载声明
├── package.json         包元信息（含 dsh.bundle / dsh.client）
└── lib
    ├── index.js         宿主侧：扫描、删除、HTTP 接口
    └── client.js        浏览器侧：设置页面板
```

## 许可

MIT
