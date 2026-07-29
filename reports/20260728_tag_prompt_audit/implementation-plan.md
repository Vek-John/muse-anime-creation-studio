# 提示词编译与推理侧优化计划

日期：2026-07-28
原则：先修正确性和可测性，再做推理加速；模型与测试数据继续放在云端，本地只保留代码、报告和生成结果。

## 最终目标

1. 用户不可能选出互相矛盾的主体、场景、动作和构图组合。
2. 同一组 tag 无论点击顺序如何，生成给模型的 prompt 完全一致。
3. `全身像`、人物数量、性别、主动作等关键 tag 永远不会被 77-token 静默截断。
4. 技术参数只影响生成配置，不再伪装成普通视觉 tag。
5. 每个 tag 有可重复的固定种子回归样图和通过标准。
6. 移除具体 IP 模仿入口与“可商用”承诺，避免把构图能力误写成权利保证。

## P0：提示词正确性基础设施

### 1. 用结构化 tag schema 替换字符串表

每个选项至少包含：

```ts
type PromptTag = {
  id: string;
  label: string;
  prompt: string[];
  slot:
    | "subject"
    | "identity"
    | "framing"
    | "action"
    | "appearance"
    | "outfit"
    | "scene"
    | "mood"
    | "style"
    | "quality";
  priority: 0 | 1 | 2 | 3;
  exclusiveGroup?: string;
  conflicts?: string[];
  requires?: string[];
  implies?: string[];
  parameterPatch?: Partial<GenerationSettings>;
  negativePrompt?: string[];
  protected?: boolean;
};
```

优先级建议：

- P0 / protected：人物数量和性别、`full body` 等构图、主动作、`safe`、模型质量后缀。
- P1：身份、核心服装、主场景。
- P2：发型、眼睛、表情、姿态细节。
- P3：配饰、氛围、社交用途修饰、可丢弃装饰。

### 2. 建立冲突解析器

硬规则：

- `campusScene` 与 `animeScene` 合并为一个 `location` 槽。
- 纯色背景选择后清空详细地点；`bokeh`、留白等改为独立 `backgroundTreatment`。
- `specialSetting` 选择情侣/闺蜜/兄弟时，统一改写人物数量和性别并删除 `solo`。
- 互动动作与氛围动作合并成一个主动作；需要手部物体的动作自动补齐物体与构图。
- 服装显式选择覆盖身份隐含服装。
- 社交格式与宽高预设联动，不能出现头像标签配海报尺寸。

前端只需要给出简短提示，例如“选择纯白背景后已移除教室窗边”，不需要复杂安全弹窗。

### 3. 拆分混合字段

- `pose` → 视角、景别、身体姿态、视线。
- `hairstyle` → 发型、发色。
- `facialFeatures` → 眼部特征、表情。
- `faceDetails` → 物种特征、面部配件。
- `background` → 地点、背景处理。

这样可以同时选择“正面视角 + 全身像 + 站姿”，而不是三选一。

### 4. 把技术优化移出 tag 区

`20 步`、CFG、sampler、seed、Clip Skip 全部只留在“高级生成参数”。

- `20 步采样`、`CFG=5` 不再显示在已选 tag 中。
- `sharp focus` 只保留一个视觉质量选项。
- “五官正常/无穿模”等拆成正向质量 tag、负面 prompt 规则和结果验证规则，不再与 sampler 同组。

### 5. 建立确定性 prompt compiler

推荐编译顺序，兼容 Animagine 官方结构：

1. 人物数量/性别。
2. 通用人物身份；不提供具体作品/角色入口。
3. `safe` rating。
4. 景别、视角、主动作。
5. 外貌与表情。
6. 服装和关键配饰。
7. 单一地点与背景处理。
8. 情绪、灯光、通用风格。
9. `masterpiece, high score, great score, absurdres` 质量后缀。

编译顺序来自 schema，不使用 JavaScript 对象插入顺序，也不受点击先后影响。

### 6. 后端执行真实 token 预算

后端加载当前模型的 `tokenizer` 与 `tokenizer_2`：

1. 对编译结果同时计数。
2. 取两者中较大的 token 数。
3. 总内容预算硬限制为 75，并精确保留质量后缀所需 token。
4. 超限时按 P3 → P2 → P1 删除完整 tag，不允许从一个 tag 中间截断。
5. P0/protected tag 不可被删除；如果只剩 protected tag 仍超限，就阻止生成并显示原因。
6. API 返回：

```json
{
  "prompt": "...",
  "token_usage": {
    "tokenizer_1": 61,
    "tokenizer_2": 62,
    "limit": 75
  },
  "omitted_tags": ["cinematic atmosphere"],
  "warnings": []
}
```

前端显示 `62 / 75 tokens`，不再显示与模型无关的 `84 / 1000` 字符数。

### 7. 先处理版权风险入口

- 删除“原神风、火影忍者画风、鬼灭之刃质感、海贼王手绘风、罗小黑战记治愈风”等具体作品名称。
- 用通用维度替换：幻想游戏插画、忍者题材赛璐璐、时代奇幻强光影、冒险漫画线稿、柔和国创动画。
- 把“可商用”改为“海报构图”；许可证核对作为独立清单，不能由 prompt tag 决定。

## P1：提高 tag 命中率

### 1. 为高风险 tag 使用组合模板

本次定向复测证明，单一词不够稳定：

