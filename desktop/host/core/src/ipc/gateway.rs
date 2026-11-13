// البوابة: المكان الوحيد الذي تعبر منه رسالة من العارض إلى المضيف.
//
// الترتيب مقصود وليس تفضيلًا: شكل الظرف، ثم إصدار البروتوكول، ثم ادّعاء الثقة،
// ثم التوجيه، ثم الحمولة، ثم التنفيذ، ثم التحقق من الردّ. كل خطوة ترفض قبل أن
// تُنفَق أي كلفة على التي بعدها، والرفض دائمًا مغلق: لا تمرير، ولا قيمة افتراضية،
// ولا «حاول على أي حال».

use serde_json::Value;

use crate::contracts::registry::RegistrySet;
use crate::p02::ipc::idempotency::{IdempotencyCache, Lookup};
use crate::contracts::schemas::SchemaSet;
use crate::diagnostics::Diagnostics;
use crate::ipc::envelope;
use crate::ipc::errors::HostError;
use crate::ipc::identity::TransportIdentity;
use crate::services::host::DesktopHost;

/// ما انتهت إليه رسالة واحدة. الردّ دائمًا ظرف صالح، نجحت أو فشلت.
pub struct GatewayOutcome {
    pub response: Value,
    /// التصنيف حين يكون الردّ خطأً. يُستعمل في الاختبار وفي سجل المضيف، ولا يعبر الحدّ.
    pub denied_category: Option<&'static str>,
}

pub struct Gateway {
    host: DesktopHost,
    identity: TransportIdentity,
    diagnostics: Diagnostics,
    /// مولّد معرّفات الرسائل الصادرة. يُحقن ليكون الاختبار حتميًا.
    next_message_id: Box<dyn Fn() -> String + Send + Sync>,
    /// نتائج العمليات ذات الأثر الجانبي بمفاتيحها.
    idempotency: IdempotencyCache,
}

impl Gateway {
    pub fn new(
        host: DesktopHost,
        identity: TransportIdentity,
        next_message_id: Box<dyn Fn() -> String + Send + Sync>,
    ) -> Self {
        Self { host, identity, diagnostics: Diagnostics::new(), next_message_id, idempotency: IdempotencyCache::default() }
    }

    /// يحفظ تفصيل الأخطاء في ملف على جهاز المالك أيضًا، فيُشخَّص الخطأ بعد إغلاق التطبيق.
    pub fn with_diagnostics_file(mut self, path: std::path::PathBuf) -> Self {
        self.diagnostics = Diagnostics::with_file(path);
        self
    }

    pub fn host(&self) -> &DesktopHost {
        &self.host
    }

    pub fn diagnostics(&self) -> &Diagnostics {
        &self.diagnostics
    }

    /// المدخل الوحيد. لا دالة عامة أخرى تقبل اسم عملية من الخارج.
    pub fn handle(&self, request: &Value) -> GatewayOutcome {
        let schemas = SchemaSet::shared();
        let stamped = self.identity.stamp();

        match self.route(schemas, request) {
            Ok(result) => {
                let message_id = (self.next_message_id)();
                match envelope::build_success(schemas, request, message_id, stamped.clone(), result) {
                    Ok(response) => GatewayOutcome { response, denied_category: None },
                    Err(error) => self.deny(schemas, request, stamped, error),
                }
            }
            Err(error) => self.deny(schemas, request, stamped, error),
        }
    }

    fn deny(
        &self,
        schemas: &SchemaSet,
        request: &Value,
        stamped: Value,
        error: HostError,
    ) -> GatewayOutcome {
        // التفصيل يبقى هنا. ما يخرج هو `BoundaryError` وحده، وهو نوع لا يملك حقل تفصيل.
        self.diagnostics.record(&error);
        let category = error.category.as_str();
        let boundary = error.to_boundary();
        let message_id = (self.next_message_id)();
        let response = envelope::build_failure(schemas, request, message_id, stamped, &boundary);
        GatewayOutcome { response, denied_category: Some(category) }
    }

