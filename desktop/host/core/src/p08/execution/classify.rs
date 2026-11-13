// تصنيف خطر الأوامر: ما يوجب موافقة بشرية قبل التشغيل.
//
// الصندوق هو الضمان، والتصنيف ليس بديلًا عنه: أمرٌ يفلت من التصنيف يبقى محبوسًا
// في مساحة مهمّته بلا شبكة. التصنيف يجيب عن سؤال آخر: هل يطلب هذا الأمر ما يستحقّ أن
// يُسأل عنه المستخدم (شبكة، تثبيت حزمة، إعداد نظام، تشغيل ملف منزَّل)؟ ولذلك هو
// محافظ: يطابق نصوصًا معروفة بلا تفسير دلالي، ويرفع الخطر ولا يخفضه أبدًا.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CommandRisk {
    /// طلب شبكة صريح أو أداة تنزيل.
    Network,
    /// تثبيت حزمة (pip، npm، winget…).
    PackageInstall,
    /// تغيير إعداد نظام أو خدمة أو سجلّ أو جدار حماية.
    SystemConfiguration,
    /// تشغيل ملف من منطقة التنزيلات المعزولة.
    DownloadedExecutable,
    /// محاولة رفع صلاحية.
    PrivilegeElevation,
}

impl CommandRisk {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Network => "NETWORK",
            Self::PackageInstall => "PACKAGE_INSTALL",
            Self::SystemConfiguration => "SYSTEM_CONFIGURATION",
            Self::DownloadedExecutable => "DOWNLOADED_EXECUTABLE",
            Self::PrivilegeElevation => "PRIVILEGE_ELEVATION",
        }
    }
}

const NETWORK: &[&str] = &[
    "invoke-webrequest", "invoke-restmethod", "iwr ", "irm ", "curl ", "curl.exe", "wget ", "start-bitstransfer", "bitsadmin", "net.webclient", "system.net.http", "downloadstring", "downloadfile",
    "urllib.request", "urlopen(", "requests.get", "requests.post", "http.client", "socket.socket", "socket.create_connection", "ftplib", "smtplib", "test-netconnection", "ssh ", "scp ", "git clone", "git fetch", "git pull",
    "nslookup", "resolve-dnsname", "ping ",
];
const INSTALL: &[&str] = &["pip install", "pip3 install", "-m pip", "npm install", "npm i ", "yarn add", "pnpm add", "winget ", "choco ", "install-module", "install-package", "msiexec", "setup.exe", "conda install", "cargo install", "gem install"];
const SYSTEM: &[&str] = &[
    "reg add", "reg delete", "reg import", "set-itemproperty hklm", "set-itemproperty hkcu", "new-itemproperty", "hklm:", "hkcu:", "schtasks", "register-scheduledtask", "sc.exe", "sc create", "sc config", "new-service",
    "set-service", "bcdedit", "netsh", "set-netfirewall", "new-netfirewallrule", "set-executionpolicy", "add-mppreference", "set-mppreference", "diskpart", "format-volume", "format c:", "format d:", "shutdown", "restart-computer", "stop-computer",
    "wmic ", "set-localuser", "net user", "net localgroup", "icacls", "takeown", "cipher /w", "vssadmin", "wevtutil cl",
];
const NAMESPACE_PREFIXES: &[&str] = &["http://schemas.openxmlformats.org/", "http://schemas.microsoft.com/", "http://www.w3.org/", "http://purl.org/dc/", "https://schemas.openxmlformats.org/"];
const ELEVATION: &[&str] = &["runas", "-verb runas", "start-process -verb", "sudo ", "gsudo"];

/// هل يذكر النصّ عنوان ويب له مضيف؟ البادئة العارية (`'http://'` في فحص «هل الرابط خارجي؟») ليست
/// عنوانًا: قِيس في Phase-08 أن شيفرة تتحقّق من روابط موقع محلي وتتخطّى الخارجية منها طُلبت لها موافقة
/// شبكة. ما يتّصل فعلًا يمرّ بواجهة في قائمة الشبكة، والنواة تمنع الشبكة بلا قدرة في كل الأحوال.
fn names_a_web_address(text: &str) -> bool {
    ["http://", "https://"].iter().any(|scheme| {
        text.match_indices(scheme).any(|(at, _)| {
            let rest = &text[at + scheme.len()..];
            match rest.chars().next() {
                // DEF-43: `[` عنوان IPv6 حرفيّ (`[::1]`، `[2001:db8::1]`) لا فئة أحرف في تعبير نمطي (`[\w./-]`).
                Some('[') => is_ipv6_literal(&rest[1..]),
                Some(c) => c.is_alphanumeric() || matches!(c, '$' | '{' | '%'),
                None => false,
            }
        })
    })
}

/// ما بعد `[`: أرقام ستّ عشرية ونقطتان (ونقاط لصيغة IPv4 المضمّنة) ثم `]`، وفيه نقطتان على الأقل.
fn is_ipv6_literal(after_bracket: &str) -> bool {
    let Some(end) = after_bracket.find(']') else { return false };
    let inner = &after_bracket[..end];
    inner.contains(':') && inner.chars().all(|c| c.is_ascii_hexdigit() || matches!(c, ':' | '.'))
}

