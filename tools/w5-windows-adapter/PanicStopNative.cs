using System;
using System.Runtime.InteropServices;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>
    /// ما يحتاجه قياس W5-P01 من الواجهة الأصلية ولم يكن معلنًا في W4.
    ///
    /// الإعلان هنا لا هناك عمدًا: شيفرة W4 مغلقة، وإضافة إعلان إليها تعديلٌ لها
    /// بلا سبب. هذا الملف يملكه W5 وحده، ويُصرَّف داخل ثنائيه.
    ///
    /// IsProcessInJob هو الفارق بين «العملية موجودة» و«العملية داخل الحصر الذي
    /// نملكه». الأول لا يثبت ملكية، والثاني يثبتها من النواة لا من اسم العملية.
    /// </summary>
    internal static class PanicStopNative
    {
        /// <summary>رمز الخروج المحفوظ لعملية لم تخرج بعد. يُقرأ مع الانتظار، لا وحده.</summary>
        internal const uint StillActive = 259;

        internal const uint WaitObject0 = 0x00000000;
        internal const uint WaitAbandoned = 0x00000080;
        internal const uint WaitTimeout = 0x00000102;
        internal const uint WaitFailed = 0xFFFFFFFF;

        internal const uint Synchronize = 0x00100000;
        internal const uint ProcessQueryLimitedInformation = 0x00001000;

        /// <summary>
        /// رمز الخروج الذي تضعه النواة على عملية أُنهيت بإغلاق آخر مقبض لـJob
        /// مضبوط على القتل عند الإغلاق. يُسجَّل كقرينة مُقاسة، ولا يُبنى عليه
        /// إسناد وحده: الإسناد يُبنى على الترتيب المُقاس لا على ثابت.
        /// </summary>
        internal const uint ErrorAbandonedWait0 = 735;

        internal const int ErrorInvalidParameter = 87;

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool IsProcessInJob(
            IntPtr processHandle, IntPtr jobHandle, [MarshalAs(UnmanagedType.Bool)] out bool result);

        /// <summary>اسم نتيجة الانتظار كما تُقرأ في الدليل، لا رقمًا خامًا.</summary>
        internal static string WaitResultName(uint wait)
        {
            if (wait == WaitObject0) { return "WAIT_OBJECT_0"; }
            if (wait == WaitTimeout) { return "WAIT_TIMEOUT"; }
            if (wait == WaitAbandoned) { return "WAIT_ABANDONED"; }
            if (wait == WaitFailed) { return "WAIT_FAILED"; }
            return "WAIT_UNKNOWN";
        }
    }
}
