using System;
using System.IO;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Child.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولات تتعلق ببيئة التشغيل الموروثة: المجلد الحالي، متغيرات البيئة،
    // المقابض المسربة، واستدعاء الأصداف النظامية
    internal static class EnvironmentProbes
    {
        public static void Run(ProbeContext context, OutcomeRecorder recorder)
        {
            recorder.Add(CurrentDirectory());
            recorder.Add(EnvironmentCanary());
            recorder.Add(LeakedHandleRead(context));
            recorder.Add(SpawnShell("X04", "C:\\Windows\\System32\\cmd.exe", "cmd.exe /c exit 0"));
            recorder.Add(SpawnShell("X05", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                "powershell.exe -NoProfile -NonInteractive -Command exit 0"));
        }

        private static ProbeOutcome CurrentDirectory()
        {
            try
            {
                string current = Directory.GetCurrentDirectory();
                return new ProbeOutcome("X01", "Directory.GetCurrentDirectory", OutcomeKind.Allow, 0,
                    "ERROR_SUCCESS", "cwd=" + current);
            }
            catch (Exception ex)
            {
                return new ProbeOutcome("X01", "Directory.GetCurrentDirectory", OutcomeKind.Error, 0,
                    "MANAGED_EXCEPTION", ex.GetType().Name);
            }
        }

        private static ProbeOutcome EnvironmentCanary()
        {
            string value = Environment.GetEnvironmentVariable("POLARIS_W1_ENV_CANARY");
            if (string.IsNullOrEmpty(value))
            {
                return new ProbeOutcome("X02", "read POLARIS_W1_ENV_CANARY", OutcomeKind.Deny, 0, "NO_ENV",
                    "environment canary not inherited");
            }
            return new ProbeOutcome("X02", "read POLARIS_W1_ENV_CANARY", OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                "canary=" + value);
        }

        // اختبار متعمد لتسرب المقابض: الـ launcher يورّث مقبضًا لملف ممنوع.
        // إن نجحت القراءة فهذا يثبت أن AppContainer لا يبطل المقابض المفتوحة مسبقًا
        private static ProbeOutcome LeakedHandleRead(ProbeContext context)
        {
            if (context.LeakedFileHandle == IntPtr.Zero)
            {
                return new ProbeOutcome("X03", "read denied file via inherited handle", OutcomeKind.Skipped, 0,
                    "NOT_PROVIDED", "launcher did not leak a handle in this variant");
            }
            return FileAttempt.ReadFromHandle("X03", context.LeakedFileHandle, "inherited handle to denied/secret.txt", false);
        }

        private static ProbeOutcome SpawnShell(string id, string imagePath, string commandLine)
        {
            ChildNativeMethods.STARTUPINFO startupInfo = new ChildNativeMethods.STARTUPINFO();
            startupInfo.cb = Marshal.SizeOf(typeof(ChildNativeMethods.STARTUPINFO));
            ChildNativeMethods.PROCESS_INFORMATION processInformation;

            bool created = ChildNativeMethods.CreateProcessW(
                null,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                ChildNativeMethods.CREATE_NO_WINDOW,
                IntPtr.Zero,
                null,
                ref startupInfo,
                out processInformation);

            if (!created)
            {
                int error = Marshal.GetLastWin32Error();
                string outcome = (error == 5) ? OutcomeKind.Deny : OutcomeKind.Error;
                return new ProbeOutcome(id, "CreateProcessW " + imagePath, outcome, error,
                    Win32ErrorNames.Resolve(error), "shell invocation blocked or failed");
            }

            bool inJob = false;
            ChildNativeMethods.IsProcessInJob(processInformation.hProcess, IntPtr.Zero, out inJob);
            ChildNativeMethods.CloseHandle(processInformation.hThread);
            ChildNativeMethods.CloseHandle(processInformation.hProcess);

            return new ProbeOutcome(id, "CreateProcessW " + imagePath, OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                "pid=" + processInformation.dwProcessId + " child_in_job=" + (inJob ? "1" : "0"));
        }
    }
}
