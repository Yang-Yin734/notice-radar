/**
 * 生成「学校目录」与「按校拆分的数据文件」。
 *
 * 为什么要它：网页版和应用要在设置里让用户**选学校、搜学校**，并且选中后立刻换成那所学校的通知。
 * 这要求数据按学校分开、且有一个可搜索的目录 —— 但**不碰抓取与推送链路**：
 * 本脚本只是把已发布的 docs/dashboard-data.json 重新组织一遍（数据从哪来不变）。
 *
 * 产出：
 *   docs/data/schools/index.json        学校目录（校名/城市/拼音/简称/学院列表/状态）
 *   docs/data/schools/<学校id>.json     该校的通知（按学院/栏目分组）
 *
 * 状态只有两种，且**不撒谎**：
 *   active  = 真抓过、能出通知（目前只有电子科技大学）
 *   pending = 只是目录条目，选中会明确提示"尚未接入"并给出接入指引
 *
 * 用法：node tools/build-schools.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(repo, 'docs', 'dashboard-data.json');
const outDir = path.join(repo, 'docs', 'data', 'schools');

/**
 * 学校目录（第一批只有 uestc 是 active）。
 * 格式：id|校名|城市|拼音|简称
 * pending 的学校只是"名字与检索词"，不代表能抓到 —— 接入要先写配置（见 docs/add-your-school.md）。
 */
