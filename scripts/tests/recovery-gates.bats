#!/usr/bin/env bats

setup() {
  temp="$(mktemp -d)"
  export RECOVERY_TARGET=ephemeral-clone
  export RECOVERY_APPROVAL_REF=clone-rehearsal
  export DATABASE_URL='postgresql://user:secret@127.0.0.1:5432/recovery'
  export RECOVERY_CLONE_NONCE=0123456789abcdef0123456789abcdef
  export PATH="$temp:$PATH"
  export PSQL_STATE="$temp/relations"
  export PSQL_RUNS="$temp/psql-runs"
  printf 'audit_events\n' > "$PSQL_STATE"
  cat > "$temp/psql" <<'EOF'
#!/usr/bin/env bash
  if [[ "$*" == *"recovery_clone_attestation"* ]]; then
    printf '1\n'
  elif [[ "$*" == *"information_schema.columns"* ]]; then
    printf '0\n'
  elif [[ "$*" == *"to_regclass"* ]]; then
  cat "$PSQL_STATE"
elif [[ "$*" == *"count(*)"* ]]; then
  printf '1\n'
elif [[ "$*" == *" -f "* ]]; then
  printf 'run\n' >> "$PSQL_RUNS"
  printf 'operators\nrefresh_tokens\njob_runs\naudit_events\n' > "$PSQL_STATE"
else
  printf 'ok\n'
fi
EOF
  chmod +x "$temp/psql"
  sql="$BATS_TEST_DIRNAME/../../packages/db/recovery/0001_auth_scheduler.sql"
}

teardown() { rm -rf "$temp"; }

@test "preflight rejects an unsafe target" {
  run env RECOVERY_TARGET=production "$BATS_TEST_DIRNAME/../recovery/preflight.sh"
  [ "$status" -eq 2 ]
}

@test "rehearsal rejects missing approval and hostile arguments" {
  run env -u RECOVERY_APPROVAL_REF "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 2 ]
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql" --unexpected
  [ "$status" -eq 2 ]
}

@test "preflight redacts URL credentials in evidence" {
  run "$BATS_TEST_DIRNAME/../recovery/preflight.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *secret* ]]
  [[ "$output" == *'"target":"ephemeral-clone"'* ]]
}

@test "rehearsal rejects checksum drift and missing relations" {
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql" --checksum deadbeef
  [ "$status" -eq 2 ]
  cat > "$temp/psql" <<'EOF'
#!/usr/bin/env bash
printf 'operators\nrefresh_tokens\njob_runs\n'
EOF
  chmod +x "$temp/psql"
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 2 ]
}

@test "rehearsal rejects a forged clone target before SQL runs" {
  cat > "$temp/psql" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"recovery_clone_attestation"* ]]; then exit 0; fi
if [[ "$*" == *" -f "* ]]; then printf 'run\n' >> "$PSQL_RUNS"; fi
if [[ "$*" == *"to_regclass"* ]]; then printf 'operators\nrefresh_tokens\njob_runs\naudit_events\n';
elif [[ "$*" == *"count(*)"* ]]; then printf '1\n'; fi
EOF
  chmod +x "$temp/psql"
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 2 ]
  [ ! -e "$PSQL_RUNS" ]
}

@test "rehearsal rejects a hostile clone nonce before psql" {
  run env RECOVERY_CLONE_NONCE="x' OR true --" "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 2 ]
  [ ! -e "$PSQL_RUNS" ]
}

@test "rehearsal rejects incomplete existing relations after SQL" {
  cat > "$temp/psql" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *"recovery_clone_attestation"* ]]; then printf '1\n';
elif [[ "$*" == *"to_regclass"* ]]; then printf 'operators\nrefresh_tokens\njob_runs\naudit_events\n';
elif [[ "$*" == *"information_schema.columns"* ]]; then printf '1\n';
elif [[ "$*" == *"count(*)"* ]]; then printf '1\n';
elif [[ "$*" == *" -f "* ]]; then printf 'run\n' >> "$PSQL_RUNS"; fi
EOF
  chmod +x "$temp/psql"
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 2 ]
  [ "$(wc -l < "$PSQL_RUNS")" -eq 2 ]
}

@test "rehearses twice with redacted preservation receipt" {
  run "$BATS_TEST_DIRNAME/../recovery/rehearse.sh" --sql "$sql"
  [ "$status" -eq 0 ]
  [ "$(wc -l < "$PSQL_RUNS")" -eq 2 ]
  [ "$(sort "$PSQL_STATE")" = $'audit_events\njob_runs\noperators\nrefresh_tokens' ]
  [[ "$output" == *'"runs":2'* ]]
  [[ "$output" == *'"audit_events":1'* ]]
  [[ "$output" != *secret* ]]
}
