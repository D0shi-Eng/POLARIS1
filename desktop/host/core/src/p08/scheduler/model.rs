// نموذج الجدولة: متى تعمل المهمّة المجدولة، بحساب زمني حتمي بلا مكتبة تقويم.
//
// المنطقة الزمنية إزاحة ثابتة عن UTC (مثل `UTC+03:00` لتوقيت الرياض). هذا حدّ مُعلن:
// المناطق ذات التوقيت الصيفي تُمثَّل بإزاحتها الحالية ولا يُتابَع تغيّرها. التواريخ
// تُحسب بخوارزمية الأيام المدنية (Hinnant)، فلا تعتمد على ساعة النظام ولا منطقته.

use serde::{Deserialize, Serialize};

pub const MIN_INTERVAL_MINUTES: u32 = 15;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ScheduleSpec {
    Once { at: String },
    Interval { minutes: u32 },
    Daily { time: String },
    Weekly { days: Vec<String>, time: String },
    /// أيام من الشهر (1..31) في وقت واحد، كـ«شهريًا في {dates} الساعة {time}» في مانوس. شهر بلا اليوم المختار (31 في نيسان) لا يعمل فيه.
    Monthly { days: Vec<u8>, time: String },
}

/// قالب المهمّة التي تُنشأ عند كل تشغيل.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MissionTemplate {
    pub title: String,
    pub objective: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

impl MissionTemplate {
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() || self.title.chars().count() > 200 {
            return Err("the title must be 1..200 characters".into());
        }
        if self.objective.trim().is_empty() || self.objective.chars().count() > 8_000 {
            return Err("the objective must be 1..8000 characters".into());
        }
        if let Some(p) = &self.project_id {
            if !crate::ids::is_uuid_v4(p) {
                return Err("project_id is not an identifier this host issues".into());
            }
        }
        Ok(())
    }
}

