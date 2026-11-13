// دمج الترتيب بـ Reciprocal Rank Fusion (Cormack وآخرون 2009؛ k = 60 كما في agentmemory `src/state/hybrid-search.ts`،
// Apache-2.0). يجمع الترتيب لا الدرجة، فلا يحتاج وزنًا يوازن بين درجة BM25 وجيب التمام. الأوزان متساوية عمدًا: أوزان agentmemory
// (0.4 و0.6 و0.3) ضُبطت على مجموعتهم، ولا مجموعة عندنا تبرّر غيرها.

/// ثابت RRF: يخفّف فرق المراكز الأولى بعضها عن بعض.
pub const RRF_K: f64 = 60.0;

/// تيّار ترتيب واحد: درجة لكل مستند بترتيب المستندات، و`None` لمن لا يظهر فيه. الدرجات المتساوية تتشارك المركز.
pub fn ranks(scores: &[Option<f64>]) -> Vec<Option<usize>> {
    scores
        .iter()
        .map(|own| own.map(|own| 1 + scores.iter().flatten().filter(|other| **other > own).count()))
        .collect()
}

/// مجموع 1 / (k + المركز) عبر التيّارات لكل مستند.
pub fn fuse(streams: &[Vec<Option<usize>>], documents: usize) -> Vec<f64> {
    (0..documents)
        .map(|i| streams.iter().filter_map(|s| s.get(i).copied().flatten()).map(|rank| 1.0 / (RRF_K + rank as f64)).sum())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ties_share_a_rank_and_absent_documents_have_none() {
        assert_eq!(ranks(&[Some(2.0), None, Some(5.0), Some(2.0)]), vec![Some(2), None, Some(1), Some(2)]);
    }

    #[test]
    fn agreement_across_streams_beats_a_single_first_place() {
        let lexical = ranks(&[Some(3.0), Some(2.0), None]);
        let semantic = ranks(&[None, Some(0.8), Some(0.9)]);
        let fused = fuse(&[lexical, semantic], 3);
        assert!(fused[1] > fused[0] && fused[1] > fused[2], "{fused:?}");
    }
}
