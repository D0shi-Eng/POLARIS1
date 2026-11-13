using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Polaris.ConfinementSpike.Launcher
{
    // تحضير بيئة الاختبار المعزولة وإرجاعها إلى حالتها بعد الانتهاء.
    // كل ما يُنشأ هنا داخل جذر المشروع فقط، ولا يُلمس أي مسار نظام
    public sealed class FixtureManager
    {
        private readonly string _root;
        private readonly List<string> _log = new List<string>();
        private string _outsideHashBefore;

        public FixtureManager(string fixtureRoot)
        {
            _root = fixtureRoot.TrimEnd('\\');
        }

        public string Root { get { return _root; } }
        public string AllowedDirectory { get { return Path.Combine(_root, "allowed"); } }
        public string DeniedDirectory { get { return Path.Combine(_root, "denied"); } }
        public string OutsideDirectory { get { return Path.Combine(_root, "outside"); } }
        public string DeniedSecretFile { get { return Path.Combine(DeniedDirectory, "secret.txt"); } }
        public string JunctionPath { get { return Path.Combine(AllowedDirectory, "escape_junction"); } }
        public string SymlinkPath { get { return Path.Combine(AllowedDirectory, "escape_symlink"); } }
        public IList<string> Log { get { return _log; } }
        public bool JunctionCreated { get; private set; }
        public bool SymlinkCreated { get; private set; }
        public string SymlinkFailureReason { get; private set; }

        public void Prepare()
        {
            Directory.CreateDirectory(AllowedDirectory);
            Directory.CreateDirectory(Path.Combine(AllowedDirectory, "output"));
            Directory.CreateDirectory(DeniedDirectory);
            Directory.CreateDirectory(OutsideDirectory);

            RemoveReparsePoint(JunctionPath);
            RemoveReparsePoint(SymlinkPath);
            RemoveIfExists(Path.Combine(OutsideDirectory, "escape_write.txt"));
            RemoveIfExists(Path.Combine(AllowedDirectory, "output\\result.txt"));

            JunctionCreated = CreateLink("/J", JunctionPath, DeniedDirectory);
            SymlinkCreated = CreateLink("/D", SymlinkPath, DeniedDirectory);
            if (!SymlinkCreated)
            {
                SymlinkFailureReason = "mklink /D failed; directory symlinks require Administrator or Developer Mode";
            }

            _outsideHashBefore = HashFile(Path.Combine(OutsideDirectory, "untouched.txt"));
            _log.Add("FIXTURE prepared at " + _root
                + " junction=" + JunctionCreated + " symlink=" + SymlinkCreated);
        }

        public bool OutsideFileUntouched()
        {
            string after = HashFile(Path.Combine(OutsideDirectory, "untouched.txt"));
            bool same = string.Equals(_outsideHashBefore, after, StringComparison.Ordinal);
            _log.Add("FIXTURE outside/untouched.txt integrity=" + (same ? "unchanged" : "CHANGED"));
            return same;
        }

        public bool EscapeWriteFileExists()
        {
            return File.Exists(Path.Combine(OutsideDirectory, "escape_write.txt"));
        }

        public void Cleanup()
        {
            RemoveReparsePoint(JunctionPath);
            RemoveReparsePoint(SymlinkPath);
            _log.Add("FIXTURE reparse points removed");
        }

        private bool CreateLink(string switchName, string linkPath, string targetPath)
        {
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo("cmd.exe",
                    "/c mklink " + switchName + " \"" + linkPath + "\" \"" + targetPath + "\"");
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                startInfo.CreateNoWindow = true;

                using (Process process = Process.Start(startInfo))
                {
                    string output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                    process.WaitForExit(10000);
                    _log.Add("MKLINK " + switchName + " exit=" + process.ExitCode + " " + output.Replace("\r", " ").Replace("\n", " ").Trim());
                    return process.ExitCode == 0 && Directory.Exists(linkPath);
                }
            }
            catch (Exception ex)
            {
                _log.Add("MKLINK " + switchName + " threw " + ex.GetType().Name);
                return false;
            }
        }

        // حذف نقطة إعادة التوجيه دون اتباعها، حتى لا نمس محتوى الهدف
        private void RemoveReparsePoint(string path)
        {
            if (!Directory.Exists(path))
            {
                return;
            }
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo("cmd.exe", "/c rmdir \"" + path + "\"");
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                using (Process process = Process.Start(startInfo))
                {
                    process.WaitForExit(10000);
                }
            }
            catch (Exception ex)
            {
                _log.Add("RMDIR failed for " + path + " " + ex.GetType().Name);
            }
        }

        private void RemoveIfExists(string path)
        {
            try { if (File.Exists(path)) { File.Delete(path); } }
            catch (Exception ex) { _log.Add("DELETE failed for " + path + " " + ex.GetType().Name); }
        }

        private static string HashFile(string path)
        {
            try
            {
                using (SHA256 sha = SHA256.Create())
                using (FileStream stream = File.OpenRead(path))
                {
                    byte[] hash = sha.ComputeHash(stream);
                    StringBuilder builder = new StringBuilder();
                    for (int i = 0; i < hash.Length; i++) { builder.Append(hash[i].ToString("x2")); }
                    return builder.ToString();
                }
            }
            catch (Exception)
            {
                return "HASH_UNAVAILABLE";
            }
        }
    }
}
