// BM25 على المدخلات المرئية لطلب واحد، بمعاملات agentmemory نفسها (`src/state/search-index.ts`، Apache-2.0): k1 = 1.2،
// وb = 0.75، وidf = ln((N − df + 0.5) / (df + 0.5) + 1). الفرق المقصود: الفهرس يُبنى لكل طلب من المرئيّ وحده، فتكرار الكلمة
// في نطاق لا يراه الطلب لا يغيّر درجة ما يراه (لا يتسرّب عدد ولا وجود عبر الإحصاء). المجموعات هنا صغيرة (ذاكرة جهاز واحد بعد
// تصفية النطاق)، فالبناء لكل طلب أرخص من فهرس دائم يحتاج مزامنة.

use std::collections::{BTreeSet, HashMap};

const K1: f64 = 1.2;
const B: f64 = 0.75;

pub struct Bm25 {
    /// تكرار كل مصطلح في كل مستند، بترتيب المستندات.
    frequencies: Vec<HashMap<String, u32>>,
    lengths: Vec<usize>,
    document_frequency: HashMap<String, usize>,
    average_length: f64,
}

impl Bm25 {
    /// فهرس من مصطلحات كل مستند (بتكرارها).
    pub fn new(documents: &[Vec<String>]) -> Self {
        let mut document_frequency: HashMap<String, usize> = HashMap::new();
        let frequencies: Vec<HashMap<String, u32>> = documents
            .iter()
            .map(|terms| {
                let mut tf: HashMap<String, u32> = HashMap::new();
                for term in terms {
                    *tf.entry(term.clone()).or_default() += 1;
                }
                for term in tf.keys() {
                    *document_frequency.entry(term.clone()).or_default() += 1;
                }
                tf
            })
            .collect();
        let lengths: Vec<usize> = documents.iter().map(Vec::len).collect();
        let average_length = if lengths.is_empty() { 0.0 } else { lengths.iter().sum::<usize>() as f64 / lengths.len() as f64 };
        Self { frequencies, lengths, document_frequency, average_length }
    }

    /// درجة كل مستند للطلب، بترتيب المستندات. صفر = لا مصطلح مشترك.
    pub fn scores(&self, query: &BTreeSet<String>) -> Vec<f64> {
        let n = self.frequencies.len() as f64;
        let average = self.average_length.max(1.0);
        self.frequencies
            .iter()
            .zip(&self.lengths)
            .map(|(tf, length)| {
                query
                    .iter()
                    .filter_map(|term| {
                        let f = f64::from(*tf.get(term)?);
                        let df = *self.document_frequency.get(term)? as f64;
                        let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
                        Some(idf * f * (K1 + 1.0) / (f + K1 * (1.0 - B + B * *length as f64 / average)))
                    })
                    .sum()
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(words: &str) -> Vec<String> {
        words.split(' ').map(str::to_string).collect()
    }

    #[test]
    fn a_rare_term_weighs_more_than_a_common_one_and_no_match_scores_zero() {
        let index = Bm25::new(&[doc("noor sms"), doc("noor doctor"), doc("noor release"), doc("moyasar payment")]);
        let common = index.scores(&BTreeSet::from(["noor".to_string()]));
        let rare = index.scores(&BTreeSet::from(["moyasar".to_string()]));
        assert!(rare[3] > common[0], "idf did not favour the rare term: {rare:?} vs {common:?}");
        assert_eq!(common[3], 0.0);
    }

    #[test]
    fn an_empty_index_or_query_scores_nothing() {
        assert!(Bm25::new(&[]).scores(&BTreeSet::from(["x".to_string()])).is_empty());
        assert_eq!(Bm25::new(&[doc("a b")]).scores(&BTreeSet::new()), vec![0.0]);
    }
}
