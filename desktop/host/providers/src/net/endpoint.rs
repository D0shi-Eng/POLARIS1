// سياسة نقاط النهاية.
//
// صنفان فقط من الشبكة:
//   LOOPBACK_PROVIDER_ACCESS — مزوّد محلي. الاتصال بالعنوانين الحرفيين 127.0.0.1
//     و::1 فقط، و`localhost` يُحوَّل ولا يُحلّ عبر DNS، فلا ملف hosts ولا إعادة ربط.
//   REMOTE_EGRESS — مزوّد بعيد. https فقط، والمضيف ثابت من الواصف، وكل عنوان يُحلّ
//     إليه يجب أن يكون عامًا؛ عنوان خاص أو محلي يرفض الاتصال كله.
// لا مسح منافذ، ولا اكتشاف شبكة محلية، ولا عنوان يأتي من العارض كوجهة حرّة.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

use serde::{Deserialize, Serialize};
use url::{Host, Url};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NetworkClass {
    LoopbackProviderAccess,
    RemoteEgress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme {
    Http,
    Https,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EndpointError {
    InvalidUrl,
    SchemeNotAllowed,
    HostNotLoopback,
    HostNotAllowed,
    CredentialsInUrl,
    QueryNotAllowed,
    PrivateAddress,
    NameResolutionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectTarget {
    Literal(IpAddr),
    /// يُحلّ عند الاتصال، ثم يُفحص كل عنوان.
    Resolve,
    /// تجهيزة اختبار على الحلقة المحلية تقف مكان مزوّد بعيد. لا يُبنى إلا صراحةً.
    FixtureLoopback(IpAddr),
}

/// نقطة نهاية مُتحقَّق منها. لا تُبنى إلا عبر الدوال أدناه.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedEndpoint {
    pub class: NetworkClass,
    pub scheme: Scheme,
    /// الاسم في ترويسة Host وفي SNI.
    pub host: String,
    pub port: u16,
    /// بادئة المسار بلا شرطة لاحقة ("" أو "/api").
    pub base_path: String,
    target: ConnectTarget,
}

fn parse(raw: &str) -> Result<Url, EndpointError> {
    if raw.len() > 256 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(EndpointError::InvalidUrl);
    }
    let url = Url::parse(raw).map_err(|_| EndpointError::InvalidUrl)?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(EndpointError::CredentialsInUrl);
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(EndpointError::QueryNotAllowed);
    }
    Ok(url)
}

fn scheme_of(url: &Url) -> Result<Scheme, EndpointError> {
    match url.scheme() {
        "http" => Ok(Scheme::Http),
        "https" => Ok(Scheme::Https),
        _ => Err(EndpointError::SchemeNotAllowed),
    }
}

fn base_path(url: &Url) -> String {
    url.path().trim_end_matches('/').to_string()
}

/// نقطة نهاية لمزوّد محلي. أي مضيف غير الحلقة المحلية مرفوض.
pub fn loopback(raw: &str) -> Result<ResolvedEndpoint, EndpointError> {
    let url = parse(raw)?;
    let scheme = scheme_of(&url)?;
    let (host, ip) = match url.host() {
        Some(Host::Ipv4(v4)) if v4 == Ipv4Addr::LOCALHOST => ("127.0.0.1".to_string(), IpAddr::V4(v4)),
        Some(Host::Ipv6(v6)) if v6 == Ipv6Addr::LOCALHOST => ("[::1]".to_string(), IpAddr::V6(v6)),
        Some(Host::Domain(name)) if name.eq_ignore_ascii_case("localhost") => {
            ("localhost".to_string(), IpAddr::V4(Ipv4Addr::LOCALHOST))
        }
        _ => return Err(EndpointError::HostNotLoopback),
    };
    let port = url.port_or_known_default().ok_or(EndpointError::InvalidUrl)?;
    Ok(ResolvedEndpoint {
        class: NetworkClass::LoopbackProviderAccess,
        scheme,
        host,
        port,
        base_path: base_path(&url),
        target: ConnectTarget::Literal(ip),
    })
}

/// نقطة نهاية لمزوّد بعيد. المضيف يجب أن يساوي المضيف الثابت في الواصف.
pub fn remote(raw: &str, expected_host: &str) -> Result<ResolvedEndpoint, EndpointError> {
    let url = parse(raw)?;
    if scheme_of(&url)? != Scheme::Https {
        return Err(EndpointError::SchemeNotAllowed);
    }
    let host = match url.host() {
        Some(Host::Domain(name)) if name.eq_ignore_ascii_case(expected_host) => name.to_ascii_lowercase(),
        _ => return Err(EndpointError::HostNotAllowed),
    };
    let port = url.port_or_known_default().ok_or(EndpointError::InvalidUrl)?;
    Ok(ResolvedEndpoint {
        class: NetworkClass::RemoteEgress,
        scheme: Scheme::Https,
        host,
        port,
        base_path: base_path(&url),
        target: ConnectTarget::Resolve,
    })
}

