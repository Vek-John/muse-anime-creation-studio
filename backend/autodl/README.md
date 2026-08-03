# AutoDL 联调环境

AutoDL 适合开发与个人联调。根据 AutoDL 自定义服务协议，该服务通道限定
科研用途且不可转发给第三方，因此不要把它当作最终商用生产环境。

## 创建实例

- GPU：RTX 4090 24GB；预算优先可选 RTX 3090 24GB
- 镜像：PyTorch 2.5.1 / Python 3.12 / CUDA 12.4
- 数据盘：至少 50GB
- 自定义服务：HTTP，实例端口 6006

## 部署

把项目上传到实例后：

```bash
cd backend
bash autodl/setup.sh
openssl rand -hex 32
```

把随机值写入 `.env` 的 `API_KEY`，然后：

```bash
bash autodl/start-background.sh
```

`setup.sh` 会把鬼灭之刃画风 LoRA 的固定版本下载到数据盘并校验
SHA-256；基础模型会在第一次启动时缓存到
`/root/autodl-tmp/muse-models`。本机启动
Runtime Gateway 后，在前端选择“云端 GPU”，填写 AutoDL SSH 命令、SSH
登录密码即可。Gateway 会自动读取 `/root/muse-diffusion/.env` 的
`API_KEY`，检查并按需启动远端模型服务，再连接 `6006` 并建立隧道，不再
需要手动复制模型 API 密钥或把 AutoDL 的自定义服务公网地址交给浏览器。
AutoDL 实例重启后，重新在网页连接即可，不需要手动执行启动脚本。

第一次使用严格主体校验时会在同一 `HF_HOME` 下载约 467 MB 的 WD SwinV2
ONNX 标签器，之后直接复用缓存。它只在 AutoDL 内检查生成图的性别与人数，
同时拒绝头部出框、无脸、无头或无人物的结果。失败时自动换 seed 重试，
不会把图片发送到互联网。服务还会拒绝低于 90 万像素或低于 25 步的请求，
防止 Animagine 在过低推理预算下退化成抽象图。

空白画布使用不限定性别的通用人物校验；明确输入无人、非人主体、无脸、
无头或头部出框时，前端会自动移除冲突限制并关闭该次人物校验。