const DIRECTORY = `
uestc|电子科技大学|成都|dianzikejidaxue|dzkjdx
tsinghua|清华大学|北京|qinghuadaxue|qhdx
pku|北京大学|北京|beijingdaxue|bjdx
ruc|中国人民大学|北京|zhongguorenmindaxue|zgrmdx
buaa|北京航空航天大学|北京|beijinghangkonghangtiandaxue|bjbhhkhtdx
bit|北京理工大学|北京|beijingligongdaxue|bjlgdx
bnu|北京师范大学|北京|beijingshifandaxue|bjsfdx
cau|中国农业大学|北京|zhongguonongyedaxue|zgnydx
bucm|北京中医药大学|北京|beijingzhongyiyaodaxue|bjzyydx
bfsu|北京外国语大学|北京|beijingwaiguoyudaxue|bjwgydx
uibe|对外经济贸易大学|北京|duiwaijingjimaoyidaxue|dwjjmydx
cufe|中央财经大学|北京|zhongyangcaijingdaxue|zycjdx
bupt|北京邮电大学|北京|beijingyoudiandaxue|bjyddx
bjtu|北京交通大学|北京|beijingjiaotongdaxue|bjjtdx
ustb|北京科技大学|北京|beijingkejidaxue|bjkjdx
bjut|北京工业大学|北京|beijinggongyedaxue|bjgydx
nankai|南开大学|天津|nankaidaxue|nkdx
tju|天津大学|天津|tianjindaxue|tjdx
hebut|河北工业大学|天津|hebeigongyedaxue|hbgydx
hit|哈尔滨工业大学|哈尔滨|haerbingongyedaxue|hebgydx
hrbeu|哈尔滨工程大学|哈尔滨|haerbingongchengdaxue|hebgcdx
neau|东北农业大学|哈尔滨|dongbeinongyedaxue|dbnydx
dlut|大连理工大学|大连|dalianligongdaxue|dllgdx
neu|东北大学|沈阳|dongbeidaxue|dbdx
jlu|吉林大学|长春|jilindaxue|jldx
neaucc|东北师范大学|长春|dongbeishifandaxue|dbsfdx
fudan|复旦大学|上海|fudandaxue|fddx
sjtu|上海交通大学|上海|shanghaijiaotongdaxue|shjtdx
tongji|同济大学|上海|tongjidaxue|tjdx
ecnu|华东师范大学|上海|huadongshifandaxue|hdsfdx
ecust|华东理工大学|上海|huadongligongdaxue|hdlgdx
dhu|东华大学|上海|donghuadaxue|dhdx
shufe|上海财经大学|上海|shanghaicaijingdaxue|shcjdx
shisu|上海外国语大学|上海|shanghaiwaiguoyudaxue|shwgydx
nju|南京大学|南京|nanjingdaxue|njdx
seu|东南大学|南京|dongnandaxue|dndx
nuaa|南京航空航天大学|南京|nanjinghangkonghangtiandaxue|njhkhkhtdx
njust|南京理工大学|南京|nanjingligongdaxue|njlgdx
hhu|河海大学|南京|hehaidaxue|hhdx
njau|南京农业大学|南京|nanjingnongyedaxue|njnydx
cpu|中国药科大学|南京|zhongguoyaokedaxue|zgykdx
njupt|南京邮电大学|南京|nanjingyoudiandaxue|njyddx
zju|浙江大学|杭州|zhejiangdaxue|zjdx
hdu|杭州电子科技大学|杭州|hangzhoudianzikejidaxue|hzdzkjdx
zjut|浙江工业大学|杭州|zhejianggongyedaxue|zjgydx
ustc|中国科学技术大学|合肥|zhongguokexuejishudaxue|zgkxjsdx
hfut|合肥工业大学|合肥|hefeigongyedaxue|hfgydx
ahu|安徽大学|合肥|anhuidaxue|ahdx
xmu|厦门大学|厦门|xiamendaxue|xmdx
fzu|福州大学|福州|fuzhoudaxue|fzdx
fjtcm|福建中医药大学|福州|fujianzhongyiyaodaxue|fjzyydx
jnu|暨南大学|广州|jinandaxue|jndx
scut|华南理工大学|广州|huananligongdaxue|hnlgdx
sysu|中山大学|广州|zhongshandaxue|zsdx
scau|华南农业大学|广州|huanannongyedaxue|hnnydx
gdut|广东工业大学|广州|guangdonggongyedaxue|gdgydx
szu|深圳大学|深圳|shenzhendaxue|szdx
sustech|南方科技大学|深圳|nanfangkejidaxue|nfkjdx
hust|华中科技大学|武汉|huazhongkejidaxue|hzkjdx
whu|武汉大学|武汉|wuhandaxue|whdx
cug|中国地质大学|武汉|zhongguodizhidaxue|zgdzdx
ccnu|华中师范大学|武汉|huazhongshifandaxue|hzsfdx
wut|武汉理工大学|武汉|wuhanligongdaxue|whlgdx
znufe|中南财经政法大学|武汉|zhongnancaijingzhengfadaxue|zncjzfdx
hbut|湖北工业大学|武汉|hubeigongyedaxue|hbgydx
csu|中南大学|长沙|zhongnandaxue|zndx
hnu|湖南大学|长沙|hunandaxue|hndx
nudt|国防科技大学|长沙|guofangkejidaxue|gfkjdx
hunnu|湖南师范大学|长沙|hunanshifandaxue|hnsfdx
zzu|郑州大学|郑州|zhengzhoudaxue|zzdx
henu|河南大学|开封|henandaxue|hndx
sdu|山东大学|济南|shandongdaxue|sddx
ouc|中国海洋大学|青岛|zhongguohaiyangdaxue|zghydx
upc|中国石油大学|青岛|zhongguoshiyoudaxue|zgsydx
qdu|青岛大学|青岛|qingdaodaxue|qddx
ncu|南昌大学|南昌|nanchangdaxue|ncdx
jxufe|江西财经大学|南昌|jiangxicaijingdaxue|jxcjdx
cqc|重庆大学|重庆|chongqingdaxue|cqdx
swu|西南大学|重庆|xinandidaxue|xndx
cqut|重庆理工大学|重庆|chongqingligongdaxue|cqlgdx
scu|四川大学|成都|sichuandaxue|scdx
swjtu|西南交通大学|成都|xinanjiaotongdaxue|xnjtdx
swufe|西南财经大学|成都|xinandacaijingdaxue|xndcjdx
cdut|成都理工大学|成都|chengduligongdaxue|cdlgdx
sicau|四川农业大学|雅安|sichuannongyedaxue|scnydx
xidian|西安电子科技大学|西安|xidiandianzikejidaxue|xddzkjdx
xjtu|西安交通大学|西安|xianjiaotongdaxue|xajtdx
nwpu|西北工业大学|西安|xibeigongyedaxue|xbgydx
nwu|西北大学|西安|xibeidaxue|xbdx
snnu|陕西师范大学|西安|shanxishifandaxue|sxsfdx
chd|长安大学|西安|changanndaxue|cadx
lzu|兰州大学|兰州|lanzhoudaxue|lzdx
xjau|新疆大学|乌鲁木齐|xinjiangdaxue|xjdx
ynu|云南大学|昆明|yunnandaxue|yndx
kmust|昆明理工大学|昆明|kunmingligongdaxue|kmlgdx
gzu|贵州大学|贵阳|guizhoudaxue|gzdx
gxu|广西大学|南宁|guangxidaxue|gxdx
hnu2|海南大学|海口|hainandaxue|hndx
nmgdx|内蒙古大学|呼和浩特|neimenggudaxue|nmgdx
nxu|宁夏大学|银川|ningxiadaxue|nxdx
qhu|青海大学|西宁|qinghaidaxue|qhdx
xza|西藏大学|拉萨|xizangdaxue|xzdx
swpu|西南石油大学|成都|xinanshiyoudaxue|xnsydx
sues|上海工程技术大学|上海|shanghaigongchengjishudaxue|shgcjsdx
shu|上海大学|上海|shanghaidaxue|shdx
usst|上海理工大学|上海|shanghailigongdaxue|shlgdx
njtech|南京工业大学|南京|nanjinggongyedaxue|njgydx
njuat|南京信息工程大学|南京|nanjingxinxigongchengdaxue|njxxgcdx
jiangnan|江南大学|无锡|jiangnandaxue|jndx
suda|苏州大学|苏州|suzhoudaxue|szdx
yzu|扬州大学|扬州|yangzhoudaxue|yzdx
ujs|江苏大学|镇江|jiangsudaxue|jsdx
hznu|杭州师范大学|杭州|hangzhoushifandaxue|hzsfdx
zafu|浙江农林大学|杭州|zhejiangnonglindaxue|zjnldx
wzu|温州大学|温州|wenzhoudaxue|wzdx
ahu2|安徽师范大学|芜湖|anhuishifandaxue|ahsfdx
hfuu|合肥学院|合肥|hefeixueyuan|hfxy
fafu|福建农林大学|福州|fujiannonglindaxue|fjnldx
jmu|集美大学|厦门|jimeidaxue|jmdx
gdufs|广东外语外贸大学|广州|guangdongwaiyuwaimaodaxue|gdw ywmdx
gzhu|广州大学|广州|guangzhoudaxue|gzdx
scnu|华南师范大学|广州|huananshifandaxue|hnsfdx
dgut|东莞理工学院|东莞|dongguanligongxueyuan|dglgxy
guet|桂林电子科技大学|桂林|guilindianzikejidaxue|gldzkjdx
gxnu|广西师范大学|桂林|guangxishifandaxue|gxsfdx
hainanu|海南师范大学|海口|hainanshifandaxue|hnsfdx
hnust|湖南科技大学|湘潭|hunankejidaxue|hnkjdx
csuft|中南林业科技大学|长沙|zhongnanlinyekejidaxue|znlykjdx
hpu|河南理工大学|焦作|henanligongdaxue|hnlgdx
haust|河南科技大学|洛阳|henankejidaxue|hnkjdx
sdust|山东科技大学|青岛|shandongkejidaxue|sdkjdx
sdut|山东理工大学|淄博|shandongligongdaxue|sdlgdx
qau|青岛农业大学|青岛|qingdaonongyedaxue|qdnydx
tyut|太原理工大学|太原|taiyuanligongdaxue|tylgdx
sxu|山西大学|太原|shanxidaxue|sxdx
nuc|中北大学|太原|zhongbeidaxue|zbdx
imut|内蒙古工业大学|呼和浩特|neimenggugongyedaxue|nmggydx
lntu|辽宁工程技术大学|阜新|liaoninggongchengjishudaxue|lngcjsdx
syau|沈阳农业大学|沈阳|shenyangnongyedaxue|synydx
dlnu|大连民族大学|大连|dalianminzudaxue|dlmzdx
jlau|吉林农业大学|长春|jilinnongyedaxue|jlnydx
ccut|长春工业大学|长春|changchungongyedaxue|ccgydx
hrbeu2|东北林业大学|哈尔滨|dongbeilinyedaxue|dblydx
hlju|黑龙江大学|哈尔滨|heilongjiangdaxue|hljdx
xaut|西安理工大学|西安|xianligongdaxue|xalgdx
xust|西安科技大学|西安|xiankejidaxue|xakjdx
xaau|西安航空学院|西安|xianhangkongxueyuan|xahkxy
gsau|甘肃农业大学|兰州|gansunongyedaxue|gsnydx
lzjtu|兰州交通大学|兰州|lanzhoujiaotongdaxue|lzjtdx
nxmu|宁夏医科大学|银川|ningxiayikedaxue|nxykdx
qhu2|青海师范大学|西宁|qinghaishifandaxue|qhsfdx
ynau|云南农业大学|昆明|yunnannongyedaxue|ynnydx
gznc|贵州师范大学|贵阳|guizhoushifandaxue|gzsfdx
`.trim();

