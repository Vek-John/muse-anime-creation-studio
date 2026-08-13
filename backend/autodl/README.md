# AutoDL 联调环境

AutoDL 适合开发与个人联调。根据 AutoDL 自定义服务协议，该服务通道限定
科研用途且不可转发给第三方，因此不要把它当作最终商用生产环境。

## 创建实例

- GPU：RTX 4090 / 3090 24GB；本次训练与推理已在 V100 32GB 实测
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

`setup.sh` 会把鬼灭之刃、火影忍者、原神和海贼王画风 LoRA 的固定版本下载
到数据盘并校验 SHA-256，同时创建罗小黑自训 LoRA 的固定发布目录；基础模型
会在第一次启动时缓存到 `/root/autodl-tmp/muse-models`。`setup.sh` 会复用已有
`.venv`，并自动读取现有 `.env` 的 `HF_ENDPOINT`；因此 AutoDL
非交互 SSH 没有全局 `python` 命令、或需要国内镜像时也能重复执行。已有部署
缺少任一 LoRA 路径变量时，脚本会补齐固定数据盘路径而不覆盖其他私有配置。
本机启动 Runtime Gateway 后，在前端选择“云端 GPU”，填写 AutoDL SSH 命令、SSH
登录密码即可。Gateway 会自动读取 `/root/muse-diffusion/.env` 的
`API_KEY`，检查并按需启动远端模型服务，再连接 `6006` 并建立隧道，不再
需要手动复制模型 API 密钥或把 AutoDL 的自定义服务公网地址交给浏览器。
AutoDL 实例重启后，重新在网页连接即可，不需要手动执行启动脚本。

第一次使用严格主体校验时会在同一 `HF_HOME` 下载约 467 MB 的 WD SwinV2
ONNX 标签器，之后直接复用缓存。它只在 AutoDL 内检查生成图的性别与人数，
同时拒绝头部出框、无脸、无头或无人物的结果。失败时自动换 seed 重试，
不会把图片发送到互联网。服务还会拒绝低于 90 万像素或低于 25 步的请求，
防止 Animagine 在过低推理预算下退化成抽象图。

## 固定 LoRA 清单

服务注册表包含五个 adapter：`demonslayer`、`luoxiaohei`、`naruto`、
`genshin`、`onepiece`。运行 `setup.sh` 后，四个公开权重应满足下表；罗小黑
权重按下一节发布。

| adapter | trigger | 默认 scale | 固定路径 |
| --- | --- | ---: | --- |
| `demonslayer` | `demonslayer style` | `0.65` | `/root/autodl-tmp/muse-models/loras/demonslayer/Demonslayer_style_lora-.safetensors` |
| `luoxiaohei` | `muse_lxh_style` | `0.60` | `/root/autodl-tmp/muse-models/loras/luoxiaohei/muse_lxh_style_v1.safetensors` |
| `naruto` | `in naruto-style` | `0.65` | `/root/autodl-tmp/muse-models/loras/naruto/pytorch_lora_weights.safetensors` |
| `genshin` | `genshin-style character` | `0.60` | `/root/autodl-tmp/muse-models/loras/genshin/pytorch_lora_weights.safetensors` |
| `onepiece` | `one_piece_style` | `0.60` | `/root/autodl-tmp/muse-models/loras/onepiece/one_piece_style_ilxl.safetensors` |

三款新增网上权重的供应链固定如下：