- 异瞳：`portrait, centered face, both eyes visible, heterochromia`。
- 闺蜜：`2girls, matching outfits, different colors, standing side by side`。
- 递情书：`outstretched hand, holding a visible envelope, giving a love letter`。
- 打篮球：`full body, dribbling a basketball, visible basketball, dynamic pose`。
- 圆形头像：`front view, centered face, ample margin around head and shoulders`。

模板不是简单增加词，而是补齐主语、数量、物体、动作和构图槽。

仍未解决：

- `校草风男生`：在 `1boy, solo, male focus` 下仍生成女性校园角色。应更换为模型更熟悉的男性标签并做多种子筛选；若成功率仍低，应暂时下线。
- `纯白背景`：两轮均生成复杂背景。优先测试把 `scenery, detailed background` 放入负面 prompt；若仍不稳，改为生成后抠图/背景替换，而不是继续堆正向词。

### 2. 对自由输入做结构化合并

- 自由输入默认作为普通优先级的自定义 tag，不再无条件插在全部选择前面。
- 解析显式 `1girl/1boy/2girls/solo/full body`，与结构化选择做冲突提示。
- 提供“高级：原始标签”模式，但显示真实 token 数和被省略内容。

### 3. 去重与同义词归一

- `锐化聚焦` 与技术区 `sharp focus` 归一为同一个 tag。
- 相同映射的微信/QQ、小红书/微博合并为平台预设，构图 tag 只输出一次。
- 同一个 prompt 片段最多出现一次。

## P2：推理侧性能与质量基线

导师要求优先推理侧优化时，建议按下面顺序做，避免先改模型训练：

### 1. 建立可重复 benchmark

固定 20 个无 IP prompt、3 个种子、两种分辨率，记录：

- 首次加载耗时、冷启动、热启动。
- 端到端 p50/p95。
- GPU 峰值显存。
- 每张图耗时。
- 人数、全身、动作、背景、手部等人工通过率。

本次可作为基线：

- 640×640、16 步：约 2.8–3.6 秒/张。
- 1024×1024、28 步：约 9.6–12.5 秒/张。

### 2. 逐项 A/B，禁止一次改多个变量

建议实验顺序：

1. Euler A、DPM++ 2M Karras、DPM++ SDE Karras 的速度/通过率比较。
2. 20、24、28 步的质量与耗时曲线。
3. PyTorch SDPA 与 xFormers attention 二选一比较。
4. `torch.compile`：记录预热成本以及多少张后回本。
5. FP16 与 BF16：验证显存、速度、颜色/稳定性。
6. VAE slicing/tiling 仅在显存不足时测试；它不应默认被当成加速项。
7. CPU offload 只作为低显存模式，不作为性能模式。

每个实验必须在同一模型快照、相同 prompt、相同 seed 下比较。

### 3. 运行时基础设施

- 云端进程启动时预加载模型，避免每次请求重新载入。
- 队列返回明确的排队状态和 request id。
- 缓存 tokenizer、scheduler 配置和编译后的 prompt diagnostics。
- 记录模型 revision、推理库版本、GPU、参数和 seed，保证结果可复现。
- 服务器重启后的自动配置继续保留，但模型版本要锁定，不自动漂移到最新。

## P3：权重与长提示词实验

在 P0/P1 benchmark 稳定后再做：

1. 试验 model card 使用的 `lpw_stable_diffusion_xl` custom pipeline。
2. 试验 Diffusers 文档推荐的 `sd_embed`，通过 `prompt_embeds` 与 `pooled_prompt_embeds` 实现真实权重。
3. 比较普通短 prompt、LPW、embedding weighting 的 tag 命中率、速度和显存。
4. Long-CLIP/TULIP 只作为研究分支；不要直接替换生产文本编码器。

通过条件：高优先级 tag 命中率显著提升，且没有人物身份、风格或颜色明显退化。

## 必须新增的测试

### 单元测试

- 153 个选项均有合法 schema。
- 点击顺序不同，编译结果相同。
- 场景、人数、性别、动作冲突能确定性消解。
- 技术参数不进入 prompt。
- 同义词不会重复。
- `full body` 等 protected tag 在 token 压缩后仍存在。
- 两个 tokenizer 都不超过 77。

### 页面测试

- 选择互斥项时，旧项自动清除并提示。
- token 计数、被省略 tag、负面 prompt 与请求载荷一致。
- 头像预设同时更新尺寸和安全区。
- 本地/云端模式的生成、下载、错误恢复都可用。

### 云端语义回归

- 每个字段至少一个代表 tag。
- 高风险 tag 每次跑 3 个固定 seed。
- 人数、性别、全身、主动作、纯色背景设为阻断级指标。
- 不使用具体作品或角色名。

## 建议的交付顺序

1. PR-A：结构化 schema、冲突解析、确定性排序、技术参数迁移、去 IP 名称。
2. PR-B：双 tokenizer 计数、预算压缩、前端 75-token 诊断。
3. PR-C：高风险 tag 模板与 23 字段固定种子回归。
4. PR-D：推理 benchmark 与 scheduler/steps/attention 优化。
5. 实验 PR：LPW 或 embedding weighting，不与主线正确性改动混在一起。

完成 PR-A 和 PR-B 后，当前最严重的静默错误就会消失；PR-C 再解决“选了但画不出来”的稳定性问题。
