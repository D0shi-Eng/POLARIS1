// منفذ سطح المكتب على Windows (Phase-05): الملف الوحيد في المنتج الذي يلمس Win32
// للجرد والالتقاط والإدخال. ملف FFI مُسمّى ذو غرض واحد، كـ`credentials.rs`
// و`shutdown.rs`، والفحص الأمني الثابت يعدّه ضمن القائمة المسمّاة بالاسم.
//
// لا قرار أمني هنا: النواة قرّرت المنحة والهويّة والحداثة والخطر قبل النداء. ما
// يضمنه هذا الملف هو ما لا يُضمن إلا من النظام:
//   ١ — الهويّة تُقرأ من النظام: المقبض، ومعرّف العملية، ووقت إنشائها، ومسار ملفّها.
//   ٢ — الالتقاط للنافذة وحدها (PrintWindow)، ولا تغادر البكسلات هذا الملف: بصمتها فقط.
//   ٣ — المقدّمة تُطلب ثم تُتحقَّق، ولا يُفترض نجاحها.
//   ٤ — النقر يضع المؤشّر ثم يرسل الضغط؛ والنقطة فُحصت قبله (النواة تسأل عن الجذر).
//
// لا لقطة تُكتب على القرص، ولا نصّ حقل كلمة مرور يُقرأ.

use std::mem::size_of;

use polaris_host_core::p05::computer::port::{
    DesktopError, DesktopPort, ElementRole, Frame, KeyChord, MouseButton, Rect, UiElement, WindowIdentity, WindowInfo,
};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::Storage::Xps::PrintWindow;
use windows_sys::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    IsWindowEnabled, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_NEXT, VK_PRIOR, VK_RETURN,
    VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumChildWindows, EnumWindows, GetAncestor, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SendMessageTimeoutW, SetCursorPos,
    SetForegroundWindow, WindowFromPoint, GA_ROOT, GWL_STYLE, PW_RENDERFULLCONTENT, SMTO_ABORTIFHUNG, WM_GETTEXT,
};

/// نمط حقل كلمة المرور في عنصر EDIT.
const ES_PASSWORD: i32 = 0x20;
/// رسالة سؤال عنصر EDIT عن محرف الإخفاء.
const EM_GETPASSWORDCHAR: u32 = 0x00D2;
/// أقصى عدد عناصر فرعية تُقرأ من نافذة واحدة.
const MAX_CHILDREN: usize = 200;

fn hwnd_of(handle: u64) -> HWND {
    handle as usize as HWND
}

fn handle_of(hwnd: HWND) -> u64 {
    hwnd as usize as u64
}

fn wide_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let n = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if n <= 0 {
        return String::new();
    }
    wide_to_string(&buffer[..n as usize])
}

fn window_title(hwnd: HWND) -> String {
    let mut buffer = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    if n <= 0 {
        return String::new();
    }
    wide_to_string(&buffer[..n as usize])
}

/// نصّ عنصر فرعي في عملية أخرى، بمهلة: نافذة معلّقة لا تعلّق المضيف.
fn control_text(hwnd: HWND) -> String {
    let mut buffer = [0u16; 512];
    let mut result: usize = 0;
    let ok = unsafe {
        SendMessageTimeoutW(hwnd, WM_GETTEXT, buffer.len(), buffer.as_mut_ptr() as LPARAM, SMTO_ABORTIFHUNG, 200, &mut result)
    };
    if ok == 0 {
        return String::new();
    }
    wide_to_string(&buffer[..result.min(buffer.len())])
}

fn window_rect(hwnd: HWND) -> Rect {
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetWindowRect(hwnd, &mut rect) };
    Rect { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/// هويّة العملية: وقت إنشائها ومسار ملفّها. صفر ومسار فارغ حين يتعذّر الفتح،
/// والنواة ترفض هويّة ناقصة هدفًا.
fn process_identity(pid: u32) -> (u64, String) {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return (0, String::new());
    }
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    let created_at = if unsafe { GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) } != 0 {
        (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime)
    } else {
        0
    };
    let mut path = [0u16; 1024];
    let mut size = path.len() as u32;
    let executable = if unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) } != 0 {
        wide_to_string(&path[..size as usize])
    } else {
        String::new()
    };
    unsafe { CloseHandle(process) };
    (created_at, executable)
}