- `naruto`：[`shawn323/sd-xl-lora-naruto`](https://huggingface.co/shawn323/sd-xl-lora-naruto) 的 `pytorch_lora_weights.safetensors`；revision `0ce4679e020c721adada507ee26970ccdea105fe`；`185,963,768` bytes；SHA-256 `d4b2a59f69bc4a4db2b4a02ce78a79daffbfbc69078574842a522194a40396ea`；[固定下载](https://huggingface.co/shawn323/sd-xl-lora-naruto/resolve/0ce4679e020c721adada507ee26970ccdea105fe/pytorch_lora_weights.safetensors?download=true)。
- `genshin`：[`mary-ruiliii/genshin-style_character_generator`](https://huggingface.co/mary-ruiliii/genshin-style_character_generator) 的 `pytorch_lora_weights.safetensors`；revision `294b0f1bacccc72ba1fd13693fbc897fad57e78b`；`23,390,424` bytes；SHA-256 `3bac9e3db1038a59f3526ffcd2933571cc07764c4b801e37a9a10c0dd3728cda`；[固定下载](https://huggingface.co/mary-ruiliii/genshin-style_character_generator/resolve/294b0f1bacccc72ba1fd13693fbc897fad57e78b/pytorch_lora_weights.safetensors?download=true)。发布者没有明确给出 trigger；项目使用的 `genshin-style character` 是根据训练 caption 推断的值。
- `onepiece`：原作者 [`andinmaro146/LoRA`](https://huggingface.co/andinmaro146/LoRA) 中的 `civitai/476041-one-piece-anime-style-lora/1067881-ilxl-v0-1/one_piece_style_ilxl.safetensors`（对应 [Civitai version 1067881](https://civitai.com/models/476041?modelVersionId=1067881)）；revision `5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f`；`228,479,220` bytes；SHA-256 `26b37729ff3bc91b11f860d1e97177f9b8c4c78510e7fc35a45b7d8ec0b360ab`；[固定下载](https://huggingface.co/andinmaro146/LoRA/resolve/5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f/civitai/476041-one-piece-anime-style-lora/1067881-ilxl-v0-1/one_piece_style_ilxl.safetensors?download=true)。该源权重基于 Illustrious，接到 Animagine XL 4.0 属于 **cross-checkpoint experimental**，必须单独做输出回归。

火影忍者、原神和海贼王权重只用于内部研究与适配验证。仓库许可证或站点
权限只约束权重/站点使用，不等于对角色、服装、画面、名称、商标等 IP 的
商用授权；不要把这些 adapter 直接作为商用素材入口。完整记录见
`../MODEL_LICENSE_NOTICE.md`。

## 发布罗小黑风格 LoRA

从训练 runs 中选定 checkpoint 后，将权重复制为固定文件：

```bash
SOURCE_LORA=/root/autodl-tmp/muse-lora/runs/v1/选定的-step检查点.safetensors
TARGET_DIR=/root/autodl-tmp/muse-models/loras/luoxiaohei
TARGET_LORA="$TARGET_DIR/muse_lxh_style_v1.safetensors"

test -s "$SOURCE_LORA"
case "$SOURCE_LORA" in
  *-state/*) echo "拒绝发布训练 state 文件" >&2; exit 1 ;;
esac
mkdir -p "$TARGET_DIR"

if [ -f "$TARGET_LORA" ]; then
  cp -a "$TARGET_LORA" "$TARGET_LORA.backup-$(date +%Y%m%d-%H%M%S)"
fi
cp "$SOURCE_LORA" "$TARGET_LORA.tmp"
test -s "$TARGET_LORA.tmp"
mv -f "$TARGET_LORA.tmp" "$TARGET_LORA"
sha256sum "$TARGET_LORA" | tee "$TARGET_LORA.sha256"
```

真实 `.env` 还需要包含：

```text
LUOXIAOHEI_LORA_PATH=/root/autodl-tmp/muse-models/loras/luoxiaohei/muse_lxh_style_v1.safetensors
```

`setup.sh` 在新服务器创建 `.env`；已有服务器升级时确认该行仍指向活动别名。
发布或替换权重后运行 `bash autodl/start-background.sh` 重启模型进程。前端选择
“罗小黑战记治愈风”后会发送 `style_adapter: "luoxiaohei"`，默认强度为
`0.60`，并使用与训练 caption 一致的 `muse_lxh_style` 触发词。

## 端到端 LoRA 切换回归

确认训练进程已经退出、`/healthz` 返回 `ready` 后，在同一个推理 API 进程上
运行固定 seed 回归：

```bash
cd /root/muse-diffusion
.venv/bin/python autodl/verify_style_switch.py
```

脚本默认读取私有 `/root/muse-diffusion/.env` 中的 `API_KEY`，不会输出或写入
密钥。也可以指定服务、密钥文件和空输出目录：

```bash
.venv/bin/python autodl/verify_style_switch.py \
  --api-url http://127.0.0.1:6006 \
  --env-file /root/muse-diffusion/.env \
  --output-dir /root/autodl-tmp/muse-style-switch-regression/manual-v1
```

工具也支持 `--api-key`，但命令行参数可能对同机其他进程可见，优先使用
`--env-file`。某个权重尚未安装时，用可重复的 `--skip-adapter` 跳过；参数值
必须是五个 adapter 名之一。例如同时跳过罗小黑与实验性的海贼王：

```bash
.venv/bin/python autodl/verify_style_switch.py \
  --skip-adapter luoxiaohei \
  --skip-adapter onepiece
```

完整模式会在同一 API 进程中依次请求：

1. `base_before`；
2. `luoxiaohei`，请求 scale 为 `null`，响应必须解析为 `0.60`；
3. `demonslayer`，请求 scale 为 `null`，响应必须解析为 `0.65`；
4. `naruto`，请求 scale 为 `null`，响应必须解析为 `0.65`；
5. `genshin`，请求 scale 为 `null`，响应必须解析为 `0.60`；
6. `onepiece`，请求 scale 为 `null`，响应必须解析为 `0.60`；
7. `base_after`。

每轮使用相同的 seed、提示词和推理参数。脚本验证 HTTP 200、返回 adapter、
解析后的 scale、该 adapter 的 `prompt_used` 触发词，以及其他四个触发词均
未泄漏；并把 PNG 与移除 `image_base64` 后的 JSON 分开保存。最后要求
`base_before` 与 `base_after` 的 PNG SHA-256 完全一致；不一致视为 adapter
残留并以非零状态退出。汇总写入
`verification_summary.json`，失败现场写入 `verification_failure.json`。

纯函数冒烟测试不连接服务：

```bash
.venv/bin/python -m doctest -v autodl/verify_style_switch.py
```

## 历史主体回归

发布新权重或修改 Prompt 编译规则后，运行两条曾经失败的男性用例，每条固定两个
seed。脚本使用产品实际展开后的 Prompt、negative、默认 LoRA scale 与严格主体
校验，并将密钥从私有 `.env` 读取而不写入结果：

```bash
cd /root/muse-diffusion
.venv/bin/python autodl/verify_subject_regressions.py \
  --adapter naruto \
  --output-dir /root/autodl-tmp/muse-subject-regression/manual-v1
```

覆盖用例是“老年男性校服全身像”和“黄发男孩日式服装暴雨”。任意请求非 HTTP
200、最终不是男性、adapter/scale 不一致，脚本都会以非零状态退出。纯函数测试：

`--adapter` 支持五个注册项，默认仍为 `luoxiaohei`。新增网上 LoRA 上线前至少
分别以 `naruto`、`genshin`、`onepiece` 跑一轮，输出目录不能复用。

```bash
.venv/bin/python -m doctest -v autodl/verify_subject_regressions.py
```

空白画布使用不限定性别的通用人物校验；明确输入无人、非人主体、无脸、
无头或头部出框时，前端会自动移除冲突限制并关闭该次人物校验。
