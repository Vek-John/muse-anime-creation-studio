# 本机 Runtime Gateway

前端始终连接本机 `127.0.0.1:8000`。Gateway 提供两种运行方式：

- 本地 GPU：选择 Diffusers 模型目录或 SDXL `.safetensors/.ckpt` 文件，
  Gateway 自动启动本地推理进程。
- 云端 GPU：填写 SSH 命令、认证信息、远端服务端口和远端 API 密钥，
  Gateway 建立 SSH 隧道后转发生成请求。

SSH 密码、私钥口令和远端 API 密钥只保存在 Gateway 进程内存，不写入前端
`localStorage` 或仓库。Gateway 默认只监听回环地址，这是内部 Demo 的安全边界。

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

云端模式要求模型服务器先运行 `app.main:app`，默认监听远端
`127.0.0.1:6006`。第一次连接新服务器前，先在终端执行一次 SSH 命令并确认
主机指纹，让它写入 `~/.ssh/known_hosts`。

本地模式要求当前 Python 环境已经安装与显卡匹配的 PyTorch/CUDA。模型目录
应包含 `model_index.json`；单文件模型支持 `.safetensors` 和 `.ckpt`。
