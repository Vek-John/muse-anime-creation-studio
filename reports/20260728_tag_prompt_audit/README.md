# MUSE 标签、提示词与推理链路审计

日期：2026-07-28

分支：`zyx_branch`

模型：`cagliostrolab/animagine-xl-4.0`
模型位置：AutoDL 云端；本地没有复制模型或模型数据。

## 结论

当前前端、网关和云端生成链路可正常使用，但提示词基础设施还不适合继续堆 tag。

最重要的五个结论：

1. **153 个选项都有映射，但“有映射”不等于“生成可靠”。** 静态审计没有发现漏映射；发现 2 个空映射和 3 组重复映射。
2. **冲突没有解析。** 教室窗边、异世界森林和纯白背景能同时进入 prompt；`solo` 与情侣、男生与少女、递情书与打篮球也会直接拼接。
3. **tag 顺序受点击历史影响。** 删除“半身像”后再选“全身像”，`full body` 会移动到 prompt 最末尾。
4. **存在真实的 77-token 静默截断。** 两个云端 tokenizer 都是 77 上限，可用内容预算 75。当前默认已用 67；每字段选一个达到 158。
5. **优先级位置会直接改变结果。** 同一长 prompt、同一 seed，`full body` 在前面时完整到鞋，在末尾时被截断，结果裁到大腿以上。

因此建议先做“冲突解析 + 确定性编译 + 双 tokenizer 预算”，再继续增加选项或研究更长 prompt。

## 测试范围

### 静态全覆盖

- 8 个类别。
- 23 个字段。
- 153 个可选项。
- 153/153 能通过 `toModelPrompt`。
- 0 个未知映射。
- 2 个空 prompt 映射：`20 步采样`、`CFG = 5`。
- 3 组重复映射：`sharp focus`、微信/QQ 头像、小红书/微博头像。

完整数据：[static-audit.json](./static-audit.json)

### 真实页面测试

已验证：

- Gateway 状态检查。
- 本地页面到 AutoDL GPU 的真实生成。
- 已选 tag 增删和重置。
- 提示词复制。
- 尺寸预设与手动宽高。
- steps、CFG、sampler、seed、Clip Skip 载荷。
- 负面提示词。
- 请求载荷预览。
- 生成结果、seed、耗时和 PNG 下载。
- 页面控制台无 warning/error。

同时稳定复现：

- 三个互斥场景共同进入 prompt。
- `full body` 因重新选择移到末尾。
- 技术参数显示成普通 tag。
- `sharp focus` 重复两次。

完整数据：[ui-functional-test.json](./ui-functional-test.json)

### 自动测试

- 前端 lint：通过。
- 生产构建与 rendered HTML：1/1 通过。
- 后端与 gateway API：11/11 通过。
- 云端生成样图：38 张。

完整数据：[automated-test-results.json](./automated-test-results.json)

## 77-token 核验

| 提示词 | 内容 token | 预算 | 结果 |
|---|---:|---:|---|
| 当前默认 | 67 | 75 | 可用，但只剩 8 |
| 每字段选一个 | 158 | 75 | 超出 83 |
| 长 prompt，`full body` 前置 | 122 | 75 | `full body` 在截断前 |
| 同一长 prompt，`full body` 末置 | 122 | 75 | `full body` 被截掉 |

当前 UI 的 `84 / 1000` 是字符数，不能反映模型上下文。

对照图：

![全身像位置与冲突对照](./contact-sheets/comparisons.png)

完整数据：[token-audit.json](./token-audit.json)

## 云端 tag 生成结果

第一轮用 640×640、16 步、CFG 5、Euler A 对 22 个语义字段逐项抽样，并增加 8 个冲突/顺序对照。

第一轮：

- 通过 10。
- 部分通过 4。
- 失败 6。
- 无法判断 1。
- 无法由单张图证明 1。

第一轮发现的典型问题：

- `校草风男生` 生成女性角色。
- `2girls` 生成三个人。
- `solo + 书包` 复制成两个人。
- `递情书` 没有信件。
- `打篮球` 只有球，没有人物。
- `纯白背景` 生成深色背景。
- `圆形裁剪兼容` 没有形成安全构图。

第一轮样图：

![字段测试一](./contact-sheets/semantic-fields-01.png)

![字段测试二](./contact-sheets/semantic-fields-02.png)

第二轮把失败/歧义项提升到模型官方推荐的 1024×1024、28 步、CFG 5、Euler A，并补齐人物、物体、人数和构图标签。

第二轮 8 项：

- 通过 6。
- 失败 2。

恢复正常：异瞳、两名闺蜜、递情书、打篮球、圆形头像、书包。

仍失败：

- `校草风男生`：即使加入 `1boy, solo, male focus`，仍生成女性水手服角色。
- `纯白背景`：即使强调纯白、无场景，仍生成云海、地面和武器。

定向复测：

![定向复测](./contact-sheets/targeted-retests.png)

完整人工复核：[visual-review.json](./visual-review.json)

## 冲突结构

当前至少有：

- 7 类硬冲突。
- 5 类条件冲突。
- 5 个字段 schema 问题。

必须优先解决的槽：

1. 人物数量与性别。
2. 单一地点与背景模式。
3. 主动作。
4. 景别、视角、姿态、视线拆分。
5. 头像用途与宽高/安全区联动。

完整矩阵：[conflict-matrix.json](./conflict-matrix.json)

## 设计和版权风险

- Animagine 官方建议：人物数量/性别在前，其他标签随后，质量词放最后。当前项目把质量词固定在最前。
- 模型是 tag-based，当前自由描述是自然语言和 tag 混合。
- `动漫 IP 衍生` 使用具体作品名称，建议全部改成通用风格维度。
- `可商用` 仅映射成海报构图，不能判断任何权利状态，应改名为“海报构图”。

资料摘要：[literature-notes.md](./literature-notes.md)

## 建议实施顺序

### PR-A：正确性

- 结构化 tag schema。
- 冲突解析。
- 确定性排序。
- 技术参数移出 tag 区。
- 去重。
- 删除具体 IP 名称和“可商用”承诺。

### PR-B：token 基础设施

- 后端同时使用两个实际 tokenizer。
- 限制 75 内容 token。
- 低优先级整 tag 淘汰。
- 保护人数、性别、全身、主动作和质量后缀。
- 前端显示真实 token 使用量、被省略 tag 和警告。

### PR-C：命中率

- 为人数、物体、动作、裁剪构图建立组合模板。
- 23 字段固定种子回归。
- 高风险 tag 三种子通过率门槛。
- 暂时下线持续失败的 tag。

### PR-D：推理侧优化

- 固定 benchmark 后比较 sampler、20/24/28 步、SDPA/xFormers、`torch.compile`、FP16/BF16。
- 本次基线：640×640/16 步约 2.8–3.6 秒；1024×1024/28 步约 9.6–12.5 秒。
- 长 prompt/权重作为独立实验，不与正确性改动混在同一 PR。

完整方案：[implementation-plan.md](./implementation-plan.md)

## 文件说明

- `audit_tags.mjs`：静态映射审计，可重复运行。
- `run_generation_matrix.mjs`：第一轮云端字段与冲突矩阵。
- `run_targeted_retests.mjs`：官方推荐设置下的定向复测。
- `make_contact_sheets.py`：把本地生成结果整理成联系表。
- `outputs/`：38 张云端生成结果。
- `contact-sheets/`：人工审阅联系表。

本次没有修改 `app/`、`backend/` 或现有 README；所有新增内容都在 `reports/20260728_tag_prompt_audit/`。
