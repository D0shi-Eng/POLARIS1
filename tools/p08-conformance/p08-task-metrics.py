# مقاييس كل مهمّة في معيار النموذج الحقيقي، للتقرير فقط: تُقرأ من سجل العُدّة (missions.local.json)
# ومن مخزن بياناتها (polaris.db) قراءةً فقط. لا تحكم على شيء: الحكم لـ p08-derive.mjs.
#
# الاستعمال: python p08-task-metrics.py <missions.local.json> <polaris.db> [--markdown]

import json
import sqlite3
import sys


def metrics(missions_path, db_path):
    with open(missions_path, encoding="utf-8") as f:
        rows = json.load(f).get("extra", {}).get("tasks", [])
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    out = []
    for r in rows:
        # المهمّة تُطابَق بعنوانها؛ وإن تكرّر العنوان تؤخذ آخر مهمّة أُنشئت به
        found = db.execute("select mission_id, state, failure_reason from missions where title = ? order by created_at desc limit 1", (r.get("title", ""),)).fetchone()
        mission_id, state, failure = found if found else (None, r.get("mission_state"), None)
        count = lambda sql: db.execute(sql, (mission_id,)).fetchone()[0] if mission_id else None
        out.append({
            "id": r["id"],
            "status": r["status"],
            "mission_state": r.get("mission_state"),
            "seconds": round(r.get("duration_ms", 0) / 1000),
            "model_calls": count("select count(*) from usage_records where category = 'MODEL' and mission_id = ?"),
            "tool_calls": count("select count(*) from tool_invocations where mission_id = ?"),
            "tools_succeeded": count("select count(*) from tool_invocations where status = 'SUCCEEDED' and mission_id = ?"),
            "approvals_asked": count("select count(*) from tool_approvals where mission_id = ?"),
            "artifacts_verified": sum(1 for a in r.get("artifacts", []) if a.get("verification") == "VERIFIED"),
            "artifacts": len(r.get("artifacts", [])),
            "detail": r.get("detail", ""),
            "failure_reason": failure,
        })
    return out


def markdown(items):
    lines = ["| Task | Verdict | Mission state | Time (s) | Model calls | Tool calls (succeeded) | Approvals asked | Artifacts verified | Check detail / failure reason |", "|---|---|---|---|---|---|---|---|---|"]
    for m in items:
        reason = m["detail"] if m["status"] == "PASS" else f"{m['detail']}" + (f"; {m['failure_reason'][:140]}" if m["failure_reason"] else "")
        lines.append(f"| {m['id']} | {m['status']} | {m['mission_state']} | {m['seconds']} | {m['model_calls']} | {m['tool_calls']} ({m['tools_succeeded']}) | {m['approvals_asked']} | {m['artifacts_verified']}/{m['artifacts']} | {reason.replace('|', '/')} |")
    return "\n".join(lines)


if __name__ == "__main__":
    items = metrics(sys.argv[1], sys.argv[2])
    print(markdown(items) if "--markdown" in sys.argv else json.dumps(items, ensure_ascii=False, indent=2))
