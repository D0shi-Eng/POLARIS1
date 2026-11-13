// محوّل أداة MCP: ينفّذ أداةً أعلنها خادم، ويعيد ناتجها بوصفه بيانات.
//
// ثلاثة حدود تبقى قائمة مهما فعل الخادم:
//   ١ — الحجج تُتحقَّق من مخطط الأداة كما خُزِّن عند الاكتشاف، لا كما يقوله الخادم الآن.
//   ٢ — الناتج يُقرأ من حقوله المعلومة وحدها؛ وما عداها يُحصى ويُهمَل.
//   ٣ — الوجهة هي نقطة الخادم المسجَّلة على الحلقة المحلية، ولا يسمّيها المستدعي.

use std::sync::Arc;

use serde_json::Value;

use crate::p04::adapter::{bounded, ToolAdapter, ToolCallContext, ToolFailure, ToolOutcome};
use crate::p04::tool::ToolDescriptor;

use super::client::{McpClient, McpError};
use super::sanitize;

/// محوّل أداة واحدة من خادم واحد.
pub struct McpToolAdapter {
    pub descriptor: ToolDescriptor,
    /// اسم الأداة كما أعلنه الخادم. معرّفنا المركّب لا يسافر إليه.
    pub declared_name: String,
    /// نقطة الخادم كما سُجِّلت. تُحلّ من جديد عند كل نداء، فلا تُعاد كتابتها في الذاكرة.
    pub endpoint: String,
    /// مخطط المدخلات كما وصل عند الاكتشاف، بنصّه.
    pub input_schema: String,
    pub client: Arc<McpClient>,
}

/// يتحقق من الحجج مقابل مخطط الأداة المخزَّن.
///
/// المخطط يأتي من طرف غير موثوق، ولذلك يُجمَّع داخل مجموعة معزولة بلا أي مرجع
/// خارجي: مخطط يشير إلى عنوان بعيد لا يُجلب، بل يفشل تجميعه فتُرفض الحجج.
pub fn validate_against_schema(schema_text: &str, arguments: &Value) -> Result<(), ToolFailure> {
    if schema_text.len() > sanitize::MAX_SCHEMA_BYTES {
        return Err(ToolFailure::ArgumentsInvalid("the stored input schema is larger than this host accepts".into()));
    }
    let schema: Value = serde_json::from_str(schema_text)
        .map_err(|_| ToolFailure::ArgumentsInvalid("the stored input schema is not valid JSON".into()))?;
    if !arguments.is_object() {
        return Err(ToolFailure::ArgumentsInvalid("the arguments must be a JSON object".into()));
    }
    // الحارس نفسه يُعاد هنا ولا يُفترض أنه جرى عند الاكتشاف: هذه الدالّة تُستدعى
    // على مخطط مخزَّن، وما خُزِّن قد يكون من بناء أقدم. مرجع خارج المستند يُرفض،
    // فلا يحاول المُجمِّع جلب عنوان من طرف غير موثوق.
    if super::sanitize::external_reference(&schema).is_some() {
        return Err(ToolFailure::ArgumentsInvalid("the stored input schema refers to something outside itself".into()));
    }
    let mut compiler = boon::Compiler::new();
    compiler.set_default_draft(boon::Draft::V2020_12);
    compiler
        .add_resource("polaris:/mcp/tool-input.json", schema)
        .map_err(|e| ToolFailure::ArgumentsInvalid(format!("the input schema could not be registered: {e}")))?;
    let mut schemas = boon::Schemas::new();
    let index = compiler
        .compile("polaris:/mcp/tool-input.json", &mut schemas)
        .map_err(|e| ToolFailure::ArgumentsInvalid(format!("the input schema does not compile: {e}")))?;
    schemas
        .validate(arguments, index)
        .map_err(|e| ToolFailure::ArgumentsInvalid(bounded(&format!("the arguments do not satisfy the tool contract: {e}"), 300)))?;
    Ok(())
}

fn failure_of(error: McpError) -> ToolFailure {
    match error {
        McpError::EndpointRefused(detail) => ToolFailure::Refused(detail),
        McpError::Unreachable(detail) => ToolFailure::Unavailable(detail),
        McpError::TimedOut => ToolFailure::TimedOut,
        McpError::Cancelled => ToolFailure::Cancelled,
        McpError::TooLarge(bytes) => ToolFailure::ResultTooLarge(bytes),
        McpError::Malformed(detail) => ToolFailure::ResultMalformed(detail),
        McpError::Remote { code, message } => ToolFailure::ResultMalformed(format!("the server returned error {code}: {message}")),
    }
}

impl ToolAdapter for McpToolAdapter {
    fn tool_id(&self) -> &str {
        &self.descriptor.tool_id
    }

    fn descriptor(&self) -> ToolDescriptor {
        self.descriptor.clone()
    }

