using System;

namespace Polaris.ConfinementSpike.Child
{
    // كل ما يحتاجه البرنامج العدائي لتنفيذ محاولاته، يُمرَّر من الـ launcher عبر سطر الأوامر.
    // لا نستخدم متغيرات البيئة لتمرير الإعدادات لأن وراثة البيئة نفسها أحد ما نختبره
    public sealed class ProbeContext
    {
        // جذر بيئة الاختبار المعزولة
        public string FixtureRoot;

        // مجلد الأدلة الخاص بهذا التشغيل
        public string EvidenceDirectory;

        // مسار ملف تقرير المحاولات
        public string ReportPath;

        // مسار نسخة البرنامج العدائي نفسه، يُستخدم لتوليد الأبناء والأحفاد
        public string SelfExecutablePath;

        // معرف عملية حارسة يشغّلها الـ launcher خارج الحصر، لاختبار التأثير على عملية غير مرتبطة
        public int SentinelProcessId;

        // مقبض ملف ممنوع سُرّب عمدًا عبر الوراثة، لاختبار تسرب المقابض. صفر يعني لا تسريب
        public IntPtr LeakedFileHandle;

        // منفذ محلي يستمع عليه الـ launcher لاختبار loopback
        public int LoopbackPort;

        // اسم نمط التشغيل الحالي لتوثيق الدليل
        public string Variant;

        // عدد المحاولات القصوى عند اختبار حد عدد العمليات، حتى لا نرهق الجهاز
        public int MaxSpawnAttempts;
    }
}
