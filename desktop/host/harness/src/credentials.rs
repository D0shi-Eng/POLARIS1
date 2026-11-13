// مخزن بيانات اعتماد للقراءة فقط، للقياس على مزوّد بعيد حقيقي (2026-10-06).
//
// يُفعَّل بـ POLARIS_P08_REAL_KEYS=1 وحده. يقرأ المفتاح الذي حفظه المالك بنفسه من نافذة الاتصال في POLARIS، من الهدف نفسه في
// Windows Credential Manager (`POLARIS/provider/<id>`). لا يكتب ولا يحذف أبدًا: الكتابة والحذف يُرفضان، فلا تستطيع العُدّة أن
// تغيّر مفتاح المالك أو تمحوه. المفتاح لا يُطبع ولا يُكتب في دليل: يمرّ من المخزن إلى رأس الطلب كما في المنتج.

use polaris_host_core::p02::ports::{CredentialStore, CredentialStoreError};
use polaris_host_providers::SecretValue;

pub struct ReadOnlyWindowsStore;

impl CredentialStore for ReadOnlyWindowsStore {
    fn available(&self) -> bool {
        cfg!(windows)
    }

    #[cfg(windows)]
    fn read(&self, target: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        use std::ffi::c_void;
        use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
        use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
        let wide: Vec<u16> = target.encode_utf16().chain(std::iter::once(0)).collect();
        let mut record: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: الهدف منتهٍ بصفر، والسجل يُحرَّر بـCredFree بعد نسخ ما فيه.
        let ok = unsafe { CredReadW(wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut record) };
        if ok == 0 {
            // SAFETY: استدعاء بلا وسائط.
            let code = unsafe { GetLastError() };
            return if code == ERROR_NOT_FOUND { Ok(None) } else { Err(CredentialStoreError::Failed(format!("CredReadW {code}"))) };
        }
        // SAFETY: السجل صالح حتى CredFree؛ الحجم والمؤشر من النظام.
        let text = unsafe {
            let bytes = std::slice::from_raw_parts((*record).CredentialBlob, (*record).CredentialBlobSize as usize);
            let text = String::from_utf8(bytes.to_vec()).ok();
            CredFree(record as *const c_void);
            text
        };
        Ok(text.and_then(SecretValue::new))
    }

    #[cfg(not(windows))]
    fn read(&self, _target: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        Ok(None)
    }

    fn write(&self, _target: &str, _secret: &SecretValue) -> Result<(), CredentialStoreError> {
        Err(CredentialStoreError::Failed("the measurement harness never writes a credential".into()))
    }

    fn delete(&self, _target: &str) -> Result<bool, CredentialStoreError> {
        Err(CredentialStoreError::Failed("the measurement harness never deletes a credential".into()))
    }
}
