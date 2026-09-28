// 查看 Android 签名密钥（PKCS#12）里的别名、条目类型与证书 SHA-256 指纹。
//
// 为什么需要它：apksigner 报 "entry \"xxx\" does not contain a key" 时，
// 就是别名对不上（keyspace 里私钥和证书的 friendlyName 不一致）。用它看清楚再用对别名。
//
// 用法：node tools/inspect-android-keystore.mjs <keystore.p12> <密码>
//   密码也可以放到环境变量 KEYSTORE_PASSWORD 里，避免出现在命令历史里。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const forge = require('node-forge');

const file = process.argv[2];
const password = process.argv[3] ?? process.env.KEYSTORE_PASSWORD ?? '';
if (!file || !password) {
  console.error('用法：node tools/inspect-android-keystore.mjs <keystore.p12> <密码>');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`找不到文件：${file}`);
  process.exit(2);
}

const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(fs.readFileSync(file, 'binary'))), password);

console.log(`=== ${file} ===`);
for (const [type, bags] of Object.entries(p12.getBags({}))) {
  if (!bags?.length) continue;
  for (const bag of bags) {
    const friendly = bag.attributes?.friendlyName?.[0] ?? '(无 friendlyName)';
    const localKeyId = bag.attributes?.localKeyId?.[0]
      ? Buffer.from(bag.attributes.localKeyId[0], 'binary').toString('hex').slice(0, 16)
      : '(无)';
    console.log(`  ${type.padEnd(24)} alias=${friendly}  localKeyId=${localKeyId}`);
  }
}

const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
for (const bag of certBags) {
  const der = forge.pki.certificateToAsn1(bag.cert);
  const fp = crypto
    .createHash('sha256')
    .update(Buffer.from(forge.asn1.toDer(der).getBytes(), 'binary'))
    .digest('hex')
    .toUpperCase()
    .match(/../g)
    .join(':');
  console.log(`\n证书 SHA-256：${fp}`);
  console.log('（这个值要写进 docs/.well-known/assetlinks.json 的 sha256_cert_fingerprints）');
}
