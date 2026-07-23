# MUSE — 二次元文生图创作台

一个可连接远程 NVIDIA GPU 的二次元文生图工作台。前端可以在本机浏览器
打开，模型和显存计算放在服务器上完成。

## 当前包含

- 图片需求中的 8 个参数大类和 22 个下拉控制项
- 文生图描述输入框与自动组合提示词
- 已选参数标签、移除、重置和复制提示词
- Animagine XL 4.0 / SDXL 远程生成接口
- 服务器地址、API 密钥和连通状态设置
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
- GPU 部署：`backend/compose.yaml` 或 `backend/autodl/`

## 远程模型服务

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

API 密钥只存放在本机浏览器 `localStorage`，不会写入仓库。若以后将前端公开
给客户使用，不应把服务器密钥发到浏览器，需要再增加自己的业务后端代理。

## 商用说明

默认模型的模型卡将许可证标记为 CreativeML Open RAIL++-M，并明确说明允许
商用、修改和分发，但仍需遵守用途限制与通知要求。模型许可不等于获得角色、
商标、参考素材或生成内容中的第三方权利，正式商用前仍需独立审核。

AutoDL 的“自定义服务”协议限定科研用途且不得把链接转给第三方，所以只用于
开发联调；正式商用部署应迁移到允许商业托管的 GPU 云服务器。
