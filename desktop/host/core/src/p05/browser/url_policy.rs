// سياسة تنقّل المتصفّح: ما يجوز بلوغه، وما يُرفض قبل أي اتصال.
//
// الافتراض الرفض (البند 18/19). يُقبل http وhttps وحدهما، إلى مضيف عام، على منفذ
// ويب معروف. وتُرفض الحلقة المحلية والشبكات الخاصة وعناوين الربط المحلي ونقاط
// البيانات الوصفية السحابية وأسماء `localhost` و`.internal` و`.local`. الاسم الذي
// يمرّ هنا يُحلّ عند الاتصال، ويُرفض الاتصال كله إن عاد عنوان واحد غير عام
// (`web_destination` في طبقة الشبكة)، فلا يغيّر DNS ما قرّرته السياسة.
//
// الاستثناء الوحيد: أصل تجهيزة اختبار على الحلقة المحلية، يسمّيه زمن التشغيل
// الموثوق صراحةً (بناء القياس)، ولا تستطيع صفحة ولا نموذج ولا إعادة توجيه أن تضيفه.

use std::net::IpAddr;

use url::{Host, Url};

use polaris_host_providers::net::is_public;

/// أقصى طول لعنوان يُقبل. عنوان أطول ليس صفحة، بل حمولة.
pub const MAX_URL_CHARS: usize = 2048;
/// أقصى عدد لإعادات التوجيه في تنقّل واحد.
pub const MAX_REDIRECTS: usize = 5;
/// منافذ الويب المقبولة لمضيف عام. منفذ غريب على مضيف عام بابٌ لخدمات غير ويب.
const WEB_PORTS: &[u16] = &[80, 443, 8000, 8080, 8443];

/// لماذا رُفض عنوان. مغلق.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDenial {
    InvalidUrl,
    SchemeNotAllowed,
    CredentialsInUrl,
    LoopbackDenied,
    PrivateAddressDenied,
    MetadataEndpointDenied,
    InternalNameDenied,
    PortNotAllowed,
    UrlTooLong,
    TooManyRedirects,
}

impl NavigationDenial {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidUrl => "INVALID_URL",
            Self::SchemeNotAllowed => "SCHEME_NOT_ALLOWED",
            Self::CredentialsInUrl => "CREDENTIALS_IN_URL",
            Self::LoopbackDenied => "LOOPBACK_DENIED",
            Self::PrivateAddressDenied => "PRIVATE_ADDRESS_DENIED",
            Self::MetadataEndpointDenied => "METADATA_ENDPOINT_DENIED",
            Self::InternalNameDenied => "INTERNAL_NAME_DENIED",
            Self::PortNotAllowed => "PORT_NOT_ALLOWED",
            Self::UrlTooLong => "URL_TOO_LONG",
            Self::TooManyRedirects => "TOO_MANY_REDIRECTS",
        }
    }
}

/// صنف الوجهة بعد القبول.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestinationClass {
    /// مضيف عام؛ يُحلّ اسمه ويُفحص كل عنوان عند الاتصال.
    PublicWeb,
    /// أصل تجهيزة اختبار سمّاه زمن التشغيل. حلقة محلية حرفية وحدها.
    TestFixture,
}

/// سياسة التنقّل. تُبنى في زمن التشغيل الموثوق ولا تتغيّر بمحتوى صفحة.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NavigationPolicy {
    /// أصول تجهيزات الاختبار: (عنوان حلقة محلية حرفي، منفذ). فارغة في ثنائي المنتج.
    fixture_origins: Vec<(IpAddr, u16)>,
}

/// عناوين البيانات الوصفية السحابية المعروفة. بعضها خاصّ أصلًا، ويُسمّى هنا ليكون
/// سبب الرفض هو السبب الحقيقي.
fn is_metadata_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            o == [169, 254, 169, 254] || o == [100, 100, 100, 200] || o == [192, 0, 0, 192] || o == [169, 254, 170, 2]
        }
        IpAddr::V6(v6) => v6.segments() == [0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254],
    }
}

fn is_internal_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".internal")
        || name.ends_with(".lan")
        || name.ends_with(".home.arpa")
        || name == "metadata"
        || name == "metadata.google.internal"
        || !name.contains('.')
}

