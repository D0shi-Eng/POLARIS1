// الشبكة: سياسة نقاط النهاية، وعميل HTTP/1.1، والإلغاء، وتأطير البث.

pub mod body;
pub mod cancel;
pub mod endpoint;
pub mod http;
pub mod lines;
pub mod loopback;
pub(crate) mod sliced;

pub use cancel::CancelToken;
pub use endpoint::{is_public, web_destination, EndpointError, NetworkClass, ResolvedEndpoint};
pub use http::{HttpClient, HttpRequest, HttpResponse, TransportError, TransportErrorKind};
