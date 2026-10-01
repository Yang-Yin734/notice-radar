/**
 * CommonJS 兼容入口（腾讯云 SCF 的默认 Node 运行时更认 CJS 的 exports.main_handler）。
 * 逻辑就是转手给 ESM 入口，避免两处实现走偏。
 */
exports.main_handler = async function main_handler(event, context) {
  const mod = await import('./handler.mjs');
  return mod.handler(event, context);
};

exports.handler = exports.main_handler;
