// التخزين المحلي: قاعدة SQLite واحدة للمنتج.
//
// لا قاعدة ثانية ولا ملفات JSON تتظاهر بأنها قاعدة. المخطط مُرقَّم بـ
// `PRAGMA user_version`، والترحيل يسبقه نسخ احتياطي، ومخطط أحدث من البناء
// يُرفض ولا يُلمس.

pub mod db;
pub mod lock;
pub mod migrations;
mod schema_v6;
mod schema_v7;
mod schema_v8;
mod schema_v9;
mod schema_v10;
mod schema_v11;
mod schema_v12;
mod schema_v13;
mod schema_v14;
mod schema_v15;
mod schema_v16;
mod schema_v17;
mod schema_v18;
mod schema_v19;
mod schema_v20;
mod schema_v21;
mod schema_v22;
mod schema_v23;
mod schema_v24;
mod schema_v25;

pub use db::{Database, StorageError};
