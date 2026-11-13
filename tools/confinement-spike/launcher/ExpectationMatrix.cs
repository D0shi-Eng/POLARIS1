using System.Collections.Generic;

namespace Polaris.ConfinementSpike.Launcher
{
    // مصفوفة التوقعات. تُكتب قبل التنفيذ ولا تُعدَّل بعد رؤية النتائج.
    // بعض التوقعات هنا نعلم مسبقًا أنها قد تفشل، ونتركها كما هي عمدًا
    // لأن الفشل الظاهر هو الدليل المطلوب لا العيب
    public static class ExpectationMatrix
    {
        private static readonly Dictionary<string, Expectation> Contained = BuildContained();
        private static readonly Dictionary<string, Expectation> WithInternetClient = BuildInternetClient();

        public static Expectation For(VariantDefinition variant, string probeId)
        {
            if (variant.IsBaseline)
            {
                return new Expectation(ExpectedValue.Control, "none", null,
                    "control run, used only to attribute later denials to the enforcement layer");
            }

            Expectation expectation;

            // الإعفاء الصريح يقلب توقع loopback فقط، وبقية التوقعات تبقى كما هي
            if (variant.LoopbackExempt && probeId == "N02")
            {
                return new Expectation(ExpectedValue.Allow, "appcontainer+firewall+loopbackExempt", null,
                    "an explicit CheckNetIsolation exemption was applied for this container SID");
            }

            bool hasInternet = variant.Capabilities != null && variant.Capabilities.Length > 0;
            if (hasInternet && WithInternetClient.TryGetValue(probeId, out expectation))
            {
                return expectation;
            }

            if (variant.LessPrivilegedAppContainer && probeId == "F09")
            {
                return new Expectation(ExpectedValue.Deny, "lpac",
                    null, "LPAC opts out of ALL APPLICATION PACKAGES, so default system read access should disappear");
            }

            if (variant.LeakDeniedFileHandle && probeId == "X03")
            {
                return new Expectation(ExpectedValue.Deny, "appcontainer",
                    null, "a real confinement boundary would revoke access through an inherited handle; Windows does not");
            }

            if (Contained.TryGetValue(probeId, out expectation))
            {
                return expectation;
            }

            return new Expectation(ExpectedValue.Documented, "unspecified", null, "no expectation declared for this probe");
        }

