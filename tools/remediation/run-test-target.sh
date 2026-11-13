#!/usr/bin/env bash
# يشغّل هدف اختبار واحدًا من core (lib أو test=<name>) ويكتب سجلّه وبصمة الشجرة.
# كل نداء من غلاف Cowork محدود بثلاث دقائق، فيُشغَّل هدف واحد في كل مرة.
# الاستعمال: run-test-target.sh <run-label> <lib|NAME> [filter]
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="$1"; TARGET="$2"; FILTER="${3:-}"
OUT="$ROOT/evidence/remediation-2026-10-12/runs/$LABEL"
mkdir -p "$OUT"
source "$ROOT/_local/linux-env.sh"
export CARGO_BUILD_JOBS=2
cd "$ROOT"
TREE=$(git ls-files -co --exclude-standard desktop/host/core desktop/host/providers | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
cd desktop/host
if [ "$TARGET" = lib ]; then SEL="--lib"; else SEL="--test $TARGET"; fi
START=$(date -u +%FT%TZ)
timeout 160 cargo test -q -p polaris-host-core $SEL -- --test-threads=1 $FILTER > "$OUT/$TARGET.log" 2>&1
RC=$?
SUMMARY=$(grep -E '^test result:' "$OUT/$TARGET.log" | tail -1)
echo "$START target=$TARGET filter=$FILTER rc=$RC tree=$TREE head=$(git rev-parse --short HEAD) :: $SUMMARY" | tee -a "$OUT/summary.txt"
