#!/usr/bin/env bash
# Cek integritas repository restic (struktur + 10% data acak).
set -euo pipefail
restic check --read-data-subset=10%
restic snapshots --host indotek --compact
