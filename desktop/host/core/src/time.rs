// طوابع زمنية بصيغة RFC 3339 بتوقيت UTC فقط.
//
// العقد يرفض الإزاحات المحلية عمدًا حتى يكون الترتيب كليًّا. كُتبت هنا يدويًا بدل
// إضافة تبعية تقويم كاملة: المطلوب تحويل واحد في اتجاه واحد، وخوارزمية الأيام
// المدنية معروفة ومحدودة، فالتبعية لا تشتري شيئًا.

use std::time::{SystemTime, UNIX_EPOCH};

/// يحوّل ثوانيَ يونكس إلى (سنة، شهر، يوم) بخوارزمية الأيام المدنية.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// يصوغ لحظة يونكس بالثواني كطابع زمني مقبول في العقد.
pub fn format_rfc3339_utc(unix_seconds: i64) -> String {
    let days = unix_seconds.div_euclid(86_400);
    let secs_of_day = unix_seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year,
        month,
        day,
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60
    )
}

/// اللحظة الحالية بصيغة العقد.
pub fn now_rfc3339_utc() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    format_rfc3339_utc(seconds)
}

/// اللحظة قبل عدد من الثواني بصيغة العقد. طوابع العقد بطول ثابت وبتوقيت UTC، فمقارنتها نصًّا مقارنة زمنية.
pub fn rfc3339_utc_seconds_ago(seconds: i64) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    format_rfc3339_utc(now - seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_earlier_instant_sorts_before_now() {
        assert!(rfc3339_utc_seconds_ago(60) < now_rfc3339_utc());
        assert_eq!(rfc3339_utc_seconds_ago(0).len(), 20);
    }

    #[test]
    fn formats_known_instants() {
        assert_eq!(format_rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_rfc3339_utc(1_000_000_000), "2001-09-09T01:46:40Z");
        // يوم كبيس: 2024-02-29
        assert_eq!(format_rfc3339_utc(1_709_164_800), "2024-02-29T00:00:00Z");
    }

    #[test]
    fn current_instant_matches_contract_shape() {
        let now = now_rfc3339_utc();
        assert_eq!(now.len(), 20);
        assert!(now.ends_with('Z'));
    }
}
