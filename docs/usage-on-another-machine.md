# 在另一台电脑上修改这个插件

这份说明针对的场景：仓库已经在 GitHub 上，换一台电脑拉下来改，改完推回去。两台电脑可能都在用 DSH，也可能只有一台在用。

## 一、新电脑的环境准备

### 1. 装 Git

`git --version` 能出版本号就够。Windows 上装 Git for Windows 即可。

### 2. 配置身份

提交流程会用到，配置一次全局生效：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

### 3. 配置 GitHub 认证

**方式 A：SSH（推荐，一次配好长期有效）**

先看有没有现成密钥：

```bash
ls ~/.ssh/id_ed25519.pub
```

没有就生成一个（邮箱换成自己的）：

```bash
ssh-keygen -t ed25519 -C "你的邮箱"
```

然后把公钥内容复制到 GitHub：

1. 打开 https://github.com/settings/keys
2. 点 **New SSH key**
3. Title 随便填，Key 粘贴 `~/.ssh/id_ed25519.pub` 的完整内容
4. 保存

验证：

```bash
ssh -T git@github.com
```

看到 `Hi 1938321675! You've successfully authenticated` 就成了。

**方式 B：HTTPS + PAT**

不想配 SSH 的话，用 classic PAT 走 HTTPS。生成方式见 https://github.com/settings/tokens，勾选 `repo` 和 `workflow`。首次 push 时 Git 会弹窗要账号密码，密码位置填 token。

## 二、克隆仓库

```bash
cd <你想放代码的目录>
git clone git@github.com:1938321675/dsh-subagent-manager.git
cd dsh-subagent-manager
```

## 三、在本机装上它（想在 DSH 里调试时）

克隆下来的是一坨源码文件，DSH 不会自动认。要让本机的 DSH 加载它，需要挂载：

### 1. 确定插件目录位置

DSH 会扫描 `<profile>/node_modules` 下的包名。推荐把仓库放在 `~/.dsh/` 下，与 profile 保持同级：

```
~/.dsh/
├── subagent-manager/          ← 你 clone 下来的
└── profiles/
    └── <profile 名>/
        ├── package.json
        ├── cordis.patch.yml
        └── node_modules/
```

**先确认你的 profile 叫什么**。一台机器上可能有多个，本文其余部分用 `desktop` 举例，换成你实际的即可：

```powershell
Get-ChildItem $HOME\.dsh\profiles -Directory | Select-Object Name
```

判断该改哪一个：看哪个目录的 `node_modules` 里装着你日常用的插件，或者哪个 `package.json` 里的 `dsh.profile.bundles` 更长。桌面客户端通常叫 `desktop`，纯网页部署常见 `web`。

### 2. 声明依赖

编辑 `~/.dsh/profiles/desktop/package.json`，在 `dependencies` 里加一行：

```json
"dsh-subagent-manager": "link:../../subagent-manager"
```

`link:` 的相对路径是相对于 `package.json` 所在目录。`../../` 从 `profiles/desktop/` 往上两级就是 `~/.dsh/`。

### 3. 建立链接

在 `node_modules` 下建一个指向仓库目录的链接：

**Windows（管理员 PowerShell 或开启开发者模式）**

```powershell
New-Item -ItemType SymbolicLink `
  -Path "$HOME\.dsh\profiles\desktop\node_modules\dsh-subagent-manager" `
  -Target "$HOME\.dsh\subagent-manager"
```

**macOS / Linux**

```bash
ln -s ~/.dsh/subagent-manager ~/.dsh/profiles/desktop/node_modules/dsh-subagent-manager
```

### 4. 挂载插件

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: subagent-manager
      name: 'dsh-subagent-manager'
      config: {}
```

注意缩进：`- insert:` 顶格，下面 `- id:` 缩进四格，`name:` / `config:` 再缩进两格。

### 5. 重启 DSH

重启后，设置左侧导航出现「子代理会话」。

### 6. 装完自检

挂载做没做对，跑一条命令就知道：

```bash
node docs/doctor.mjs
```

它会逐项检查 git、仓库结构、DSH 安装位置、目标 profile、依赖声明、符号链接、挂载条目、模块可加载性，以及客户端 `inject` 写法。每项失败都会跟一行修复提示。全部通过时退出码为 0。

如果前面某步拿不准，可以先跑这个脚本，它会告诉你缺什么。

## 四、日常改代码的循环

改完代码后：

```bash
git status              # 看改了什么
git diff                # 看具体改动
git add -A
git commit -m "一句话说明改了什么"
git push
```

推送成功后会看到 `main -> main` 之类的输出。

想立刻在 DSH 里看效果：**文件改了之后需要重启 DSH**。宿主侧的 `lib/index.js` 改完必须重启；浏览器侧的 `lib/client.js` 在开发模式下可能热重载，但改结构（新增组件、改注册逻辑）时重启最稳。

## 五、两台电脑同时改的注意事项

### 推送前先拉

另一台电脑可能已经推了新提交。养成习惯：

```bash
git pull
```

如果提示冲突，说明两边改了同一个文件的同一处。解决办法：

1. 打开冲突文件，搜索 `<<<<<<<`，你会看到三段：自己的改动、分隔线、对方的改动
2. 手动编辑成最终想要的样子，删掉 `<<<<<<<`、`=======`、`>>>>>>>` 这些标记行
3. `git add <冲突文件>`
4. `git commit`（不用带 -m，Git 会生成合并提交信息）

### 什么时候会有冲突

| 情况 | 结果 |
|---|---|
| 两边改不同文件 | 自动合并，不冲突 |
| 两边改同一文件不同位置 | 通常能自动合并 |
| 两边改同一文件同一行 | 冲突，需要手动处理 |

### 推送被拒怎么办

看到 `! [rejected] main -> main (fetch first)` 说明远程有新提交：

```bash
git pull
git push
```

## 六、常见问题

**`Permission denied (publickey)`**

SSH 密钥没配好。`ssh -T git@github.com` 会明确告诉你卡在哪一步。常见原因是公钥没加到 GitHub，或者密钥不在默认路径（需要在 `~/.ssh/config` 里指定）。

**`Authentication failed`**

HTTPS 方式下 token 错了或过期了。重新生成一个，Windows 上到「凭据管理器 → Windows 凭据」里把 `git:https://github.com` 那条删掉，下次 push 会重新询问。

**插件装了但 DSH 里看不到**

按顺序排查：

1. `node_modules/dsh-subagent-manager` 这个链接是否真的存在（`ls -la` 看它指向哪）
2. `cordis.patch.yml` 的缩进对不对（YAML 对缩进敏感）
3. 重启 DSH
4. 看 DSH 启动日志里有没有 `dsh-subagent-manager: pending` 之类的字样

**DSH 打不开、报 `1 entry did not activate`**

这是插件加载失败导致整个 web 启动被阻断。看报错里写的 `waiting for services` —— 如果列出的是 `@deepseek-ai/...` 这类包名，说明 `inject` 写错了：那里应该写 `ctx` 上暴露的服务名（如 `slots`、`locale`、`webServer`），不是包名。

应急恢复：把 `cordis.patch.yml` 里那条 insert 注释掉，重启 DSH 就能打开。
