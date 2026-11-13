// أيقونة تطبيق Windows: قراءة، تحقّق، وتوليد حتمي.
//
// العيب الذي يغلقه هذا الملف: P01_WINDOWS_RESOURCE_ICON_MISSING.
// ‎tauri-build‎ على Windows يولّد ملف موارد ‎(.rc)‎ ويحتاج أيقونة ‎.ico‎ مملوكة
// للتطبيق. المستودع كان يملك ‎icons/icon.png‎ (علامة نجم الشمال 32×32) فقط،
// فتوقّف البناء. الإصلاح ليس إطفاء توليد الموارد، بل إنتاج الأصل الناقص من
// المصدر المعتمد نفسه، بلا مكتبة صور، وبنتيجة ثابتة البايتات.
//
// سياسة التكبير: المصدر 32×32 ولا يوجد مصدر متجهي أو أكبر في المستودع. لذلك
// الحجم 32 يُنسخ كما هو بكسلًا ببكسل، والأحجام الأكبر تكبير بأقرب جار فقط:
// لا تنعيم ولا تفاصيل مُختلَقة، والألوان والهندسة لا تتغيّر. الحجمان 16 و24
// تصغير بأقرب جار كذلك. مصدر أعلى دقة قيد مُسجَّل لا عيب مخفي.

import { deflateSync, inflateSync } from "node:zlib";

