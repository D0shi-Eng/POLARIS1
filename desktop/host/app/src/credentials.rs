// مخزن بيانات الاعتماد ونافذة إدخالها على Windows.
//
// المفتاح يُكتب في Windows Credential Manager كسجل عام (CRED_TYPE_GENERIC) باسم
// هدف ثابت لكل مزوّد، ولا يُكتب في أي ملف. نافذة الإدخال هي نافذة النظام
// (CredUIPromptForWindowsCredentialsW): العارض لا يرى الحقل ولا ما يُكتب فيه.
// كل مخزن مؤقت يحمل المفتاح يُصفَّر قبل تحريره.

use std::ffi::c_void;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicIsize, Ordering};

use polaris_host_core::p02::ports::{CredentialPrompt, CredentialStore, CredentialStoreError, PromptOutcome};
use polaris_host_providers::SecretValue;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED, ERROR_NOT_FOUND, FILETIME};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredUIPromptForWindowsCredentialsW, CredUnPackAuthenticationBufferW, CredWriteW,
    CREDENTIALW, CREDUIWIN_GENERIC, CREDUI_INFOW, CRED_PACK_GENERIC_CREDENTIALS, CRED_PERSIST_LOCAL_MACHINE,
    CRED_TYPE_GENERIC,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;

/// أقصى طول مقبول لمفتاح بمحارف UTF-16. المفاتيح الرسمية أقصر بكثير.
const MAX_SECRET_UNITS: usize = 1024;
/// حدّ Credential Manager لحجم السجل العام بالبايت.
const MAX_BLOB_BYTES: usize = 5 * 512;
/// اسم المستخدم المسجّل مع المفتاح. ليس سرًا، ولا يحمل معنى.
const USER_NAME: &str = "polaris";

/// مقبض النافذة الرئيسية كي تكون نافذة الإدخال مشروطة بها. صفر يعني بلا أب.
static PARENT_WINDOW: AtomicIsize = AtomicIsize::new(0);

pub fn set_parent_window(handle: *mut c_void) {
    PARENT_WINDOW.store(handle as isize, Ordering::SeqCst);
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// تصفير مخزن قبل تحريره. الكتابة المتطايرة تمنع المترجم من حذفها.
fn wipe(buffer: *mut u8, len: usize) {
    for i in 0..len {
        // SAFETY: المستدعي يضمن أن المخزن بطول len وقابل للكتابة.
        unsafe { std::ptr::write_volatile(buffer.add(i), 0) };
    }
}

fn wipe_units(units: &mut [u16]) {
    for unit in units.iter_mut() {
        // SAFETY: مرجع صالح قابل للكتابة.
        unsafe { std::ptr::write_volatile(unit, 0) };
    }
}

fn last_error() -> u32 {
    // SAFETY: استدعاء بلا وسائط.
    unsafe { GetLastError() }
}

pub struct WindowsCredentialStore;

impl CredentialStore for WindowsCredentialStore {
    fn available(&self) -> bool {
        true
    }

    fn read(&self, target: &str) -> Result<Option<SecretValue>, CredentialStoreError> {
        let target = wide(target);
        let mut record: *mut CREDENTIALW = null_mut();
        // SAFETY: الهدف منتهٍ بصفر، والمؤشر الخارج يُحرَّر بـCredFree.
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut record) };
        if ok == 0 {
            let code = last_error();
            return if code == ERROR_NOT_FOUND { Ok(None) } else { Err(CredentialStoreError::Failed(format!("CredReadW {code}"))) };
        }
        // SAFETY: السجل صالح حتى CredFree؛ الحجم والمؤشر من النظام.
        let secret = unsafe {
            let blob = (*record).CredentialBlob;
            let size = (*record).CredentialBlobSize as usize;
            let bytes = std::slice::from_raw_parts(blob, size);
            let text = String::from_utf8(bytes.to_vec()).ok();
            wipe(blob, size);
            CredFree(record as *const c_void);
            text
        };
        Ok(secret.and_then(SecretValue::new))
    }

    fn write(&self, target: &str, secret: &SecretValue) -> Result<(), CredentialStoreError> {
        let mut blob = secret.expose().as_bytes().to_vec();
        if blob.len() > MAX_BLOB_BYTES {
            wipe(blob.as_mut_ptr(), blob.len());
            return Err(CredentialStoreError::Failed("secret too large".into()));
        }
        let mut target = wide(target);
        let mut user = wide(USER_NAME);
        let record = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: null_mut(),
            LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: null_mut(),
            TargetAlias: null_mut(),
            UserName: user.as_mut_ptr(),
        };
        // SAFETY: كل المؤشرات تعيش حتى نهاية النداء.
        let ok = unsafe { CredWriteW(&record, 0) };
        let code = if ok == 0 { last_error() } else { 0 };
        wipe(blob.as_mut_ptr(), blob.len());
        if ok == 0 {
            return Err(CredentialStoreError::Failed(format!("CredWriteW {code}")));
        }
        Ok(())
    }

    fn delete(&self, target: &str) -> Result<bool, CredentialStoreError> {
        let target = wide(target);
        // SAFETY: الهدف منتهٍ بصفر.
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 {
            return Ok(true);
        }
        match last_error() {
            ERROR_NOT_FOUND => Ok(false),
            code => Err(CredentialStoreError::Failed(format!("CredDeleteW {code}"))),
        }
    }
}

