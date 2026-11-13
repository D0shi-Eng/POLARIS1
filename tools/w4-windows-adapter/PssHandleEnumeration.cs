using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// تعداد جدول مقابض عملية هدف عبر Process Snapshotting API — الواجهة العامة
    /// الموثّقة في kernel32.
    ///
    /// تصحيح ADR-007: نفَت النسخة الأولى وجود واجهة عامة في kernel32 تُعدّد جدول
    /// مقابض عملية أخرى. ذلك النفي خطأ واقعي. مايكروسوفت توثّق في
    /// processsnapshot.h و kernel32.dll (ويندوز 8.1 وما بعده):
    ///
    ///     PssCaptureSnapshot(target, PSS_CAPTURE_HANDLES | ..., 0, out snapshot)
    ///     PssQuerySnapshot(snapshot, PSS_QUERY_HANDLE_INFORMATION, ...)
    ///         -> PSS_HANDLE_INFORMATION.HandlesCaptured
    ///     PssWalkSnapshot(snapshot, PSS_WALK_HANDLES, marker, entry, size)
    ///         -> PSS_HANDLE_ENTRY، وحقل Handle فيها هو قيمة المقبض الخام في
    ///            العملية الهدف، وينتهي المشي بـERROR_NO_MORE_ITEMS.
    ///
    /// ولذلك هذه هي الواجهة الأولى (PRIMARY) لتعداد جدول مقابض ابن معلّق. البديل
    /// الداخلي NtQueryInformationProcess تصفه مايكروسوفت نصًّا بأنه internal وقابل
    /// للتغيير بين إصدارات ويندوز، فلا يصحّ أن يكون اعتماد POLARIS الأساسي عليه بلا
    /// ضرورة. يبقى شاهدًا ثانيًا ومسارًا احتياطيًا معلنًا، لا أساسًا.
    ///
    /// الاكتمال يُثبَت ولا يُفترض. لا تُقرأ نتيجة هذا الملف تعدادًا كاملًا إلا إذا:
    ///   1) نجح الالتقاط،
    ///   2) وسُجِّل HandlesCaptured من النظام،
    ///   3) وانتهى المشي بـERROR_NO_MORE_ITEMS لا بخطأ آخر،
    ///   4) وطابق عدد ما مُشي عليه HandlesCaptured.
    /// وإلا فالنتيجة Succeeded=false مع سبب، ويصير الحكم INCONCLUSIVE لا PASS.
    ///
    /// طول مخزن الإدخال يُسوّى مع الواجهة نفسها: أول محاولة بحجم البنية كما تعلنها
    /// طبقة الترتيب، وإن ردّت الواجهة ERROR_BAD_LENGTH تُجرَّب أطوال متدرّجة حتى
    /// تقبل الواجهة. الطول المقبول يُسجَّل في الدليل. هذا ليس سقفًا لقيم المقابض:
    /// لا يوجد في هذا المسار سقف لقيمة مقبض بحال، والفاصل هو جواب الواجهة نفسها.
    /// وتسوية الطول تجري على علّامة مشي مستقلة تُهمل بعدها، فلا تستهلك موضعًا من
    /// المشي الحقيقي.
    /// </summary>
    internal static class PssHandleEnumeration
    {
        internal const string MethodName = "PSS_WALK_HANDLES";

        private const uint PSS_CAPTURE_HANDLES = 0x00000004;
        private const uint PSS_CAPTURE_HANDLE_BASIC_INFORMATION = 0x00000010;
        private const uint PSS_QUERY_HANDLE_INFORMATION = 4;
        private const uint PSS_WALK_HANDLES = 2;

        private const uint ERROR_SUCCESS = 0;
        private const uint ERROR_BAD_LENGTH = 24;
        private const uint ERROR_NO_MORE_ITEMS = 259;

        // حدّ تسوية الطول: زيادة على حجم البنية المعلنة تكفي لأي حشو أو اتحاد أوسع.
        // حدّ على حجم بنية واحدة، لا على قيم المقابض ولا على عددها.
        private const int EntrySizeNegotiationHeadroom = 128;

        // حدّ على عدد الإدخالات المقروءة مشتق من عدد النظام نفسه (HandlesCaptured)
        // لا من رقم مكتوب: المشي يتوقف إن تجاوز ما أبلغ عنه النظام، وذلك تناقض
        // يُسجَّل عدم اكتمال لا يُبتلع.
        private const long WalkOverrunAllowance = 1;

        [StructLayout(LayoutKind.Sequential)]
        private struct PSS_HANDLE_TYPE_SPECIFIC_LAYOUT
        {
            // أوسع صيغة في الاتحاد الموثّق هي صيغة الخيط. تُستعمل لحساب الحجم فقط.
            internal uint ExitStatus;
            internal IntPtr TebBaseAddress;
            internal uint ProcessId;
            internal uint ThreadId;
            internal IntPtr AffinityMask;
            internal int Priority;
            internal int BasePriority;
            internal IntPtr Win32StartAddress;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PSS_HANDLE_ENTRY_LAYOUT
        {
            internal IntPtr Handle;
            internal uint Flags;
            internal uint ObjectType;
            internal uint CaptureTimeLow;
            internal uint CaptureTimeHigh;
            internal uint Attributes;
            internal uint GrantedAccess;
            internal uint HandleCount;
            internal uint PointerCount;
            internal uint PagedPoolCharge;
            internal uint NonPagedPoolCharge;
            internal uint CreationTimeLow;
            internal uint CreationTimeHigh;
            internal ushort TypeNameLength;
            internal IntPtr TypeName;
            internal ushort ObjectNameLength;
            internal IntPtr ObjectName;
            internal PSS_HANDLE_TYPE_SPECIFIC_LAYOUT TypeSpecificInformation;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PSS_HANDLE_INFORMATION
        {
            internal uint HandlesCaptured;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssCaptureSnapshot(
            IntPtr processHandle, uint captureFlags, uint threadContextFlags, out IntPtr snapshotHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssFreeSnapshot(IntPtr processHandle, IntPtr snapshotHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssQuerySnapshot(
            IntPtr snapshotHandle, uint informationClass, IntPtr buffer, uint bufferLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssWalkMarkerCreate(IntPtr allocator, out IntPtr walkMarkerHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssWalkMarkerFree(IntPtr walkMarkerHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint PssWalkSnapshot(
            IntPtr snapshotHandle, uint informationClass, IntPtr walkMarkerHandle,
            IntPtr buffer, uint bufferLength);

        /// <summary>
        /// التقاط جدول مقابض العملية الهدف والمشي عليه كاملًا. العملية الهدف تبقى
        /// كما هي: الالتقاط لا يستأنفها ولا يغيّر جدولها.
        /// </summary>
        internal static HandleTableSnapshot Query(IntPtr targetProcess)
        {
            HandleTableSnapshot snapshot = new HandleTableSnapshot();
            snapshot.Attempted = true;
            snapshot.Method = MethodName;
            snapshot.ApiClass = "PUBLIC_DOCUMENTED";

            IntPtr capture = IntPtr.Zero;
            uint flags = PSS_CAPTURE_HANDLES | PSS_CAPTURE_HANDLE_BASIC_INFORMATION;
            uint status;
            try
            {
                status = PssCaptureSnapshot(targetProcess, flags, 0, out capture);
                if (status != ERROR_SUCCESS)
                {
                    // مسار احتياطي معلن داخل الواجهة العامة نفسها: الحدّ الأدنى
                    // الموثّق لالتقاط الجدول هو PSS_CAPTURE_HANDLES وحده.
                    flags = PSS_CAPTURE_HANDLES;
                    status = PssCaptureSnapshot(targetProcess, flags, 0, out capture);
                }
            }
            catch (Exception error)
            {
                snapshot.Succeeded = false;
                snapshot.Available = false;
                snapshot.FailureReason =
                    "PssCaptureSnapshot threw " + error.GetType().Name + ": " + error.Message;
                return snapshot;
            }

            snapshot.CaptureFlags = flags;
            snapshot.CaptureStatus = status;
            if (status != ERROR_SUCCESS || capture == IntPtr.Zero)
            {
                snapshot.Succeeded = false;
                snapshot.Available = false;
                snapshot.FailureReason =
                    "PssCaptureSnapshot(PSS_CAPTURE_HANDLES) returned Win32 " + status.ToString();
                return snapshot;
            }

            snapshot.Available = true;
            snapshot.CaptureHandle = capture;
            IntPtr self = NativeExtras.GetCurrentProcess();
            try
            {
                if (!QueryHandlesCaptured(snapshot))
                {
                    return snapshot;
                }
                Walk(snapshot);
                return snapshot;
            }
            finally
            {
                PssFreeSnapshot(self, capture);
                snapshot.CaptureHandle = IntPtr.Zero;
            }
        }

        private static bool QueryHandlesCaptured(HandleTableSnapshot snapshot)
        {
            // هذا الرقم هو عدّ النظام لما التُقط. تطابق المشي معه هو شاهد الاكتمال.
            int size = Marshal.SizeOf(typeof(PSS_HANDLE_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                uint status = PssQuerySnapshot(
                    snapshot.CaptureHandle, PSS_QUERY_HANDLE_INFORMATION, buffer, (uint) size);
                snapshot.QueryStatus = status;
                if (status != ERROR_SUCCESS)
                {
                    snapshot.Succeeded = false;
                    snapshot.FailureReason =
                        "PssQuerySnapshot(PSS_QUERY_HANDLE_INFORMATION) returned Win32 " + status.ToString()
                        + ", so the system's own captured-handle count is unknown and completeness cannot be proven";
                    return false;
                }
                PSS_HANDLE_INFORMATION information =
                    (PSS_HANDLE_INFORMATION) Marshal.PtrToStructure(buffer, typeof(PSS_HANDLE_INFORMATION));
                snapshot.ReportedCount = information.HandlesCaptured;
                snapshot.HandlesCapturedRecorded = true;
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static void Walk(HandleTableSnapshot snapshot)
        {
            int declared = Marshal.SizeOf(typeof(PSS_HANDLE_ENTRY_LAYOUT));
            int entrySize = NegotiateEntrySize(snapshot, declared);
            if (entrySize <= 0)
            {
                snapshot.Succeeded = false;
                snapshot.FailureReason =
                    "PssWalkSnapshot(PSS_WALK_HANDLES) rejected every entry buffer length between "
                    + declared.ToString() + " and " + (declared + EntrySizeNegotiationHeadroom).ToString()
                    + " with ERROR_BAD_LENGTH";
                return;
            }
            snapshot.EntrySizeUsed = entrySize;

            IntPtr marker = IntPtr.Zero;
            uint created = PssWalkMarkerCreate(IntPtr.Zero, out marker);
            if (created != ERROR_SUCCESS)
            {
                snapshot.Succeeded = false;
                snapshot.FailureReason = "PssWalkMarkerCreate returned Win32 " + created.ToString();
                return;
            }

            IntPtr buffer = Marshal.AllocHGlobal(entrySize);
            try
            {
                long limit = snapshot.ReportedCount + WalkOverrunAllowance;
                while (true)
                {
                    uint status = PssWalkSnapshot(
                        snapshot.CaptureHandle, PSS_WALK_HANDLES, marker, buffer, (uint) entrySize);
                    if (status == ERROR_NO_MORE_ITEMS)
                    {
                        snapshot.WalkTerminalStatus = status;
                        snapshot.WalkEndedWithNoMoreItems = true;
                        break;
                    }
                    if (status != ERROR_SUCCESS)
                    {
                        snapshot.WalkTerminalStatus = status;
                        snapshot.Succeeded = false;
                        snapshot.FailureReason =
                            "PssWalkSnapshot(PSS_WALK_HANDLES) ended with Win32 " + status.ToString()
                            + " after " + snapshot.ParsedCount.ToString()
                            + " entries instead of ERROR_NO_MORE_ITEMS";
                        return;
                    }

                    HandleTableEntry record = new HandleTableEntry();
                    record.Value = Marshal.ReadIntPtr(buffer).ToInt64();
                    record.PssFlags = (uint) Marshal.ReadInt32(buffer, IntPtr.Size);
                    record.PssObjectType = (uint) Marshal.ReadInt32(buffer, IntPtr.Size + 4);
                    snapshot.Entries.Add(record);
                    if (record.Value > snapshot.MaxValue) { snapshot.MaxValue = record.Value; }
                    snapshot.ParsedCount++;

                    if (snapshot.ParsedCount > limit)
                    {
                        // النظام أبلغ عددًا، والمشي تجاوزه. تناقض يُسجَّل، ولا يُبتلع.
                        snapshot.Succeeded = false;
                        snapshot.FailureReason =
                            "the walk returned more entries (" + snapshot.ParsedCount.ToString()
                            + ") than PSS_HANDLE_INFORMATION.HandlesCaptured reported ("
                            + snapshot.ReportedCount.ToString() + ")";
                        return;
                    }
                }

                snapshot.Succeeded =
                    snapshot.HandlesCapturedRecorded
                    && snapshot.WalkEndedWithNoMoreItems
                    && snapshot.ParsedCount == snapshot.ReportedCount;
                if (!snapshot.Succeeded)
                {
                    snapshot.FailureReason =
                        "walked " + snapshot.ParsedCount.ToString() + " of "
                        + snapshot.ReportedCount.ToString() + " captured handles";
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
                PssWalkMarkerFree(marker);
            }
        }

        /// <summary>
        /// تسوية طول مخزن الإدخال مع الواجهة. الفاصل جواب الواجهة نفسها
        /// (ERROR_BAD_LENGTH) لا رقم نعتقده. تجري على علّامة مشي مستقلة تُحرَّر
        /// بعدها، فلا تستهلك موضعًا من المشي الحقيقي.
        /// </summary>
        private static int NegotiateEntrySize(HandleTableSnapshot snapshot, int declared)
        {
            for (int size = declared; size <= declared + EntrySizeNegotiationHeadroom; size += 8)
            {
                IntPtr marker = IntPtr.Zero;
                if (PssWalkMarkerCreate(IntPtr.Zero, out marker) != ERROR_SUCCESS) { return -1; }
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    uint status = PssWalkSnapshot(
                        snapshot.CaptureHandle, PSS_WALK_HANDLES, marker, buffer, (uint) size);
                    snapshot.EntrySizeAttempts++;
                    if (status != ERROR_BAD_LENGTH) { return size; }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                    PssWalkMarkerFree(marker);
                }
            }
            return -1;
        }
    }
}