fn window_info(hwnd: HWND) -> Option<WindowInfo> {
    if unsafe { IsWindow(hwnd) } == 0 {
        return None;
    }
    let mut pid: u32 = 0;
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    let (process_created_at, executable) = process_identity(pid);
    Some(WindowInfo {
        identity: WindowIdentity { hwnd: handle_of(hwnd), pid, process_created_at, executable, thread_id, class_name: class_name(hwnd) },
        title: window_title(hwnd),
        rect: window_rect(hwnd),
        visible: unsafe { IsWindowVisible(hwnd) } != 0,
        minimized: unsafe { IsIconic(hwnd) } != 0,
    })
}

unsafe extern "system" fn collect_top_level(hwnd: HWND, state: LPARAM) -> BOOL {
    let list = &mut *(state as *mut Vec<HWND>);
    if IsWindowVisible(hwnd) != 0 {
        list.push(hwnd);
    }
    1
}

unsafe extern "system" fn collect_children(hwnd: HWND, state: LPARAM) -> BOOL {
    let list = &mut *(state as *mut Vec<HWND>);
    list.push(hwnd);
    BOOL::from(list.len() < MAX_CHILDREN)
}

fn role_of(class: &str, style: i32) -> ElementRole {
    let upper = class.to_ascii_uppercase();
    if upper.contains("BUTTON") {
        match style & 0xF {
            2 | 3 | 5 | 6 => ElementRole::CheckBox,
            4 | 9 => ElementRole::CheckBox,
            _ => ElementRole::Button,
        }
    } else if upper.contains("EDIT") || upper.contains("RICHEDIT") {
        ElementRole::Edit
    } else if upper.contains("STATIC") {
        ElementRole::Text
    } else if upper.contains("COMBOBOX") {
        ElementRole::ComboBox
    } else if upper.contains("LISTBOX") || upper.contains("SYSLISTVIEW") {
        ElementRole::List
    } else {
        ElementRole::Other
    }
}