pub struct WindowsCredentialPrompt;

impl CredentialPrompt for WindowsCredentialPrompt {
    fn prompt(&self, provider_display_name: &str) -> PromptOutcome {
        let caption = wide("POLARIS");
        // النص يسمّي المزوّد فقط. لا يُطلب اسم مستخدم ذو معنى: الحقل الثاني هو المفتاح.
        let message = wide(&format!("{provider_display_name}: API key"));
        let info = CREDUI_INFOW {
            cbSize: std::mem::size_of::<CREDUI_INFOW>() as u32,
            hwndParent: PARENT_WINDOW.load(Ordering::SeqCst) as *mut c_void,
            pszMessageText: message.as_ptr(),
            pszCaptionText: caption.as_ptr(),
            hbmBanner: null_mut(),
        };
        let mut package: u32 = 0;
        let mut out: *mut c_void = null_mut();
        let mut out_size: u32 = 0;
        // SAFETY: البنية صالحة طوال النداء؛ المخزن الخارج يُصفَّر ويُحرَّر أدناه.
        let status = unsafe {
            CredUIPromptForWindowsCredentialsW(
                &info,
                0,
                &mut package,
                null(),
                0,
                &mut out,
                &mut out_size,
                null_mut(),
                CREDUIWIN_GENERIC,
            )
        };
        if status == ERROR_CANCELLED {
            return PromptOutcome::Cancelled;
        }
        if status != 0 || out.is_null() {
            return PromptOutcome::Unavailable;
        }
        let outcome = unpack(out, out_size);
        wipe(out as *mut u8, out_size as usize);
        // SAFETY: المخزن خصّصه النظام بـCoTaskMemAlloc.
        unsafe { CoTaskMemFree(out as *const c_void) };
        outcome
    }
}