    fn route(&self, schemas: &SchemaSet, request: &Value) -> Result<Value, HostError> {
        // ١ — شكل الظرف. رسالة لا تجتاز `IPCEnvelopeV1` لا تُقرأ حقولها أصلًا.
        envelope::validate_request_envelope(schemas, request)?;

        // ٢ — إصدار البروتوكول. MAJOR مختلف مرفوض، وMINOR أعلى من المضيف مرفوض.
        let (major, minor) = envelope::parse_protocol_version(request)?;
        let (host_major, host_minor) = envelope::host_protocol_version();
        if major != host_major || minor > host_minor {
            return Err(HostError::unsupported_version(format!(
                "declared protocol {major}.{minor}, host speaks {host_major}.{host_minor}"
            )));
        }

        let operation = request
            .get("operation")
            .and_then(Value::as_str)
            .ok_or_else(|| HostError::invalid_message("operation is absent").at("/operation"))?;

        // ٣ — القاعدة الدلالية لـADR-017 وADR-019: عملية لا تسافر داخل مستند يعلن
        // إصدارًا أدنى من إصدار إدخالها. بوابة الإصدار وحدها تقبل MINOR أدنى، فلا تكفي.
        // الإصدار يُقرأ من سجل العملية؛ والبادئة القديمة تبقى حارسًا ثانيًا.
        if operation.starts_with("desktop.") && minor < 1 {
            return Err(HostError::unsupported_version(format!(
                "operation {operation} was introduced at 1.1 and cannot travel in a {major}.{minor} document"
            )));
        }
        if let Some(record) = RegistrySet::record(operation) {
            if let Some((_, introduced_minor)) = record.envelope_version.split_once('.') {
                let introduced_minor: u32 = introduced_minor.parse().unwrap_or(u32::MAX);
                if minor < introduced_minor {
                    return Err(HostError::unsupported_version(format!(
                        "operation {operation} was introduced at {} and cannot travel in a {major}.{minor} document",
                        record.envelope_version
                    )));
                }
            }
        }

        // ٤ — ادّعاء درجة ثقة. الكتابة فوق الهوية تحدث على أي حال، لكن الادّعاء
        // نفسه حدث أمني يُرفض ويُسجَّل، لا يُصحَّح بصمت.
        if TransportIdentity::claims_elevated_trust(request) {
            return Err(HostError::permission_denied(format!(
                "renderer request for {operation} claimed TIER_0_TRUSTED"
            ))
            .at("/caller_identity/trust_tier"));
        }

        // ٥ — التوجيه. صحة المخطط ليست إذنًا: ثلاث حالات مختلفة — غير معروفة،
        // ومعروفة غير مسجَّلة، ومسجَّلة غير موجَّهة — تُختزل عمدًا إلى رفض واحد،
        // لأن التمييز بينها معلومة عن داخل المضيف لا يحتاجها العارض.
        if !RegistrySet::is_routed(operation) {
            return Err(HostError::unsupported_operation(format!(
                "operation {operation} is not routed by this host"
            )));
        }
        let record = RegistrySet::record(operation)
            .ok_or_else(|| HostError::internal("routed operation vanished from the registry"))?;

        // ٦ — الحمولة، مقابل مخططها المُسمّى في السجل لا مقابل مخطط مُختار هنا.
        let payload = request
            .get("payload")
            .ok_or_else(|| HostError::invalid_message("payload is absent").at("/payload"))?;
        schemas.validate(&record.request_schema, payload).map_err(|errors| {
            let detail = errors
                .iter()
                .take(6)
                .map(|e| format!("{} {}", e.pointer, e.detail))
                .collect::<Vec<_>>()
                .join("; ");
            HostError::validation(detail).at("/payload")
        })?;

        // ٧ — التنفيذ عند المالك المُسجَّل. العملية ذات الأثر الجانبي تُنفَّذ مرة واحدة
        // لكل مفتاح: التكرار يعيد النتيجة، والمفتاح نفسه بحمولة أخرى تعارض.
        let session = self.identity.session_id.as_str();
        let idempotency_key = request.get("idempotency_key").and_then(Value::as_str);
        let side_effecting = record.effect == "SIDE_EFFECTING";
        if side_effecting {
            let key = idempotency_key.ok_or_else(|| HostError::validation("idempotency_key is required").at("/idempotency_key"))?;
            match self.idempotency.lookup(session, operation, key, payload) {
                Lookup::Replay(result) => return Ok(result),
                Lookup::Conflict => {
                    return Err(HostError::new(
                        crate::ipc::errors::DesktopErrorCategory::ConfigUnavailable,
                        "CONFLICT",
                        format!("idempotency key reused with a different payload for {operation}"),
                    )
                    .at("/idempotency_key"))
                }
                Lookup::Miss => {}
            }
        }
        let result = self.host.handle_as(operation, payload, session)?;

        // ٨ — ردّ المضيف يُتحقَّق منه كما يُتحقَّق من طلب العارض.
        schemas.validate(&record.response_schema, &result).map_err(|errors| {
            HostError::internal(format!(
                "service {} produced a result that violates {}: {}",
                record.owner,
                record.response_schema,
                errors.iter().take(4).map(|e| format!("{} {}", e.pointer, e.detail)).collect::<Vec<_>>().join("; ")
            ))
        })?;

        if let (true, Some(key)) = (side_effecting, idempotency_key) {
            self.idempotency.store(session, operation, key, payload, &result);
        }
        Ok(result)
    }
}
