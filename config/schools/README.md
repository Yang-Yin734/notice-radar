# config/schools：学校目录与抓取预设

这个目录里有两类东西，**别混**：

| 文件 | 谁写的 | 作用 |
|---|---|---|
| `directory.tsv` | 机器生成（教育部官方名单） | 全国 3167 所高校的权威名单：学校标识码 / 校名 / 省份 / 城市 / 层次 / 主管部门 / 备注 |
| `curated.json` | **人工维护** | 给重点高校一个短 id 与拼音、简称（其余学校的 id 就是学校标识码） |
| `uestc.yaml`、`uestc-math.yaml` | 人工维护 | 真正干活的东西：某校各栏目的抓取预设（选择器、节奏、推送分级） |
| `registry.json` | 人工维护 | 适配器市场登记：谁维护哪个学校的预设、状态与最后验证日期 |

选校功能读的是 `directory.tsv` + `curated.json` 生成出来的 `docs/data/schools/index.json`；
抓取只用 `*.yaml`。**目录再全也不等于能抓** —— 只有写了预设、真抓过、能出通知的学校才会被标成
`active`（目前只有电子科技大学）。

## `directory.tsv` 的来源与刷新

- 来源页面：<https://hudong.moe.gov.cn/jyb_xxgk/s5743/s5744/202506/t20250627_1195683.html>
  （教育部《全国高等学校名单》，**截至 2025 年 6 月 20 日**）
- 页面公布的总数：全国高等学校 **3167** 所 ＝ 普通高校 2919（**本科 1365** + 高职专科 1554）+ 成人高校 248
- 教育部每年更新一次名单。刷新步骤（**本机跑，CI 不需要**；产物提交进仓库）：

```bash
# 需要随 DSH 捆绑的 LibreOffice Kit 把官方 .xls 转成 CSV
node tools/moe-refresh.mjs \
  --kit="D:\DSH desktop new\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\libreoffice-kit\lib\cli.js" \
  --node="D:\DSH desktop new\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
```

脚本会自己抓页面、下两个附件、转换、解析，并**与页面公布的总数逐项对账**：
对不上就直接失败退出，不会把错的名单写进仓库。

> 沙箱提示：转换那一步是 LibreOffice 起子进程，在 DSH 的文件沙箱里会被拒（`spawn EPERM`），
> 需要在放开沙箱的终端里跑一次。

### 列的含义

| 列 | 说明 |
|---|---|
| `code` | 学校标识码（10 位，官方唯一，例如电子科技大学 `4151010614`） |
| `name` | 校名（官方写法，含「（武汉）」这类校区后缀） |
| `province` | 省份（来自官方名单的分组标题，直辖市就是市名） |
| `city` | 城市（来自「所在地」列；直辖市与成人高校可能为空） |
| `level` | `本科` / `专科` / `成人` |
| `authority` | 主管部门（教育部 / 某某省 / 某某省教育厅…） |
| `note` | 官方备注，主要是 `民办` |

### 已知不包含什么

- **军队院校**（如国防科技大学）：教育部这份名单不收，需要另找来源。
- **港澳台高校**：同上，名单里明确写了"本名单未包含港澳台地区高等学校"。
- 所以"全国高校名单"的准确说法是：**大陆普通高校 + 成人高校**。

## `curated.json`：短 id 与拼音

应用里记住的"我选了哪所学校"用的是 id；数据文件名（`docs/data/schools/<id>.json`）也用它。
规则很简单：

- `curated.json` 里给了短 id（如 `uestc`）→ 用短 id
- 没给 → **id 就是学校标识码**（如 `4151010610`）

为什么要短 id：电子科技大学的数据文件名是 `uestc.json`，已经装到用户手机上的应用记的也是这个 ——
改掉它，老用户的选择就失效了。新增学校时不必纠结，直接留空用标识码即可。

给某校**接入抓取**时（见 [docs/add-your-school.md](../../docs/add-your-school.md)）：

1. 如果希望它有短 id / 拼音搜索，往 `curated.json` 的 `schools` 里加一条（`code` 必须与 `directory.tsv` 一致）；
2. 写 `config/schools/<id>.yaml` 预设（**文件名就用这个 id**，`build-schools.mjs` 靠它取学院列表）；
3. 到 `registry.json` 登记；
4. 抓过一轮后，`tools/build-schools.mjs` 会把这所学校自动标成 `active` 并生成数据文件 —— 不需要手工改状态。

## 数据是怎么核对过的

`directory.tsv` 由两条**互相独立**的解析路径产出过并逐字段比对（3167 行 × 6 个字段，零差异）：

- Python + openpyxl 读 LibreOffice 转出来的 `.xlsx`
- Node 直接解析 LibreOffice 转出来的 `.csv`（就是 `tools/moe-refresh.mjs` 里那条路径）

再加上 CI 里的 `tests/schools-directory.test.ts`：字段齐全、标识码唯一且为 10 位、
层次分布与教育部公布的数字**逐项相等**（1365 / 1554 / 248）、省份不少于 30 个。