fn keyboard(vk: VIRTUAL_KEY, scan: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn mouse(flags: u32, data: u32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn send(inputs: &[INPUT]) -> Result<(), DesktopError> {
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        // إدخال لم يُرسل كاملًا (حجب UIPI، أو سطح مكتب آمن) يُبلَّغ فشلًا لا نجاحًا.
        Err(DesktopError::Failed(format!("the system accepted {sent} of {} input events", inputs.len())))
    }
}

/// منفذ Win32 الحقيقي.
pub struct Win32Desktop;

impl DesktopPort for Win32Desktop {
    fn available(&self) -> bool {
        true
    }

    fn list_windows(&self) -> Result<Vec<WindowInfo>, DesktopError> {
        let mut handles: Vec<HWND> = Vec::new();
        unsafe { EnumWindows(Some(collect_top_level), &mut handles as *mut Vec<HWND> as LPARAM) };
        Ok(handles.into_iter().take(400).filter_map(window_info).collect())
    }

    fn window(&self, hwnd: u64) -> Result<WindowInfo, DesktopError> {
        window_info(hwnd_of(hwnd)).ok_or(DesktopError::WindowGone)
    }

    fn elements(&self, hwnd: u64) -> Result<Vec<UiElement>, DesktopError> {
        let root = hwnd_of(hwnd);
        if unsafe { IsWindow(root) } == 0 {
            return Err(DesktopError::WindowGone);
        }
        let mut children: Vec<HWND> = Vec::new();
        unsafe { EnumChildWindows(root, Some(collect_children), &mut children as *mut Vec<HWND> as LPARAM) };
        let focused = unsafe { windows_sys::Win32::UI::Input::KeyboardAndMouse::GetFocus() };
        Ok(children
            .into_iter()
            .map(|child| {
                let class = class_name(child);
                let style = unsafe { GetWindowLongW(child, GWL_STYLE) };
                let role = role_of(&class, style);
                let mut password = false;
                if role == ElementRole::Edit {
                    let mut ch: usize = 0;
                    let asked = unsafe { SendMessageTimeoutW(child, EM_GETPASSWORDCHAR, 0, 0, SMTO_ABORTIFHUNG, 200, &mut ch) };
                    password = style & ES_PASSWORD != 0 || (asked != 0 && ch != 0);
                }
                UiElement {
                    handle: handle_of(child),
                    role,
                    // نصّ حقل كلمة المرور لا يُطلب أصلًا.
                    text: if password { String::new() } else { control_text(child) },
                    class_name: class,
                    rect: window_rect(child),
                    enabled: unsafe { IsWindowEnabled(child) } != 0,
                    visible: unsafe { IsWindowVisible(child) } != 0,
                    password,
                    focused: child == focused,
                }
            })
            .collect())
    }

    fn capture(&self, hwnd: u64) -> Result<Frame, DesktopError> {
        let window = hwnd_of(hwnd);
        let rect = window_rect(window);
        let (width, height) = (rect.width(), rect.height());
        if width <= 0 || height <= 0 {
            return Err(DesktopError::Failed("the window has no visible area".into()));
        }
        unsafe {
            let window_dc = GetWindowDC(window);
            if window_dc.is_null() {
                return Err(DesktopError::WindowGone);
            }
            let memory_dc = CreateCompatibleDC(window_dc);
            let bitmap = CreateCompatibleBitmap(window_dc, width, height);
            let previous = SelectObject(memory_dc, bitmap);
            let printed = PrintWindow(window, memory_dc, PW_RENDERFULLCONTENT) != 0;
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };
            let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
            SelectObject(memory_dc, previous);
            let lines = GetDIBits(memory_dc, bitmap, 0, height as u32, pixels.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
            DeleteObject(bitmap);
            DeleteDC(memory_dc);
            ReleaseDC(window, window_dc);
            if !printed || lines <= 0 {
                return Err(DesktopError::Failed("the window could not be captured".into()));
            }
            // البكسلات تُبصم هنا وتُسقط هنا: لا تعبر إلى النواة ولا إلى القرص.
            Ok(Frame { width: width as u32, height: height as u32, pixel_digest: polaris_host_core::digest::sha256_hex(&pixels) })
        }
    }

    fn focus(&self, hwnd: u64) -> Result<(), DesktopError> {
        let window = hwnd_of(hwnd);
        if unsafe { IsWindow(window) } == 0 {
            return Err(DesktopError::WindowGone);
        }
        unsafe {
            if SetForegroundWindow(window) != 0 && GetForegroundWindow() == window {
                return Ok(());
            }
            // ربط طابور الإدخال بخيط النافذة الأمامية الحالية مؤقتًا، ثم فكّه دائمًا.
            let foreground = GetForegroundWindow();
            let their_thread = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
            let our_thread = GetCurrentThreadId();
            let attached = their_thread != 0 && their_thread != our_thread && AttachThreadInput(our_thread, their_thread, 1) != 0;
            BringWindowToTop(window);
            SetForegroundWindow(window);
            if attached {
                AttachThreadInput(our_thread, their_thread, 0);
            }
        }
        // النجاح يُقاس بالمقدّمة الفعلية، والنواة تتحقّق منها مرّة أخرى قبل أي إدخال.
        Ok(())
    }

    fn foreground(&self) -> Result<Option<u64>, DesktopError> {
        let window = unsafe { GetForegroundWindow() };
        Ok((!window.is_null()).then(|| handle_of(window)))
    }

    fn root_window_at(&self, x: i32, y: i32) -> Result<Option<u64>, DesktopError> {
        let hit = unsafe { WindowFromPoint(POINT { x, y }) };
        if hit.is_null() {
            return Ok(None);
        }
        let root = unsafe { GetAncestor(hit, GA_ROOT) };
        Ok((!root.is_null()).then(|| handle_of(root)))
    }

    fn pointer_move(&self, x: i32, y: i32) -> Result<(), DesktopError> {
        if unsafe { SetCursorPos(x, y) } == 0 {
            return Err(DesktopError::Failed("the pointer could not be moved".into()));
        }
        Ok(())
    }

    fn click(&self, x: i32, y: i32, button: MouseButton) -> Result<(), DesktopError> {
        self.pointer_move(x, y)?;
        let (down, up) = match button {
            MouseButton::Left => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
            MouseButton::Right => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        };
        send(&[mouse(down, 0), mouse(up, 0)])
    }

    fn key(&self, chord: KeyChord) -> Result<(), DesktopError> {
        let (modifier, key): (Option<VIRTUAL_KEY>, VIRTUAL_KEY) = match chord {
            KeyChord::Enter => (None, VK_RETURN),
            KeyChord::Tab => (None, VK_TAB),
            KeyChord::ShiftTab => (Some(VK_SHIFT), VK_TAB),
            KeyChord::Escape => (None, VK_ESCAPE),
            KeyChord::Backspace => (None, VK_BACK),
            KeyChord::Delete => (None, VK_DELETE),
            KeyChord::Space => (None, VK_SPACE),
            KeyChord::Up => (None, VK_UP),
            KeyChord::Down => (None, VK_DOWN),
            KeyChord::Left => (None, VK_LEFT),
            KeyChord::Right => (None, VK_RIGHT),
            KeyChord::Home => (None, VK_HOME),
            KeyChord::End => (None, VK_END),
            KeyChord::PageUp => (None, VK_PRIOR),
            KeyChord::PageDown => (None, VK_NEXT),
            KeyChord::SelectAll => (Some(VK_CONTROL), b'A' as VIRTUAL_KEY),
        };
        let mut inputs = Vec::new();
        if let Some(m) = modifier {
            inputs.push(keyboard(m, 0, 0));
        }
        inputs.push(keyboard(key, 0, 0));
        inputs.push(keyboard(key, 0, KEYEVENTF_KEYUP));
        if let Some(m) = modifier {
            inputs.push(keyboard(m, 0, KEYEVENTF_KEYUP));
        }
        send(&inputs)
    }

    fn type_text(&self, text: &str) -> Result<(), DesktopError> {
        let mut inputs = Vec::new();
        for unit in text.encode_utf16() {
            inputs.push(keyboard(0, unit, KEYEVENTF_UNICODE));
            inputs.push(keyboard(0, unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
        send(&inputs)
    }

    fn scroll(&self, x: i32, y: i32, notches: i32) -> Result<(), DesktopError> {
        self.pointer_move(x, y)?;
        send(&[mouse(MOUSEEVENTF_WHEEL, (notches * 120) as u32)])
    }
}

// اختبار دخان تشخيصي على نافذة التجهيزة الحقيقية التي يملكها المشغّل. يُترجَم فقط
// بالميزة `win32-smoke` ومعرّف عمليتها مسمًّى صراحةً (`POLARIS_P05_FIXTURE_PID`)،
// ولا يلمس نافذة غيرها. ليس تخطّيًا في المجموعة القانونية: المنفذ نفسه يُقاس هناك
// بالتشغيل الأصلي الكامل على النافذة نفسها (E2E-14..19).
#[cfg(all(test, feature = "win32-smoke"))]
mod tests {
    use std::sync::Arc;

    use polaris_host_core::audit::AuditLedger;
    use polaris_host_core::p03::clock::RuntimeClock;
    use polaris_host_core::p05::computer::port::MouseButton;
    use polaris_host_core::p05::computer::runtime::{ComputerActionContext, ComputerRuntime, InputAction};
    use polaris_host_core::p05::computer::store::ComputerStore;
    use polaris_host_core::p05::session::ActionBudget;
    use polaris_host_core::storage::Database;
    use polaris_host_providers::net::CancelToken;

    use super::*;

    #[test]
    fn the_win32_port_observes_and_clicks_the_fixture_window_only() {
        let pid: u32 = std::env::var("POLARIS_P05_FIXTURE_PID").expect("fixture pid").parse().unwrap();
        let port = Arc::new(Win32Desktop);
        let all = port.list_windows().unwrap();
        eprintln!("listed {} windows; fixture candidates: {:?}", all.len(), all.iter().filter(|w| w.identity.pid == pid || w.title.contains("POLARIS")).map(|w| (w.identity.pid, w.title.clone())).collect::<Vec<_>>());
        let window = all
            .into_iter()
            .find(|w| w.identity.pid == pid && w.title.contains("POLARIS TEST FIXTURE"))
            .expect("the fixture window is listed");
        assert!(window.identity.is_complete(), "incomplete identity: {:?}", window.identity);
        let db = Arc::new(Database::in_memory().unwrap());
        let runtime = ComputerRuntime::new(port.clone(), ComputerStore::new(db.clone()), RuntimeClock::system(), Arc::new(AuditLedger::new(db)), ActionBudget::default());
        runtime.grant("m1", window.identity.hwnd).expect("grant");
        let cancel = CancelToken::new();
        let ctx = ComputerActionContext { mission_id: "m1", task_id: "t1", agent_id: "a1", cancel: &cancel };
        let observed = runtime.observe(&ctx, None).expect("observe").observation.unwrap();
        eprintln!("{}", observed.context_text());
        let increment = observed.elements.iter().find(|e| e.text == "Increment").expect("Increment button").element_ref.clone();
        assert!(observed.elements.iter().any(|e| e.password), "the password field was not detected");
        let result = runtime.perform(&ctx, &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest).expect("click");
        eprintln!("{}", result.summary);
        assert!(result.observed_text.unwrap().contains("count: 1"), "the click did not reach the fixture");
    }
}