export const ICON_SIZES = Object.freeze([16, 24, 32, 48, 64, 128, 256]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------- PNG

/** جدول CRC32 كما يحدّده معيار PNG. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * يفكّ PNG من النوع الوحيد الذي نحتاجه: RGBA بعمق 8 بلا تشابك.
 * أي نوع آخر يُرفض صراحة بدل أن يُفكّ خطأً.
 */
export function decodeRgbaPng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("PNG_SIGNATURE_INVALID");
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (header === null) throw new Error("PNG_IHDR_MISSING");
  if (header.depth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(`PNG_UNSUPPORTED depth=${header.depth} colorType=${header.colorType} interlace=${header.interlace}`);
  }
  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`PNG_FILTER_UNKNOWN ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** يرمّز RGBA إلى PNG بمرشّح صفري ومستوى ضغط ثابت: البايتات حتمية. */
export function encodeRgbaPng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- resampling

/** أقرب جار. لا يُنشئ لونًا غير موجود في المصدر. */
export function resizeNearest(image, size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sy = Math.floor((y * image.height) / size);
    for (let x = 0; x < size; x += 1) {
      const sx = Math.floor((x * image.width) / size);
      image.pixels.copy(pixels, (y * size + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return { width: size, height: size, pixels };
}

// ---------------------------------------------------------------- ICO

/**
 * مدخل BMP داخل ICO: BITMAPINFOHEADER بارتفاع مضاعف، بكسلات BGRA من الأسفل
 * إلى الأعلى، ثم قناع AND بعرض مُحاذى إلى 32 بت. هذا ما يقبله rc.exe وقارئ
 * الأيقونات في tauri-codegen معًا.
 */
function bmpEntry({ width, height, pixels }) {
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(width, 4);
  info.writeInt32LE(height * 2, 8);
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  info.writeUInt32LE(0, 16);
  const xor = Buffer.alloc(width * height * 4);
  const maskStride = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const s = (y * width + x) * 4;
      const d = (row * width + x) * 4;
      xor[d] = pixels[s + 2];
      xor[d + 1] = pixels[s + 1];
      xor[d + 2] = pixels[s];
      xor[d + 3] = pixels[s + 3];
      if (pixels[s + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  info.writeUInt32LE(xor.length + mask.length, 20);
  return Buffer.concat([info, xor, mask]);
}

/** يبني ICO متعدد الأحجام: BMP تحت 256 وPNG عند 256، وهو عرف Windows. */
export function buildIco(source, sizes = ICON_SIZES) {
  const images = sizes.map((size) => {
    const image = size === source.width && size === source.height ? source : resizeNearest(source, size);
    return { size, data: size >= 256 ? encodeRgbaPng(image) : bmpEntry(image) };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = 6 + directory.length;
  images.forEach((image, index) => {
    const at = index * 16;
    directory[at] = image.size >= 256 ? 0 : image.size;
    directory[at + 1] = image.size >= 256 ? 0 : image.size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });
  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

/**
 * يقرأ حاوية ICO ويتحقّق من كل إطار. يعيد قائمة الإطارات وقائمة العيوب؛
 * لا يرمي، حتى يستطيع الحارس أن يبلّغ عن كل عيب بدل الأول فقط.
 */
export function inspectIco(bytes) {
  const problems = [];
  const frames = [];
  if (bytes.length < 6) return { frames, problems: ["ICO_TOO_SHORT"] };
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) problems.push("ICO_HEADER_INVALID");
  const count = bytes.readUInt16LE(4);
  if (count === 0) problems.push("ICO_NO_IMAGES");
  if (6 + count * 16 > bytes.length) return { frames, problems: [...problems, "ICO_DIRECTORY_TRUNCATED"] };
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16;
    const width = bytes[at] === 0 ? 256 : bytes[at];
    const height = bytes[at + 1] === 0 ? 256 : bytes[at + 1];
    const size = bytes.readUInt32LE(at + 8);
    const offset = bytes.readUInt32LE(at + 12);
    const frame = { width, height, bytes: size, format: "UNKNOWN" };
    frames.push(frame);
    if (size === 0 || offset + size > bytes.length) {
      problems.push(`ICO_FRAME_${index}_OUT_OF_BOUNDS`);
      continue;
    }
    const data = bytes.subarray(offset, offset + size);
    if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
      frame.format = "PNG";
      try {
        const decoded = decodeRgbaPng(data);
        if (decoded.width !== width || decoded.height !== height) problems.push(`ICO_FRAME_${index}_PNG_SIZE_MISMATCH`);
      } catch (error) {
        problems.push(`ICO_FRAME_${index}_PNG_CORRUPT:${error.message}`);
      }
    } else if (data.length >= 40 && data.readUInt32LE(0) === 40) {
      frame.format = "BMP";
      const bmpWidth = data.readInt32LE(4);
      const bmpHeight = data.readInt32LE(8);
      const bits = data.readUInt16LE(14);
      const expected = 40 + width * height * 4 + Math.ceil(width / 32) * 4 * height;
      if (bmpWidth !== width || bmpHeight !== height * 2) problems.push(`ICO_FRAME_${index}_BMP_SIZE_MISMATCH`);
      if (bits === 32 && data.length !== expected) problems.push(`ICO_FRAME_${index}_BMP_LENGTH_MISMATCH`);
    } else {
      problems.push(`ICO_FRAME_${index}_FORMAT_UNKNOWN`);
    }
  }
  return { frames, problems };
}

// ---------------------------------------------------------------- Tauri guard

/**
 * يفحص أيقونات Tauri المُعلنة في tauri.conf.json، ويعيد نتيجة كل شرط:
 *   P01-ASSET-001  أيقونة Windows (.ico) مُعلنة وموجودة وغير فارغة
 *   P01-ASSET-002  كل مسار أيقونة نسبي، لا مطلق ولا بحرف قرص
 *   P01-ASSET-003  الـico حاوية صالحة، فيها صورة واحدة على الأقل، وفيها 256
 *   P01-ASSET-004  لا مسار مورد يهرب من مجلد التطبيق
 * القارئ والنظام الملفّي يُمرَّران من الخارج حتى يُختبر الحارس بلا قرص.
 */
export function checkTauriIcons(appDirectory, { readText, readBytes, exists, pathApi }) {
  const config = JSON.parse(readText(pathApi.join(appDirectory, "tauri.conf.json")));
  const icons = Array.isArray(config?.bundle?.icon) ? config.bundle.icon : [];
  const results = [];
  const record = (id, pass, detail) => results.push({ id, verdict: pass ? "PASS" : "FAIL", detail });

  const isAbsoluteLike = (value) => pathApi.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[\\/]/.test(value);
  const absolute = icons.filter(isAbsoluteLike);
  record("P01-ASSET-002", icons.length > 0 && absolute.length === 0, absolute.length ? `absolute: ${absolute.join(", ")}` : `${icons.length} relative icon paths`);

  const root = pathApi.resolve(appDirectory);
  const escaping = icons.filter((value) => {
    const resolved = pathApi.resolve(root, value);
    const rel = pathApi.relative(root, resolved);
    return rel === "" || rel.startsWith("..") || pathApi.isAbsolute(rel);
  });
  record("P01-ASSET-004", escaping.length === 0, escaping.length ? `escaping: ${escaping.join(", ")}` : "every icon path stays inside the app directory");

  const ico = icons.find((value) => value.toLowerCase().endsWith(".ico"));
  const icoPath = ico === undefined ? null : pathApi.join(appDirectory, ico);
  const present = icoPath !== null && exists(icoPath);
  const bytes = present ? readBytes(icoPath) : null;
  record(
    "P01-ASSET-001",
    present && bytes.length > 0,
    ico === undefined ? "no .ico declared in bundle.icon" : present ? `${ico} (${bytes.length} bytes)` : `${ico} missing`,
  );

  if (bytes === null || bytes.length === 0) {
    record("P01-ASSET-003", false, "no icon bytes to inspect");
  } else {
    const { frames, problems } = inspectIco(bytes);
    const has256 = frames.some((frame) => frame.width === 256 && frame.height === 256);
    const pass = problems.length === 0 && frames.length > 0 && has256;
    const sizes = frames.map((frame) => `${frame.width}${frame.format === "PNG" ? "p" : ""}`).join(",");
    record("P01-ASSET-003", pass, pass ? `${frames.length} frames: ${sizes}` : `${problems.join("; ") || "no 256x256 frame"} [${sizes}]`);
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * يعيد بكسلات RGBA لإطار واحد. المقارنة بالبكسل لا بالبايت، لأن ضغط PNG قد
 * يختلف بين إصدارات zlib دون أن تختلف الصورة.
 */
export function icoFramePixels(bytes, index) {
  const at = 6 + index * 16;
  const width = bytes[at] === 0 ? 256 : bytes[at];
  const height = bytes[at + 1] === 0 ? 256 : bytes[at + 1];
  const offset = bytes.readUInt32LE(at + 12);
  const data = bytes.subarray(offset, offset + bytes.readUInt32LE(at + 8));
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return decodeRgbaPng(data);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = 40 + ((height - 1 - y) * width + x) * 4;
      const d = (y * width + x) * 4;
      pixels[d] = data[s + 2];
      pixels[d + 1] = data[s + 1];
      pixels[d + 2] = data[s];
      pixels[d + 3] = data[s + 3];
    }
  }
  return { width, height, pixels };
}

/** هل الـico الموجود يطابق المصدر إطارًا إطارًا وبكسلًا ببكسل؟ */
export function icoMatchesSource(bytes, source, sizes = ICON_SIZES) {
  const { frames, problems } = inspectIco(bytes);
  if (problems.length > 0 || frames.length !== sizes.length) return false;
  return sizes.every((size, index) => {
    if (frames[index].width !== size || frames[index].height !== size) return false;
    const expected = size === source.width ? source : resizeNearest(source, size);
    return icoFramePixels(bytes, index).pixels.equals(expected.pixels);
  });
}
