#!/usr/bin/env bash
# يشغّل ملفات اختبار العقود المبنية (dist/tests) دفعةً بعد دفعة ضمن حدّ زمن نداء الغلاف. الاستعمال: <label> <start-index>
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/evidence/remediation-2026-10-12/runs/$1"; mkdir -p "$OUT"; START="${2:-0}"
cd "$ROOT/contracts"
mapfile -t FILES < <(ls dist/tests/*.test.js)
T0=$(date +%s); i=0
for f in "${FILES[@]}"; do
  if [ $i -lt $START ]; then i=$((i+1)); continue; fi
  if [ $(( $(date +%s) - T0 )) -gt 120 ]; then echo "NEXT=$i"; exit 0; fi
  b=$(basename "$f")
  timeout 100 node --test --test-concurrency=1 "$f" > "$OUT/contracts-$b.log" 2>&1; RC=$?
  echo "contracts $b rc=$RC $(grep -E '^# (pass|fail)' "$OUT/contracts-$b.log" | tr '\n' ' ')" | tee -a "$OUT/contracts-summary.txt"
  i=$((i+1))
done
echo "DONE total=${#FILES[@]}"