    fn input_schema(&self) -> Option<serde_json::Value> {
        // مخطط الخادم كما خُزِّن بعد تعقيمه. مرجع خارجي فيه يُسقط العرض كله: لا يُعرض على النموذج ما لا يُترجم.
        let schema: serde_json::Value = serde_json::from_str(&self.input_schema).ok()?;
        (schema.is_object() && super::sanitize::external_reference(&schema).is_none()).then_some(schema)
    }

    fn validate(&self, arguments: &serde_json::Value) -> Result<(), ToolFailure> {
        validate_against_schema(&self.input_schema, arguments)
    }

    fn execute(&self, arguments: &serde_json::Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure> {
        if context.cancel.is_cancelled() {
            return Err(ToolFailure::Cancelled);
        }
        // العنوان يُحلّ ويُفحص عند كل نداء، محليًّا كان أو عامًّا (PHASE-06).
        let (endpoint, _) = super::client::resolve_registered(&self.endpoint).map_err(failure_of)?;
        let (result, timing) = self
            .client
            .call_tool(&endpoint, &self.declared_name, arguments, context.timeout_ms, context.cancel)
            .map_err(failure_of)?;

        // الناتج بيانات: يُقرأ نصّه، ويُحصى ما حاول أن يكون أكثر من ذلك.
        let text = sanitize::clean_text(&sanitize::extract_text(&result), 4000);
        let claims = sanitize::authority_claim_count(&result);
        let ignored = sanitize::ignored_field_count(&result);
        let errored = sanitize::is_error(&result);
        let measured = format!(
            "MCP_TOOL_RESULT tool={} bytes={} ms={} error={} text={}",
            self.descriptor.tool_id, timing.response_bytes, timing.elapsed_ms, errored, text
        );
        let detail = format!(
            "server={} authority_claims_ignored={claims} unread_fields={ignored} bytes={}",
            self.descriptor.provenance.server_name.clone().unwrap_or_default(),
            timing.response_bytes
        );
        Ok(ToolOutcome {
            summary: bounded(&text, 1000),
            measured_bytes: measured.into_bytes(),
            // الخادم يقول عن نفسه إن نداءه أخفق؛ ذلك يُصدَّق عن النداء لا عن العالم.
            supports: !errored,
            detail,
            evidence: None,
            // CP-06-7: النصّ كاملًا (حتى 4000 محرف) للوكيل ناتجًا مسيَّجًا؛ الملخّص المقصوص يبقى للسجلّ والدليل.
            observation: Some(text),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SCHEMA: &str = r#"{"type":"object","additionalProperties":false,"required":["text"],"properties":{"text":{"type":"string","maxLength":100}}}"#;

    #[test]
    fn arguments_are_measured_against_the_schema_stored_at_discovery() {
        assert!(validate_against_schema(SCHEMA, &json!({ "text": "hello" })).is_ok());
        assert!(validate_against_schema(SCHEMA, &json!({ "text": 7 })).is_err());
        assert!(validate_against_schema(SCHEMA, &json!({})).is_err(), "a missing required argument passed");
        assert!(validate_against_schema(SCHEMA, &json!({ "text": "x", "extra": 1 })).is_err(), "an undeclared argument passed");
        assert!(validate_against_schema(SCHEMA, &json!("not an object")).is_err());
    }

    #[test]
    fn a_schema_that_points_at_a_remote_reference_fails_closed_rather_than_fetching_it() {
        let remote = r#"{"type":"object","properties":{"a":{"$ref":"https://example.invalid/schema.json"}}}"#;
        let outcome = validate_against_schema(remote, &json!({ "a": 1 }));
        assert!(matches!(outcome, Err(ToolFailure::ArgumentsInvalid(_))), "a remote reference was resolved");
    }

    #[test]
    fn a_schema_larger_than_the_bound_is_refused() {
        let huge = format!(r#"{{"type":"object","description":"{}"}}"#, "x".repeat(sanitize::MAX_SCHEMA_BYTES));
        assert!(matches!(validate_against_schema(&huge, &json!({})), Err(ToolFailure::ArgumentsInvalid(_))));
    }

    #[test]
    fn every_transport_error_maps_to_a_closed_failure() {
        assert_eq!(failure_of(McpError::TimedOut), ToolFailure::TimedOut);
        assert_eq!(failure_of(McpError::Cancelled), ToolFailure::Cancelled);
        assert_eq!(failure_of(McpError::TooLarge(9)), ToolFailure::ResultTooLarge(9));
        assert!(matches!(failure_of(McpError::Malformed("x".into())), ToolFailure::ResultMalformed(_)));
        assert!(matches!(failure_of(McpError::Remote { code: -1, message: "x".into() }), ToolFailure::ResultMalformed(_)));
    }
}
