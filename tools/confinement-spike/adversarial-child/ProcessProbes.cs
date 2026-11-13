using System;
using System.Globalization;
using System.IO;
using System.Threading;
using Polaris.ConfinementSpike.Child.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولات الخروج من حصر العمليات: التوليد، الأحفاد، الانفصال عن Job،
    // التأثير على عملية غير مرتبطة، وحدود الموارد
    internal static class ProcessProbes
    {
        public static void Run(ProbeContext context, OutcomeRecorder recorder)
        {
            string markerPath = Path.Combine(context.EvidenceDirectory, "grandchild-marker.txt");
            TryDeleteMarker(markerPath);

            recorder.Add(SpawnDirectChild(context, markerPath));
            recorder.Add(InspectGrandchildMarker(markerPath));
            recorder.Add(AttemptJobBreakaway(context));
            recorder.Add(AttemptTerminateUnrelated(context));
            recorder.Add(AttemptQueryUnrelated(context));
            recorder.Add(SpawnOrphanCandidate(context));
            recorder.Add(ProbeActiveProcessLimit(context));
            recorder.Add(ProbeMemoryLimit());
        }

        private static void TryDeleteMarker(string markerPath)
        {
            try { if (File.Exists(markerPath)) { File.Delete(markerPath); } }
            catch (Exception) { /* غياب الصلاحية هنا ليس فشلًا، سيظهر لاحقًا في نتيجة P02 */ }
        }

        // P01: توليد عملية ابن مباشرة والتحقق أنها بقيت داخل نفس حدود الحصر
        private static ProbeOutcome SpawnDirectChild(ProbeContext context, string markerPath)
        {
            string arguments = "--role grandchild --self \"" + context.SelfExecutablePath + "\""
                + " --marker \"" + markerPath + "\"";
            SpawnResult result = ProcessSpawner.Spawn(context.SelfExecutablePath, arguments, 0);

            if (!result.Created)
            {
                return new ProbeOutcome("P01", "CreateProcessW self --role grandchild", OutcomeKind.Deny,
                    result.ErrorCode, Win32ErrorNames.Resolve(result.ErrorCode), "spawn refused");
            }

            return new ProbeOutcome("P01", "CreateProcessW self --role grandchild", OutcomeKind.Allow, 0,
                "ERROR_SUCCESS", "pid=" + result.ProcessId + " child_in_job=" + (result.ChildInJob ? "1" : "0"));
        }

        // P02: قراءة أثر الحفيد لإثبات أن الجيل الثالث بقي داخل الحدود
        private static ProbeOutcome InspectGrandchildMarker(string markerPath)
        {
            for (int i = 0; i < 30; i++)
            {
                try
                {
                    if (File.Exists(markerPath))
                    {
                        string content = File.ReadAllText(markerPath).Replace("\r", " ").Replace("\n", " ").Trim();
                        if (content.IndexOf("grandchild_pid", StringComparison.Ordinal) >= 0)
                        {
                            return new ProbeOutcome("P02", "read grandchild marker", OutcomeKind.Allow, 0,
                                "ERROR_SUCCESS", content);
                        }
                    }
                }
                catch (Exception) { /* نعيد المحاولة، الملف قد يكون قيد الكتابة */ }
                Thread.Sleep(200);
            }
            return new ProbeOutcome("P02", "read grandchild marker", OutcomeKind.Error, 0, "TIMEOUT",
                "marker not produced within 6s, grandchild generation unverified");
        }

        // P03: محاولة الانفصال عن Job Object
        private static ProbeOutcome AttemptJobBreakaway(ProbeContext context)
        {
            SpawnResult result = ProcessSpawner.Spawn(context.SelfExecutablePath,
                ProcessSpawner.SleeperArguments(2000), ChildNativeMethods.CREATE_BREAKAWAY_FROM_JOB);

            if (!result.Created)
            {
                return new ProbeOutcome("P03", "CreateProcessW CREATE_BREAKAWAY_FROM_JOB", OutcomeKind.Deny,
                    result.ErrorCode, Win32ErrorNames.Resolve(result.ErrorCode), "breakaway refused by job limits");
            }

            return new ProbeOutcome("P03", "CreateProcessW CREATE_BREAKAWAY_FROM_JOB", OutcomeKind.Allow, 0,
                "ERROR_SUCCESS", "pid=" + result.ProcessId + " escaped_in_job=" + (result.ChildInJob ? "1" : "0"));
        }

        // P05: محاولة إنهاء عملية حارسة خارج الحصر
        private static ProbeOutcome AttemptTerminateUnrelated(ProbeContext context)
        {
            if (context.SentinelProcessId <= 0)
            {
                return new ProbeOutcome("P05", "OpenProcess PROCESS_TERMINATE on sentinel", OutcomeKind.Skipped, 0,
                    "NO_SENTINEL", "launcher did not provide a sentinel pid");
            }

            IntPtr handle = ChildNativeMethods.OpenProcess(
                ChildNativeMethods.PROCESS_TERMINATE | ChildNativeMethods.PROCESS_VM_READ,
                false, (uint)context.SentinelProcessId);

            if (handle == IntPtr.Zero)
            {
                int error = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
                return new ProbeOutcome("P05", "OpenProcess PROCESS_TERMINATE on sentinel", OutcomeKind.Deny, error,
                    Win32ErrorNames.Resolve(error), "sentinel_pid=" + context.SentinelProcessId);
            }

            ChildNativeMethods.CloseHandle(handle);
            // لم نُنهِ العملية فعلًا. مجرد الحصول على المقبض دليل كافٍ على الخطر
            return new ProbeOutcome("P05", "OpenProcess PROCESS_TERMINATE on sentinel", OutcomeKind.Allow, 0,
                "ERROR_SUCCESS", "handle acquired, termination NOT performed, sentinel_pid=" + context.SentinelProcessId);
        }

        private static ProbeOutcome AttemptQueryUnrelated(ProbeContext context)
        {
            if (context.SentinelProcessId <= 0)
            {
                return new ProbeOutcome("P05B", "OpenProcess PROCESS_QUERY_LIMITED_INFORMATION on sentinel",
                    OutcomeKind.Skipped, 0, "NO_SENTINEL", "launcher did not provide a sentinel pid");
            }

            IntPtr handle = ChildNativeMethods.OpenProcess(
                ChildNativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)context.SentinelProcessId);

            if (handle == IntPtr.Zero)
            {
                int error = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
                return new ProbeOutcome("P05B", "OpenProcess PROCESS_QUERY_LIMITED_INFORMATION on sentinel",
                    OutcomeKind.Deny, error, Win32ErrorNames.Resolve(error), "sentinel_pid=" + context.SentinelProcessId);
            }

            ChildNativeMethods.CloseHandle(handle);
            return new ProbeOutcome("P05B", "OpenProcess PROCESS_QUERY_LIMITED_INFORMATION on sentinel",
                OutcomeKind.Allow, 0, "ERROR_SUCCESS", "query handle acquired, sentinel_pid=" + context.SentinelProcessId);
        }

        // P04: توليد عملية طويلة العمر، والـ launcher هو من يتحقق من فنائها بعد إنهاء الـ job
        private static ProbeOutcome SpawnOrphanCandidate(ProbeContext context)
        {
            SpawnResult result = ProcessSpawner.Spawn(context.SelfExecutablePath,
                ProcessSpawner.SleeperArguments(45000), 0);

            if (!result.Created)
            {
                return new ProbeOutcome("P04", "spawn long-lived sleeper (orphan candidate)", OutcomeKind.Deny,
                    result.ErrorCode, Win32ErrorNames.Resolve(result.ErrorCode), "orphan_pid=0");
            }

            return new ProbeOutcome("P04", "spawn long-lived sleeper (orphan candidate)", OutcomeKind.Allow, 0,
                "ERROR_SUCCESS", "orphan_pid=" + result.ProcessId + " in_job=" + (result.ChildInJob ? "1" : "0"));
        }

        // P06A: حد عدد العمليات النشطة. نتوقف عند سقف صغير حتى لا نرهق الجهاز
        private static ProbeOutcome ProbeActiveProcessLimit(ProbeContext context)
        {
            int spawned = 0;
            int lastError = 0;
            for (int i = 0; i < context.MaxSpawnAttempts; i++)
            {
                SpawnResult result = ProcessSpawner.Spawn(context.SelfExecutablePath,
                    ProcessSpawner.SleeperArguments(4000), 0);
                if (!result.Created)
                {
                    lastError = result.ErrorCode;
                    break;
                }
                spawned++;
            }

            if (lastError != 0)
            {
                return new ProbeOutcome("P06A", "spawn until active process limit", OutcomeKind.Deny, lastError,
                    Win32ErrorNames.Resolve(lastError), "spawned_before_limit=" + spawned.ToString(CultureInfo.InvariantCulture));
            }

            return new ProbeOutcome("P06A", "spawn until active process limit", OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                "no limit hit, spawned=" + spawned.ToString(CultureInfo.InvariantCulture)
                + " cap=" + context.MaxSpawnAttempts.ToString(CultureInfo.InvariantCulture));
        }

        // P06B: حد الذاكرة. التخصيص تدريجي وبسقف منخفض حتى لا يتأثر النظام
        private static ProbeOutcome ProbeMemoryLimit()
        {
            const int ChunkMegabytes = 16;
            const int MaxChunks = 25;
            System.Collections.Generic.List<byte[]> blocks = new System.Collections.Generic.List<byte[]>();
            int allocated = 0;
            try
            {
                for (int i = 0; i < MaxChunks; i++)
                {
                    byte[] block = new byte[ChunkMegabytes * 1024 * 1024];
                    // اللمس ضروري لأن التخصيص وحده قد لا يُلزم الذاكرة فعليًا
                    for (int j = 0; j < block.Length; j += 4096) { block[j] = 1; }
                    blocks.Add(block);
                    allocated += ChunkMegabytes;
                }
            }
            catch (OutOfMemoryException)
            {
                blocks.Clear();
                return new ProbeOutcome("P06B", "commit memory until job memory limit", OutcomeKind.Deny, 0,
                    "OUT_OF_MEMORY", "allocated_mb_before_limit=" + allocated.ToString(CultureInfo.InvariantCulture));
            }

            blocks.Clear();
            return new ProbeOutcome("P06B", "commit memory until job memory limit", OutcomeKind.Allow, 0,
                "ERROR_SUCCESS", "no limit hit, allocated_mb=" + allocated.ToString(CultureInfo.InvariantCulture)
                + " cap_mb=" + (ChunkMegabytes * MaxChunks).ToString(CultureInfo.InvariantCulture));
        }
    }
}