const rows = DIRECTORY.split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [id, name, city, pinyin, abbr] = line.split('|').map((s) => s.trim());
    return { id, name, city, pinyin, abbr };
  });

// 学院/栏目：配置里的源名是「教务处·重要公告」这种，取 `·` 前那段作为归属单位
function unitOf(sourceName) {
  const head = String(sourceName ?? '').split('·')[0]?.trim();
  return head || '其它';
}

/**
 * 从配置里取该校**全部**学院/栏目。
 * 为什么必须这么做：学院列表如果只从"已有条目"里推，那么某个栏目当前 0 条（很常见，
 * 比如研究生院近期没发通知）就会从选择列表里消失 —— 用户就选不到它了。
 * 所以以配置为准：配置里有这个源，就必须能选。
 */
function unitsFromConfig(schoolId) {
  const file = path.join(repo, 'config', 'schools', `${schoolId}.yaml`);
  if (!fs.existsSync(file)) return [];
  const cfg = parseYaml(fs.readFileSync(file, 'utf8'));
  const names = [];
  for (const s of cfg.sources ?? []) {
    const unit = unitOf(s.name ?? s.id);
    if (!names.includes(unit)) names.push(unit);
  }
  return names;
}

function build() {
  if (!fs.existsSync(dataFile)) throw new Error(`找不到 ${dataFile}，先跑 node src/cli.ts dashboard`);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  // ---- 已接入的学校：按 school 分组，再按学院/栏目分组 ----
  const bySchool = new Map();
  for (const item of data.items ?? []) {
    const sid = item.school || 'unknown';
    if (!bySchool.has(sid)) bySchool.set(sid, []);
    bySchool.get(sid).push(item);
  }

  const activeSchools = [];
  for (const [sid, items] of bySchool) {
    const meta = rows.find((r) => r.id === sid) ?? { id: sid, name: sid, city: '', pinyin: '', abbr: '' };
    const units = [];
    // 先按配置把所有学院/栏目铺上（哪怕当前 0 条），保证"选得到"
    for (const name of unitsFromConfig(sid)) {
      units.push({ id: name, name, sources: [], count: 0 });
    }
    for (const item of items) {
      const unitName = unitOf(item.sourceName);
      let unit = units.find((u) => u.name === unitName);
      if (!unit) {
        unit = { id: unitName, name: unitName, sources: [], count: 0 };
        units.push(unit);
      }
      if (item.sourceName && !unit.sources.includes(item.sourceName)) unit.sources.push(item.sourceName);
      unit.count += 1;
    }
    units.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));

    const file = `${sid}.json`;
    fs.writeFileSync(
      path.join(outDir, file),
      `${JSON.stringify(
        {
          school: sid,
          name: meta.name,
          city: meta.city,
          generatedAt: data.generatedAt,
          total: items.length,
          units,
          items: items.map((it) => ({ ...it, unit: unitOf(it.sourceName) })),
        },
        null,
        1,
      )}\n`,
    );
    activeSchools.push({
      id: sid,
      name: meta.name,
      city: meta.city,
      pinyin: meta.pinyin,
      abbr: meta.abbr,
      status: 'active',
      file,
      units: units.map((u) => ({ id: u.id, name: u.name, count: u.count })),
      total: items.length,
      updatedAt: data.generatedAt,
    });
  }

  // ---- 目录：active 的用真实统计覆盖，其余保持 pending（只有名字与检索词）----
  const activeIds = new Set(activeSchools.map((s) => s.id));
  const schools = [
    ...activeSchools,
    ...rows
      .filter((r) => !activeIds.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        pinyin: r.pinyin,
        abbr: r.abbr,
        status: 'pending',
        file: null,
        units: [],
        total: 0,
        updatedAt: null,
      })),
  ];

  fs.writeFileSync(
    path.join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        generatedAt: data.generatedAt,
        note:
          'status=active 表示真抓过、能出通知；pending 只是目录条目，选中会提示尚未接入。' +
          '接入方法见 docs/add-your-school.md',
        counts: {
          total: schools.length,
          active: activeSchools.length,
          pending: schools.length - activeSchools.length,
        },
        schools,
      },
      null,
      1,
    )}\n`,
  );

  return { schools, activeSchools };
}

const { schools, activeSchools } = build();
const stat = fs.statSync(path.join(outDir, 'index.json'));
console.log(`✓ docs/data/schools/index.json（${schools.length} 所学校，其中已接入 ${activeSchools.length} 所，${(stat.size / 1024).toFixed(0)} KB）`);
for (const s of activeSchools) {
  console.log(`  · ${s.name}（${s.id}）：${s.total} 条，学院/栏目 ${s.units.length} 个 → ${s.units.map((u) => `${u.name}(${u.count})`).join('、')}`);
}
console.log(`  · 其余 ${schools.length - activeSchools.length} 所标为 pending（灰显 + 接入指引）`);