        private static Dictionary<string, Expectation> BuildContained()
        {
            Dictionary<string, Expectation> map = new Dictionary<string, Expectation>();

            map["V01"] = new Expectation(ExpectedValue.Documented, "validation", null, "identity of the confined process");
            map["V02"] = new Expectation(ExpectedValue.Documented, "validation", "is_app_container=1",
                "if this is not 1 then no file or network result in this variant is attributable to AppContainer");
            map["V03"] = new Expectation(ExpectedValue.Documented, "validation", "in_job=1",
                "if this is not 1 then no process result in this variant is attributable to the Job Object");

            map["F01"] = new Expectation(ExpectedValue.Allow, "appcontainer-acl", null, "explicitly granted scope");
            map["F02"] = new Expectation(ExpectedValue.Allow, "appcontainer-acl", null, "explicitly granted scope");
            map["F03"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "no ACE for the container SID");
            map["F04"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "write outside the granted root");
            map["F05"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "relative traversal resolves before the access check");
            map["F06"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "junction target must be access checked, not the link");
            map["F06B"] = new Expectation(ExpectedValue.Documented, "appcontainer-acl", null, "symlink may be unavailable without elevation");
            map["F07"] = new Expectation(ExpectedValue.Documented, "appcontainer+firewall", null, "UNC behaviour must be documented explicitly");
            map["F08"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "case normalization must not bypass the ACL");
            map["F08B"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "extended path prefix must not bypass the ACL");
            map["F08C"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "NT namespace path must not bypass the ACL");
            map["F09"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null,
                "reading outside the granted root; a failure here documents the ALL APPLICATION PACKAGES default read grant");
            map["F10"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "user profile is outside the granted root");
            map["F11"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "user temp directory is outside the granted root");
            map["F12"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "credential store directory is outside the granted root");
            map["F13"] = new Expectation(ExpectedValue.Deny, "appcontainer-acl", null, "traverse was granted but listing was not");
            map["F14"] = new Expectation(ExpectedValue.Allow, "appcontainer-acl", null, "listing inside the granted scope");

            map["X01"] = new Expectation(ExpectedValue.Documented, "none", null, "current directory inherited from the launcher");
            map["X02"] = new Expectation(ExpectedValue.Documented, "none", null, "environment inheritance is not restricted by AppContainer");
            map["X03"] = new Expectation(ExpectedValue.Documented, "none", null, "no handle leaked in this variant");
            map["X04"] = new Expectation(ExpectedValue.Documented, "appcontainer+job", "child_in_job=1", "system shell invocation must remain confined");
            map["X05"] = new Expectation(ExpectedValue.Documented, "appcontainer+job", "child_in_job=1", "system shell invocation must remain confined");

            map["P01"] = new Expectation(ExpectedValue.Allow, "job", "child_in_job=1", "child is permitted but must stay inside the boundary");
            map["P02"] = new Expectation(ExpectedValue.Allow, "job", "great_grandchild_in_job=1", "third generation must stay inside the boundary");
            map["P03"] = new Expectation(ExpectedValue.Deny, "job", null, "JOB_OBJECT_LIMIT_BREAKAWAY_OK is not set");
            map["P04"] = new Expectation(ExpectedValue.Allow, "job", null, "spawn is allowed; survival is judged separately by P04B");
            map["P05"] = new Expectation(ExpectedValue.Deny, "appcontainer", null, "an unrelated process must not be openable for termination");
            map["P05B"] = new Expectation(ExpectedValue.Documented, "appcontainer", null, "limited query access is a separate question from control");
            map["P06A"] = new Expectation(ExpectedValue.Deny, "job", null, "active process limit must be enforced");
            map["P06B"] = new Expectation(ExpectedValue.Deny, "job", null, "job memory limit must be enforced");
            map["P04B"] = new Expectation(ExpectedValue.Deny, "job", null, "zero surviving processes after the job handle is closed");

            map["N01"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "no network capability means default deny");
            map["N02"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "loopback is blocked without an explicit exemption");
            map["N03"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "no capability, so even a wanted endpoint is denied");
            map["N04"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "no capability, so an unwanted endpoint is denied too");
            map["N05"] = new Expectation(ExpectedValue.Documented, "appcontainer+firewall", null,
                "DNS is served by the DNS Client service over ALPC, so it may succeed even when sockets are denied");
            map["N06"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "literal IP must not bypass the policy");
            map["N07"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "alternate port must not bypass the policy");
            map["N08"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null, "UDP egress must be denied too");

            map["F04B"] = new Expectation(ExpectedValue.Allow, "fixture-integrity", null, "the outside fixture file must remain byte identical");

            return map;
        }

        // عند منح القدرة internetClient تتغير توقعات الشبكة فقط.
        // نُبقي N04 وN06 وN07 على توقع المنع عمدًا، لأن Polaris يحتاج التمييز بين الوجهات،
        // وفشل هذه الحالات هو بالضبط الدليل على أن AppContainer وحده لا يكفي
        private static Dictionary<string, Expectation> BuildInternetClient()
        {
            Dictionary<string, Expectation> map = new Dictionary<string, Expectation>();

            map["N01"] = new Expectation(ExpectedValue.Allow, "appcontainer+firewall", null,
                "internetClient permits outbound egress as a category");
            map["N02"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null,
                "internetClient does not grant loopback; that needs an explicit exemption");
            map["N03"] = new Expectation(ExpectedValue.Allow, "appcontainer+firewall", null,
                "the endpoint Polaris would want to allow");
            map["N04"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null,
                "the endpoint Polaris would want to deny; if this is allowed then destination control does not exist at this layer");
            map["N05"] = new Expectation(ExpectedValue.Documented, "appcontainer+firewall", null, "resolution behaviour with a network capability");
            map["N06"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null,
                "literal IP must not bypass a destination policy");
            map["N07"] = new Expectation(ExpectedValue.Deny, "appcontainer+firewall", null,
                "alternate port must not bypass a destination policy");
            map["N08"] = new Expectation(ExpectedValue.Documented, "appcontainer+firewall", null, "UDP egress with a network capability");

            return map;
        }
    }
}
