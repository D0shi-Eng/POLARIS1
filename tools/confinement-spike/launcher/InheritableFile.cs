using System;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // فتح ملفات بمقابض قابلة للتوريث، وهي الطريقة الوحيدة لإعطاء الطفل مخرجات قياسية
    // ولاختبار تسرب المقابض عمدًا
    internal static class InheritableFile
    {
        public static IntPtr CreateForWrite(string path)
        {
            ProcessNativeMethods.SECURITY_ATTRIBUTES attributes = new ProcessNativeMethods.SECURITY_ATTRIBUTES();
            attributes.nLength = Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_ATTRIBUTES));
            attributes.lpSecurityDescriptor = IntPtr.Zero;
            attributes.bInheritHandle = true;

            return ProcessNativeMethods.CreateFileW(
                path,
                ProcessNativeMethods.GENERIC_WRITE,
                ProcessNativeMethods.FILE_SHARE_READ | ProcessNativeMethods.FILE_SHARE_WRITE,
                ref attributes,
                ProcessNativeMethods.CREATE_ALWAYS,
                ProcessNativeMethods.FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
        }

        public static IntPtr OpenForRead(string path)
        {
            ProcessNativeMethods.SECURITY_ATTRIBUTES attributes = new ProcessNativeMethods.SECURITY_ATTRIBUTES();
            attributes.nLength = Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_ATTRIBUTES));
            attributes.lpSecurityDescriptor = IntPtr.Zero;
            attributes.bInheritHandle = true;

            return ProcessNativeMethods.CreateFileW(
                path,
                ProcessNativeMethods.GENERIC_READ,
                ProcessNativeMethods.FILE_SHARE_READ | ProcessNativeMethods.FILE_SHARE_WRITE,
                ref attributes,
                ProcessNativeMethods.OPEN_EXISTING,
                ProcessNativeMethods.FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
        }

        public static void Close(IntPtr handle)
        {
            if (handle != IntPtr.Zero && handle != ProcessNativeMethods.INVALID_HANDLE_VALUE)
            {
                ProcessNativeMethods.CloseHandle(handle);
            }
        }
    }
}