/// يصنّف نصّ أمر (أو شيفرة Python). يعيد المخاطر المكتشفة مرتّبة بلا تكرار.
pub fn classify(text: &str, network_requested: bool) -> Vec<CommandRisk> {
    // تطبيع: أحرف صغيرة، ومسافات موحّدة، وإزالة علامات الهروب الشائعة في PowerShell (`)
    // التي تُستعمل لتفكيك الكلمات المفتاحية (In`voke-WebRequest).
    let lower: String = text.to_lowercase().replace(['`', '^'], "");
    let squeezed = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    let hit = |list: &[&str]| list.iter().any(|p| squeezed.contains(p) || lower.contains(p));
    let mut risks = Vec::new();
    // معرّفات أسماء XML (OOXML وW3C وDublin Core) عناوين تُكتب داخل الملفات ولا يُتّصل بها؛ قراءة
    // مستند DOCX أو XLSX تذكرها حتمًا. تُزال هي وحدها قبل البحث عن عنوان ويب، وأي عنوان آخر يبقى خطرًا
    // (والصندوق يمنع الشبكة في كل الأحوال).
    let without_namespaces = NAMESPACE_PREFIXES.iter().fold(squeezed.clone(), |acc, p| acc.replace(p, ""));
    if network_requested || hit(NETWORK) || names_a_web_address(&without_namespaces) {
        risks.push(CommandRisk::Network);
    }
    if hit(INSTALL) {
        risks.push(CommandRisk::PackageInstall);
    }
    if hit(SYSTEM) {
        risks.push(CommandRisk::SystemConfiguration);
    }
    if hit(ELEVATION) {
        risks.push(CommandRisk::PrivilegeElevation);
    }
    // تشغيل ما في منطقة التنزيلات: مسار يمرّ بـ downloads وينتهي بامتداد تنفيذي.
    let executable = [".exe", ".bat", ".cmd", ".ps1", ".msi", ".com", ".scr", ".vbs", ".js"];
    if squeezed.split(|c: char| c.is_whitespace() || c == '"' || c == '\'').any(|token| {
        let t = token.replace('\\', "/");
        t.contains("downloads/") && executable.iter().any(|e| t.ends_with(e))
    }) {
        risks.push(CommandRisk::DownloadedExecutable);
    }
    risks.sort();
    risks.dedup();
    risks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_work_carries_no_risk() {
        assert!(classify("Get-ChildItem work | Measure-Object", false).is_empty());
        assert!(classify("import csv, json\nrows = list(csv.reader(open('inputs/data.csv')))", false).is_empty());
        assert!(classify("python -m pytest tests", false).is_empty());
    }

    #[test]
    fn network_install_system_and_downloaded_binaries_are_recognised() {
        assert_eq!(classify("In`voke-WebRequest https://x.test -OutFile a", false), vec![CommandRisk::Network]);
        assert!(classify("python -m pip install requests", false).contains(&CommandRisk::PackageInstall));
        assert!(classify("reg add HKCU\\Software\\X /v Y", false).contains(&CommandRisk::SystemConfiguration));
        assert!(classify("& .\\downloads\\setup.exe /quiet", false).contains(&CommandRisk::DownloadedExecutable));
        assert!(classify("Start-Process powershell -Verb RunAs", false).contains(&CommandRisk::PrivilegeElevation));
        assert_eq!(classify("echo hi", true), vec![CommandRisk::Network]);
    }

    #[test]
    fn xml_namespace_identifiers_in_document_code_are_not_network() {
        let code = "import zipfile\nfrom xml.etree import ElementTree as ET\nW = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'\nz = zipfile.ZipFile('outputs/a.docx')\n";
        assert!(classify(code, false).is_empty(), "{:?}", classify(code, false));
        // عنوان حقيقي بجانب معرّف الاسم ما زال خطر شبكة.
        assert!(classify(&format!("{code}print('https://example.test/x')"), false).contains(&CommandRisk::Network));
    }

    /// DEF-43 (2026-11-12): سكربت يقرأ ملفًا محليًا ويستخرج الروابط بتعبير نمطي صُنّف «شبكة» فطلب موافقة بلا داعٍ.
    /// `[` بعد البادئة عنوان IPv6 حرفيّ فقط (أرقام ستّ عشرية ونقطتان ثم `]`)، لا فئة أحرف في تعبير نمطي.
    #[test]
    fn a_regex_character_class_after_the_scheme_is_not_a_web_address() {
        let code = "import re\ntext = open('notes.txt', encoding='utf-8').read()\nlinks = re.findall(r'https://[\\w./-]+', text)\nprint(len(links))\n";
        assert!(classify(code, false).is_empty(), "{:?}", classify(code, false));
        assert!(classify(r"re.compile(r'https?://[^\s]+')", false).is_empty());
        // عنوان IPv6 حرفيّ ما زال شبكة.
        assert!(classify("print('http://[::1]:8080/x')", false).contains(&CommandRisk::Network));
        assert!(classify("print('https://[2001:db8::1]/x')", false).contains(&CommandRisk::Network));
    }

    #[test]
    fn a_bare_scheme_prefix_in_link_checking_code_is_not_a_web_address() {
        let code = "import os, re\nfor href in re.findall(r'href=\"([^\"]+)\"', html):\n    if href.startswith(('http://', 'https://', 'mailto:')):\n        continue\n    assert os.path.exists(href)\n";
        assert!(classify(code, false).is_empty(), "{:?}", classify(code, false));
        // عنوان له مضيف، أو مضيف يُبنى من متغيّر، ما زال شبكة.
        assert!(classify("print('https://example.test/x')", false).contains(&CommandRisk::Network));
        assert!(classify("url = f'http://{host}/data'", false).contains(&CommandRisk::Network));
        assert!(classify("Invoke-WebRequest http://$server/file", false).contains(&CommandRisk::Network));
    }

    #[test]
    fn python_network_code_is_recognised() {
        assert!(classify("import urllib.request\nurllib.request.urlopen('http://10.0.0.1')", false).contains(&CommandRisk::Network));
        assert!(classify("import socket; socket.create_connection(('1.1.1.1', 53))", false).contains(&CommandRisk::Network));
    }
}
