// 文本切片：按段落聚合，目标 500 字符、重叠 100 字符
export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 100;

export function splitIntoChunks(text) {
  const paragraphs = text.split(/\r?\n\s*\r?\n|\r?\n/).map(p => p.trim()).filter(Boolean);

  // 先把超长段落硬切成不超过 CHUNK_SIZE 的块
  const units = [];
  for (const p of paragraphs) {
    if (p.length <= CHUNK_SIZE) {
      units.push(p);
    } else {
      for (let i = 0; i < p.length; i += CHUNK_SIZE) {
        units.push(p.slice(i, i + CHUNK_SIZE));
      }
    }
  }

  // 聚合相邻单元到接近 CHUNK_SIZE
  const chunks = [];
  let buf = '';
  for (const u of units) {
    if (buf && (buf.length + u.length + 1) > CHUNK_SIZE) {
      chunks.push(buf);
      // 携带尾部重叠开始新块
      buf = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP)) + '\n' + u;
      while (buf.length > CHUNK_SIZE) {
        chunks.push(buf.slice(0, CHUNK_SIZE));
        buf = buf.slice(CHUNK_SIZE - CHUNK_OVERLAP);
      }
    } else {
      buf = buf ? buf + '\n' + u : u;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}
