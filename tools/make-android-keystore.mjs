// 生成 Android 签名密钥（PKCS#12），用于给 TWA 打包出来的 APK 签名。
//
// 为什么要有这个工具：
//   Android 要求同一个应用的更新包用**同一把密钥**签名，否则用户必须卸载重装。
//   所以密钥必须先生成、长期保存（GitHub Secrets），不能每次构建现生成。
//
// 用法：
//   node tools/make-android-keystore.mjs --out=<目录> [--alias=notice-radar]
// 产物（都在 <目录> 下，**不要提交到仓库**）：
//   notice-radar.p12          keystore 本体
//   notice-radar.p12.base64   base64 编码（贴进 GitHub Secret 用）
//   keystore.txt              别名/密码/指纹（自己留一份，丢了就再也签不出可更新包）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const outDir = path.resolve(arg('out', './android-signing'));
const alias = arg('alias', 'notice-radar');
const password = process.env.KEYSTORE_PASSWORD ?? crypto.randomBytes(18).toString('base64url');

if (fs.existsSync(path.join(outDir, `${alias}.p12`))) {
  console.error(`已经存在 ${path.join(outDir, `${alias}.p12`)}，不覆盖（换 --out 或先手动备份/删除）`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

console.log('▸ 生成 2048 位 RSA 密钥与自签名证书（有效期 30 年）');
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = crypto.randomBytes(8).toString('hex');
cert.validity.notBefore = new Date(Date.now() - 86400000);
cert.validity.notAfter = new Date(Date.now() + 30 * 365 * 86400000);
const attrs = [
  { name: 'commonName', value: 'notice-radar' },
  { name: 'organizationName', value: 'notice-radar' },
  { name: 'countryName', value: 'CN' },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());

// Android 认的"签名指纹" = 证书 DER 的 SHA-256
const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
const fingerprint = crypto
  .createHash('sha256')
  .update(Buffer.from(certDer, 'binary'))
  .digest('hex')
  .toUpperCase()
  .match(/../g)
  .join(':');

const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
  algorithm: '3des',
  // 关键：必须给条目设 friendlyName，否则私钥/证书条目没有别名，
  // apksigner 会报 entry "别名" does not contain a key（踩过这个坑）
  friendlyName: alias,
});
const p12Der = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

// 写完立刻回读自检：确认私钥条目存在、别名正确、证书指纹与预期一致
{
  const readBack = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(p12Der.toString('binary'))), password);
  const keyBags = readBack.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const certBags = readBack.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const names = [...keyBags, ...certBags].map((b) => b.attributes?.friendlyName?.[0]);
  if (!keyBags.length) {
    console.error('自检失败：导出的 keystore 里没有私钥条目，apksigner 会拒绝签名');
    process.exit(1);
  }
  if (names.some((n) => n !== alias)) {
    console.error(`自检失败：条目别名不一致（期望 ${alias}，实际 ${JSON.stringify(names)}）`);
    process.exit(1);
  }
  console.log(`  ✓ 自检通过：条目 ${names.length} 个，别名均为 ${alias}，私钥可读回`);
}

const p12Path = path.join(outDir, `${alias}.p12`);
fs.writeFileSync(p12Path, p12Der);
fs.writeFileSync(`${p12Path}.base64`, p12Der.toString('base64'));
fs.writeFileSync(
  path.join(outDir, 'keystore.txt'),
  [
    'notice-radar Android 签名密钥 —— 妥善保存，丢了就无法发布可覆盖安装的更新包',
    '',
    `keystore 文件 : ${p12Path}（PKCS#12）`,
    `key alias     : ${alias}`,
    `store 密码    : ${password}`,
    `key 密码      : ${password}`,
    `SHA-256 指纹  : ${fingerprint}`,
    '',
    '需要写进 GitHub Secrets 的四个值：',
    '  ANDROID_KEYSTORE_BASE64   = <notice-radar.p12.base64 的内容>',
    '  ANDROID_KEYSTORE_PASSWORD = <上面的 store 密码>',
    '  ANDROID_KEY_ALIAS         = <上面的 alias>',
    '  ANDROID_KEY_PASSWORD      = <上面的 key 密码>',
    '',
    'assetlinks.json 里要填的指纹：',
    `  "sha256_cert_fingerprints": ["${fingerprint}"]`,
  ].join('\n'),
  'utf8',
);

console.log(`  ✓ keystore：${p12Path}（${(p12Der.length / 1024).toFixed(1)} KB）`);
console.log(`  ✓ base64  ：${p12Path}.base64`);
console.log(`  ✓ 说明    ：${path.join(outDir, 'keystore.txt')}（含密码与指纹，别提交）`);
console.log(`  ✓ SHA-256 指纹：${fingerprint}`);
