# 本机 Runtime Gateway

前端始终连接本机 `127.0.0.1:8000`。Gateway 提供两种运行方式：

- 本地 GPU：选择 Diffusers 模型目录或 SDXL `.safetensors/.ckpt` 文件，
  Gateway 自动启动本地推理进程。
- 云端 GPU：只填写 AutoDL SSH 登录指令和密码，Gateway 登录后自动读取
  `/root/muse-diffusion/.env` 中的 `API_KEY`，并连接远端 6006 端口。

SSH 密码和自动读取的远端 API 密钥只保存在 Gateway 进程内存，不写入前端
存储或仓库。Gateway 默认只监听回环地址，这是内部 Demo 的安全边界。

## 启动

需要 Python 3.10 或更高版本。

```bash
cd backend
python3 -m venv .venv --system-site-packages
source .venv/bin/activate
pip install -r requirements.txt
cp gateway/.env.example gateway/.env
chmod +x gateway/start.sh
./gateway/start.sh
```

云端模式要求每台 AutoDL 使用相同目录约定：项目位于
`/root/muse-diffusion`，模型服务监听 `127.0.0.1:6006`，API 密钥位于
`/root/muse-diffusion/.env`。第一次连接新服务器前，先在终端执行一次 SSH
命令并确认主机指纹，让它写入 `~/.ssh/known_hosts`。

本地模式要求当前 Python 环境已经安装与显卡匹配的 PyTorch/CUDA。模型目录
应包含 `model_index.json`；单文件模型支持 `.safetensors` 和 `.ckpt`。
