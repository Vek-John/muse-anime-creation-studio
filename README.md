# MUSE — 二次元文生图创作台

一个同时支持本地 NVIDIA GPU 和云端 GPU 的二次元文生图工作台。所有人使用
相同前端与参数协议，通过本机 Runtime Gateway 选择自己的模型运行环境。

## 当前包含

- 图片需求中的 8 个参数大类和 22 个下拉控制项
- 文生图描述输入框与自动组合提示词
- 已选参数标签、移除、重置和复制提示词
- 本地 Diffusers 模型目录与 `.safetensors/.ckpt` 单文件选择
- AutoDL SSH 隧道与自动远端 API 密钥读取
- 本机 Runtime Gateway 与统一生成接口
- 尺寸、采样步数、CFG、种子、采样器、Clip Skip、负面词控制
- 真实成图预览和 PNG 下载
- 中文结构化选项到动漫模型英文标签的映射
- 桌面端和移动端响应式布局

## 本地启动

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm run build
npm test
```

## 推荐分工

- UI 同事：`app/page.tsx`、`app/globals.css`
- 参数策划：`app/studio-config.ts`
- 提示词映射：`app/prompt-tags.ts`
- 模型服务：`backend/app/`
- 本机/云端调度：`backend/gateway/`
- GPU 工作节点部署：`backend/compose.yaml` 或 `backend/autodl/`

## 启动 Runtime Gateway

每个使用前端的同事都在自己电脑上启动一次 Gateway：
需要 Python 3.10 或更高版本。

```bash
cd backend
python3 -m venv .venv --system-site-packages
source .venv/bin/activate
pip install -r requirements.txt
cp gateway/.env.example gateway/.env
./gateway/start.sh
```

前端默认连接 `http://127.0.0.1:8000`。选择“本地 GPU”时，Gateway 会从所选
模型路径启动本地推理进程；选择“云端 GPU”时，只需填写 AutoDL SSH 登录
指令和密码。Gateway 会通过 SSH 登录，自动读取远端 `.env` 的 API 密钥并
建立隧道。SSH 密码和远端 API 密钥只保存在 Gateway 内存中，不会写入
浏览器存储或 Git。

详细说明见 `backend/gateway/README.md`。

## GPU 工作节点

通用 NVIDIA Docker 部署说明见 `backend/README.md`。AutoDL 个人联调说明见
`backend/autodl/README.md`。

前端会向 `POST /v1/generate` 发送：

```json
{
  "prompt": "masterpiece, best quality, 1girl, solo",
  "negative_prompt": "lowres, bad anatomy, watermark",
  "width": 1024,
  "height": 1024,
  "steps": 28,
  "guidance_scale": 5,
  "seed": -1,
  "sampler": "dpmpp_2m_karras",
  "clip_skip": 2
}
```

前端不持久化 SSH 或模型服务密钥。当前 Gateway 是内部 Demo 基础设施，只
监听 `127.0.0.1`；若以后公开给客户使用，需要增加正式业务后端、用户鉴权
和集中任务队列。

## 商用说明

默认模型的模型卡将许可证标记为 CreativeML Open RAIL++-M，并明确说明允许
商用、修改和分发，但仍需遵守用途限制与通知要求。模型许可不等于获得角色、
商标、参考素材或生成内容中的第三方权利，正式商用前仍需独立审核。

AutoDL 的“自定义服务”协议限定科研用途且不得把链接转给第三方，所以只用于
开发联调；正式商用部署应迁移到允许商业托管的 GPU 云服务器。
