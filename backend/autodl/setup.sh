#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "${script_dir}/.." && pwd)"
venv_dir="${backend_dir}/.venv"

if [[ ! -x "${venv_dir}/bin/python" ]]; then
  if command -v python >/dev/null 2>&1; then
    bootstrap_python="$(command -v python)"
  elif command -v python3 >/dev/null 2>&1; then
    bootstrap_python="$(command -v python3)"
  elif [[ -x /root/miniconda3/bin/python ]]; then
    bootstrap_python="/root/miniconda3/bin/python"
  else
    echo "未找到可用于创建虚拟环境的 Python 3。" >&2
    exit 1
  fi
  "${bootstrap_python}" -m venv --system-site-packages "${venv_dir}"
fi
source "${venv_dir}/bin/activate"

if [[ -z "${HF_ENDPOINT:-}" && -f "${backend_dir}/.env" ]]; then
  configured_hf_endpoint="$(
    sed -n 's/^HF_ENDPOINT=//p' "${backend_dir}/.env" | head -n 1
  )"
  configured_hf_endpoint="${configured_hf_endpoint%\"}"
  configured_hf_endpoint="${configured_hf_endpoint#\"}"
  configured_hf_endpoint="${configured_hf_endpoint%\'}"
  configured_hf_endpoint="${configured_hf_endpoint#\'}"
  if [[ "${configured_hf_endpoint}" == http://* || "${configured_hf_endpoint}" == https://* ]]; then
    export HF_ENDPOINT="${configured_hf_endpoint%/}"
  fi
fi

python -m pip install --upgrade pip
python -m pip install -r "${backend_dir}/requirements.txt"

mkdir -p /root/autodl-tmp/muse-models
mkdir -p "${backend_dir}/outputs"

download_lora() {
  local display_name="$1"
  local repo_id="$2"
  local source_filename="$3"
  local revision="$4"
  local destination_dir="$5"
  local destination_filename="$6"
  local expected_sha256="$7"
  local expected_size="$8"
  local destination_path="${destination_dir}/${destination_filename}"

  mkdir -p "${destination_dir}"
  local needs_download=1
  if [[ -f "${destination_path}" ]]; then
    local existing_size
    local existing_sha256
    existing_size="$(stat -c '%s' "${destination_path}")"
    existing_sha256="$(sha256sum "${destination_path}" | awk '{print $1}')"
    if [[ "${existing_size}" == "${expected_size}" && "${existing_sha256}" == "${expected_sha256}" ]]; then
      needs_download=0
    else
      echo "${display_name} 的现有文件校验失败，将重新下载。" >&2
      local invalid_backup
      invalid_backup="${destination_path}.invalid-$(date +%Y%m%d-%H%M%S)"
      mv -- "${destination_path}" "${invalid_backup}"
      echo "原文件已保留为：${invalid_backup}" >&2
    fi
  fi
  if [[ "${needs_download}" == "1" ]]; then
    echo "正在下载 ${display_name}..."
    LORA_REPO_ID="${repo_id}" \
      LORA_SOURCE_FILENAME="${source_filename}" \
      LORA_REVISION="${revision}" \
      LORA_DESTINATION_DIR="${destination_dir}" \
      LORA_DESTINATION_FILENAME="${destination_filename}" \
      HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}" \
      HF_HUB_DISABLE_XET=1 \
      python - <<'PY'
import os
from pathlib import Path

from huggingface_hub import hf_hub_download

downloaded = Path(
    hf_hub_download(
        repo_id=os.environ["LORA_REPO_ID"],
        filename=os.environ["LORA_SOURCE_FILENAME"],
        revision=os.environ["LORA_REVISION"],
        local_dir=os.environ["LORA_DESTINATION_DIR"],
    )
)
destination = Path(os.environ["LORA_DESTINATION_DIR"]) / os.environ[
    "LORA_DESTINATION_FILENAME"
]
if downloaded != destination:
    destination.parent.mkdir(parents=True, exist_ok=True)
    downloaded.replace(destination)
PY
  fi

  local actual_size
  local actual_sha256
  actual_size="$(stat -c '%s' "${destination_path}")"
  actual_sha256="$(sha256sum "${destination_path}" | awk '{print $1}')"
  if [[ "${actual_size}" != "${expected_size}" ]]; then
    echo "${display_name} 文件大小校验失败：${actual_size}（应为 ${expected_size}）" >&2
    exit 1
  fi
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "${display_name} SHA-256 校验失败：${actual_sha256}" >&2
    exit 1
  fi
  echo "已校验 ${display_name}：${actual_sha256}"
}

download_lora \
  "鬼灭之刃画风 LoRA（约 405 MB）" \
  "Rudra973592/Demonslayer_style_lora" \
  "Demonslayer_style_lora-.safetensors" \
  "96f2249b16f4d152c22908e585f5616c4bd9a955" \
  "/root/autodl-tmp/muse-models/loras/demonslayer" \
  "Demonslayer_style_lora-.safetensors" \
  "0f85a1efc816cc46913cfe5e4993261c5874f680a7113d1a3d802a11282efed3" \
  "405057460"

download_lora \
  "火影忍者画风 LoRA（约 186 MB）" \
  "shawn323/sd-xl-lora-naruto" \
  "pytorch_lora_weights.safetensors" \
  "0ce4679e020c721adada507ee26970ccdea105fe" \
  "/root/autodl-tmp/muse-models/loras/naruto" \
  "pytorch_lora_weights.safetensors" \
  "d4b2a59f69bc4a4db2b4a02ce78a79daffbfbc69078574842a522194a40396ea" \
  "185963768"

download_lora \
  "原神人物风格 LoRA（约 23 MB）" \
  "mary-ruiliii/genshin-style_character_generator" \
  "pytorch_lora_weights.safetensors" \
  "294b0f1bacccc72ba1fd13693fbc897fad57e78b" \
  "/root/autodl-tmp/muse-models/loras/genshin" \
  "pytorch_lora_weights.safetensors" \
  "3bac9e3db1038a59f3526ffcd2933571cc07764c4b801e37a9a10c0dd3728cda" \
  "23390424"

download_lora \
  "海贼王画风 LoRA（实验，约 228 MB）" \
  "andinmaro146/LoRA" \
  "civitai/476041-one-piece-anime-style-lora/1067881-ilxl-v0-1/one_piece_style_ilxl.safetensors" \
  "5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f" \
  "/root/autodl-tmp/muse-models/loras/onepiece" \
  "one_piece_style_ilxl.safetensors" \
  "26b37729ff3bc91b11f860d1e97177f9b8c4c78510e7fc35a45b7d8ec0b360ab" \
  "228479220"

luoxiaohei_lora_dir="/root/autodl-tmp/muse-models/loras/luoxiaohei"
luoxiaohei_lora_file="${luoxiaohei_lora_dir}/muse_lxh_style_v1.safetensors"
mkdir -p "${luoxiaohei_lora_dir}"

if [[ -f "${luoxiaohei_lora_file}" ]]; then
  luoxiaohei_sha256="$(sha256sum "${luoxiaohei_lora_file}" | awk '{print $1}')"
  echo "已发现罗小黑风格 LoRA：${luoxiaohei_lora_file}"
  echo "罗小黑风格 LoRA SHA-256：${luoxiaohei_sha256}"
else
  echo "罗小黑风格 LoRA 尚未发布；训练完成后请复制到："
  echo "${luoxiaohei_lora_file}"
fi

if [[ ! -f "${backend_dir}/.env" ]]; then
  cp "${backend_dir}/.env.example" "${backend_dir}/.env"
  echo "已创建 backend/.env，请先填写 API_KEY。"
fi

ensure_env_default() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "${backend_dir}/.env"; then
    printf '\n%s=%s\n' "${key}" "${value}" >>"${backend_dir}/.env"
    echo "已补充 ${key} 到现有 backend/.env。"
  fi
}

ensure_env_default \
  "DEMONSLAYER_LORA_PATH" \
  "/root/autodl-tmp/muse-models/loras/demonslayer/Demonslayer_style_lora-.safetensors"
ensure_env_default \
  "NARUTO_LORA_PATH" \
  "/root/autodl-tmp/muse-models/loras/naruto/pytorch_lora_weights.safetensors"
ensure_env_default \
  "GENSHIN_LORA_PATH" \
  "/root/autodl-tmp/muse-models/loras/genshin/pytorch_lora_weights.safetensors"
ensure_env_default \
  "ONEPIECE_LORA_PATH" \
  "/root/autodl-tmp/muse-models/loras/onepiece/one_piece_style_ilxl.safetensors"
ensure_env_default \
  "LUOXIAOHEI_LORA_PATH" \
  "/root/autodl-tmp/muse-models/loras/luoxiaohei/muse_lxh_style_v1.safetensors"

echo "环境安装完成。填写 .env 后运行 backend/autodl/start.sh。"
