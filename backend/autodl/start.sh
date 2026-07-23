#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "${script_dir}/.." && pwd)"

source "${backend_dir}/.venv/bin/activate"

export HF_HOME="${HF_HOME:-/root/autodl-tmp/muse-models}"
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
export API_BIND_ADDRESS="${API_BIND_ADDRESS:-127.0.0.1}"

exec uvicorn app.main:app \
  --app-dir "${backend_dir}" \
  --env-file "${backend_dir}/.env" \
  --host "${API_BIND_ADDRESS}" \
  --port 6006 \
  --workers 1 \
  --proxy-headers