impl NavigationPolicy {
    /// سياسة المنتج: لا تجهيزة.
    pub fn product() -> Self {
        Self { fixture_origins: Vec::new() }
    }

    /// سياسة تسمح بأصل تجهيزة اختبار واحد أو أكثر على الحلقة المحلية. العنوان يجب
    /// أن يكون حلقة محلية حرفية، وإلا يُسقط ولا يُضاف.
    pub fn with_fixture_origins(origins: &[(IpAddr, u16)]) -> Self {
        Self { fixture_origins: origins.iter().copied().filter(|(ip, port)| ip.is_loopback() && *port > 0).collect() }
    }

    pub fn fixture_origins(&self) -> &[(IpAddr, u16)] {
        &self.fixture_origins
    }

    /// يفحص عنوانًا نصّيًّا ويعيده محلَّلًا مع صنف وجهته.
    pub fn check_text(&self, raw: &str) -> Result<(Url, DestinationClass), NavigationDenial> {
        if raw.chars().count() > MAX_URL_CHARS {
            return Err(NavigationDenial::UrlTooLong);
        }
        if raw.chars().any(|c| c.is_control()) {
            return Err(NavigationDenial::InvalidUrl);
        }
        let url = Url::parse(raw.trim()).map_err(|_| NavigationDenial::InvalidUrl)?;
        let class = self.check(&url)?;
        Ok((url, class))
    }

    /// يفحص عنوانًا محلَّلًا. يُستدعى للتنقّل الأول ولكل إعادة توجيه.
    pub fn check(&self, url: &Url) -> Result<DestinationClass, NavigationDenial> {
        if url.as_str().chars().count() > MAX_URL_CHARS {
            return Err(NavigationDenial::UrlTooLong);
        }
        // المخطط أولًا: file وjavascript وdata وchrome وedge وdevtools وabout وغيرها
        // ليست وجهات تنقّل هنا مهما قالت الصفحة.
        match url.scheme() {
            "http" | "https" => {}
            _ => return Err(NavigationDenial::SchemeNotAllowed),
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(NavigationDenial::CredentialsInUrl);
        }
        let port = url.port_or_known_default().ok_or(NavigationDenial::InvalidUrl)?;
        let literal = match url.host() {
            Some(Host::Ipv4(v4)) => Some(IpAddr::V4(v4)),
            Some(Host::Ipv6(v6)) => Some(IpAddr::V6(v6)),
            Some(Host::Domain(name)) => {
                if is_internal_name(name) {
                    return Err(if name.to_ascii_lowercase().contains("localhost") {
                        NavigationDenial::LoopbackDenied
                    } else if name.to_ascii_lowercase().contains("metadata") {
                        NavigationDenial::MetadataEndpointDenied
                    } else {
                        NavigationDenial::InternalNameDenied
                    });
                }
                None
            }
            None => return Err(NavigationDenial::InvalidUrl),
        };
        if let Some(ip) = literal {
            // عنوان IPv6 يحمل IPv4 داخله يُفحص بما يحمله.
            let effective = match ip {
                IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
                other => other,
            };
            if self.fixture_origins.iter().any(|(fixture, fixture_port)| *fixture == effective && *fixture_port == port) {
                return Ok(DestinationClass::TestFixture);
            }
            if is_metadata_ip(effective) {
                return Err(NavigationDenial::MetadataEndpointDenied);
            }
            if effective.is_loopback() || effective.is_unspecified() {
                return Err(NavigationDenial::LoopbackDenied);
            }
            if !is_public(effective) {
                return Err(NavigationDenial::PrivateAddressDenied);
            }
        }
        if !WEB_PORTS.contains(&port) {
            return Err(NavigationDenial::PortNotAllowed);
        }
        Ok(DestinationClass::PublicWeb)
    }

