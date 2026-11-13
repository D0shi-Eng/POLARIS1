// أساس التعاون: منح أدوار (OWNER/EDITOR/VIEWER) على مهمّة أو مخرَج أو مساحة، بيانات محلية.
//
// هذا ليس خادمًا متعدّد المستأجرين ولا مزامنة سحابية: هو نموذج الأذونات المحلي الذي تبني
// عليه أي مشاركة لاحقة، بحيث لا تحتاج إعادة تصميم. المالك الضمني هو مستخدم هذا الجهاز؛
// المنح لا يرسل شيئًا إلى أحد، ولا يغيّر ما يستطيع الوكيل فعله.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

pub const OBJECT_TYPES: [&str; 3] = ["MISSION", "ARTIFACT", "WORKSPACE"];
pub const ROLES: [&str; 3] = ["OWNER", "EDITOR", "VIEWER"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ShareGrant {
    pub grant_id: String,
    pub object_type: String,
    pub object_id: String,
    pub member: String,
    pub role: String,
    pub created_at: String,
}

/// هل يسمح الدور بالفعل؟ القراءة لكل الأدوار، والتعديل للمالك والمحرّر، والمنح للمالك وحده.
pub fn role_allows(role: &str, action: &str) -> bool {
    match action {
        "READ" => ROLES.contains(&role),
        "EDIT" => matches!(role, "OWNER" | "EDITOR"),
        "SHARE" | "DELETE" => role == "OWNER",
        _ => false,
    }
}

pub struct ShareService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
}

fn valid_member(member: &str) -> bool {
    let m = member.trim();
    !m.is_empty() && m.chars().count() <= 200 && !m.chars().any(char::is_control)
}

impl ShareService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { db, audit, clock }
    }

    pub fn set(&self, object_type: &str, object_id: &str, member: &str, role: &str) -> Result<ShareGrant, String> {
        if !OBJECT_TYPES.contains(&object_type) || !ROLES.contains(&role) || !crate::ids::is_uuid_v4(object_id) || !valid_member(member) {
            return Err("the grant is not valid".into());
        }
        let id = self.clock.id();
        let now = self.clock.now();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_share_grants (grant_id, object_type, object_id, member, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(object_type, object_id, member) DO UPDATE SET role = excluded.role",
                    params![id, object_type, object_id, member.trim(), role, now],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())?;
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::ShareGrantChanged, "share", object_id, AuditOutcome::Success, serde_json::json!({ "object_type": object_type, "role": role, "action": "SET" })));
        self.list(object_type, object_id)?.into_iter().find(|g| g.member == member.trim()).ok_or_else(|| "the grant vanished".into())
    }

    pub fn remove(&self, grant_id: &str) -> Result<bool, String> {
        let n = self.db.with(|c| Ok(c.execute("DELETE FROM p08_share_grants WHERE grant_id = ?1", params![grant_id])?)).map_err(|e| e.to_string())?;
        if n > 0 {
            let _ = self.audit.append(&AuditRecord::new(AuditEventType::ShareGrantChanged, "share", grant_id, AuditOutcome::Success, serde_json::json!({ "action": "REMOVE" })));
        }
        Ok(n > 0)
    }

    pub fn list(&self, object_type: &str, object_id: &str) -> Result<Vec<ShareGrant>, String> {
        self.db
            .with(|c| {
                let mut s = c.prepare("SELECT grant_id, object_type, object_id, member, role, created_at FROM p08_share_grants WHERE object_type = ?1 AND object_id = ?2 ORDER BY created_at")?;
                let rows = s
                    .query_map(params![object_type, object_id], |r| Ok(ShareGrant { grant_id: r.get(0)?, object_type: r.get(1)?, object_id: r.get(2)?, member: r.get(3)?, role: r.get(4)?, created_at: r.get(5)? }))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_are_ordered_and_closed() {
        assert!(role_allows("VIEWER", "READ") && !role_allows("VIEWER", "EDIT"));
        assert!(role_allows("EDITOR", "EDIT") && !role_allows("EDITOR", "SHARE"));
        assert!(role_allows("OWNER", "SHARE"));
        assert!(!role_allows("ADMIN", "READ"));
    }

    #[test]
    fn a_grant_is_upserted_per_member_and_invalid_ones_are_refused() {
        let db = Arc::new(Database::in_memory().unwrap());
        let s = ShareService::new(db.clone(), Arc::new(AuditLedger::new(db)), RuntimeClock::system());
        let object = crate::ids::new_uuid_v4();
        s.set("MISSION", &object, "sara@example.test", "VIEWER").unwrap();
        s.set("MISSION", &object, "sara@example.test", "EDITOR").unwrap();
        let grants = s.list("MISSION", &object).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].role, "EDITOR");
        assert!(s.set("MISSION", &object, "x", "ADMIN").is_err());
        assert!(s.set("PROJECT", &object, "x", "VIEWER").is_err());
        assert!(s.remove(&grants[0].grant_id).unwrap());
    }
}
