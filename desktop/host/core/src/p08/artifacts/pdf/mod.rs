// PDF: كتابة بتخطيط A4 وخط مضمَّن اختياري، وقراءة للتحقق والتحليل.

pub mod arabic;
pub mod font;
pub mod metrics;
pub mod read;
pub mod writer;

pub use font::TrueTypeFont;
pub use read::{read_pdf, PdfInfo};
pub use writer::{write_pdf, PdfOutput};
