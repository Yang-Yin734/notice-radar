# 适配器市场：谁维护哪个学校

这个项目的目标不是"支持尽可能多的学校"，而是**让每个学校都有一个人愿意负责**。
所以每个学校预设都要登记在册：谁维护、上次验证是什么时候、现在能不能用。

查看当前清单（命令行）：

```bash
npx notice-radar schools        # 或在仓库里：npm run schools
```

## 登记表在哪

[`config/schools/registry.json`](../config/schools/registry.json)：

```json
{
  "version": 1,
  "updatedAt": "2026-09-28",
  "schools": [
    {
      "id": "uestc",
      "name": "电子科技大学",
      "city": "成都",
      "presets": ["config/schools/uestc.yaml", "config/schools/uestc-math.yaml"],
      "sources": 6,
      "maintainers": ["Yang-Yin734"],
      "status": "verified",
      "lastVerified": "2026-09-28",
      "notes": "数学科学学院是瑞数 WAF，需要 --allow-browser"
    }
  ]
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `id` | 学校短名，小写字母/数字/连字符，与文件名一致 |
| `presets` | 该学校的预设文件（至少一个；第一个视为"主预设"） |
| `sources` | 主预设里的源数量——**会被 CI 校验**，改配置忘了更新登记就会红 |
| `maintainers` | GitHub 用户名，**不能为空**（没人负责的预设不该进市场） |
| `status` | `verified`（维护者近期跑通）/ `community`（社区提交未复核）/ `broken`（站点改版已失效） |
| `lastVerified` | `YYYY-MM-DD`，你最后一次真跑通它的日期 |

## CI 会拦住的三种情况

`tests/registry.test.ts` 每次 CI 都跑，以下情况直接失败：

1. **登记的预设文件不存在** —— 写了 `config/schools/xxx.yaml` 但没这个文件
2. **有"野生"预设** —— `config/schools/` 下有 `.yaml`，但登记表里没有它（没人知道谁维护）
3. **源数量对不上** —— `sources` 与主预设里的实际源数量不一致

这样"市场"不会慢慢和现实脱节。

## 加自己的学校

1. 按 [add-your-school.md](add-your-school.md) 写好预设（YAML，大多数学校不用写代码）
2. 在 `registry.json` 里加一条，`maintainers` 填你自己的 GitHub 用户名
3. `npm test` 跑一下，然后提 PR

预设本身能用、登记信息真实，就够了——不需要"完美支持"。

## 接手一个已失效的学校

`status: broken` 的条目欢迎任何人修：

1. 跑 `npx notice-radar doctor --config=config/schools/<学校>.yaml` 看是选择器过期还是站点结构变了
2. 用 `npx notice-radar fetch <url> --out=页面.html` 导出真实 DOM，改选择器
3. 把 `status` 改回 `verified`、`lastVerified` 改成今天、`maintainers` 加上你自己
