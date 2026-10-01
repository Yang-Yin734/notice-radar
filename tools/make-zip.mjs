/**
 * 最小 ZIP 写入器（零依赖）。
 *
 * 为什么不用系统自带工具：Windows 上 Compress-Archive 和 .NET ZipFile.CreateFromDirectory
 * **都会把路径写成反斜杠**（实测 2070/2074 条），而云函数运行时是 Linux，
 * 解压后文件名里会带着字面量的反斜杠字符，代码目录直接找不到 —— 部署必失败。
 * 这个写入器自己控制条目名，一律用正斜杠，行为在 Windows/macOS/Linux 完全一致。
 *
 * 用法（命令行）：node tools/make-zip.mjs <源目录> <输出.zip>
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 递归列出文件（相对路径统一用 /） */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push({ full, name: path.relative(base, full).split(path.sep).join('/') });
    }
  }
  return out;
}

/** 把目录打包成 zip（条目名一律正斜杠）。返回条目数。 */
export function makeZip(srcDir, zipPath) {
  const files = listFiles(srcDir).sort((a, b) => (a.name < b.name ? -1 : 1));
  const chunks = [];
  const central = [];
  let offset = 0;

  // 固定一个时间戳，保证同样的输入产出同样的包（可复现）
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const file of files) {
    const data = fs.readFileSync(file.full);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // 压不动就存原始数据，别让包变大
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(file.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 需要的版本
    local.writeUInt16LE(0x0800, 6); // 标志位：文件名为 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4); // 生成方版本
    dir.writeUInt16LE(20, 6); // 需要的版本
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(dosTime, 12);
    dir.writeUInt16LE(dosDate, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // 内部属性
    // 注意 >>> 0：JS 的 << 结果是**有符号** 32 位，0o100644 << 16 会变成负数，
    // 直接传给 writeUInt32LE 会抛 ERR_OUT_OF_RANGE（这里踩过一次）
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // 外部属性：普通文件 0644
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
  return files.length;
}

// 允许直接当命令行用：node tools/make-zip.mjs <源目录> <输出.zip>
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error('用法：node tools/make-zip.mjs <源目录> <输出.zip>');
    process.exit(1);
  }
  const count = makeZip(path.resolve(src), path.resolve(out));
  console.log(`✓ ${out}（${count} 个条目，路径分隔符一律正斜杠）`);
}
