using System;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// تصنيف إخفاق إقلاع المنفّذ من مخرجه التشخيصي وحده.
    ///
    /// لماذا: "لم يستجب المنفّذ" ليس تشخيصًا. الفرق بين وحدة ناقصة من التدريج،
    /// وحلٍّ للوحدة الرئيسية تمنعه الحاوية، وامتداد لا يفهمه محمّل الوحدات، فرقٌ
    /// يغيّر العلاج كلّه. النص التشخيصي موجود في الدليل أصلًا — فليُقرأ ويُسمَّ.
    ///
    /// هذا تصنيف لما وقع، لا حكم أمني: كل الحالات تبقى BLOCKED.
    /// </summary>
    internal static class ExecutorStartupDiagnosis
    {
        internal const string NoDiagnostics = "NO_STARTUP_DIAGNOSTICS";
        internal const string ModuleResolutionAccessDenied = "MODULE_RESOLUTION_ACCESS_DENIED";
        internal const string ModuleNotFound = "MODULE_NOT_FOUND";
        internal const string EsmResolutionFailed = "ESM_RESOLUTION_FAILED";
        internal const string NativeModuleLoadFailed = "NATIVE_MODULE_LOAD_FAILED";
        internal const string ProtocolInputRejected = "PROTOCOL_INPUT_REJECTED";
        internal const string Unclassified = "STARTUP_FAILURE_UNCLASSIFIED";

        /// <summary>يصنّف من مجرى الخطأ. لا يخمّن حين لا يوجد نص يقرؤه.</summary>
        public static string Classify(string diagnostics)
        {
            string text = diagnostics == null ? "" : diagnostics;
            if (text.Trim().Length == 0) { return NoDiagnostics; }

            bool denied = Has(text, "EPERM") || Has(text, "EACCES") || Has(text, "operation not permitted");
            bool resolving = Has(text, "realpath") || Has(text, "lstat")
                || Has(text, "resolveMainPath") || Has(text, "_findPath")
                || Has(text, "toRealPath") || Has(text, "run_main");
            if (denied && resolving) { return ModuleResolutionAccessDenied; }

            if (Has(text, "ERR_MODULE_NOT_FOUND") || Has(text, "Cannot find module")
                || Has(text, "Cannot find package")) { return ModuleNotFound; }
            if (Has(text, "ERR_UNKNOWN_FILE_EXTENSION") || Has(text, "ERR_REQUIRE_ESM")
                || Has(text, "ERR_UNSUPPORTED_DIR_IMPORT") || Has(text, "Cannot use import statement"))
            {
                return EsmResolutionFailed;
            }
            if (Has(text, "STATUS_DLL_NOT_FOUND") || Has(text, "0xc0000135")
                || Has(text, "The specified module could not be found")) { return NativeModuleLoadFailed; }
            if (Has(text, "MALFORMED_GRANT")) { return ProtocolInputRejected; }
            if (denied) { return ModuleResolutionAccessDenied; }
            return Unclassified;
        }

        /// <summary>ما يعنيه التصنيف عمليًّا، بلا وعد بإصلاح لم يُثبت.</summary>
        public static string Explain(string classification)
        {
            if (classification == NoDiagnostics)
            {
                return "the executor wrote nothing to its diagnostic stream, so the failure happened before Node"
                    + " could report it or the process never reached user code";
            }
            if (classification == ModuleResolutionAccessDenied)
            {
                return "Node's module resolution was refused by the operating system. The confined token has no"
                    + " rights on some path element the resolver queries directly - the volume root above all -"
                    + " which is expected for a zero-capability AppContainer. The launch must stop asking for it,"
                    + " not be granted it: see the node_startup_flags recorded in the launch inputs.";
            }
            if (classification == ModuleNotFound)
            {
                return "a module the executor loads was not present in the staged runtime-code scope; the staged"
                    + " import graph is incomplete, which is a staging defect and never a confinement result";
            }
            if (classification == EsmResolutionFailed)
            {
                return "the staged layout did not resolve as ES modules; the package manifest at the root of the"
                    + " granted scope or the built extension paths are wrong";
            }
            if (classification == NativeModuleLoadFailed)
            {
                return "the Windows loader could not load a module the executable needs inside the container";
            }
            if (classification == ProtocolInputRejected)
            {
                return "the executor read its standard input and rejected the grant, so this is a protocol defect"
                    + " in the launcher rather than an AppContainer access result";
            }
            return "the diagnostic stream does not match any known startup failure shape; it is recorded verbatim"
                + " and no cause is claimed";
        }

        private static bool Has(string text, string needle)
        {
            return text.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;
        }
    }
}
