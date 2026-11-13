// الاستعمال والكلفة والميزانيات (Phase-06).
//
// لا كلفة وهمية (البند 18): المبلغ يأتي من تقرير مزوّد، أو من سعر أدخله المستخدم
// بمصدره فيُعلَن مقدَّرًا، وإلا فهو مجهول. والزمن وعدد الطلبات قياس محلي لا يصير مالًا
// بلا مصدر تسعير (البند 21).

pub mod budget;
pub mod guard;
pub mod ledger;
pub mod model;
pub mod pricing;

use std::sync::Arc;

use crate::storage::Database;

use budget::BudgetBook;
use ledger::UsageLedger;
use pricing::PricingBook;

/// الدفاتر الثلاثة معًا: الاستعمال، والأسعار، والميزانيات.
pub struct CostBooks {
    pub ledger: Arc<UsageLedger>,
    pub pricing: Arc<PricingBook>,
    pub budgets: Arc<BudgetBook>,
}

impl CostBooks {
    pub fn new(db: Arc<Database>) -> Self {
        let ledger = Arc::new(UsageLedger::new(db.clone()));
        Self { pricing: Arc::new(PricingBook::new(db.clone())), budgets: Arc::new(BudgetBook::new(db, ledger.clone())), ledger }
    }
}
