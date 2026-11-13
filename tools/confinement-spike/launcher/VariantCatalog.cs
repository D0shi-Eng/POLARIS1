using System.Collections.Generic;

namespace Polaris.ConfinementSpike.Launcher
{
    // قائمة الأنماط المنفذة.
    // خط الأساس أولًا وبشكل إلزامي، لأن أي منع لاحق بلا خط أساس لا يمكن نسبه إلى آلية الحصر
    public static class VariantCatalog
    {
        public static List<VariantDefinition> All(bool elevated)
        {
            List<VariantDefinition> variants = new List<VariantDefinition>();

            VariantDefinition baseline = new VariantDefinition();
            baseline.Id = "V0_BASELINE";
            baseline.Description = "Uncontained control run: no AppContainer, no Job Object";
            baseline.UseAppContainer = false;
            baseline.Capabilities = NetworkPolicy.NoCapabilities;
            baseline.UseJobObject = false;
            baseline.EnforcementLayer = "none";
            baseline.IsBaseline = true;
            variants.Add(baseline);

            VariantDefinition noCap = new VariantDefinition();
            noCap.Id = "V1_APPCONTAINER_NOCAP_JOB";
            noCap.Description = "AppContainer with zero capabilities, inside a Job Object";
            noCap.UseAppContainer = true;
            noCap.Capabilities = NetworkPolicy.NoCapabilities;
            noCap.UseJobObject = true;
            noCap.EnforcementLayer = "appcontainer+job";
            variants.Add(noCap);

            VariantDefinition net = new VariantDefinition();
            net.Id = "V2_APPCONTAINER_INTERNET_JOB";
            net.Description = "AppContainer with internetClient capability, inside a Job Object";
            net.UseAppContainer = true;
            net.Capabilities = NetworkPolicy.InternetClientOnly;
            net.UseJobObject = true;
            net.EnforcementLayer = "appcontainer+job+internetClient";
            variants.Add(net);

            VariantDefinition lpac = new VariantDefinition();
            lpac.Id = "V3_LPAC_JOB";
            lpac.Description = "Less Privileged AppContainer, opted out of ALL APPLICATION PACKAGES";
            lpac.UseAppContainer = true;
            lpac.Capabilities = NetworkPolicy.NoCapabilities;
            lpac.LessPrivilegedAppContainer = true;
            lpac.UseJobObject = true;
            lpac.EnforcementLayer = "lpac+job";
            variants.Add(lpac);

            VariantDefinition leak = new VariantDefinition();
            leak.Id = "V4_HANDLE_LEAK";
            leak.Description = "AppContainer with zero capabilities, but the launcher deliberately inherits a handle to a denied file";
            leak.UseAppContainer = true;
            leak.Capabilities = NetworkPolicy.NoCapabilities;
            leak.UseJobObject = true;
            leak.LeakDeniedFileHandle = true;
            leak.EnforcementLayer = "appcontainer+job (with deliberate handle leak)";
            variants.Add(leak);

            if (elevated)
            {
                VariantDefinition exempt = new VariantDefinition();
                exempt.Id = "V5_INTERNET_LOOPBACK_EXEMPT";
                exempt.Description = "AppContainer with internetClient and an explicit loopback exemption applied by CheckNetIsolation";
                exempt.UseAppContainer = true;
                exempt.Capabilities = NetworkPolicy.InternetClientOnly;
                exempt.UseJobObject = true;
                exempt.LoopbackExempt = true;
                exempt.RequiresElevation = true;
                exempt.EnforcementLayer = "appcontainer+job+internetClient+loopbackExempt";
                variants.Add(exempt);
            }

            return variants;
        }
    }
}
