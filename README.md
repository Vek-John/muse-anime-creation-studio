# MUSE — 二次元文生图创作台

一个独立的前端框架，用于把自然语言描述和二次元创作参数整理为可供
Diffusion 后端消费的结构化请求。

## 当前包含

- 图片需求中的 8 个参数大类和 22 个下拉控制项
- 文生图描述输入框与自动组合提示词
- 已选参数标签、移除、重置和复制提示词
- “生成画面”演示状态，不调用真实模型
- 可展开查看的后端 JSON 请求载荷
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
- 后端同事：在 `handleGenerate` 中提交 `payload`

## 后端映射

前端已经生成以下结构，后端只需将 `parameters` 中的字段映射为模型参数，
或直接消费 `compiledPrompt`：

```json
{
  "prompt": "用户输入的自然语言描述",
  "parameters": {
    "baseStyle": "日系萌系",
    "texture": "4K 高清",
    "sampling": "20 步采样"
  },
  "compiledPrompt": "用户描述，日系萌系，4K 高清，20 步采样"
}
```
