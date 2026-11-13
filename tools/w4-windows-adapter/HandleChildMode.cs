using System;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// وضع الابن في اختبار X03: يفحص جدول مقابضه هو، ويحاول القراءة منها.
    ///
    /// وجوده ضروري للضابط الموجب: لا معنى لقول "لم يتسرب مقبض" ما لم يُثبَت أولًا
    /// أن هذا الفحص يكتشف تسربًا حقيقيًا حين يقع.
    ///
    /// التعداد هنا هو نفسه التعداد الذي يستعمله الوالد: جدول المقابض كاملًا من
    /// النواة، بلا سقف قيمة مخترع.
    /// </summary>
    internal static class HandleChildMode
    {
        internal static int Run(Options options)
        {
            string canary = options.Get("canary", "");
            string scope = options.Get("scope", "");

            HandleScanContext context = new HandleScanContext();
            context.ScopeRoots = scope.Length == 0 ? new string[0] : scope.Split(';');
            context.Canary = canary;
            context.Phase = "SELF";

            HandleScanResult result = HandleScanner.Scan(NativeExtras.GetCurrentProcess(), context);

            JsonWriter json = new JsonWriter();
            json.BeginObject();
            json.Property("role", "handle-child");
            json.Property("process_id", NativeExtras.GetCurrentProcessId());
            HandleScanner.Emit(json, "handles", result);
            json.EndObject();

            Console.Out.Write(json.ToString());
            Console.Out.Flush();
            return 0;
        }
    }
}