/// تجهيزة اختبار على الحلقة المحلية تحمل صنف الخروج البعيد، ليُختبر قرار الخروج
/// على المسار الحقيقي. المضيف لا يستدعيها إلا في بناء القياس (`e2e`) أو في الاختبار.
pub fn remote_fixture(raw: &str) -> Result<ResolvedEndpoint, EndpointError> {
    let mut endpoint = loopback(raw)?;
    let ip = match endpoint.target {
        ConnectTarget::Literal(ip) => ip,
        _ => return Err(EndpointError::HostNotLoopback),
    };
    endpoint.class = NetworkClass::RemoteEgress;
    endpoint.target = ConnectTarget::FixtureLoopback(ip);
    Ok(endpoint)
}

/// وجهة صفحة ويب لمتصفّح Phase-05.
///
/// قرار السياسة (أي مخطط، وأي منفذ، وأي أصل تجهيزة) يقع في طبقة المتصفّح قبل هذا
/// النداء. ما يضمنه هذا الملف هو ما لا يُضمن إلا عند الاتصال: اسمٌ يُحلّ مرّة واحدة
/// لحظة الاتصال، وكل عنوان يعود يجب أن يكون عامًّا، ثم يُتّصل بتلك العناوين نفسها.
/// فلا نافذة بين الفحص والاتصال تُعاد فيها إعادة الربط (DNS rebinding).
///
/// `loopback_fixture` لا يُمرَّر إلا لأصلٍ أذنت به طبقة المتصفّح صراحةً بوصفه
/// تجهيزة اختبار؛ وحتى حينها لا يُقبل إلا عنوان حلقة محلية حرفي.
pub fn web_destination(url: &Url, loopback_fixture: bool) -> Result<ResolvedEndpoint, EndpointError> {
    if !url.username().is_empty() || url.password().is_some() {
        return Err(EndpointError::CredentialsInUrl);
    }
    let scheme = scheme_of(url)?;
    let port = url.port_or_known_default().ok_or(EndpointError::InvalidUrl)?;
    let (host, target) = match url.host() {
        Some(Host::Ipv4(v4)) => {
            let ip = IpAddr::V4(v4);
            if loopback_fixture && v4 == Ipv4Addr::LOCALHOST {
                ("127.0.0.1".to_string(), ConnectTarget::Literal(ip))
            } else if is_public(ip) {
                (v4.to_string(), ConnectTarget::Literal(ip))
            } else {
                return Err(EndpointError::PrivateAddress);
            }
        }
        Some(Host::Ipv6(v6)) => {
            let ip = IpAddr::V6(v6);
            if loopback_fixture && v6 == Ipv6Addr::LOCALHOST {
                ("[::1]".to_string(), ConnectTarget::Literal(ip))
            } else if is_public(ip) {
                (format!("[{v6}]"), ConnectTarget::Literal(ip))
            } else {
                return Err(EndpointError::PrivateAddress);
            }
        }
        // تجهيزة الحلقة المحلية لا تُبلغ باسم: الاسم يمرّ بالحلّ، والحلّ ليس ما أُذن به.
        Some(Host::Domain(_)) if loopback_fixture => return Err(EndpointError::HostNotLoopback),
        Some(Host::Domain(name)) => (name.to_ascii_lowercase(), ConnectTarget::Resolve),
        None => return Err(EndpointError::InvalidUrl),
    };
    let class = if loopback_fixture { NetworkClass::LoopbackProviderAccess } else { NetworkClass::RemoteEgress };
    Ok(ResolvedEndpoint { class, scheme, host, port, base_path: String::new(), target })
}

/// هل العنوان عام؟ كل ما عداه ممنوع على الخروج البعيد.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || o[0] == 0
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(mapped));
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00
                || (s[0] & 0xffc0) == 0xfe80
                || s[0] == 0x2001 && s[1] == 0x0db8)
        }
    }
}

impl ResolvedEndpoint {
    /// العناوين التي يُسمح بالاتصال بها فعلًا.
    pub fn socket_addrs(&self) -> Result<Vec<SocketAddr>, EndpointError> {
        match &self.target {
            ConnectTarget::Literal(ip) | ConnectTarget::FixtureLoopback(ip) => Ok(vec![SocketAddr::new(*ip, self.port)]),
            ConnectTarget::Resolve => {
                let addrs: Vec<SocketAddr> = (self.host.as_str(), self.port)
                    .to_socket_addrs()
                    .map_err(|_| EndpointError::NameResolutionFailed)?
                    .collect();
                if addrs.is_empty() {
                    return Err(EndpointError::NameResolutionFailed);
                }
                // عنوان واحد غير عام يرفض الكل: الخلط بين عام وخاص علامة إعادة ربط.
                if addrs.iter().any(|a| !is_public(a.ip())) {
                    return Err(EndpointError::PrivateAddress);
                }
                Ok(addrs)
            }
        }
    }

