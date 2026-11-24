#!/usr/bin/env bash
# Applies migrations + seed to a throwaway local Postgres DB and runs DB assertions,
# including a real concurrency race. Requires local PostgreSQL ≥ 15 (psql + createdb).
# Usage: PGUSER=postgres ./scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-salon_test}"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"

dropdb --if-exists "$DB" >/dev/null
createdb "$DB"
$PSQL -d "$DB" -f supabase/tests/00_supabase_stubs.sql
for f in supabase/migrations/*.sql; do echo "→ $f"; $PSQL -d "$DB" -f "$f"; done
echo "→ supabase/seed.sql"; $PSQL -d "$DB" -f supabase/seed.sql
$PSQL -d "$DB" -f supabase/tests/rls_and_booking_test.sql

echo "→ concurrency race: 8 parallel clients book the same slot"
SLOT="date_trunc('hour', now()) + interval '20 days'"
for i in $(seq 1 8); do
  ( $PSQL -d "$DB" -tAc "select appointment_id from public.book_appointment('00000000-0000-4000-8001-000000000001',
      '00000000-0000-4000-8002-000000000001', null, $SLOT, array['00000000-0000-4000-8003-000000000001']::uuid[],
      'website', 'race-key-$i')" >/dev/null 2>&1 && echo ok || echo rejected ) &
done | sort | uniq -c > /tmp/race.txt
wait
cat /tmp/race.txt
WON=$($PSQL -d "$DB" -tAc "select count(*) from appointments where idempotency_key like 'race-key-%'")
[ "$WON" = "1" ] || { echo "FAIL: $WON bookings won the race"; exit 1; }
echo "PASS: exactly one booking won the race"
dropdb "$DB"
