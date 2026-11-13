using System;
using System.Globalization;
using System.IO;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Launcher
{
    // التقاط بيئة التشغيل الحقيقية. التقرير النهائي يجب أن يذكر البناء الدقيق لويندوز
    // لأن سلوك AppContainer يتغير بين الإصدارات
    public static class EnvironmentReport
    {
        public static string Capture()
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("{\n");
            JsonText.WriteStringField(builder, "captured_utc", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture), true);
            JsonText.WriteStringField(builder, "product_name", ReadRegistry("ProductName"), true);
            JsonText.WriteStringField(builder, "display_version", ReadRegistry("DisplayVersion"), true);
            JsonText.WriteStringField(builder, "current_build", ReadRegistry("CurrentBuild"), true);
            JsonText.WriteStringField(builder, "ubr", ReadRegistry("UBR"), true);
            JsonText.WriteStringField(builder, "os_version", Environment.OSVersion.Version.ToString(), true);
            JsonText.WriteStringField(builder, "machine_name_hash", HashOf(Environment.MachineName), true);
            JsonText.WriteStringField(builder, "processor_architecture",
                Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE"), true);
            JsonText.WriteRawField(builder, "os_64bit", Environment.Is64BitOperatingSystem ? "true" : "false", true);
            JsonText.WriteRawField(builder, "process_64bit", Environment.Is64BitProcess ? "true" : "false", true);
            JsonText.WriteStringField(builder, "clr_version", Environment.Version.ToString(), true);
            JsonText.WriteRawField(builder, "elevated", IsElevated() ? "true" : "false", true);
            JsonText.WriteRawField(builder, "windows_sandbox_binary_present",
                File.Exists(@"C:\Windows\System32\WindowsSandbox.exe") ? "true" : "false", true);
            JsonText.WriteRawField(builder, "checknetisolation_present",
                File.Exists(@"C:\Windows\System32\CheckNetIsolation.exe") ? "true" : "false", false);
            builder.Append("}\n");
            return builder.ToString();
        }

        public static bool IsElevated()
        {
            try
            {
                WindowsIdentity identity = WindowsIdentity.GetCurrent();
                WindowsPrincipal principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static string ReadRegistry(string name)
        {
            try
            {
                using (RegistryKey key = RegistryKey
                    .OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                    .OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    if (key == null) { return "unavailable"; }
                    object value = key.GetValue(name);
                    return value == null ? "unavailable" : value.ToString();
                }
            }
            catch (Exception)
            {
                return "unavailable";
            }
        }

        // لا نكتب اسم الجهاز صراحة في الأدلة، بل بصمة قصيرة تكفي للتمييز
        private static string HashOf(string value)
        {
            using (System.Security.Cryptography.SHA256 sha = System.Security.Cryptography.SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? ""));
                StringBuilder builder = new StringBuilder();
                for (int i = 0; i < 6; i++) { builder.Append(hash[i].ToString("x2")); }
                return builder.ToString();
            }
        }
    }
}