/// أيام من 1970-01-01 لتاريخ مدني.
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// التاريخ المدني ليوم منذ 1970-01-01 (عكس `days_from_civil`).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// يحلّل `YYYY-MM-DDTHH:MM:SSZ` إلى ثوانٍ منذ الحقبة.
pub fn parse_rfc3339_utc(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() != 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[19] != b'Z' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| text.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, s) = (n(0..4)?, n(5..7)?, n(8..10)?, n(11..13)?, n(14..16)?, n(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || s > 59 {
        return None;
    }
    Some(days_from_civil(y, mo as u32, d as u32) * 86_400 + h * 3_600 + mi * 60 + s)
}

/// إزاحة المنطقة بالثواني: `UTC` أو `UTC+HH:MM` أو `UTC-HH:MM`.
pub fn parse_offset(zone: &str) -> Option<i64> {
    if zone == "UTC" {
        return Some(0);
    }
    let rest = zone.strip_prefix("UTC")?;
    let (sign, hm) = match rest.chars().next()? {
        '+' => (1, &rest[1..]),
        '-' => (-1, &rest[1..]),
        _ => return None,
    };
    let (h, m) = hm.split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    if h > 14 || m > 59 || h.to_string().len() > 2 {
        return None;
    }
    Some(sign * (h * 3_600 + m * 60))
}

fn parse_time(text: &str) -> Option<i64> {
    let (h, m) = text.split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    ((0..24).contains(&h) && (0..60).contains(&m) && text.len() == 5).then_some(h * 3_600 + m * 60)
}

fn weekday(name: &str) -> Option<i64> {
    // 1970-01-01 كان خميسًا: فهرس اليوم = (أيام + 4) mod 7، والأحد صفر.
    Some(match name {
        "SUN" => 0,
        "MON" => 1,
        "TUE" => 2,
        "WED" => 3,
        "THU" => 4,
        "FRI" => 5,
        "SAT" => 6,
        _ => return None,
    })
}

impl ScheduleSpec {
    pub fn validate(&self, zone: &str) -> Result<(), String> {
        parse_offset(zone).ok_or("the timezone must be UTC or UTC±HH:MM")?;
        match self {
            Self::Once { at } => parse_rfc3339_utc(at).map(|_| ()).ok_or_else(|| "at must be YYYY-MM-DDTHH:MM:SSZ".into()),
            Self::Interval { minutes } if *minutes < MIN_INTERVAL_MINUTES || *minutes > 60 * 24 * 31 => Err(format!("the interval must be {MIN_INTERVAL_MINUTES} minutes to 31 days")),
            Self::Interval { .. } => Ok(()),
            Self::Daily { time } => parse_time(time).map(|_| ()).ok_or_else(|| "time must be HH:MM".into()),
            Self::Weekly { days, time } => {
                parse_time(time).ok_or("time must be HH:MM")?;
                if days.is_empty() || days.len() > 7 || days.iter().any(|d| weekday(d).is_none()) {
                    return Err("days must name SUN..SAT".into());
                }
                Ok(())
            }
            Self::Monthly { days, time } => {
                parse_time(time).ok_or("time must be HH:MM")?;
                let mut seen = days.clone();
                seen.sort_unstable();
                seen.dedup();
                if days.is_empty() || seen.len() != days.len() || days.iter().any(|d| !(1..=31).contains(d)) {
                    return Err("days must be distinct days of the month 1..31".into());
                }
                Ok(())
            }
        }
    }

    /// أول تشغيل بعد `after` (ثوانٍ UTC)، أو لا شيء إن انقضى تشغيل وحيد.
    pub fn next_after(&self, zone: &str, after: i64) -> Option<i64> {
        let offset = parse_offset(zone)?;
        match self {
            Self::Once { at } => parse_rfc3339_utc(at).filter(|t| *t > after),
            Self::Interval { minutes } => Some(after + *minutes as i64 * 60),
            Self::Daily { time } => {
                let t = parse_time(time)?;
                let local = after + offset;
                let day = local.div_euclid(86_400);
                let candidate = day * 86_400 + t;
                let next_local = if candidate > local { candidate } else { candidate + 86_400 };
                Some(next_local - offset)
            }
            Self::Weekly { days, time } => {
                let t = parse_time(time)?;
                let wanted: Vec<i64> = days.iter().filter_map(|d| weekday(d)).collect();
                let local = after + offset;
                let day = local.div_euclid(86_400);
                (0..8).map(|k| day + k).find_map(|d| {
                    let candidate = d * 86_400 + t;
                    (wanted.contains(&(d + 4).rem_euclid(7)) && candidate > local).then_some(candidate - offset)
                })
            }
            Self::Monthly { days, time } => {
                let t = parse_time(time)?;
                let local = after + offset;
                let day = local.div_euclid(86_400);
                // اليوم 31 يأتي في سبعة أشهر من اثني عشر: سنة واحدة تكفي لأي يوم مختار.
                (0..=366).map(|k| day + k).find_map(|d| {
                    let candidate = d * 86_400 + t;
                    (days.contains(&(civil_from_days(d).2 as u8)) && candidate > local).then_some(candidate - offset)
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_round_trip_through_the_formatter() {
        for secs in [0i64, 951_782_400, 1_790_300_000, 4_102_444_800] {
            let text = crate::time::format_rfc3339_utc(secs);
            assert_eq!(parse_rfc3339_utc(&text), Some(secs), "{text}");
        }
        assert_eq!(parse_rfc3339_utc("2026-13-01T00:00:00Z"), None);
    }

    #[test]
    fn a_daily_schedule_in_riyadh_time_fires_at_the_local_hour() {
        let spec = ScheduleSpec::Daily { time: "08:30".into() };
        // 2026-09-25T06:00:00Z = 09:00 في الرياض: التالي غدًا 08:30 محليًّا = 05:30Z.
        let after = parse_rfc3339_utc("2026-09-25T06:00:00Z").unwrap();
        let next = spec.next_after("UTC+03:00", after).unwrap();
        assert_eq!(crate::time::format_rfc3339_utc(next), "2026-09-26T05:30:00Z");
        let early = parse_rfc3339_utc("2026-09-25T04:00:00Z").unwrap();
        assert_eq!(crate::time::format_rfc3339_utc(spec.next_after("UTC+03:00", early).unwrap()), "2026-09-25T05:30:00Z");
    }

    #[test]
    fn weekly_interval_and_once_schedules() {
        // 2026-09-25 جمعة.
        let after = parse_rfc3339_utc("2026-09-25T12:00:00Z").unwrap();
        let weekly = ScheduleSpec::Weekly { days: vec!["MON".into()], time: "09:00".into() };
        assert_eq!(crate::time::format_rfc3339_utc(weekly.next_after("UTC", after).unwrap()), "2026-09-28T09:00:00Z");
        assert_eq!(ScheduleSpec::Interval { minutes: 60 }.next_after("UTC", after), Some(after + 3_600));
        let once = ScheduleSpec::Once { at: "2026-09-25T11:00:00Z".into() };
        assert_eq!(once.next_after("UTC", after), None, "a past one-off schedule does not fire again");
        assert!(ScheduleSpec::Interval { minutes: 1 }.validate("UTC").is_err());
        assert!(ScheduleSpec::Daily { time: "8:30".into() }.validate("UTC").is_err());
        assert!(ScheduleSpec::Daily { time: "08:30".into() }.validate("Asia/Riyadh").is_err());
    }

    #[test]
    fn auto_a_monthly_schedule_runs_on_the_chosen_days_and_skips_months_without_them() {
        for secs in [0i64, 951_782_400, 1_790_300_000] {
            let day = secs.div_euclid(86_400);
            let (y, m, d) = civil_from_days(day);
            assert_eq!(days_from_civil(y, m, d), day);
        }
        let spec = ScheduleSpec::Monthly { days: vec![1, 15], time: "09:00".into() };
        let after = parse_rfc3339_utc("2026-10-23T12:00:00Z").unwrap();
        // 09:00 الرياض = 06:00Z.
        let next = spec.next_after("UTC+03:00", after).unwrap();
        assert_eq!(crate::time::format_rfc3339_utc(next), "2026-11-01T06:00:00Z");
        assert_eq!(crate::time::format_rfc3339_utc(spec.next_after("UTC+03:00", next).unwrap()), "2026-11-15T06:00:00Z");
        // اليوم 31: تشرين الثاني بلا 31، فالتالي بعد 31 تشرين الأول هو 31 كانون الأول.
        let last = ScheduleSpec::Monthly { days: vec![31], time: "09:00".into() };
        let oct = last.next_after("UTC", after).unwrap();
        assert_eq!(crate::time::format_rfc3339_utc(oct), "2026-10-31T09:00:00Z");
        assert_eq!(crate::time::format_rfc3339_utc(last.next_after("UTC", oct).unwrap()), "2026-12-31T09:00:00Z");
        assert!(ScheduleSpec::Monthly { days: vec![], time: "09:00".into() }.validate("UTC").is_err());
        assert!(ScheduleSpec::Monthly { days: vec![32], time: "09:00".into() }.validate("UTC").is_err());
        assert!(ScheduleSpec::Monthly { days: vec![5, 5], time: "09:00".into() }.validate("UTC").is_err());
    }
}
