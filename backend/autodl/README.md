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

第一次启动会把模型缓存到 `/root/autodl-tmp/muse-models`。本机启动
Runtime Gateway 后，在前端选择“云端 GPU”，填写 AutoDL SSH 命令、SSH
认证信息、远端端口 `6006` 和 `.env` 中的 `API_KEY`。Gateway 会自动建立
隧道，不再需要把 AutoDL 的自定义服务公网地址交给浏览器。
