# 发布到 npm

发布后的用法：

```bash
npx notice-radar list          # 看内置学校预设
npx notice-radar schools       # 适配器市场（谁维护哪个学校）
npx notice-radar run           # 抓一次并推送
npx notice-radar stats         # 归档频次统计
npx notice-radar --help        # 全部命令
```

包名 `notice-radar`，同时提供两个可执行名：`notice-radar` 与 `radr`。

---

## 为什么包发的是编译后的 JS，而不是源码 TS

本仓库平时**不需要构建**：Node ≥22.18 能直接跑 `.ts`（类型剥离）。但**发布 npm 包不行**——
Node 明确拒绝对 `node_modules` 里的文件做类型剥离：

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]:
Stripping types is currently unsupported for files under node_modules
```

所以发布走一层编译：

```bash
npm run build     # tsc -p tsconfig.build.json → dist/，再补 shebang + 校验 import 后缀
```

- `tsconfig.build.json`：只编 `src`，`outDir: dist`
- 依赖 `rewriteRelativeImportExtensions`（TypeScript ≥5.7）：把 `import './x.ts'` 改写成 `import './x.js'`，
  否则产物里的 `.ts` 后缀会被 Node 拒绝（`tools/postbuild.mjs` 会自检这一点）
- `bin` 指向 `dist/cli.js`；`files` 只带 `dist` 与 `config`（学校预设、适配器登记表）
- `npm pack` 会先跑 `prepack`（= 构建），所以本地打出来的包一定是编译产物

> 想验证发布形态对不对，不必真的发到 npm：

```bash
npm pack                                   # 得到 notice-radar-x.y.z.tgz
npm install -g ./notice-radar-x.y.z.tgz --prefix /tmp/try
cd /tmp && /tmp/try/notice-radar list      # 换一个目录执行，验证包内路径解析
```

---

## 正式发布（需要一次你自己的 npm 凭据）

我（AI）没有你的 npm 账号，所以**这一步必须你来授权**。两种方式任选：

### 方式 A：交给 GitHub Actions（推荐，带 provenance 签名）

1. 到 npm 建一个 **Automation** 类型的 token：npm → Access Tokens → Generate New Token → Automation
2. 在 GitHub 仓库里加 secret：Settings → Secrets and variables → Actions → New repository secret
   - 名称 `NPM_TOKEN`，值就是上面那个 token
3. 触发发布：Actions → **publish-npm** → Run workflow
   - 想先演练：把 `dry-run` 保持为 true（只跑 `npm publish --dry-run`）
   - 正式发：`dry-run` 设为 false
   - 之后每次 push `v*` 标签也会自动发布

工作流会做：`npm ci` → `npm test` → 打包自检（确认 `dist/cli.ts`、学校预设、登记表都在包里）→ `npm publish --provenance`。

### 方式 B：本机手动发布

```bash
npm login                 # 用你的 npm 账号
npm publish --access public
```

`prepack` 会自动先构建，所以不会漏掉 `dist/`。

---

## 发布后建议做一次冒烟

```bash
npx notice-radar@latest --help
npx notice-radar@latest schools
```

如果 `npx` 报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，说明发布的包里带了 `.ts`
（`files`/`bin` 配错了）——这正是本项目踩过的坑，见上面的说明。

---

## 版本约定

- `package.json` 的 `version` 是唯一版本源：应用外壳（`docs/version.json`）与 TWA 工程的
  `appVersionName` 都由它派生（`radr dashboard` 与 `tools/twa-version.mjs`）
- 打 tag（`v0.6.0`）会同时触发：npm 发布、Android APK 构建（`android.yml`）
