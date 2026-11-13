// قراءة ملفات يختارها المستخدم (منتقي أو سحب وإفلات) إلى base64 لإرسالها إلى المضيف.
//
// العارض لا يرى مسار الملف على الجهاز ولا يرسله: يرسل الاسم والمحتوى، والمضيف يقرّر
// التصنيف ويرفض الملفات التنفيذية. الحجم يُفحص هنا أيضًا كي لا يُقرأ ملف ضخم عبثًا.

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

export interface PickedFile {
  readonly name: string;
  readonly size: number;
  readonly base64: string;
}

/** يحوّل بايتات إلى base64 على دفعات، فلا يتجاوز حدّ وسائط الدالّة في الملفات الكبيرة. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function readPicked(file: File): Promise<PickedFile | "TOO_LARGE"> {
  if (file.size > MAX_ATTACHMENT_BYTES) return "TOO_LARGE";
  const buffer = await file.arrayBuffer();
  return { name: file.name, size: file.size, base64: bytesToBase64(new Uint8Array(buffer)) };
}

/** امتداد صورة من نوعها المعلن في الحافظة. */
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/** أسماء يضعها المتصفح أو ويندوز لصورة في الحافظة لا تقول شيئًا عن محتواها. */
const GENERIC_CLIPBOARD_NAMES = new Set(["", "image.png", "image.jpg", "image.jpeg", "image.gif", "image.webp", "image.bmp", "image.tiff"]);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * اسم ملف ملصوق: الاسم الحقيقي يبقى (ملفات منسوخة من المستكشف)، والاسم العامّ لصورة في الحافظة يصير
 * `pasted-image-YYYYMMDD-HHMMSS[-n].ext` بامتداد نوعها، فلا تتصادم لصقتان ولا يكذب الامتداد.
 */
export function pastedName(file: File, at: Date, index: number): string {
  const name = displayName(file.name).trim();
  const ext = IMAGE_EXTENSIONS[file.type];
  if (ext === undefined || !GENERIC_CLIPBOARD_NAMES.has(name.toLowerCase())) return name === "" ? `pasted-file-${index + 1}` : name;
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `pasted-image-${stamp}${index === 0 ? "" : `-${index + 1}`}.${ext}`;
}

/** الحدّ الأدنى من `DataTransfer` الذي يحتاجه اللصق؛ يسمح باختباره بلا متصفح. */
export interface ClipboardLike {
  readonly files?: ArrayLike<File> | null;
  readonly items?: ArrayLike<{ readonly kind: string; getAsFile(): File | null }> | null;
}

/**
 * الملفات في لصقة: من `items` (صورة الحافظة تظهر هنا عنصرَ ملف)، وإلا من `files` (ملفات منسوخة). لا تكرار
 * حين يعرض المتصفح الملف في الاثنين.
 */
export function clipboardFiles(data: ClipboardLike | null | undefined): File[] {
  if (data === null || data === undefined) return [];
  const fromItems = Array.from(data.items ?? []).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file === null ? [] : [file];
  });
  return fromItems.length > 0 ? fromItems : Array.from(data.files ?? []);
}

/** أنواع صور تُعرض مصغّرتها في شريحة المرفق. SVG مستثنى: نصّ قد يحمل شيفرة، فلا يُعرض قبل فحص المضيف. */
export const PREVIEWABLE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"]);
/** فوق هذا الحجم لا تُبنى مصغّرة من الملف كله (عنوان data ضخم يثقل العارض). */
export const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/** اسم ملف من جهة المستخدم كما سيظهر: الجزء الأخير فقط، بلا مسار. */
export function displayName(name: string): string {
  const parts = name.split(/[\\/]/);
  return parts[parts.length - 1] ?? name;
}
