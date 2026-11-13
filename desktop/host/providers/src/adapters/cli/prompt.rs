// صياغة طلب واحد نصًّا لأداة سطر أوامر.
//
// الأداة تأخذ مُوجِّهًا واحدًا، لا قائمة رسائل. تعليمة النظام والمحادثة تُكتبان في نصّ واحد بأقسام مسمّاة. الأدوات لا تُنقل
// بصيغة الاستدعاء الأصيل هنا: المضيف يستعمل عقد JSON النصّي مع هذا المحوّل.

use crate::domain::messages::{ChatMessage, InvocationSpec, ResponseFormat, Role};

/// ما يُقال للأداة عن دورها: نموذج لغة خلف تطبيق آخر، بلا أدوات.
pub const HOST_NOTE: &str = "You are the language model behind another application. The message you receive contains that application's system instructions and a conversation. Follow those instructions. You have no tools here: do not try to read files, run commands or browse. Reply with the assistant's next message as plain text only.";

fn label(role: Role) -> &'static str {
    match role {
        Role::System => "system",
        Role::User => "user",
        Role::Assistant => "assistant",
        Role::Tool => "tool result",
    }
}

fn turn(out: &mut String, message: &ChatMessage) {
    out.push_str(&format!("[{}]\n", label(message.role)));
    if !message.text.trim().is_empty() {
        out.push_str(message.text.trim_end());
        out.push('\n');
    }
    // سجلّ قديم قد يحمل استدعاءات أصيلة من مزوّد آخر: تُكتب نصًّا كي لا يضيع السياق.
    for call in &message.tool_calls {
        out.push_str(&format!("(called tool {} with arguments {})\n", call.name, call.arguments));
    }
    out.push('\n');
}

/// المُوجِّه الكامل لطلب واحد.
pub fn render(spec: &InvocationSpec) -> String {
    let mut out = String::new();
    if let Some(system) = spec.system.as_deref().filter(|s| !s.trim().is_empty()) {
        out.push_str("<system_instructions>\n");
        out.push_str(system.trim_end());
        out.push_str("\n</system_instructions>\n\n");
    }
    out.push_str("<conversation>\n");
    for message in &spec.messages {
        turn(&mut out, message);
    }
    out.push_str("</conversation>\n\n");
    out.push_str("Write the assistant's next message in this conversation. Output only that message.");
    if spec.response_format == ResponseFormat::Json {
        out.push_str(" It must be a single JSON object and nothing else.");
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::messages::{ProposedToolCall, WireProfile};

    fn spec(messages: Vec<ChatMessage>, format: ResponseFormat) -> InvocationSpec {
        InvocationSpec {
            provider_model_id: "m".into(),
            system: Some("Be brief.".into()),
            messages,
            temperature: None,
            max_output_tokens: None,
            response_format: format,
            reasoning_effort: None,
            user_effort: None,
            tools: Vec::new(),
            context_window: None,
            wire: WireProfile::default(),
            model_reasons: false,
        }
    }

    #[test]
    fn the_system_instruction_and_every_turn_are_in_order() {
        let text = render(&spec(vec![ChatMessage::text(Role::User, "مرحبا"), ChatMessage::text(Role::Assistant, "أهلا"), ChatMessage::text(Role::User, "ما اسمك؟")], ResponseFormat::Text));
        let system = text.find("Be brief.").unwrap();
        let first = text.find("[user]\nمرحبا").unwrap();
        let reply = text.find("[assistant]\nأهلا").unwrap();
        let last = text.find("[user]\nما اسمك؟").unwrap();
        assert!(system < first && first < reply && reply < last, "{text}");
        assert!(!text.contains("JSON object"), "{text}");
    }

    #[test]
    fn json_mode_and_tool_history_are_written_as_text() {
        let mut assistant = ChatMessage::text(Role::Assistant, "");
        assistant.tool_calls.push(ProposedToolCall { id: Some("c1".into()), name: "read_file".into(), arguments: "{\"path\":\"a.txt\"}".into() });
        let text = render(&spec(vec![ChatMessage::text(Role::User, "read it"), assistant, ChatMessage::text(Role::Tool, "content of a")], ResponseFormat::Json));
        assert!(text.contains("(called tool read_file with arguments {\"path\":\"a.txt\"})"), "{text}");
        assert!(text.contains("[tool result]\ncontent of a"), "{text}");
        assert!(text.contains("single JSON object"), "{text}");
    }
}