    pub fn is_fixture(&self) -> bool {
        matches!(self.target, ConnectTarget::FixtureLoopback(_))
    }

    /// قيمة ترويسة Host.
    pub fn host_header(&self) -> String {
        let default = match self.scheme {
            Scheme::Http => 80,
            Scheme::Https => 443,
        };
        if self.port == default {
            self.host.clone()
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    /// يبني المسار الكامل من بادئة نقطة النهاية ومسار البروتوكول.
    pub fn path(&self, suffix: &str) -> String {
        format!("{}{}", self.base_path, suffix)
    }

    /// عرض نقطة النهاية للمستخدم: بلا مسار داخلي ولا أي سرّ (لا توجد أسرار هنا أصلًا).
    pub fn display(&self) -> String {
        let scheme = match self.scheme {
            Scheme::Http => "http",
            Scheme::Https => "https",
        };
        format!("{scheme}://{}{}", self.host_header(), self.base_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_accepts_only_the_local_host() {
        for ok in ["http://127.0.0.1:1234", "http://localhost:11434/", "http://[::1]:8080", "http://127.0.0.1:1234/v1"] {
            let e = loopback(ok).unwrap_or_else(|err| panic!("{ok}: {err:?}"));
            assert_eq!(e.class, NetworkClass::LoopbackProviderAccess);
            assert!(e.socket_addrs().unwrap().iter().all(|a| a.ip().is_loopback()));
        }
        for bad in [
            "http://192.168.1.10:1234",
            "http://10.0.0.5:11434",
            "http://127.0.0.2:1234",
            "http://example.com:1234",
            "http://localhost.evil.test:1234",
            "http://0.0.0.0:1234",
            "file:///etc/passwd",
            "ftp://127.0.0.1",
        ] {
            assert!(loopback(bad).is_err(), "{bad} was accepted");
        }
    }

    #[test]
    fn urls_with_credentials_queries_or_whitespace_are_refused() {
        assert_eq!(loopback("http://user:pw@127.0.0.1:1"), Err(EndpointError::CredentialsInUrl));
        assert_eq!(loopback("http://127.0.0.1:1/?x=1"), Err(EndpointError::QueryNotAllowed));
        assert_eq!(loopback("http://127.0.0.1:1/ a"), Err(EndpointError::InvalidUrl));
    }

    #[test]
    fn remote_requires_https_and_the_descriptor_host() {
        assert!(remote("https://api.example.test", "api.example.test").is_ok());
        assert_eq!(remote("http://api.example.test", "api.example.test"), Err(EndpointError::SchemeNotAllowed));
        assert_eq!(remote("https://evil.test", "api.example.test"), Err(EndpointError::HostNotAllowed));
        assert_eq!(remote("https://127.0.0.1", "api.example.test"), Err(EndpointError::HostNotAllowed));
    }

    #[test]
    fn private_and_special_addresses_are_not_public() {
        for ip in ["10.1.2.3", "172.16.0.1", "192.168.0.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"] {
            assert!(!is_public(ip.parse().unwrap()), "{ip} counted as public");
        }
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip} counted as private");
        }
    }

    #[test]
    fn a_web_destination_refuses_private_literals_and_keeps_names_for_connect_time_checks() {
        let parse = |raw: &str| Url::parse(raw).unwrap();
        for bad in ["http://10.0.0.1/", "http://169.254.169.254/latest", "http://127.0.0.1:80/", "http://[::1]/", "http://192.168.1.1/"] {
            assert_eq!(web_destination(&parse(bad), false), Err(EndpointError::PrivateAddress), "{bad}");
        }
        assert_eq!(web_destination(&parse("http://user:pw@example.test/"), false), Err(EndpointError::CredentialsInUrl));
        assert_eq!(web_destination(&parse("ftp://example.test/"), false), Err(EndpointError::SchemeNotAllowed));
        let named = web_destination(&parse("https://example.test/a?b=c"), false).unwrap();
        assert_eq!(named.class, NetworkClass::RemoteEgress);
        assert_eq!(named.target, ConnectTarget::Resolve, "a name must be resolved and checked at connect time");
        // تجهيزة الحلقة المحلية: حرفيٌّ فقط، ولا اسم.
        let fixture = web_destination(&parse("http://127.0.0.1:4100/page"), true).unwrap();
        assert!(fixture.socket_addrs().unwrap()[0].ip().is_loopback());
        assert_eq!(web_destination(&parse("http://localhost:4100/"), true), Err(EndpointError::HostNotLoopback));
    }

    #[test]
    fn a_fixture_keeps_the_remote_class_and_a_loopback_target() {
        let e = remote_fixture("http://127.0.0.1:9999").unwrap();
        assert_eq!(e.class, NetworkClass::RemoteEgress);
        assert!(e.is_fixture());
        assert!(e.socket_addrs().unwrap()[0].ip().is_loopback());
    }
}
