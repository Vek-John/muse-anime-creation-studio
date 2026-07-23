#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_file="/root/autodl-tmp/muse-diffusion.log"

if command -v tmux >/dev/null 2>&1; then
  if tmux has-session -t muse-diffusion 2>/dev/null; then
    tmux kill-session -t muse-diffusion
  fi
  tmux new-session -d -s muse-diffusion "${script_dir}/start.sh"
  echo "服务已在 tmux 会话 muse-diffusion 中启动。"
  echo "查看日志：tmux attach -t muse-diffusion"
elif command -v screen >/dev/null 2>&1; then
  screen -S muse-diffusion -X quit >/dev/null 2>&1 || true
  screen -dmS muse-diffusion bash -lc \
    "\"${script_dir}/start.sh\" >>\"${log_file}\" 2>&1"
  echo "服务已在 screen 会话 muse-diffusion 中启动。"
  echo "查看日志：tail -f ${log_file}"
else
  nohup "${script_dir}/start.sh" >>"${log_file}" 2>&1 &
  echo "服务已通过 nohup 启动。"
  echo "查看日志：tail -f ${log_file}"
fi
