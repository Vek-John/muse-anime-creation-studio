# Model license notice

The default runtime model is
[`cagliostrolab/animagine-xl-4.0`](https://huggingface.co/cagliostrolab/animagine-xl-4.0).
Its model card identifies the license as CreativeML Open RAIL++-M and states
that commercial use, modification, distribution, and private use are permitted,
subject to the license restrictions and notice requirements.

The optional `demonslayer` style adapter is
[`Rudra973592/Demonslayer_style_lora`](https://huggingface.co/Rudra973592/Demonslayer_style_lora),
pinned to revision `96f2249b16f4d152c22908e585f5616c4bd9a955` and file
SHA-256
`0f85a1efc816cc46913cfe5e4993261c5874f680a7113d1a3d802a11282efed3`.
Its model card labels the weights MIT, but does not document the source or
licensing of the 746 training images. The repository license therefore should
not be treated as clearance for third-party characters, artwork, or a
commercial style-imitation use.

The optional `luoxiaohei` adapter is a project-trained artifact and is not
bundled with this repository. A deployment should keep its dataset/version
record, training configuration, base-model revision, trigger
`muse_lxh_style`, and final SHA-256 alongside the released weight.

## Online style adapters: internal research only

The following three adapters are pinned for reproducible **internal research
and model evaluation only**. Their weight licenses or hosting-site permissions
do not grant permission to commercially exploit the Naruto, Genshin Impact, or
One Piece names, characters, costumes, artwork, logos, or other third-party IP.
Do not treat this list as commercial-use clearance.

### Naruto

- Source: [`shawn323/sd-xl-lora-naruto`](https://huggingface.co/shawn323/sd-xl-lora-naruto), file [`pytorch_lora_weights.safetensors`](https://huggingface.co/shawn323/sd-xl-lora-naruto/resolve/0ce4679e020c721adada507ee26970ccdea105fe/pytorch_lora_weights.safetensors?download=true).
- Pinned revision: `0ce4679e020c721adada507ee26970ccdea105fe`.
- File identity: `185,963,768` bytes; SHA-256 `d4b2a59f69bc4a4db2b4a02ce78a79daffbfbc69078574842a522194a40396ea`.
- Declared base/weight license: SDXL 1.0; repository metadata labels the
  adapter `OpenRAIL++`.
- Runtime contract: trigger `in naruto-style`; default scale `0.65`; path
  `/root/autodl-tmp/muse-models/loras/naruto/pytorch_lora_weights.safetensors`.
- The model card leaves its training-data and limitations sections incomplete.
  The repository license therefore is not evidence that the training images or
  franchise elements were cleared.

### Genshin Impact

- Source: [`mary-ruiliii/genshin-style_character_generator`](https://huggingface.co/mary-ruiliii/genshin-style_character_generator), file [`pytorch_lora_weights.safetensors`](https://huggingface.co/mary-ruiliii/genshin-style_character_generator/resolve/294b0f1bacccc72ba1fd13693fbc897fad57e78b/pytorch_lora_weights.safetensors?download=true).
- Pinned revision: `294b0f1bacccc72ba1fd13693fbc897fad57e78b`.
- File identity: `23,390,424` bytes; SHA-256 `3bac9e3db1038a59f3526ffcd2933571cc07764c4b801e37a9a10c0dd3728cda`.
- Declared base/weight license: SDXL 1.0; CreativeML OpenRAIL-M.
- Runtime contract: trigger `genshin-style character`; default scale `0.60`;
  path `/root/autodl-tmp/muse-models/loras/genshin/pytorch_lora_weights.safetensors`.
- The publisher does not declare a trigger word. `genshin-style character` is
  a project inference from the repository's training captions, not a
  publisher-specified trigger. The card describes training on official
  character portraits, so character leakage and third-party IP risk must be
  evaluated separately.

### One Piece

- Original-creator sources: [`andinmaro146/LoRA`](https://huggingface.co/andinmaro146/LoRA), file [`one_piece_style_ilxl.safetensors`](https://huggingface.co/andinmaro146/LoRA/resolve/5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f/civitai/476041-one-piece-anime-style-lora/1067881-ilxl-v0-1/one_piece_style_ilxl.safetensors?download=true), and [Civitai model version 1067881](https://civitai.com/models/476041?modelVersionId=1067881).
- Pinned Hugging Face revision: `5f9fa99cf3faa8c42b06d872b7bffff5c1a4435f`.
- File identity: `228,479,220` bytes; SHA-256 `26b37729ff3bc91b11f860d1e97177f9b8c4c78510e7fc35a45b7d8ec0b360ab`.
- Hosting terms: the Hugging Face archive does not declare a model-card
  license. The Civitai version flags permit commercial image use, derivatives,
  and use without credit subject to Civitai's terms; those flags are not a
  license to third-party One Piece IP.
- Runtime contract: trigger `one_piece_style`; project default scale `0.60`;
  path `/root/autodl-tmp/muse-models/loras/onepiece/one_piece_style_ilxl.safetensors`.
- Compatibility is **cross-checkpoint experimental**: the source version is an
  experimental Illustrious LoRA, while this service runs Animagine XL 4.0.
  Architectural loadability does not guarantee correct conditioning, output
  quality, or reproducibility; keep it behind internal evaluation.

Before commercial deployment:

1. Read the complete license in the model repository.
2. Preserve the license and model notices with the deployed service.
3. Comply with the use-based restrictions.
4. Review rights in prompts, training references, characters, logos, and the
   generated output separately. A model license does not grant third-party IP,
   privacy, publicity, or trademark rights.

This file is an engineering notice, not legal advice.