fn unpack(buffer: *mut c_void, size: u32) -> PromptOutcome {
    let mut user = vec![0u16; 256];
    let mut domain = vec![0u16; 256];
    let mut password = vec![0u16; MAX_SECRET_UNITS];
    let mut user_len = user.len() as u32;
    let mut domain_len = domain.len() as u32;
    let mut password_len = password.len() as u32;
    // SAFETY: كل مخزن بطوله المعلن، والمخزن المصدر من النظام.
    let ok = unsafe {
        CredUnPackAuthenticationBufferW(
            CRED_PACK_GENERIC_CREDENTIALS,
            buffer,
            size,
            user.as_mut_ptr(),
            &mut user_len,
            domain.as_mut_ptr(),
            &mut domain_len,
            password.as_mut_ptr(),
            &mut password_len,
        )
    };
    let outcome = if ok == 0 {
        PromptOutcome::Unavailable
    } else {
        // الطول المُعاد يشمل الصفر الختامي.
        let units = password.iter().position(|u| *u == 0).unwrap_or(password.len());
        // `SecretValue::new` يقصّ الفراغ ويصفّر النص الذي أخذه.
        match String::from_utf16(&password[..units]).ok().and_then(SecretValue::new) {
            Some(secret) => PromptOutcome::Entered(secret),
            None => PromptOutcome::Cancelled,
        }
    };
    wipe_units(&mut password);
    wipe_units(&mut user);
    wipe_units(&mut domain);
    outcome
}

#[cfg(test)]
mod native_scope_tests {
    // على Credential Manager الحقيقي، بمعرّف مزوّد اصطناعي فريد لكل تشغيل: لا يُقرأ ولا
    // يُكتب ولا يُحذف أي هدف لمزوّد يملكه المستخدم. كل ما يُكتب يُحذف في آخر الاختبار.
    use std::sync::Arc;

    use polaris_host_core::p02::ports::{credential_scope_for, scoped_target, CredentialStore, ScopedCredentialStore};
    use polaris_host_providers::secret::credential_target;

    use super::*;

    fn secret(text: &str) -> SecretValue {
        SecretValue::new(text.to_string()).unwrap()
    }

    #[test]
    fn the_real_store_keeps_test_scopes_apart_from_production_and_from_each_other() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let provider = format!("qa-canary-{}-{nonce}", std::process::id());
        let production = credential_target(&provider);
        let raw: Arc<dyn CredentialStore> = Arc::new(WindowsCredentialStore);
        let scope_a = credential_scope_for(std::path::Path::new(r"D:\POLARIS\_local\qa-scope-a"));
        let scope_b = credential_scope_for(std::path::Path::new(r"D:\POLARIS\_local\qa-scope-b"));
        let a = ScopedCredentialStore::new(raw.clone(), scope_a.clone());
        let b = ScopedCredentialStore::new(raw.clone(), scope_b.clone());

        // create / read
        a.write(&production, &secret("synthetic-a-1")).unwrap();
        b.write(&production, &secret("synthetic-b-1")).unwrap();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert!(raw.read(&production).unwrap().is_none(), "a scoped write reached the production target");
            assert_eq!(a.read(&production).unwrap().unwrap().expose(), "synthetic-a-1");
            assert_eq!(b.read(&production).unwrap().unwrap().expose(), "synthetic-b-1");
            assert_eq!(raw.read(&scoped_target(&scope_a, &production)).unwrap().unwrap().expose(), "synthetic-a-1");
            // update
            a.write(&production, &secret("synthetic-a-2")).unwrap();
            // «إعادة التشغيل»: مخزن جديد بالنطاق نفسه يقرأ القيمة المحفوظة.
            let a_again = ScopedCredentialStore::new(Arc::new(WindowsCredentialStore), scope_a.clone());
            assert_eq!(a_again.read(&production).unwrap().unwrap().expose(), "synthetic-a-2");
            assert_eq!(b.read(&production).unwrap().unwrap().expose(), "synthetic-b-1");
            // delete في نطاق لا يمسّ الآخر
            assert!(a.delete(&production).unwrap());
            assert!(a.read(&production).unwrap().is_none());
            assert_eq!(b.read(&production).unwrap().unwrap().expose(), "synthetic-b-1");
            assert!(raw.read(&production).unwrap().is_none());
        }));
        let _ = a.delete(&production);
        let _ = b.delete(&production);
        assert!(b.read(&production).unwrap().is_none(), "cleanup left a synthetic record");
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}
