// خدمة النافذة: ما لا تستطيع النواة فعله لأنه يخصّ نظام التشغيل والإطار.
//
// ثلاث مسؤوليات فقط: اللغة الابتدائية من النظام، والمظهر، وقواعد النافذة عند
// الإقلاع. لا منطق منتج هنا.

use tauri::{LogicalSize, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window};

/// وسم لغة نظام التشغيل، إن عُرف. تجاوزٌ صريح عبر البيئة مسموح لأن الاختبار
/// الأصلي يحتاج أن يُثبت لغةً بعينها دون تغيير إعدادات الجهاز.
pub fn system_locale_tag() -> Option<String> {
    if let Ok(forced) = std::env::var("POLARIS_LOCALE") {
        if !forced.trim().is_empty() {
            return Some(forced);
        }
    }
    sys_locale::get_locale()
}

/// المظهر الابتدائي.
///
/// المضيف يعلن `SYSTEM` عمدًا ولا يسأل نظام التشغيل عن فاتح أو داكن: «اتبع
/// النظام» هو التفضيل الحقيقي، والعارض يحلّه بـ`prefers-color-scheme` فيتابع
/// تغيّر النظام أثناء التشغيل دون أن يعيد المضيف إخباره. سؤال النظام هنا كان
/// سيجمّد القيمة عند لحظة الإقلاع.
pub fn system_appearance() -> Option<polaris_host_core::model::bootstrap::Appearance> {
    None
}

/// حدّ أدنى لحجم النافذة. أصغر من هذا يكسر الشريط الجانبي وصفحة الإعدادات معًا.
pub const MIN_WIDTH: f64 = 960.0;
pub const MIN_HEIGHT: f64 = 640.0;

/// قواعد الإقلاع: نافذة لا تُستعاد خارج الشاشة.
///
/// الحالة الحقيقية التي تحمي منها: شاشة ثانية فُصلت بعد آخر تشغيل، فتُستعاد
/// النافذة إلى إحداثيات لم تعد موجودة، ويرى المستخدم تطبيقًا «لا يفتح».
pub fn apply_startup_rules(window: &WebviewWindow) {
    // الحدّ الأدنى مُعلَن في الإعدادات ومفروض هنا أيضًا: الإعدادات تصف النافذة عند
    // إنشائها، وهذا السطر يبقى صحيحًا لو أنشأها أحد بطريق آخر لاحقًا.
    let _ = window.set_min_size(Some(LogicalSize::new(MIN_WIDTH, MIN_HEIGHT)));
    if is_off_screen(window) {
        let _ = window.center();
    }
}

/// الحدّ الأدنى بالبكسل الفعلي عند معامل تحجيم معيّن. التقريب للأعلى حتى لا
/// يسمح كسرٌ بنافذة أصغر من الحد المنطقي ببكسل.
pub fn min_physical_size(scale_factor: f64) -> (u32, u32) {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 { scale_factor } else { 1.0 };
    ((MIN_WIDTH * scale).ceil() as u32, (MIN_HEIGHT * scale).ceil() as u32)
}

/// الحجم الذي يجب أن تُعاد إليه النافذة، أو لا شيء إن كانت ضمن الحد.
///
/// الحجم الصفري حالة التصغير إلى شريط المهام، وليس تصغيرًا حقيقيًا: لا يُمسّ.
pub fn clamped_size(current: (u32, u32), minimum: (u32, u32)) -> Option<(u32, u32)> {
    let (width, height) = current;
    if width == 0 && height == 0 {
        return None;
    }
    if width >= minimum.0 && height >= minimum.1 {
        return None;
    }
    Some((width.max(minimum.0), height.max(minimum.1)))
}

/// يفرض الحد الأدنى بعد كل تغيير حجم، أيًّا كان مصدره.
///
/// لماذا لا يكفي `set_min_size`: Windows يطبّق حدّ التتبّع على سحب المستخدم
/// لحواف النافذة، لكن `SetWindowPos` من عملية أخرى (أدوات ترتيب النوافذ، أو
/// مسبار القياس الأصلي) صغّر النافذة فعلًا إلى 400x300 في التشغيل الأصلي
/// (P01-W2x). الحدّ هنا ملك التطبيق، فيُفرض من التطبيق.
pub fn enforce_min_size<R: Runtime>(window: &Window<R>, size: PhysicalSize<u32>) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let minimum = min_physical_size(window.scale_factor().unwrap_or(1.0));
    if let Some((width, height)) = clamped_size((size.width, size.height), minimum) {
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
}

/// هل النافذة خارج كل الشاشات المتاحة؟
pub fn is_off_screen(window: &WebviewWindow) -> bool {
    let Ok(position) = window.outer_position() else { return false };
    let Ok(monitors) = window.available_monitors() else { return false };
    if monitors.is_empty() {
        return false;
    }
    !monitors.iter().any(|monitor| contains(monitor.position(), monitor.size(), &position))
}

fn contains(
    origin: &PhysicalPosition<i32>,
    size: &tauri::PhysicalSize<u32>,
    point: &PhysicalPosition<i32>,
) -> bool {
    let right = origin.x + size.width as i32;
    let bottom = origin.y + size.height as i32;
    point.x >= origin.x && point.x < right && point.y >= origin.y && point.y < bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_below_the_minimum_is_raised_to_it() {
        assert_eq!(clamped_size((400, 300), (960, 640)), Some((960, 640)));
        assert_eq!(clamped_size((1200, 300), (960, 640)), Some((1200, 640)));
        assert_eq!(clamped_size((400, 900), (960, 640)), Some((960, 900)));
    }

    #[test]
    fn a_window_at_or_above_the_minimum_is_left_alone() {
        assert_eq!(clamped_size((960, 640), (960, 640)), None);
        assert_eq!(clamped_size((1280, 800), (960, 640)), None);
    }

    #[test]
    fn a_minimized_window_is_not_resized() {
        assert_eq!(clamped_size((0, 0), (960, 640)), None);
    }

    #[test]
    fn the_minimum_scales_with_the_display_and_rounds_up() {
        assert_eq!(min_physical_size(1.0), (960, 640));
        assert_eq!(min_physical_size(1.25), (1200, 800));
        assert_eq!(min_physical_size(1.5), (1440, 960));
        assert_eq!(min_physical_size(1.75), (1680, 1120));
        assert_eq!(min_physical_size(0.0), (960, 640));
        assert_eq!(min_physical_size(f64::NAN), (960, 640));
    }
}
