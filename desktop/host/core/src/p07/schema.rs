// بصمة المخطط: ما تقوله القاعدة عن بنيتها مقارنًا بما يبنيه هذا البناء.
//
// لماذا: نسخة احتياطية سليمة الصفحات قد تحمل جدولًا زائدًا أو مشغّلًا (trigger)
// أو عرضًا لم يكتبه المنتج. استعادتها تزرع منطقًا يعمل مع كل كتابة لاحقة. البصمة
// تقارن كل كائن في `sqlite_master` بالمخطط المرجعي لإصدار الملف نفسه، المبني في
// الذاكرة بالترحيلات نفسها، فلا قائمة مكتوبة باليد تنجرف عن الترحيلات.

use rusqlite::Connection;

use crate::digest::sha256_hex;
use crate::storage::migrations;

use super::error::{MaintenanceError, MaintenanceResult};

/// نص قانوني لكائنات المخطط: النوع والاسم والجدول والتعريف، مرتّبة.
/// كائنات SQLite الداخلية (`sqlite_*`) تُستثنى: يبنيها المحرّك لا المنتج.
pub fn canonical_schema(conn: &Connection) -> MaintenanceResult<String> {
    let mut stmt = conn
        .prepare(
            "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master \
             WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY type, name",
        )
        .map_err(|e| MaintenanceError::new("STORE_CORRUPT", e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(format!(
                "{}\u{1f}{}\u{1f}{}\u{1f}{}",
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?
            ))
        })
        .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        .map_err(|e| MaintenanceError::new("STORE_CORRUPT", e.to_string()))?;
    Ok(rows.join("\u{1e}"))
}

pub fn fingerprint(conn: &Connection) -> MaintenanceResult<String> {
    Ok(sha256_hex(canonical_schema(conn)?.as_bytes()))
}

/// البصمة التي يجب أن تحملها قاعدة عند إصدار بعينه.
pub fn expected_fingerprint(version: i64) -> MaintenanceResult<String> {
    if !(1..=migrations::SUPPORTED_VERSION).contains(&version) {
        return Err(MaintenanceError::new(
            "STORE_SCHEMA_UNKNOWN",
            format!("no reference schema for version {version}"),
        ));
    }
    let mut conn = Connection::open_in_memory().map_err(|e| MaintenanceError::new("STORE_IO", e.to_string()))?;
    migrations::apply_up_to(&mut conn, version).map_err(|e| MaintenanceError::new("STORE_SCHEMA_UNKNOWN", e.to_string()))?;
    fingerprint(&conn)
}

/// يقارن قاعدة ببصمة إصدارها. يعيد الإصدار إن تطابقا.
pub fn verify_schema(conn: &Connection) -> MaintenanceResult<i64> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| MaintenanceError::new("STORE_CORRUPT", e.to_string()))?;
    if version > migrations::SUPPORTED_VERSION {
        return Err(MaintenanceError::new(
            "STORE_SCHEMA_TOO_NEW",
            format!("schema {version} is newer than supported {}", migrations::SUPPORTED_VERSION),
        ));
    }
    let expected = expected_fingerprint(version)?;
    let found = fingerprint(conn)?;
    if expected != found {
        return Err(MaintenanceError::new(
            "BACKUP_SCHEMA_MISMATCH",
            format!("schema objects at version {version} differ from the product's reference schema"),
        ));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_version_has_a_distinct_reference_fingerprint() {
        let prints: Vec<String> = (1..=migrations::SUPPORTED_VERSION).map(|v| expected_fingerprint(v).unwrap()).collect();
        let mut unique = prints.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), prints.len());
        assert!(expected_fingerprint(0).is_err());
        assert!(expected_fingerprint(migrations::SUPPORTED_VERSION + 1).is_err());
    }

    #[test]
    fn a_step_by_step_upgrade_has_the_same_schema_as_a_fresh_store() {
        let mut stepped = Connection::open_in_memory().unwrap();
        for version in 1..=migrations::SUPPORTED_VERSION {
            migrations::apply_up_to(&mut stepped, version).unwrap();
        }
        assert_eq!(verify_schema(&stepped).unwrap(), migrations::SUPPORTED_VERSION);
    }

    #[test]
    fn an_added_trigger_is_a_schema_mismatch() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrations::apply(&mut conn).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER planted AFTER INSERT ON projects BEGIN UPDATE projects SET name = 'x'; END;",
        )
        .unwrap();
        assert_eq!(verify_schema(&conn).unwrap_err().code, "BACKUP_SCHEMA_MISMATCH");
    }
}
