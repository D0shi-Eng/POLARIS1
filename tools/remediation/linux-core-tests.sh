#!/usr/bin/env bash
# مشغّل تحقق Linux لنواة المضيف (core) داخل آلة Cowork. يكتب سجلًا مربوطًا ببصمة الشجرة.
# الاستعمال: linux-core-tests.sh <label> [cargo test args...]
# الحدود: عامل واحد، اختبار واحد في المرة؛ لا يبني app (يحتاج Windows/WebView2).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="$1"; shift
OUT="$ROOT/evidence/remediation-2026-10-12/runs/$LABEL"
mkdir -p "$OUT"
source "$ROOT/_local/linux-env.sh"
cd "$ROOT"
{
  echo "label=$LABEL"
  echo "started_utc=$(date -u +%FT%TZ)"
  echo "head=$(git rev-parse HEAD)"
  # بصمة الشجرة العاملة كما هي (تشمل التغييرات غير الملتزمة) لملفات المضيف
  echo "worktree_host_sha256=$(git ls-files -co --exclude-standard desktop/host/core desktop/host/providers | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)"
  echo "rustc=$(rustc --version)"
  echo "args=$*"
} > "$OUT/meta.txt"
cd desktop/host
cargo test -p polaris-host-core "$@" > "$OUT/cargo.log" 2>&1
echo "exit=$?" >> "$OUT/meta.txt"
echo "finished_utc=$(date -u +%FT%TZ)" >> "$OUT/meta.txt"
