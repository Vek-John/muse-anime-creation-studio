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

if [[ ! -f "${backend_dir}/.env" ]]; then
  cp "${backend_dir}/.env.example" "${backend_dir}/.env"
  echo "已创建 backend/.env，请先填写 API_KEY。"
fi

echo "环境安装完成。填写 .env 后运行 backend/autodl/start.sh。"
