// المشاريع: السجل، والتخزين، ومرجع مساحة العمل.

pub mod model;
pub mod repository;
pub mod service;
pub mod workspace;

pub use model::{Project, ProjectStatus};
pub use service::ProjectService;
