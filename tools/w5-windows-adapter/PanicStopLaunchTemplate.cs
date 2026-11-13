using System;
using System.Collections.Generic;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>
    /// شكل الإطلاق الإنتاجي لـW5-P01، مصدرًا واحدًا.
    ///
    /// العيب الذي يغلقه: معايرةٌ تُجرى على شكل إطلاق يخالف الإنتاج تُثبت شيئًا
    /// عن غير المقيس. هنا الشكل واحد — الملف التنفيذي، وسطر الأوامر بأعلامه
    /// وتوقيعه، ومجلد العمل، والحاوية، وقائمة المقابض الصريحة — ولا يختلف بين
    /// المعايرة والقياس إلا ما يُقصد اختلافه: خريطة البيئة، والـJob، وهل هو
    /// إنشاءٌ يليه إنهاء فوري أم إطلاق حقيقي.
    ///
    /// وضعية الأمان ليست معاملًا: صفر قدرات، وقائمة مقابض صريحة، وفحص المقابض
    /// قبل الاستئناف مفروضًا — كلها مثبَّتة هنا ولا تُمرَّر من الخارج.
    /// </summary>
    internal sealed class PanicStopLaunchTemplate
    {
        public string ExecutablePath = "";
        public string HostScriptPath = "";
        public string WorkingDirectory = "";
        public string Nonce = "";
        public IntPtr AppContainerSid = IntPtr.Zero;
        public string[] ScopeRoots = new string[0];

        /// <summary>أعلام مفسّر العقدة. تُسجَّل في الدليل وتدخل سطر الأوامر معًا.</summary>
        public static readonly string[] NodeFlags =
            new string[] { "--preserve-symlinks-main", "--preserve-symlinks" };

        public string[] Arguments()
        {
            List<string> arguments = new List<string>();
            arguments.AddRange(NodeFlags);
            arguments.Add(HostScriptPath);
            arguments.Add(Nonce);
            return arguments.ToArray();
        }

        public string CommandLine()
        {
            return ConfinedLauncher.BuildCommandLine(ExecutablePath, Arguments());
        }

        /// <summary>
        /// يبني حالة إطلاق واحدة. createOnly = إنشاء معلّق ثم إنهاء فوري: قياس
        /// قابلية الإطلاق وحدها، بلا استئناف ولا مخرجات ولا ادّعاء أمني.
        /// </summary>
        public LaunchSpec Build(
            Dictionary<string, string> environment,
            IntPtr jobHandle,
            bool createOnly,
            IPipeObserver stdoutObserver,
            int timeoutMilliseconds)
        {
            LaunchSpec spec = new LaunchSpec();
            spec.ExecutablePath = ExecutablePath;
            spec.UseExplicitApplicationName = true;
            spec.NodeStartupFlags = NodeFlags;
            spec.CommandLine = CommandLine();
            spec.RequiredFiles = new string[] { ExecutablePath, HostScriptPath };
            spec.WorkingDirectory = WorkingDirectory;
            spec.Environment = environment;
            spec.Inheritance = InheritanceMode.ExplicitHandleList;
            spec.AppContainerSid = AppContainerSid;
            spec.JobHandle = jobHandle;
            spec.ScopeRoots = ScopeRoots;
            spec.CreateOnly = createOnly;
            spec.UseAmbientEnvironment = false;
            // الفحص وهي معلّقة شرط تنفيذ لا وصف، ويبقى مفروضًا في الإطلاق الحقيقي.
            spec.ScanHandlesBeforeResume = !createOnly;
            spec.EnforceHandleScope = !createOnly;
            spec.ScanHandlesAfterResume = false;
            spec.StdoutObserver = stdoutObserver;
            spec.TimeoutMilliseconds = timeoutMilliseconds;
            return spec;
        }
    }
}
