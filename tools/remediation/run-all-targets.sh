#!/usr/bin/env bash
# يشغّل كل أهداف اختبار core المتكاملة بالترتيب، متوقّفًا قبل تجاوز ميزانية النداء (ثانية واحدة = حدّ 180 للنداء).
# الاستعمال: run-all-targets.sh <label> <start-index> ; يطبع الفهرس التالي إن توقّف.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="$1"; START="${2:-0}"
mapfile -t TARGETS < <(ls "$ROOT/desktop/host/core/tests"/*.rs | xargs -n1 basename | sed 's/\.rs$//')
T0=$(date +%s); i=0
for t in "${TARGETS[@]}"; do
  if [ $i -lt $START ]; then i=$((i+1)); continue; fi
  if [ $(( $(date +%s) - T0 )) -gt 115 ]; then echo "NEXT=$i"; exit 0; fi
  "$ROOT/tools/remediation/run-test-target.sh" "$LABEL" "$t" | sed 's/ tree=[0-9a-f]*//; s/ filter= / /'
  i=$((i+1))
done
echo "DONE total=${#TARGETS[@]}"