    /// يحلّ هدف إعادة توجيه نسبةً إلى العنوان الحالي ويفحصه من جديد.
    pub fn check_redirect(&self, current: &Url, location: &str, hops: usize) -> Result<(Url, DestinationClass), NavigationDenial> {
        if hops >= MAX_REDIRECTS {
            return Err(NavigationDenial::TooManyRedirects);
        }
        let next = current.join(location.trim()).map_err(|_| NavigationDenial::InvalidUrl)?;
        let class = self.check(&next)?;
        Ok((next, class))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> NavigationPolicy {
        NavigationPolicy::with_fixture_origins(&[("127.0.0.1".parse().unwrap(), 4100)])
    }

    #[test]
    fn only_http_and_https_are_navigable() {
        for bad in [
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,<script>x</script>",
            "chrome://settings",
            "edge://settings",
            "devtools://devtools/bundled/inspector.html",
            "about:blank",
            "ftp://example.com/",
            "view-source:https://example.com",
        ] {
            assert!(
                matches!(policy().check_text(bad), Err(NavigationDenial::SchemeNotAllowed) | Err(NavigationDenial::InvalidUrl)),
                "{bad} was navigable"
            );
        }
        assert_eq!(policy().check_text("https://example.com/").unwrap().1, DestinationClass::PublicWeb);
    }

    #[test]
    fn loopback_private_link_local_and_metadata_are_refused() {
        let p = NavigationPolicy::product();
        let cases = [
            ("http://127.0.0.1/", NavigationDenial::LoopbackDenied),
            ("http://localhost:8080/", NavigationDenial::LoopbackDenied),
            ("http://app.localhost/", NavigationDenial::LoopbackDenied),
            ("http://[::1]/", NavigationDenial::LoopbackDenied),
            ("http://0.0.0.0/", NavigationDenial::LoopbackDenied),
            ("http://10.0.0.8/", NavigationDenial::PrivateAddressDenied),
            ("http://192.168.1.1/admin", NavigationDenial::PrivateAddressDenied),
            ("http://172.16.4.4/", NavigationDenial::PrivateAddressDenied),
            ("http://169.254.169.254/latest/meta-data/", NavigationDenial::MetadataEndpointDenied),
            ("http://metadata.google.internal/", NavigationDenial::MetadataEndpointDenied),
            ("http://[::ffff:10.0.0.1]/", NavigationDenial::PrivateAddressDenied),
            ("http://intranet/", NavigationDenial::InternalNameDenied),
            ("http://printer.local/", NavigationDenial::InternalNameDenied),
            ("http://user:pw@example.com/", NavigationDenial::CredentialsInUrl),
            ("http://example.com:22/", NavigationDenial::PortNotAllowed),
        ];
        for (url, expected) in cases {
            assert_eq!(p.check_text(url).map(|(_, c)| c), Err(expected), "{url}");
        }
    }

    #[test]
    fn a_fixture_origin_is_exact_and_cannot_be_widened() {
        let p = policy();
        assert_eq!(p.check_text("http://127.0.0.1:4100/normal").unwrap().1, DestinationClass::TestFixture);
        // منفذ آخر على الحلقة المحلية ليس التجهيزة.
        assert_eq!(p.check_text("http://127.0.0.1:4101/").map(|(_, c)| c), Err(NavigationDenial::LoopbackDenied));
        // والاسم لا يساوي العنوان: localhost يمرّ بالحلّ، والحلّ ليس ما أُذن به.
        assert_eq!(p.check_text("http://localhost:4100/").map(|(_, c)| c), Err(NavigationDenial::LoopbackDenied));
        // وتجهيزة غير محلية تُسقط عند البناء.
        let widened = NavigationPolicy::with_fixture_origins(&[("10.0.0.5".parse().unwrap(), 80)]);
        assert!(widened.fixture_origins().is_empty());
    }

    #[test]
    fn a_redirect_is_rechecked_and_bounded() {
        let p = policy();
        let start = Url::parse("http://127.0.0.1:4100/redirect").unwrap();
        assert_eq!(p.check_redirect(&start, "/normal", 0).unwrap().1, DestinationClass::TestFixture);
        assert_eq!(p.check_redirect(&start, "http://127.0.0.1:9/private", 0).map(|(_, c)| c), Err(NavigationDenial::LoopbackDenied));
        assert_eq!(p.check_redirect(&start, "http://169.254.169.254/", 0).map(|(_, c)| c), Err(NavigationDenial::MetadataEndpointDenied));
        assert_eq!(p.check_redirect(&start, "javascript:alert(1)", 0).map(|(_, c)| c), Err(NavigationDenial::SchemeNotAllowed));
        assert_eq!(p.check_redirect(&start, "/normal", MAX_REDIRECTS).map(|(_, c)| c), Err(NavigationDenial::TooManyRedirects));
    }
}
