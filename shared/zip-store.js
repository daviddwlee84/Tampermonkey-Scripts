/**
 * 最小的 ZIP writer：只做 STORE（不壓縮），給「Markdown + 圖片」這種打包用。
 *
 *   // @require https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/shared/zip-store.js
 *
 *   const blob = ZipStore.build([
 *     { name: 'note.md', data: '# hi' },              // string 會用 UTF-8 編碼
 *     { name: 'images/01.png', data: uint8Array },
 *   ]);
 *
 * 不壓縮是刻意的：圖片本來就壓過，省下的只有 Markdown 那一點；換來零相依、程式碼短。
 * 檔名設 UTF-8 旗標（general purpose bit 11），中文檔名在 macOS／Windows 才不會變亂碼。
 * 不支援 ZIP64，單檔與總大小都要小於 4 GiB。不碰 DOM、不呼叫任何 GM API。
 */
const ZipStore = (() => {
  'use strict';
  const encoder = new TextEncoder();

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /** MS-DOS 時間格式；ZIP 只認 1980 年以後。 */
  function dosDateTime(date) {
    const year = Math.max(date.getFullYear(), 1980);
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  // 不用 instanceof：頁面 fetch 回來的 buffer 可能屬於另一個 realm（manager sandbox、iframe）。
  function toBytes(data) {
    if (typeof data === 'string') return encoder.encode(data);
    if (ArrayBuffer.isView(data))
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]')
      return new Uint8Array(data);
    throw new TypeError('ZipStore: data 必須是 string、Uint8Array 或 ArrayBuffer');
  }

  /** @returns {Uint8Array} 完整的 .zip 內容 */
  function bytes(entries, { date = new Date() } = {}) {
    const { time, date: day } = dosDateTime(date);
    const seen = new Set();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encoder.encode(String(entry.name).replace(/^\/+/, ''));
      if (!name.length) throw new Error('ZipStore: 檔名不能是空的');
      if (seen.has(entry.name)) throw new Error(`ZipStore: 檔名重複 ${entry.name}`);
      seen.add(entry.name);
      const data = toBytes(entry.data);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 檔名
      local.setUint16(8, 0, true); // STORE
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true); // central directory signature
      // version made by：host 標成 Unix（3）。標 MS-DOS 的話 Info-ZIP 會無視 UTF-8 旗標、用 OEM code page 解檔名。
      record.setUint16(4, (3 << 8) | 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, 0x0800, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, time, true);
      record.setUint16(14, day, true);
      record.setUint32(16, crc, true);
      record.setUint32(20, data.length, true);
      record.setUint32(24, data.length, true);
      record.setUint16(28, name.length, true);
      record.setUint32(38, 0o100644 << 16, true); // external attributes：一般檔案 rw-r--r--
      record.setUint32(42, offset, true); // 其餘欄位（extra、comment）都是 0
      central.push(new Uint8Array(record.buffer), name);

      offset += 30 + name.length + data.length;
    }

    const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((sum, chunk) => sum + chunk.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function build(entries, options) {
    return new Blob([bytes(entries, options)], { type: 'application/zip' });
  }

  return Object.freeze({ build, bytes, crc32 });
})();
