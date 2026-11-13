#!/usr/bin/env bash
# يشغّل ملف اختبار واحدًا من اختبارات العارض المبنية (build-tests) ويكتب ملخّصه. الاستعمال: <label> <file.test.js>
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/evidence/remediation-2026-10-12/runs/$1"; mkdir -p "$OUT"
cd "$ROOT/desktop/renderer"
timeout 160 node --test --test-concurrency=1 "build-tests/tests/$2" > "$OUT/renderer-$2.log" 2>&1; RC=$?
echo "$(date -u +%FT%TZ) renderer $2 rc=$RC $(grep -E '^# (pass|fail)' "$OUT/renderer-$2.log" | tr '\n' ' ')" | tee -a "$OUT/summary.txt"
