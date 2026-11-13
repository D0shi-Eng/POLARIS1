// وقت الأتمتة «مرة واحدة» (D-MP-14، مكافأة Manus 2026-10-20): تاريخ ووقت حائطيّان في إزاحة الجدول ⇄ لحظة UTC يحفظها المضيف.
//
// قِيس في النسخة التنفيذية أن حقل `datetime-local` في الواجهة العربية يصعب ملؤه، وأنه كان يُفسَّر بتوقيت الجهاز لا بإزاحة الجدول
// المكتوبة بجانبه، وأن تعديل الجدول يفتحه فارغًا (القيمة المحفوظة «…Z» لا يقبلها الحقل). هنا التحويل صريح بالإزاحة نفسها
// (`UTC` أو `UTC±hh:mm`، كما يقبلها المضيف)، بلا اعتماد على منطقة الجهاز.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const OFFSET = /^UTC(?:([+-])(0\d|1[0-4]):([0-5]\d))?$/;

/** إزاحة الجدول بالدقائق، أو لا شيء لصيغة لا يقبلها المضيف. */
function offsetMinutes(timezone: string): number | null {
  const m = OFFSET.exec(timezone.trim());
  if (m === null) return null;
  if (m[1] === undefined) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

const two = (n: number) => String(n).padStart(2, "0");

/** لحظة UTC (`YYYY-MM-DDTHH:MM:00Z`) لتاريخ ووقت حائطيّين في إزاحة الجدول، أو لا شيء لمدخل ناقص أو مستحيل (لا يُنقل 30 فبراير إلى مارس). */
export function onceInstant(date: string, time: string, timezone: string): string | null {
  const d = DATE.exec(date.trim());
  const t = TIME.exec(time.trim());
  const offset = offsetMinutes(timezone);
  if (d === null || t === null || offset === null) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const wall = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return new Date(wall - offset * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** التاريخ والوقت الحائطيّان للحظة UTC في إزاحة الجدول، للتعديل. قيمة لا تُقرأ تعطي حقلين فارغين. */
export function onceParts(at: string, timezone: string): { readonly date: string; readonly time: string } {
  const ms = Date.parse(at);
  const offset = offsetMinutes(timezone) ?? 0;
  if (Number.isNaN(ms)) return { date: "", time: "" };
  const wall = new Date(ms + offset * 60_000);
  return { date: `${wall.getUTCFullYear()}-${two(wall.getUTCMonth() + 1)}-${two(wall.getUTCDate())}`, time: `${two(wall.getUTCHours())}:${two(wall.getUTCMinutes())}` };
}
