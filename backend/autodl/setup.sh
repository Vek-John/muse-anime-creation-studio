#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "${script_dir}/.." && pwd)"
venv_dir="${backend_dir}/.venv"

python -m venv --system-site-packages "${venv_dir}"
source "${venv_dir}/bin/activate"

python -m pip install --upgrade pip
python -m pip install -r "${backend_dir}/requirements.txt"

mkdir -p /root/autodl-tmp/muse-models
mkdir -p "${backend_dir}/outputs"

lora_dir="/root/autodl-tmp/muse-models/loras/demonslayer"
lora_file="${lora_dir}/Demonslayer_style_lora-.safetensors"
lora_sha256="0f85a1efc816cc46913cfe5e4993261c5874f680a7113d1a3d802a11282efed3"
mkdir -p "${lora_dir}"

if [[ ! -f "${lora_file}" ]]; then
  echo "正在下载鬼灭之刃画风 LoRA（约 405 MB）..."
  HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}" \
    HF_HUB_DISABLE_XET=1 \
    python - <<'PY'
from huggingface_hub import hf_hub_download

hf_hub_download(
    repo_id="Rudra973592/Demonslayer_style_lora",
    filename="Demonslayer_style_lora-.safetensors",
    revision="96f2249b16f4d152c22908e585f5616c4bd9a955",
    local_dir="/root/autodl-tmp/muse-models/loras/demonslayer",
)
PY
fi

actual_lora_sha256="$(sha256sum "${lora_file}" | awk '{print $1}')"
if [[ "${actual_lora_sha256}" != "${lora_sha256}" ]]; then
  echo "LoRA SHA-256 校验失败：${actual_lora_sha256}" >&2
  exit 1
fi

if [[ ! -f "${backend_dir}/.env" ]]; then
  cp "${backend_dir}/.env.example" "${backend_dir}/.env"
  echo "已创建 backend/.env，请先填写 API_KEY。"
fi

echo "环境安装完成。填写 .env 后运行 backend/autodl/start.sh。"
