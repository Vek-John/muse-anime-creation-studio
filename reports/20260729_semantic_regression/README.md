# 语义命中率与 Token 回归报告

日期：2026-07-29

分支：`zyx_branch`

模型：`cagliostrolab/animagine-xl-4.0`

## 结论

最终固定种子回归共生成 24 张图：

- 23 张通过
- 1 张部分通过
- 0 张失败
- 正向提示词最高 73 / 75 tokens
- 负向提示词最高 71 / 75 tokens
- 0 次提示词片段省略
- 单张平均推理约 10.9 秒

基线为 15 通过、6 部分通过、3 失败。主要提升来自：

1. 主体、构图、动作、场景、风格和质量尾缀的确定性排序。
2. 场景、动作、人物数量和圆形裁剪之间的冲突消解。
3. 全身、递情书、白底与多人构图的专用提示词模板。
4. 正向和负向提示词分别用模型的两个 tokenizer 实测，不再按字符数猜测。
5. 默认使用模型卡推荐的 1024×1024、28 步、CFG 5、Euler Ancestral。
6. 选择纯白背景时，在云端推理结果上执行受保护的边缘背景归一化；复杂背景不会被破坏性刷白。

## 最终结果

| 用例 | 通过 | 部分通过 | 失败 | 备注 |
| --- | ---: | ---: | ---: | --- |
| 校草风男生 | 3 | 0 | 0 | 性别与校园形象稳定 |
| 纯白背景 | 3 | 0 | 0 | 无场景，背景确定为白色 |
| 情侣双人 | 2 | 1 | 0 | 一张性别表现偏中性，但人数正确 |
| 闺蜜双人 | 3 | 0 | 0 | 两名女生与协调服装稳定 |
| 全身像 | 3 | 0 | 0 | 头脚完整 |
| 递情书 | 3 | 0 | 0 | 人物完整、信封可见 |
| 打篮球 | 3 | 0 | 0 | 篮球与动作稳定 |
| 圆形裁剪 | 3 | 0 | 0 | 采用保守的全身留白安全构图 |

逐张人工复核见 `release-review.json`，请求、实际提示词、token 诊断和每张图片路径见 `release-results.json`。

## Token 规则

SDXL 的文本编码器总长度通常是 77，其中包含特殊 token，因此本项目按 75 个内容 token 控制。后端执行以下规则：

1. 分别计算两个 tokenizer 的正向与负向 token 数。
2. 正向超限时按完整片段省略低优先级内容，不从 tag 中间截断。
3. 主体、核心构图、核心动作和质量尾缀受保护。
4. 负向超限时直接拒绝请求并提示精简，避免静默截断。
5. 前端同时显示正向和负向用量，并显示被省略片段。

## 可重复运行

确保前端网关已连接模型后：

```bash
cd /Users/vekel/编程/Anime/anime-creation-studio
REGRESSION_PHASE=release node reports/20260729_semantic_regression/run_regression.mjs
REGRESSION_PHASE=release node reports/20260729_semantic_regression/make_contact_sheets.mjs
```

只检查提示词和 token，不生成图片：

```bash
REGRESSION_PHASE=dry-run REGRESSION_DRY_RUN=true node reports/20260729_semantic_regression/run_regression.mjs
```

只复测指定用例：

```bash
REGRESSION_PHASE=targeted REGRESSION_CASES=white_background,circular_crop node reports/20260729_semantic_regression/run_regression.mjs
```

## 仍需关注

- 情侣双人有小概率出现性别偏中性。下一步可在不训练版权敏感角色数据的前提下，生成 2–4 个候选并用通用人数/性别/姿态检测器自动选优。
- 圆形裁剪当前优先保证“不会被裁掉”，因此人物会比普通头像更小。下一阶段可加入通用人体关键点检测后自动缩放，在安全与面部占比之间取得更好平衡。
- 页面中的具体 IP 选项按需求保留。它们只是提示词映射，不代表获得角色、画风、商标或训练数据的商业授权；商用前仍需单独做权利审核。

## 主要依据

- Animagine XL 4.0 模型卡：<https://huggingface.co/cagliostrolab/animagine-xl-4.0>
- Diffusers 提示词权重文档：<https://huggingface.co/docs/diffusers/en/using-diffusers/weighted_prompts>
