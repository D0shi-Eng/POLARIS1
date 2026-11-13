using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// تعداد جدول مقابض عملية هدف عبر واجهة ويندوز الداخلية
    /// NtQueryInformationProcess(ProcessHandleInformation).
    ///
    /// صنف هذه الواجهة: داخلية، لا عامة. مايكروسوفت تنصّ في توثيق
    /// NtQueryInformationProcess على أنها "may be altered or unavailable in future
    /// versions of Windows"، وأن الدالة والبنى التي تعيدها "internal to the
    /// operating system and subject to change from one release of Windows to
    /// another". وصفحة PROCESSINFOCLASS العامة لا تذكر ProcessHandleInformation
    /// (51) ضمن ما توثّقه، فلا يجوز وصفه بأنه موثّق رسميًا.
    ///
    /// ولذلك ليست هذه واجهة التعداد الأساسية في POLARIS. الأساسية هي
    /// PssHandleEnumeration: Process Snapshotting API العامة في kernel32. راجع
    /// ADR-007 بعد تصحيحه.
    ///
    /// دور هذا الملف اثنان لا ثالث لهما:
    ///   1) شاهد ثانٍ مستقل على تعداد PSS. اختلاف المصدرين لا يُدمج ولا يُخفى:
    ///      يصير الحكم INCONCLUSIVE برمز HANDLE_ENUMERATION_SOURCES_DISAGREE.
    ///   2) مسار احتياطي معلن حين تتعذّر الواجهة العامة على الجهاز. يُسجَّل حينها
    ///      أن مصدر التعداد داخلي، ولا يُخفَّف شرط اكتمال واحد بسبب ذلك.
    ///
    /// وهي أيضًا مصدر الحقول الوصفية (الصلاحية الممنوحة، دليل النوع، السمات) التي
    /// لا تعطيها PSS كحقول معتمَدة — الوثيقة تصف نظائرها في PSS_HANDLE_ENTRY بأنها
    /// محجوزة لاستعمال النظام. هذه الحقول وصفية في الدليل ولا يُبنى عليها حكم.
    ///
    /// العزل: هذا الملف هو المكان الوحيد الذي يلمس ntdll. لا يظهر شيء من هذا في
    /// عقود المجال ولا في runtime.
    ///
    /// وإن فشلت الواجهة لأي سبب، لا يُقرأ ذلك نظافةً: تعود اللقطة بـSucceeded=false
    /// ومعها رمز NTSTATUS.
    /// </summary>
    internal static class NtHandleEnumeration
    {
        internal const string MethodName = "NT_PROCESS_HANDLE_SNAPSHOT";

        // ليس ضمن عقد PROCESSINFOCLASS العام الذي توثّقه مايكروسوفت.
        private const int ProcessHandleInformation = 51;
        private const uint STATUS_SUCCESS = 0x00000000;
        private const uint STATUS_INFO_LENGTH_MISMATCH = 0xC0000004;

        // حد التوسعة مشتق من سلوك الواجهة نفسها (تضاعف حتى تتسع)، لا من رقم
        // يمثّل حدًّا مزعومًا لجدول المقابض. لا يوجد هنا سقف لقيم المقابض.
        private const int MaxGrowthAttempts = 16;

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_HANDLE_TABLE_ENTRY_INFO
        {
            internal IntPtr HandleValue;
            internal IntPtr HandleCount;
            internal IntPtr PointerCount;
            internal uint GrantedAccess;
            internal uint ObjectTypeIndex;
            internal uint HandleAttributes;
            internal uint Reserved;
        }

        [DllImport("ntdll.dll")]
        private static extern uint NtQueryInformationProcess(
            IntPtr processHandle,
            int processInformationClass,
            IntPtr processInformation,
            uint processInformationLength,
            out uint returnLength);

        internal static HandleTableSnapshot Query(IntPtr targetProcess)
        {
            HandleTableSnapshot snapshot = new HandleTableSnapshot();
            snapshot.Attempted = true;
            snapshot.Method = MethodName;
            snapshot.ApiClass = "INTERNAL_UNDOCUMENTED";

            uint length = 8192;
            for (int attempt = 0; attempt < MaxGrowthAttempts; attempt++)
            {
                IntPtr buffer = Marshal.AllocHGlobal((int) length);
                try
                {
                    uint returned = 0;
                    uint status;
                    try
                    {
                        status = NtQueryInformationProcess(
                            targetProcess, ProcessHandleInformation, buffer, length, out returned);
                    }
                    catch (Exception error)
                    {
                        snapshot.Succeeded = false;
                        snapshot.Available = false;
                        snapshot.FailureReason =
                            "NtQueryInformationProcess threw " + error.GetType().Name + ": " + error.Message;
                        return snapshot;
                    }

                    snapshot.NtStatus = status;

                    if (status == STATUS_INFO_LENGTH_MISMATCH)
                    {
                        // الطول يتحدد بما يطلبه النظام، أو بالتضاعف إن لم يُبلَّغ.
                        uint next = returned > length ? returned + 4096 : length * 2;
                        if (next <= length)
                        {
                            snapshot.Succeeded = false;
                            snapshot.FailureReason = "the required buffer length did not grow between attempts";
                            return snapshot;
                        }
                        length = next;
                        continue;
                    }

                    if (status != STATUS_SUCCESS)
                    {
                        snapshot.Succeeded = false;
                        snapshot.Available = false;
                        snapshot.FailureReason =
                            "NtQueryInformationProcess(ProcessHandleInformation) returned NTSTATUS 0x"
                            + status.ToString("x8");
                        return snapshot;
                    }

                    snapshot.Available = true;
                    Parse(buffer, length, snapshot);
                    return snapshot;
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }

            snapshot.Succeeded = false;
            snapshot.FailureReason =
                "the handle snapshot did not fit after " + MaxGrowthAttempts.ToString() + " growth attempts";
            return snapshot;
        }

        private static void Parse(IntPtr buffer, uint length, HandleTableSnapshot snapshot)
        {
            // PROCESS_HANDLE_SNAPSHOT_INFORMATION: NumberOfHandles ثم Reserved ثم المصفوفة.
            snapshot.ReportedCount = Marshal.ReadIntPtr(buffer).ToInt64();
            int entrySize = Marshal.SizeOf(typeof(PROCESS_HANDLE_TABLE_ENTRY_INFO));
            long offset = IntPtr.Size * 2;

            for (long index = 0; index < snapshot.ReportedCount; index++)
            {
                if (offset + entrySize > (long) length)
                {
                    // النظام أبلغ عددًا أكبر مما يسع المخزن المقروء: تعداد ناقص،
                    // ويُسجَّل ناقصًا بدل أن يُقرأ اكتمالًا.
                    snapshot.Succeeded = false;
                    snapshot.FailureReason =
                        "the reported handle count (" + snapshot.ReportedCount.ToString()
                        + ") exceeds the entries the returned buffer can hold ("
                        + snapshot.ParsedCount.ToString() + " parsed)";
                    return;
                }

                PROCESS_HANDLE_TABLE_ENTRY_INFO entry =
                    (PROCESS_HANDLE_TABLE_ENTRY_INFO) Marshal.PtrToStructure(
                        new IntPtr(buffer.ToInt64() + offset), typeof(PROCESS_HANDLE_TABLE_ENTRY_INFO));

                HandleTableEntry record = new HandleTableEntry();
                record.Value = entry.HandleValue.ToInt64();
                record.GrantedAccess = entry.GrantedAccess;
                record.ObjectTypeIndex = entry.ObjectTypeIndex;
                record.HandleAttributes = entry.HandleAttributes;
                snapshot.Entries.Add(record);
                if (record.Value > snapshot.MaxValue) { snapshot.MaxValue = record.Value; }

                snapshot.ParsedCount++;
                offset += entrySize;
            }

            snapshot.Succeeded = snapshot.ParsedCount == snapshot.ReportedCount;
            if (!snapshot.Succeeded)
            {
                snapshot.FailureReason =
                    "parsed " + snapshot.ParsedCount.ToString() + " of " + snapshot.ReportedCount.ToString()
                    + " reported handles";
            }
        }
    }
}
