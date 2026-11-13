// مخطط v20 (تكليف المكافأة الوظيفية مع Manus 2026-10-19): ما يعرفه POLARIS عن المرفق بعد فحص محتواه.
//
// - `p08_attachments.family`: عائلة الصيغة (TEXT، DOCUMENT، IMAGE …).
// - `p08_attachments.mime_type`: النوع المقرَّر بعد مقارنة توقيع المحتوى بالامتداد، لا ما ادّعاه الاسم وحده.
// - `p08_attachments.content_check`: MATCHED (التوقيع يطابق) أو UNVERIFIED (صيغة بلا توقيع ثابت).
// - `p08_attachments.model_access`: كيف يصل إلى النموذج: نصّ مستخرج، أو صورة لنموذج يرى الصور، أو تخزين فقط.
//
// أعمدة تُضاف قابلةً للفراغ: صفوف ما قبل v20 تبقى كما هي (فراغها يعني «لم يُفحص بهذا الفاحص»)، ولا يُعاد بناء الجدول.

pub const V20: &str = r#"
ALTER TABLE p08_attachments ADD COLUMN family TEXT NULL CHECK (family IS NULL OR family IN ('TEXT', 'CODE', 'DOCUMENT', 'SPREADSHEET', 'PRESENTATION', 'IMAGE', 'AUDIO', 'VIDEO', 'ARCHIVE', 'BINARY'));
ALTER TABLE p08_attachments ADD COLUMN mime_type TEXT NULL CHECK (mime_type IS NULL OR length(mime_type) BETWEEN 3 AND 100);
ALTER TABLE p08_attachments ADD COLUMN content_check TEXT NULL CHECK (content_check IS NULL OR content_check IN ('MATCHED', 'UNVERIFIED'));
ALTER TABLE p08_attachments ADD COLUMN model_access TEXT NULL CHECK (model_access IS NULL OR model_access IN ('TEXT_EXTRACTION', 'IMAGE_INPUT', 'STORE_ONLY'));
"#;
