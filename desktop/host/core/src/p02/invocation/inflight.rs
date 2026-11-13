// سجل الاستدعاءات الجارية.
//
// الإلغاء يرتبط باستدعاء واحد وجلسة واحدة. لا إلغاء جماعي. إلغاء يصل قبل أن يبدأ
// الاستدعاء يُحفظ، فيبدأ الاستدعاء ملغًى. ومعرّف استُعمل مرة لا يُعاد استعماله.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use polaris_host_providers::net::CancelToken;

const MAX_REMEMBERED: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelOutcome {
    CancellationRequested,
    AlreadyFinished,
    PreCancelled,
    /// الاستدعاء لجلسة أخرى.
    ForeignSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Registration {
    Started,
    PreCancelled,
    Duplicate,
}

struct Running {
    session: String,
    token: CancelToken,
}

#[derive(Default)]
struct State {
    running: HashMap<String, Running>,
    finished: VecDeque<String>,
    pre_cancelled: VecDeque<(String, String)>,
}

#[derive(Default)]
pub struct Inflight {
    state: Mutex<State>,
}

fn remember<T>(queue: &mut VecDeque<T>, value: T) {
    if queue.len() >= MAX_REMEMBERED {
        queue.pop_front();
    }
    queue.push_back(value);
}

impl Inflight {
    /// يسجّل استدعاءً جديدًا ويعيد رمز إلغائه.
    pub fn register(&self, invocation_id: &str, session: &str) -> (Registration, CancelToken) {
        let token = CancelToken::new();
        let Ok(mut state) = self.state.lock() else { return (Registration::Duplicate, token) };
        if state.running.contains_key(invocation_id) || state.finished.iter().any(|f| f == invocation_id) {
            return (Registration::Duplicate, token);
        }
        if let Some(position) = state.pre_cancelled.iter().position(|(id, s)| id == invocation_id && s == session) {
            state.pre_cancelled.remove(position);
            token.cancel();
            remember(&mut state.finished, invocation_id.to_string());
            return (Registration::PreCancelled, token);
        }
        state.running.insert(invocation_id.to_string(), Running { session: session.to_string(), token: token.clone() });
        (Registration::Started, token)
    }

    pub fn finish(&self, invocation_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.running.remove(invocation_id);
            remember(&mut state.finished, invocation_id.to_string());
        }
    }

    pub fn cancel(&self, invocation_id: &str, session: &str) -> CancelOutcome {
        let Ok(mut state) = self.state.lock() else { return CancelOutcome::AlreadyFinished };
        if let Some(running) = state.running.get(invocation_id) {
            if running.session != session {
                return CancelOutcome::ForeignSession;
            }
            running.token.cancel();
            return CancelOutcome::CancellationRequested;
        }
        if state.finished.iter().any(|f| f == invocation_id) {
            return CancelOutcome::AlreadyFinished;
        }
        if !state.pre_cancelled.iter().any(|(id, _)| id == invocation_id) {
            remember(&mut state.pre_cancelled, (invocation_id.to_string(), session.to_string()));
        }
        CancelOutcome::PreCancelled
    }

    pub fn running_count(&self) -> usize {
        self.state.lock().map(|s| s.running.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_binds_to_one_invocation_and_one_session() {
        let inflight = Inflight::default();
        let (reg, token) = inflight.register("a", "s1");
        assert_eq!(reg, Registration::Started);
        let (_, other) = inflight.register("b", "s1");
        assert_eq!(inflight.cancel("a", "s2"), CancelOutcome::ForeignSession);
        assert!(!token.is_cancelled());
        assert_eq!(inflight.cancel("a", "s1"), CancelOutcome::CancellationRequested);
        assert!(token.is_cancelled());
        assert!(!other.is_cancelled(), "cancel reached another invocation");
    }

    #[test]
    fn a_cancel_before_start_makes_the_start_cancelled() {
        let inflight = Inflight::default();
        assert_eq!(inflight.cancel("x", "s1"), CancelOutcome::PreCancelled);
        let (reg, token) = inflight.register("x", "s1");
        assert_eq!(reg, Registration::PreCancelled);
        assert!(token.is_cancelled());
    }

    #[test]
    fn a_pre_cancel_from_another_session_does_not_apply() {
        let inflight = Inflight::default();
        inflight.cancel("x", "s2");
        let (reg, token) = inflight.register("x", "s1");
        assert_eq!(reg, Registration::Started);
        assert!(!token.is_cancelled());
    }

    #[test]
    fn identifiers_are_single_use() {
        let inflight = Inflight::default();
        inflight.register("a", "s");
        assert_eq!(inflight.register("a", "s").0, Registration::Duplicate);
        inflight.finish("a");
        assert_eq!(inflight.register("a", "s").0, Registration::Duplicate);
        assert_eq!(inflight.cancel("a", "s"), CancelOutcome::AlreadyFinished);
        assert_eq!(inflight.running_count(), 0);
    }
}
