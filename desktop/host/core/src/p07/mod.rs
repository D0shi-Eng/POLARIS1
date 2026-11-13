// Phase-07: التصليب، والاسترداد، والنسخ الاحتياطي، والترقية، والتحديث الآمن، والسياسة المُدارة.
//
// لماذا وحدة مستقلة: كل ما هنا يعمل على المنتج من خارجه أو قبل أن يبدأ — حارس الإقلاع،
// وأداة الصيانة، والتحقق من التحديث — فلا يدخل في مسار مهمّة ولا بوابة. يعتمد على
// التخزين وعلى إعدادات Phase-06، ولا يعتمد عليه شيء قبله إلا حارس الإقلاع في Phase-02.

pub mod backup;
pub mod error;
pub mod integrity;
pub mod layout;
pub mod maintenance;
pub mod policy;
pub mod recovery;
pub mod restore;
pub mod retention;
pub mod schema;
pub mod update;
