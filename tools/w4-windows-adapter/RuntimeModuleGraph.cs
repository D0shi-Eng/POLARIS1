using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>ضلع في رسم الاستيراد: من أي وحدة، بأي محدِّد، وإلى أي ملف حُلَّ.</summary>
    internal sealed class RuntimeModuleEdge
    {
        public string From = "";
        public string Specifier = "";
        /// <summary>BUILTIN وحدة مدمجة في العقدة. RELATIVE ملف داخل شجرة البناء.</summary>
        public string Kind = "";
        public string Resolved = "";
    }

    /// <summary>
    /// إغلاق رسم الاستيراد لمنفّذ W4 الحقيقي، محسوبًا من نقطة الدخول لا مفترضًا.
    ///
    /// العيب الذي يغلقه هذا الصنف: كان التدريج ينسخ شجرة dist كلها — بما فيها
    /// الاختبارات وما لا يحمّله المنفّذ أصلًا — ثم يثبت الهوية لملفين اثنين فقط.
    /// فالنطاق المحصور كان أوسع من اللازم، والإثبات أضيق من الادّعاء.
    ///
    /// ما يفعله بدلًا من ذلك: يقرأ نقطة الدخول، يستخرج محدِّدات الاستيراد منها،
    /// يحلّها، ويكرّر حتى يُغلق الرسم. كل محدِّد يُصنَّف صراحةً:
    ///   BUILTIN   وحدة مدمجة (node:*). لا تُدرَّج ولا تُطلب.
    ///   RELATIVE  ملف داخل شجرة البناء. يجب أن يوجد، وإلا فالتدريج ناقص.
    /// وأي محدِّد آخر — مجرّد أو مطلق أو ديناميكي غير حرفي — لا يُخمَّن: يُصنَّف
    /// عائقًا باسمه، فلا يُطلق منفّذ ينقصه ما يحمّله.
    /// </summary>
    internal sealed class RuntimeModuleGraph
    {
        internal const string ReasonIncomplete = "RUNTIME_CODE_STAGING_INCOMPLETE";
        internal const string ReasonBare = "RUNTIME_CODE_STAGING_BARE_SPECIFIER";
        internal const string ReasonAbsolute = "RUNTIME_CODE_STAGING_ABSOLUTE_SPECIFIER";
        internal const string ReasonEscapes = "RUNTIME_CODE_STAGING_ESCAPES_RUNTIME_ROOT";
        internal const string ReasonDynamic = "RUNTIME_CODE_STAGING_UNRESOLVABLE_DYNAMIC_IMPORT";
        internal const string ReasonUnreadable = "RUNTIME_CODE_STAGING_MODULE_UNREADABLE";

        private const string SpecifierGroup = "(\"[^\"\\r\\n]*\"|'[^'\\r\\n]*')";

        // import ... from "x" و export ... from "x". الحدّ فاصلة منقوطة، فالاستيراد
        // الممتد على أسطر يُلتقط كما هو.
        private static readonly Regex FromSpecifier = new Regex(
            "(?:^|[^\\w$.])(?:import|export)\\b[^;]*?\\bfrom\\s*" + SpecifierGroup);

        // import "x"; بلا ربط أسماء: أثر جانبي، ويحمَّل فعلًا.
        private static readonly Regex SideEffectImport = new Regex(
            "(?:^|[^\\w$.])import\\s*" + SpecifierGroup + "\\s*;");

        // import("x") الديناميكي بحرفية نصية.
        private static readonly Regex DynamicImport = new Regex(
            "(?:^|[^\\w$.])import\\s*\\(\\s*" + SpecifierGroup + "\\s*\\)");

        // require("x") — ليس في مخرج هذا البناء، ويُلتقط حتى لا يمرّ صامتًا لو ظهر.
        private static readonly Regex RequireCall = new Regex(
            "(?:^|[^\\w$.])require\\s*\\(\\s*" + SpecifierGroup + "\\s*\\)");

        // أي import( لا يليه نص حرفي: لا يُحلّ ساكنًا، ولا يُخمَّن.
        private static readonly Regex NonLiteralDynamicImport = new Regex(
            "(?:^|[^\\w$.])import\\s*\\(\\s*(?![\"'])");

        /// <summary>الوحدات بترتيب الاكتشاف، نقطة الدخول أولًا. مسارات مصدر مطلقة.</summary>
        public List<string> Modules = new List<string>();
        public List<RuntimeModuleEdge> Edges = new List<RuntimeModuleEdge>();
        public string FailureReasonCode = "";
        public string FailureDetail = "";

        /// <summary>
        /// يغلق الرسم انطلاقًا من نقطة الدخول. يعيد false مع سبب مصنَّف عند أول
        /// محدِّد لا يمكن إثبات وجوده داخل شجرة البناء.
        /// </summary>
        public bool Resolve(string distRoot, string entry)
        {
            string root = Path.GetFullPath(distRoot).TrimEnd('\\');
            string start = Path.GetFullPath(entry);
            if (!File.Exists(start))
            {
                FailureReasonCode = ReasonIncomplete;
                FailureDetail = "the execution host entry does not exist at " + start;
                return false;
            }
            if (!Inside(root, start))
            {
                FailureReasonCode = ReasonEscapes;
                FailureDetail = "the execution host entry " + start + " is outside the built runtime tree " + root;
                return false;
            }

            Dictionary<string, bool> seen = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            List<string> pending = new List<string>();
            pending.Add(start);
            seen[start] = true;

            int index = 0;
            while (index < pending.Count)
            {
                string module = pending[index];
                index++;
                Modules.Add(module);

                string text;
                try
                {
                    text = File.ReadAllText(module);
                }
                catch (Exception error)
                {
                    FailureReasonCode = ReasonUnreadable;
                    FailureDetail = "the runtime module " + module + " could not be read: "
                        + error.GetType().Name + ": " + error.Message;
                    return false;
                }

                if (NonLiteralDynamicImport.IsMatch(text))
                {
                    FailureReasonCode = ReasonDynamic;
                    FailureDetail = "the runtime module " + module
                        + " contains a dynamic import whose specifier is not a string literal, so the staged"
                        + " artifact graph cannot be proven complete before launch";
                    return false;
                }

                List<string> specifiers = new List<string>();
                Collect(FromSpecifier, text, specifiers);
                Collect(SideEffectImport, text, specifiers);
                Collect(DynamicImport, text, specifiers);
                Collect(RequireCall, text, specifiers);

                for (int i = 0; i < specifiers.Count; i++)
                {
                    string specifier = specifiers[i];
                    RuntimeModuleEdge edge = new RuntimeModuleEdge();
                    edge.From = module;
                    edge.Specifier = specifier;

                    if (IsBuiltin(specifier))
                    {
                        edge.Kind = "BUILTIN";
                        Edges.Add(edge);
                        continue;
                    }
                    if (specifier.IndexOf('?') >= 0 || specifier.IndexOf('#') >= 0)
                    {
                        FailureReasonCode = ReasonIncomplete;
                        FailureDetail = "the specifier " + specifier + " in " + module
                            + " carries a query or fragment and cannot be resolved to a single staged file";
                        return false;
                    }
                    if (IsAbsolute(specifier))
                    {
                        FailureReasonCode = ReasonAbsolute;
                        FailureDetail = "the specifier " + specifier + " in " + module
                            + " is an absolute or URL specifier; the confined executor must reach nothing outside"
                            + " the staged runtime-code scope";
                        return false;
                    }
                    if (!IsRelative(specifier))
                    {
                        FailureReasonCode = ReasonBare;
                        FailureDetail = "the specifier " + specifier + " in " + module
                            + " is a bare package specifier; no repository node_modules is part of the staged"
                            + " runtime contract, so it cannot be resolved inside the container";
                        return false;
                    }

                    string resolved = Path.GetFullPath(Path.Combine(
                        Path.GetDirectoryName(module), specifier.Replace('/', '\\')));
                    if (!Inside(root, resolved))
                    {
                        FailureReasonCode = ReasonEscapes;
                        FailureDetail = "the specifier " + specifier + " in " + module + " resolves to "
                            + resolved + ", which is outside the built runtime tree " + root;
                        return false;
                    }
                    if (!File.Exists(resolved))
                    {
                        FailureReasonCode = ReasonIncomplete;
                        FailureDetail = "the specifier " + specifier + " in " + module + " resolves to "
                            + resolved + ", which does not exist; the staged executor would be missing a module"
                            + " it loads at startup";
                        return false;
                    }

                    edge.Kind = "RELATIVE";
                    edge.Resolved = resolved;
                    Edges.Add(edge);

                    if (!seen.ContainsKey(resolved))
                    {
                        seen[resolved] = true;
                        pending.Add(resolved);
                    }
                }
            }
            return true;
        }

        internal void Emit(JsonWriter json)
        {
            json.Name("runtime_code_graph").BeginObject();
            json.Property("module_count", Modules.Count);
            json.Property("edge_count", Edges.Count);
            json.Name("edges").BeginArray();
            for (int i = 0; i < Edges.Count; i++)
            {
                RuntimeModuleEdge edge = Edges[i];
                json.BeginObject();
                json.Property("from", edge.From);
                json.Property("specifier", edge.Specifier);
                json.Property("kind", edge.Kind);
                json.Property("resolved", edge.Resolved);
                json.EndObject();
            }
            json.EndArray();
            json.EndObject();
        }

        private static void Collect(Regex pattern, string text, List<string> into)
        {
            Match match = pattern.Match(text);
            while (match.Success)
            {
                string literal = match.Groups[1].Value;
                if (literal.Length >= 2)
                {
                    string specifier = literal.Substring(1, literal.Length - 2);
                    if (specifier.Length > 0 && !into.Contains(specifier)) { into.Add(specifier); }
                }
                match = match.NextMatch();
            }
        }

        private static bool IsBuiltin(string specifier)
        {
            return specifier.StartsWith("node:", StringComparison.Ordinal);
        }

        private static bool IsRelative(string specifier)
        {
            return specifier.StartsWith("./", StringComparison.Ordinal)
                || specifier.StartsWith("../", StringComparison.Ordinal);
        }

        private static bool IsAbsolute(string specifier)
        {
            if (specifier.StartsWith("/", StringComparison.Ordinal)) { return true; }
            if (specifier.IndexOf("://", StringComparison.Ordinal) >= 0) { return true; }
            if (specifier.Length >= 2 && specifier[1] == ':') { return true; }
            return false;
        }

        private static bool Inside(string root, string candidate)
        {
            return candidate.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase)
                || string.Equals(candidate, root, StringComparison.OrdinalIgnoreCase);
        }
    }
}
