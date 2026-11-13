using System;
using System.Runtime.InteropServices;
using System.Text;
using Polaris.ConfinementSpike.Child.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // عمليات ملفات منخفضة المستوى تُرجع نتيجة خام مع رقم خطأ Windows الحقيقي
    internal static class FileAttempt
    {
        public static ProbeOutcome Read(string id, string path)
        {
            IntPtr handle = ChildNativeMethods.CreateFileW(
                path,
                ChildNativeMethods.GENERIC_READ,
                ChildNativeMethods.FILE_SHARE_READ | ChildNativeMethods.FILE_SHARE_WRITE,
                IntPtr.Zero,
                ChildNativeMethods.OPEN_EXISTING,
                ChildNativeMethods.FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);

            if (handle == ChildNativeMethods.INVALID_HANDLE_VALUE)
            {
                int error = Marshal.GetLastWin32Error();
                // نميز بوضوح بين المنع الأمني وبين عدم وجود الملف حتى لا ينجح الاختبار لسبب خاطئ
                string outcome = (error == 5) ? OutcomeKind.Deny : OutcomeKind.Error;
                if (error == 5)
                {
                    outcome = OutcomeKind.Deny;
                }
                return new ProbeOutcome(id, "CreateFileW GENERIC_READ " + path, outcome, error,
                    Win32ErrorNames.Resolve(error), "open failed, path=" + path);
            }

            return ReadFromHandle(id, handle, path, true);
        }

        public static ProbeOutcome ReadFromHandle(string id, IntPtr handle, string label, bool closeHandle)
        {
            try
            {
                byte[] buffer = new byte[512];
                uint read;
                bool ok = ChildNativeMethods.ReadFile(handle, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    return new ProbeOutcome(id, "ReadFile " + label, OutcomeKind.Deny, error,
                        Win32ErrorNames.Resolve(error), "read failed after successful open");
                }

                string content = Encoding.UTF8.GetString(buffer, 0, (int)read);
                string canary = ExtractCanary(content);
                return new ProbeOutcome(id, "ReadFile " + label, OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                    "bytes=" + read + " canary=" + canary);
            }
            finally
            {
                if (closeHandle)
                {
                    ChildNativeMethods.CloseHandle(handle);
                }
            }
        }

        public static ProbeOutcome Write(string id, string path, string content)
        {
            IntPtr handle = ChildNativeMethods.CreateFileW(
                path,
                ChildNativeMethods.GENERIC_WRITE,
                0,
                IntPtr.Zero,
                ChildNativeMethods.CREATE_ALWAYS,
                ChildNativeMethods.FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);

            if (handle == ChildNativeMethods.INVALID_HANDLE_VALUE)
            {
                int error = Marshal.GetLastWin32Error();
                string outcome = (error == 5) ? OutcomeKind.Deny : OutcomeKind.Error;
                return new ProbeOutcome(id, "CreateFileW GENERIC_WRITE " + path, outcome, error,
                    Win32ErrorNames.Resolve(error), "create failed, path=" + path);
            }

            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(content);
                uint written;
                bool ok = ChildNativeMethods.WriteFile(handle, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    return new ProbeOutcome(id, "WriteFile " + path, OutcomeKind.Deny, error,
                        Win32ErrorNames.Resolve(error), "write failed after successful create");
                }
                return new ProbeOutcome(id, "WriteFile " + path, OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                    "bytes=" + written);
            }
            finally
            {
                ChildNativeMethods.CloseHandle(handle);
            }
        }

        public static ProbeOutcome ListDirectory(string id, string directoryPath)
        {
            ChildNativeMethods.WIN32_FIND_DATA data;
            string pattern = directoryPath.TrimEnd('\\') + "\\*";
            IntPtr find = ChildNativeMethods.FindFirstFileW(pattern, out data);
            if (find == ChildNativeMethods.INVALID_HANDLE_VALUE)
            {
                int error = Marshal.GetLastWin32Error();
                string outcome = (error == 5) ? OutcomeKind.Deny : OutcomeKind.Error;
                return new ProbeOutcome(id, "FindFirstFileW " + pattern, outcome, error,
                    Win32ErrorNames.Resolve(error), "enumeration failed");
            }
            ChildNativeMethods.FindClose(find);
            return new ProbeOutcome(id, "FindFirstFileW " + pattern, OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                "first entry=" + data.cFileName);
        }

        // نستخرج علامة القناري لإثبات أن القراءة وصلت للمحتوى الحقيقي وليست قراءة فارغة
        private static string ExtractCanary(string content)
        {
            int index = content.IndexOf("CANARY_", StringComparison.Ordinal);
            if (index < 0)
            {
                return "none";
            }
            int end = content.IndexOfAny(new char[] { '\r', '\n' }, index);
            if (end < 0)
            {
                end = content.Length;
            }
            return content.Substring(index, end - index);
        }
    }
}
