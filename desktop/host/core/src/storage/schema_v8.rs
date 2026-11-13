// مخطط v8 (الوكلاء المتخصّصون، 2026-10-01): عمود واحد يُضاف، لا جدول يُمسّ.
//
// `p08_mission_preferences.specialist_id`: متخصّص ثبّته المستخدم للمهمّة من صفحة الوكلاء. معرّف من
// الكتالوج المضمَّن (`<domain>.<slug>`)، لا نصّ حرّ؛ والمهمّة بلا قيمة فيه يختار زمن التشغيل لعُقدها.

pub const V8: &str = r#"
ALTER TABLE p08_mission_preferences ADD COLUMN specialist_id TEXT NULL CHECK (specialist_id IS NULL OR length(specialist_id) BETWEEN 3 AND 120);
"#;
