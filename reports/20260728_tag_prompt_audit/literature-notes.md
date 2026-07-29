# 文献与官方资料笔记

日期：2026-07-28
范围：当前云端模型 `cagliostrolab/animagine-xl-4.0` 的提示词结构、77-token 限制、权重与长提示词方案。

## 1. 当前模型的官方提示词规范

来源：[Animagine XL 4.0 model card](https://huggingface.co/cagliostrolab/animagine-xl-4.0)

- 模型使用标签式 caption 和 tag-ordering 训练，不适合把长自然语言直接当成主要控制方式。
- 官方结构是：人物数量/性别 → 角色与作品信息 → rating → 其他内容 → 质量增强词。
- 官方建议把 `masterpiece, high score, great score, absurdres` 放在末尾。
- 官方推荐 CFG 5、28 步、Euler Ancestral；方图推荐 1024×1024。
- 官方明确提示，多人物与复杂手部/动作需要更仔细的 prompt engineering。
- model card 示例使用 `lpw_stable_diffusion_xl` custom pipeline 来处理长、带权重、细节较多的提示词。

对当前项目的直接影响：

1. 现有 `QUALITY_PREFIX = "masterpiece, best quality"` 放在最前面，与模型官方顺序相反。
2. 当前默认描述是自然语言式短句与标签混合，应改成模型化的结构化 tag 编译。
3. 当前后端直接调用标准 `StableDiffusionXLPipeline`，没有使用 model card 示例中的长提示词 pipeline。
4. 定向复测应使用官方推荐设置。本次 1024×1024、28 步、CFG 5、Euler A 的结果已证明，多数失败项可通过更明确的标签组合恢复。

## 2. 77-token 上限

来源：[OpenAI CLIP repository](https://github.com/openai/CLIP)；其中公开 API 的默认 `context_length=77`。

本项目不是仅依据文献推测：已在云端当前模型快照中直接读取两个 tokenizer，二者 `model_max_length` 都是 77。去掉开始和结束特殊 token 后，可用内容预算为 75。

本次实测：

- 当前默认提示词：67 个内容 token，只剩 8 个。
- 每个字段各选一个选项：158 个内容 token，超出 83 个。
- 同一长提示词的 `full body` 放前面时进入上下文；放末尾时被完全截断。
- 同种子输出中，前置版人物完整到鞋，末尾版裁到大腿以上。

结论：当前项目存在真实的静默截断，不是理论风险。前端显示的 `84 / 1000` 是字符数，不是模型 token 数。

## 3. SDXL 的双文本编码器

来源：[SDXL: Improving Latent Diffusion Models for High-Resolution Image Synthesis](https://arxiv.org/abs/2307.01952)

SDXL 使用第二个文本编码器扩大条件表达能力。当前 Animagine XL 4.0 快照中的 `tokenizer` 和 `tokenizer_2` 都已实测为 77 上限，因此后端 token 诊断必须同时运行两套 tokenizer，并按更严格的结果决定是否可生成。

## 4. 权重不是简单改字符串

来源：[Hugging Face Diffusers prompting documentation](https://huggingface.co/docs/diffusers/main/en/using-diffusers/weighted_prompts)

Diffusers 的权重控制通过 `prompt_embeds` 与 `pooled_prompt_embeds` 实现；官方文档示例使用 `sd_embed` 生成加权 SDXL embeddings。当前项目把普通字符串直接交给 pipeline，因此不能假定 WebUI 风格的 `(full body:1.3)` 会自动生效。

建议：

- P0 先做确定性排序、冲突消解、去重与 token 预算，这些不需要换 pipeline。
- P1 再以 `prompt_embeds` 做受控 A/B 实验，验证全身构图、人数和动作的成功率。
- 如果没有 embeddings 集成，不要在前端暴露“权重滑杆”，否则会形成虚假控制。

## 5. 长文本研究方向

- [Long-CLIP: Unlocking the Long-Text Capability of CLIP](https://arxiv.org/abs/2403.15378)：指出 CLIP 输入限制为 77 token，并提出长文本替代编码器。
- [TULIP: Token-length Upgraded CLIP](https://arxiv.org/abs/2410.10034)：使用相对位置编码和蒸馏，使 CLIP-like 模型支持超过 77 token。

这些论文适合作为后续研究方向，但不是当前 Animagine checkpoint 的无风险替换项。替换文本编码器可能改变原 checkpoint 熟悉的 embedding 分布，且 SDXL 有双文本编码器。应先完成短 prompt 编译器与固定种子 benchmark，再单独评估 LPW、`sd_embed`、Long-CLIP/TULIP 方案。

## 6. 许可证与版权风险边界

Animagine XL 4.0 model card 标注 CreativeML Open RAIL++-M，并说明许可商业使用、修改和分发，同时要求保留许可证、声明修改并遵守限制。模型许可证允许某类使用，不等于某张输出自动完成了角色、作品、商标、素材来源等权利清理。

当前前端的两处高风险设计：

1. `动漫 IP 衍生` 直接使用原神、火影忍者、鬼灭之刃、海贼王、罗小黑战记等名称。即使英文映射已写成通用风格词，UI 仍在鼓励按具体作品模仿。建议删除具体 IP 名称，改为通用视觉维度。
2. `可商用（用于社团海报）` 只映射为 `poster-ready composition`。该标签只能影响构图，不能判断权利状态，应删除“可商用”承诺，改成“海报构图”，并把许可证/素材清单放到独立流程。

本次云端测试没有使用具体作品角色名或作品专有角色设定。
