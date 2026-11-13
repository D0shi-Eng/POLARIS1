using System;

namespace Polaris.ConfinementSpike.Shared
{
    // نتيجة خام لمحاولة واحدة قام بها البرنامج العدائي.
    // البرنامج العدائي لا يحكم على النجاح أو الفشل، بل يسجل ما حدث فقط.
    // الحكم يتم في الـ launcher حتى لا يخدع الطفلُ العدائيُّ نتيجةَ الاختبار.
    public sealed class ProbeOutcome
    {
        // معرف المحاولة، مثل F03 أو N01
        public string Id;

        // وصف نصي قصير لما تمت محاولته فعليًا
        public string Attempt;

        // النتيجة الخام: allow أو deny أو error أو skipped
        public string Outcome;

        // رقم خطأ Windows إن وجد، وإلا 0
        public int OsErrorCode;

        // اسم رمزي لخطأ Windows، مثل ERROR_ACCESS_DENIED
        public string OsErrorName;

        // تفاصيل إضافية: مسار، منفذ، عنوان IP، معرف عملية، إلخ
        public string Detail;

        public ProbeOutcome(string id, string attempt, string outcome, int osErrorCode, string osErrorName, string detail)
        {
            Id = id;
            Attempt = attempt;
            Outcome = outcome;
            OsErrorCode = osErrorCode;
            OsErrorName = osErrorName;
            Detail = detail;
        }
    }
}
