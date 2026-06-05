# Web Code

在 Web 上获得与本地终端一样的编程能力。

## 部署

WASM 产物体积较大，不会提交到 Git 仓库。每次 `main` 分支构建成功后，GitHub Actions 会创建一个 Release，标签形如 `build-<workflow-run-id>`，并上传以下 zip：

| 文件 | 内容 |
|------|------|
| `webcode-static.zip` | 站点公共文件：`_headers`、`index.html`、`instances.json`、`sw.js`、`shared/`、`flush/` |
| `webcode-claude-code.zip` | Claude Code 终端实例 |
| `webcode-cursor-cli.zip` | Cursor CLI 终端实例 |
| `webcode-opencode.zip` | OpenCode 终端实例 |

（若新增容器，Release 中会出现对应的 `webcode-<id>.zip`。）

### 使用方法

1. 打开 [Releases](https://github.com/xiaoheiCat/webcode/releases)，选择最新一次构建（`build-*` 标签）。
2. 下载该 Release 下的**全部** `webcode-*.zip`。
3. 新建一个空文件夹，将**所有 zip 解压到同一文件夹**（不要分子目录存放）。
4. 将该文件夹作为静态站点根目录托管即可，例如上传到 Cloudflare Pages、Nginx、或任意静态文件服务。

解压后目录结构应类似：

```
_headers
index.html
instances.json
sw.js
shared/
flush/
claude-code/
cursor-cli/
opencode/
```

### 本地预览

需要支持 COOP/COEP 头（SharedArrayBuffer）。`python -m http.server` 不支持 `_headers`，请使用 Cloudflare Pages 或：

```bash
npx wrangler pages dev dist
```

### 本地构建

```bash
bash scripts/build-dist.sh          # 全量构建到 dist/
bash scripts/build-dist.sh release-zips release   # 打包为 webcode-*.zip
```
