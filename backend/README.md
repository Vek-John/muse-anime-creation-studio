# MUSE Diffusion API

面向 NVIDIA GPU 服务器的单模型推理服务。默认使用 Animagine XL 4.0，
通过带 API 密钥的 HTTP 接口作为 MUSE Runtime Gateway 的 GPU 工作节点。
本地/云端切换和 SSH 隧道说明见 `gateway/README.md`。

## 建议服务器

- Ubuntu 22.04/24.04
- NVIDIA GPU，建议 24 GB 显存（L4、A10、A5000、RTX 3090/4090）
- 50 GB 以上可用磁盘
- Docker、Compose 与 NVIDIA Container Toolkit
- 正式使用时配置域名和 HTTPS

## 启动

```bash
cp .env.example .env
openssl rand -hex 32
# 把生成值写入 .env 的 API_KEY
docker compose up -d --build
docker compose logs -f diffusion-api
```

首次启动需要下载模型，因此健康检查会先显示 `starting`。完成后：

```bash
curl http://127.0.0.1:8000/healthz
```

## HTTPS

先将域名解析到服务器，填写 `.env` 中的 `API_DOMAIN`，然后运行：

```bash
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Caddy 会自动申请和续期 HTTPS 证书。前端服务地址填写
`https://你的域名`。

## API

`POST /v1/generate`

```json
{
  "prompt": "masterpiece, 1girl, solo, looking at viewer",
  "negative_prompt": "lowres, bad anatomy, bad hands, text, watermark",
  "expected_subject": "female",
  "subject_validation": "strict",
  "max_subject_attempts": 4,
  "width": 1024,
  "height": 1024,
  "steps": 28,
  "guidance_scale": 5,
  "seed": -1,
  "sampler": "dpmpp_2m_karras",
  "clip_skip": 2,
  "style_adapter": null,
  "style_adapter_scale": 0.65
}
```

`style_adapter` 当前支持 `demonslayer`。启用后，服务会按请求加载并开启
LoRA，生成结束后立即停用，下一次普通生成不会继承该风格。LoRA 文件路径由
`DEMONSLAYER_LORA_PATH` 配置；AutoDL 的 `autodl/setup.sh` 会下载并校验
固定版本权重。

前端还会发送 `expected_subject`、`subject_validation: "strict"` 和
`max_subject_attempts: 4`。`expected_subject` 支持不限定性别的 `human`：
所有可见选项为空时，前端只编译一个很短且可省略的通用人物基线，服务器
确认画面中存在可辨认、头部完整的人物。用户明确指定性别/人数后改用对应
校验；明确要求无人、非人主体、无脸、无头或头部出框时，前端会移除冲突
限制并关闭该次人物校验。

严格模式失败的候选图不会返回，而是自动递增 seed 重试。全部候选都不符合
时返回 422。
校验模型第一次使用时下载到服务器的 `HF_HOME`，图片不会上传给第三方。

为避免 SDXL 在过低计算预算下退化成抽象图，接口要求画布至少 90 万像素、
短边至少 640，并且至少 25 个采样步。推荐继续使用 1024×1024、28 步、
CFG 5 和 Euler Ancestral。

请求头：

```text
Authorization: Bearer <API_KEY>
```

服务使用单进程和单 GPU 队列，避免并发请求重复加载模型或造成显存溢出。
公开商用前建议在反向代理层继续添加限流、访问日志脱敏和业务用户鉴权。

`MODEL_ID` 也可以填写本机 Diffusers 目录，或 SDXL `.safetensors/.ckpt`
单文件路径。Runtime Gateway 的“本地 GPU”模式会自动设置该变量并启动工作
进程。
