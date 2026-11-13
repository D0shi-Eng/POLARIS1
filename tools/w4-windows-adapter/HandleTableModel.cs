using System;
using System.Collections.Generic;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>إدخال واحد في جدول مقابض عملية، كما يعيده النظام لا كما نخمّنه.</summary>
    internal sealed class HandleTableEntry
    {
        public long Value;
        /// <summary>من الواجهة الداخلية فقط. وصفي، لا يدخل حكمًا.</summary>
        public uint GrantedAccess;
        /// <summary>من الواجهة الداخلية فقط. وصفي، لا يدخل حكمًا.</summary>
        public uint ObjectTypeIndex;
        /// <summary>من الواجهة الداخلية فقط. وصفي، لا يدخل حكمًا.</summary>
        public uint HandleAttributes;
        /// <summary>PSS_HANDLE_ENTRY.Flags كما تعيدها الواجهة العامة.</summary>
        public uint PssFlags;
        /// <summary>PSS_HANDLE_ENTRY.ObjectType كما تعيدها الواجهة العامة.</summary>
        public uint PssObjectType;
    }

    /// <summary>
    /// لقطة جدول المقابض ونتيجة التعداد نفسه.
    ///
    /// التمييز جوهري: "لم نجد مقبضًا خارج النطاق" لا يعني شيئًا ما لم يُثبَت أن
    /// التعداد رأى الجدول كله. لذلك تُحمل حالة التعداد مع النتيجة دائمًا، ومعها
    /// صنف الواجهة التي أنتجتها: عامة موثّقة أم داخلية.
    /// </summary>
    internal sealed class HandleTableSnapshot
    {
        public bool Attempted;
        public bool Succeeded;
        /// <summary>هل كانت الواجهة نفسها متاحة على هذا الجهاز أصلًا.</summary>
        public bool Available;
        public string Method = "NONE";
        /// <summary>PUBLIC_DOCUMENTED أو INTERNAL_UNDOCUMENTED. يُخرَج في الدليل.</summary>
        public string ApiClass = "UNKNOWN";
        public string FailureReason = "";

        /// <summary>عدد المقابض كما يعرفه النظام: HandlesCaptured أو NumberOfHandles.</summary>
        public long ReportedCount;
        /// <summary>عدد ما قُرئ فعلًا.</summary>
        public long ParsedCount;
        public long MaxValue;
        public List<HandleTableEntry> Entries = new List<HandleTableEntry>();

        // ── خاصّ بمسار PSS العام ──────────────────────────────────────────────
        public IntPtr CaptureHandle = IntPtr.Zero;
        public uint CaptureFlags;
        public uint CaptureStatus;
        public uint QueryStatus;
        /// <summary>سُجِّل PSS_HANDLE_INFORMATION.HandlesCaptured فعلًا.</summary>
        public bool HandlesCapturedRecorded;
        /// <summary>انتهى المشي بـERROR_NO_MORE_ITEMS لا بخطأ آخر.</summary>
        public bool WalkEndedWithNoMoreItems;
        public uint WalkTerminalStatus;
        public int EntrySizeUsed;
        public int EntrySizeAttempts;

        // ── خاصّ بالمسار الداخلي ──────────────────────────────────────────────
        public uint NtStatus;
    }
}
