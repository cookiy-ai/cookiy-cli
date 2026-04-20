# 贴入 `Cookiy Skill & MCP 维护手册.md` §7.x

> 这段是为 Obsidian 维护手册准备的草稿，建议插在 §7.3（npm `cookiy-mcp` 发版）**之后**，作为一个独立小节 `§7.3a npm cookiy-cli 发版`。

---

## 7.3a npm `cookiy-cli` 发版

**源码位置：** `/Users/yupeng/Downloads/cookiy/cookiy-cli`（GitHub: `cookiy-ai/cookiy-cli`，npm: [`cookiy-cli`](https://www.npmjs.com/package/cookiy-cli)）。

**对外用户入口：**

```bash
npx cookiy-cli <command>          # 推荐，免安装
npm install -g cookiy-cli         # 全局安装后可直接 cookiy <command>
npm update -g cookiy-cli          # 升级全局安装
```

### 7.3a.1 什么改动需要重新发 npm

跟 `cookiy-mcp` 不同，`cookiy-cli` **没有 SEA 二进制 / Homebrew formula / skill-assets** 链路，所以触发点更少：

| 改动 | 需要重发 |
|---|---|
| `src/**/*.ts` 任意文件 | ✅ 必须 |
| `src/help.ts`（用户看到的 `cookiy help` 文本） | ✅ 必须 |
| `src/config.ts` 的 `VERSION` 常量 | ✅ 必须（发版时强制同步 bump） |
| `package.json`（版本/依赖/bin） | ✅ 必须 |
| `README.md`（npm 页面展示） | ⚠️ 仅影响 npm 页 README；若只改这个可以和其它改动一起发，不必单独发 |
| `tsconfig.json` / `tsup.config.ts` | ⚠️ 只在构建行为变化时（目标 Node 版本、输出格式）才重发 |
| `LICENSE` | ❌ 不重发 |

### 7.3a.2 发版命令

```bash
cd /Users/yupeng/Downloads/cookiy/cookiy-cli

# 1) 版本号 bump（同时修改 package.json）
npm version patch --no-git-tag-version          # 或 minor / major

# 2) 手动同步 src/config.ts 的 VERSION = "<new>"（必须，CLI 输出的 --version 从这里取）

# 3) 本地验证链
npm run typecheck
npm run build
node dist/index.js --version                    # 核对输出等于新版号
node dist/index.js help | head -5               # 冒烟测试

# 4) 包内容预览 & 发布
npm pack --dry-run                              # 应只包含 LICENSE / README.md / dist/index.js / package.json
npm publish --access public

# 5) git 同步
git add package.json package-lock.json src/config.ts
git commit -m "release: v<new>"
git tag v<new>
git push --tags
git push
```

### 7.3a.3 发布后复核

```bash
# 从 npm registry 验证（走 npx 冷启动，能发现 bin/shebang/打包问题）
npx --yes cookiy-cli@<new> --version
npx --yes cookiy-cli@<new> help | head -20

# 如果用户曾 npm install -g，提醒他们：
npm update -g cookiy-cli
```

### 7.3a.4 与 Skill 仓的关系

- `user-research-skill` 仓里所有 CLI 示例形如 `npx cookiy-cli <command>`。**Skill 仓不用跟着 cookiy-cli 发版**，除非这次 CLI 发版**改了面向用户的命令形状**（新增/重命名/删除 subcommand 或 flag）。
- 如果命令形状有变，按 §5 流程把 `references/cookiy/*.md` 里的示例同步更新，再 push `user-research-skill`（这一条走 §6.1，跟 GitHub 走、不用发 npm）。

### 7.3a.5 版本号策略

- 跟随 `cookiy-mcp` **独立** 版本号，两者不联动（MCP 线改 server contract 时不自动触发 CLI 发版）。
- 当前首个 npm 版本 `1.21.0` 承接了原 `scripts/cookiy.sh` / `cookiy.js` 的版本号，保证历史延续。之后按 semver：
  - patch：bugfix / 错误信息微调 / 内部重构
  - minor：新增 subcommand / flag；不破坏现有调用
  - major：删除 subcommand / flag，或改变 JSON 输出形状

### 7.3a.6 `cookiy-cli` 与 `cookiy-mcp` 的边界

- `cookiy-cli` 只是一个 MCP tool 的**命令行调用器**；它内部仍然通过 `/mcp` JSON-RPC endpoint 与服务端对话，但**不对外暴露 "MCP" 字样**（所有 help / README / error / env 变量名都用 `cookiy-cli` / `COOKIY_API_*`）。
- MCP tool contract 变更（增删工具、改参数）时：
  - 一定要更新 `cookiy-cli`（否则 `study list --limit 10` 会给用户报 RPC error）
  - 此时 `cookiy-cli` 需要重发 npm
  - `cookiy-mcp` 也需要重发（它是另一个用户入口）

### 7.3a.7 当前状态快照（首次发版记录）

- **2026-04-20**：`cookiy-cli@1.21.0` 首发 npm（TypeScript + commander，zero-runtime-dep 打包为 30 KB ESM）。
- **同期** `user-research-skill` 仓执行 PR #39：删除 `references/cookiy/scripts/cookiy.sh`，所有示例改为 `npx cookiy-cli`。PR #38（Node.js 中间态）已关闭。
