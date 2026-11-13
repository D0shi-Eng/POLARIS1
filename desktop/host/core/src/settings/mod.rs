// طبقة الإعدادات في المضيف.
//
// قرار المرحلة، ومكتوب هنا لأنه يفسّر كل ما تحته: مجموعة عمليات Phase-01 كلها
// READ_ONLY بحكم ADR-017، فلا وجود لعملية كتابة إعداد أصلًا. وعليه لا يوجد إعداد
// واحد بوضع ACTIVE في هذه المرحلة: إعلان ACTIVE على إعداد لا يستطيع أحد حفظه هو
// بالضبط «عنصر يبدو شغالًا ولا يفعل شيئًا»، وهو ما وُجد هذا التصنيف لمنعه.
//
// تبديل السمة واللغة أثناء الجلسة ليس إعدادًا: إنه تفضيل عرض يملكه العارض وحده،
// محدود بالجلسة، ولا يدّعي حفظًا. الفرق معلن في الواجهة لا مسكوت عنه.

pub mod catalogue;
pub mod resolver;

pub use catalogue::{section_ids, sections, SectionSpec, SettingSpec};
pub use resolver::{HostLocalSettingsResolver, ResolvedValue, SettingsResolver};
