"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_NEGATIVE_PROMPT } from "./prompt-tags";
import {
  compilePrompt,
  mergeNegativePrompt,
  orderedSelectionEntries,
  PromptSegment,
  resolveSelectionChange,
} from "./prompt-compiler";
import {
  ConnectionStatus,
  RuntimePanel,
} from "./runtime-panel";
import {
  DEFAULT_QUALITY_GUARD,
  DEFAULT_SELECTIONS,
  PARAMETER_GROUPS,
  QUALITY_GUARD_OPTIONS,
} from "./studio-config";

const FIELD_LABELS = Object.fromEntries(
  PARAMETER_GROUPS.flatMap((group) =>
    group.fields.map((field) => [field.id, field.label]),
  ),
);

const SIZE_PRESETS = [
  { label: "头像 1:1", width: 1024, height: 1024 },
  { label: "竖版 3:4", width: 896, height: 1152 },
  { label: "横版 4:3", width: 1152, height: 896 },
  { label: "海报 2:3", width: 832, height: 1216 },
];

const SAMPLERS = [
  { value: "dpmpp_2m_karras", label: "DPM++ 2M Karras" },
  { value: "dpmpp_sde_karras", label: "DPM++ SDE Karras" },
  { value: "euler_a", label: "Euler Ancestral" },
  { value: "euler", label: "Euler" },
];

type GenerationStatus = "idle" | "generating" | "ready" | "error";
type InspectionStatus = "idle" | "checking" | "ready" | "error";

type TokenUsage = {
  tokenizer_1: number;
  tokenizer_2: number;
  limit: number;
};

type PromptDiagnostics = {
  token_usage: TokenUsage;
  negative_token_usage?: TokenUsage;
  omitted_segments: PromptSegment[];
  warnings: string[];
};

type PromptInspection = {
  prompt: string;
  negative_prompt: string;
  diagnostics: PromptDiagnostics;
};

type PromptInspectionState = PromptInspection & {
  sourcePrompt: string;
  sourceNegativePrompt: string;
  sourceGatewayUrl: string;
};

type GenerationResult = {
  request_id: string;
  image_base64: string;
  mime_type: string;
  seed: number;
  model: string;
  width: number;
  height: number;
  steps: number;
  guidance_scale: number;
  sampler: string;
  duration_ms: number;
  prompt_used?: string;
  prompt_diagnostics?: PromptDiagnostics;
  background_mode?: "none" | "white";
};

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function connectionLabel(status: ConnectionStatus) {
  if (status === "checking") return "正在检查";
  if (status === "starting") return "模型加载中";
  if (status === "connected") return "GPU 已连接";
  if (status === "error") return "连接失败";
  return "未连接服务";
}

export default function Home() {
  const [selections, setSelections] =
    useState<Record<string, string>>(DEFAULT_SELECTIONS);
  const [description, setDescription] = useState(
    "1girl, solo, looking back at viewer, gentle smile, soft backlight, clean composition",
  );
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<GenerationResult | null>(null);

  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:8000");
  const [connection, setConnection] =
    useState<ConnectionStatus>("unchecked");
  const [connectionMessage, setConnectionMessage] = useState(
    "选择本地模型，或通过 SSH 连接云端 GPU",
  );

  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(28);
  const [guidanceScale, setGuidanceScale] = useState(5);
  const [seed, setSeed] = useState(-1);
  const [sampler, setSampler] = useState("euler_a");
  const [clipSkip, setClipSkip] = useState(2);
  const [qualityGuard, setQualityGuard] = useState(DEFAULT_QUALITY_GUARD);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [inspection, setInspection] =
    useState<PromptInspectionState | null>(null);
  const [inspectionStatus, setInspectionStatus] =
    useState<InspectionStatus>("idle");
  const [inspectionError, setInspectionError] = useState("");

  const selectedEntries = useMemo(
    () => orderedSelectionEntries(selections),
    [selections],
  );

  const compiled = useMemo(
    () =>
      compilePrompt({
        selections,
        description,
        qualityGuard,
      }),
    [description, qualityGuard, selections],
  );

  const effectiveNegativePrompt = useMemo(
    () => mergeNegativePrompt(negativePrompt, compiled.negativeAdditions),
    [compiled.negativeAdditions, negativePrompt],
  );

  const normalizedGatewayUrl = normalizeApiUrl(gatewayUrl);
  const currentInspection =
    connection === "connected" &&
    inspection?.sourcePrompt === compiled.prompt &&
    inspection.sourceNegativePrompt === effectiveNegativePrompt &&
    inspection.sourceGatewayUrl === normalizedGatewayUrl
      ? inspection
      : null;
  const visibleInspectionStatus: InspectionStatus =
    connection !== "connected"
      ? "idle"
      : currentInspection
        ? "ready"
        : inspectionStatus === "error"
          ? "error"
          : "checking";
  const effectivePrompt = currentInspection?.prompt ?? compiled.prompt;
  const effectiveDiagnostics = currentInspection?.diagnostics ?? null;
  const tokenCount = effectiveDiagnostics
    ? Math.max(
        effectiveDiagnostics.token_usage.tokenizer_1,
        effectiveDiagnostics.token_usage.tokenizer_2,
      )
    : null;
  const negativeTokenCount = effectiveDiagnostics?.negative_token_usage
    ? Math.max(
        effectiveDiagnostics.negative_token_usage.tokenizer_1,
        effectiveDiagnostics.negative_token_usage.tokenizer_2,
      )
    : null;
  const backgroundMode =
    selections.background === "纯白背景" ? "white" : "none";

  const payload = useMemo(
    () => ({
      prompt: compiled.prompt,
      prompt_segments: compiled.segments,
      negative_prompt: effectiveNegativePrompt,
      width,
      height,
      steps,
      guidance_scale: guidanceScale,
      seed,
      sampler,
      clip_skip: clipSkip,
      background_mode: backgroundMode,
    }),
    [
      backgroundMode,
      clipSkip,
      compiled.prompt,
      compiled.segments,
      effectiveNegativePrompt,
      guidanceScale,
      height,
      sampler,
      seed,
      steps,
      width,
    ],
  );

  useEffect(() => {
    if (connection !== "connected" || !compiled.prompt) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setInspectionStatus("checking");
      setInspectionError("");
      try {
        const response = await fetch(
          `${normalizeApiUrl(gatewayUrl)}/v1/prompt/inspect`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: compiled.prompt,
              prompt_segments: compiled.segments,
              negative_prompt: effectiveNegativePrompt,
            }),
            signal: controller.signal,
          },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(body.detail || `提示词检查失败（${response.status}）`);
        }
        setInspection({
          ...(body as PromptInspection),
          sourcePrompt: compiled.prompt,
          sourceNegativePrompt: effectiveNegativePrompt,
          sourceGatewayUrl: normalizeApiUrl(gatewayUrl),
        });
        setInspectionStatus("ready");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setInspection(null);
        setInspectionStatus("error");
        setInspectionError(
          error instanceof Error ? error.message : "提示词检查失败",
        );
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    compiled.prompt,
    compiled.segments,
    connection,
    effectiveNegativePrompt,
    gatewayUrl,
  ]);

  function updateSelection(fieldId: string, value: string) {
    setSelections((current) => {
      const resolved = resolveSelectionChange(current, fieldId, value);
      setSelectionNotice(resolved.notices.join(" "));
      return resolved.selections;
    });
    if (fieldId === "format" && value) {
      setWidth(1024);
      setHeight(1024);
    }
    setStatus("idle");
  }

  function removeSelection(fieldId: string) {
    setSelections((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setSelectionNotice("");
    setStatus("idle");
  }

  function resetForm() {
    setSelections(DEFAULT_SELECTIONS);
    setDescription("");
    setNegativePrompt(DEFAULT_NEGATIVE_PROMPT);
    setQualityGuard(DEFAULT_QUALITY_GUARD);
    setSelectionNotice("");
    setInspection(null);
    setWidth(1024);
    setHeight(1024);
    setSteps(28);
    setGuidanceScale(5);
    setSeed(-1);
    setSampler("euler_a");
    setClipSkip(2);
    setStatus("idle");
    setResult(null);
    setErrorMessage("");
  }

  async function copyPrompt() {
    if (!effectivePrompt) return;
    await navigator.clipboard.writeText(effectivePrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function handleGenerate() {
    const baseUrl = normalizeApiUrl(gatewayUrl);
    if (
      !compiled.prompt ||
      status === "generating" ||
      visibleInspectionStatus === "error"
    ) {
      return;
    }
    if (!baseUrl) {
      setStatus("error");
      setErrorMessage("请先启动本机 Runtime Gateway");
      return;
    }

    setStatus("generating");
    setErrorMessage("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1000);

    try {
      const response = await fetch(`${baseUrl}/v1/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || `生成失败（${response.status}）`);
      }
      const generationResult = body as GenerationResult;
      setResult(generationResult);
      if (generationResult.prompt_used && generationResult.prompt_diagnostics) {
        setInspection({
          prompt: generationResult.prompt_used,
          negative_prompt: effectiveNegativePrompt,
          diagnostics: generationResult.prompt_diagnostics,
          sourcePrompt: compiled.prompt,
          sourceNegativePrompt: effectiveNegativePrompt,
          sourceGatewayUrl: normalizeApiUrl(gatewayUrl),
        });
        setInspectionStatus("ready");
      }
      setSeed(body.seed);
      setStatus("ready");
      setConnection("connected");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.name === "AbortError"
            ? "生成超时，请检查服务器负载"
            : error.message
          : "生成请求失败",
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function downloadResult() {
    if (!result) return;
    const link = document.createElement("a");
    link.href = `data:${result.mime_type};base64,${result.image_base64}`;
    link.download = `muse-${result.seed}.png`;
    link.click();
  }

  function applySizePreset(preset: (typeof SIZE_PRESETS)[number]) {
    setWidth(preset.width);
    setHeight(preset.height);
    if (preset.width !== preset.height) {
      setSelections((current) => {
        if (!current.format) return current;
        const next = { ...current };
        delete next.format;
        setSelectionNotice(
          "已移除头像裁剪适配：当前画布不是正方形。",
        );
        return next;
      });
    }
    setStatus("idle");
  }

  function updateCanvasDimension(
    nextWidth: number,
    nextHeight: number,
  ) {
    setWidth(nextWidth);
    setHeight(nextHeight);
    if (nextWidth !== nextHeight) {
      setSelections((current) => {
        if (!current.format) return current;
        const next = { ...current };
        delete next.format;
        setSelectionNotice(
          "已移除头像裁剪适配：当前画布不是正方形。",
        );
        return next;
      });
    }
    setStatus("idle");
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#parameters" aria-label="MUSE 创作台">
          <span className="brand-mark">M</span>
          <span>
            <strong>MUSE</strong>
            <small>ANIME PROMPT STUDIO</small>
          </span>
        </a>

        <div className="topbar-actions">
          <a
            className={`api-status api-${connection}`}
            href="#server"
            title={connectionMessage}
          >
            <i aria-hidden="true" />
            {connectionLabel(connection)}
          </a>
          <a className="ghost-link" href="#parameters">
            参数配置
          </a>
          <a className="primary-link" href="#prompt">
            开始创作
          </a>
        </div>
      </header>

      <section className="workspace" id="parameters">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PARAMETER MATRIX / 02</p>
            <h2>定义你的画面</h2>
          </div>
          <p>
            中文选项会映射为动漫模型标签。
            <br />
            自定义描述推荐使用英文或 Danbooru 标签。
          </p>
        </div>

        <div className="workspace-grid">
          <div className="parameter-list">
            {PARAMETER_GROUPS.map((group, groupIndex) => (
              <details
                className="parameter-group"
                key={group.id}
                open={groupIndex < 2}
              >
                <summary>
                  <span className="group-index">{group.index}</span>
                  <span className="group-title">
                    <strong>{group.title}</strong>
                    <small>{group.description}</small>
                  </span>
                  <span className="summary-icon" aria-hidden="true">
                    +
                  </span>
                </summary>

                <div className="group-fields">
                  {group.fields.map((field) => (
                    <label className="select-field" key={field.id}>
                      <span>{field.label}</span>
                      <span className="select-wrap">
                        <select
                          aria-label={field.label}
                          value={selections[field.id] ?? ""}
                          onChange={(event) =>
                            updateSelection(field.id, event.target.value)
                          }
                        >
                          <option value="">暂不设置</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <i aria-hidden="true">↓</i>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            ))}
          </div>

          <aside className="creation-console" id="prompt">
            <div className="console-topline">
              <span>MODEL RUNTIME</span>
              <span>LOCAL / CLOUD · V2</span>
            </div>

            <details
              className="server-panel"
              id="server"
              open={connection !== "connected"}
            >
              <summary>
                <span>
                  <i className={`connection-dot dot-${connection}`} />
                  模型运行环境
                </span>
                <small>{connectionLabel(connection)}</small>
              </summary>
              <RuntimePanel
                gatewayUrl={gatewayUrl}
                connection={connection}
                connectionMessage={connectionMessage}
                onGatewayUrlChange={(value) => {
                  setGatewayUrl(value);
                  setInspectionStatus("idle");
                  setInspectionError("");
                }}
                onConnectionChange={(nextStatus, message) => {
                  setConnection(nextStatus);
                  setConnectionMessage(message);
                  if (nextStatus !== "connected") {
                    setInspection(null);
                    setInspectionStatus("idle");
                    setInspectionError("");
                  }
                }}
              />
            </details>

            <div className={`preview-stage preview-${status}`}>
              {!result && (
                <>
                  <div className="preview-noise" />
                  <div className="preview-shape shape-a" />
                  <div className="preview-shape shape-b" />
                  <div className="preview-shape shape-c" />
                </>
              )}

              {result && (
                // The image is returned by the user's own generation server.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="generated-image"
                  src={`data:${result.mime_type};base64,${result.image_base64}`}
                  alt={`生成结果，种子 ${result.seed}`}
                />
              )}

              {status === "generating" && (
                <div className="preview-message" role="status">
                  <span className="loader" />
                  <strong>GPU 正在绘制</strong>
                  <span>首次生成可能需要等待模型加载</span>
                </div>
              )}

              {status === "error" && (
                <div className="preview-message preview-error" role="alert">
                  <strong>生成没有完成</strong>
                  <span>{errorMessage}</span>
                </div>
              )}

              {status === "idle" && !result && (
                <div className="preview-caption">
                  <span>CANVAS PREVIEW</span>
                  <small>
                    {width} × {height}
                  </small>
                </div>
              )}

              {result && status === "ready" && (
                <div className="result-meta">
                  <span>SEED {result.seed}</span>
                  <span>{(result.duration_ms / 1000).toFixed(1)}S</span>
                </div>
              )}
            </div>

            {result && status === "ready" && (
              <button
                className="download-button"
                type="button"
                onClick={downloadResult}
              >
                下载原始 PNG
                <span aria-hidden="true">↓</span>
              </button>
            )}

            <div className="selection-summary">
              <div className="summary-heading">
                <span>已选参数</span>
                <button type="button" onClick={resetForm}>
                  重置
                </button>
              </div>
              <div className="selection-tags">
                {selectedEntries.length ? (
                  selectedEntries.map(([fieldId, value]) => (
                    <button
                      type="button"
                      key={fieldId}
                      onClick={() => removeSelection(fieldId)}
                      title={`移除${FIELD_LABELS[fieldId] ?? "参数"}`}
                    >
                      {value}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))
                ) : (
                  <p>还没有选择参数</p>
                )}
              </div>
              {selectionNotice && (
                <p className="selection-notice" role="status">
                  {selectionNotice}
                </p>
              )}
            </div>

            <div className="prompt-box">
              <div className="prompt-heading">
                <label htmlFor="prompt-input">模型提示词</label>
                <span
                  className={`token-meter token-${visibleInspectionStatus}`}
                  data-testid="token-meter"
                  title={
                    effectiveDiagnostics
                      ? `正向分词器 1：${effectiveDiagnostics.token_usage.tokenizer_1}；正向分词器 2：${effectiveDiagnostics.token_usage.tokenizer_2}${
                          effectiveDiagnostics.negative_token_usage
                            ? `；负向分词器 1：${effectiveDiagnostics.negative_token_usage.tokenizer_1}；负向分词器 2：${effectiveDiagnostics.negative_token_usage.tokenizer_2}`
                            : ""
                        }`
                      : inspectionError
                  }
                >
                  {visibleInspectionStatus === "checking"
                    ? "TOKEN 计算中"
                    : visibleInspectionStatus === "ready" &&
                        tokenCount !== null &&
                        effectiveDiagnostics
                      ? negativeTokenCount !== null
                        ? `正 ${tokenCount} · 负 ${negativeTokenCount} / ${effectiveDiagnostics.token_usage.limit}`
                        : `${tokenCount} / ${effectiveDiagnostics.token_usage.limit} TOKENS`
                      : visibleInspectionStatus === "error"
                        ? "TOKEN 检查失败"
                        : "连接 GPU 后计算 TOKENS"}
                </span>
              </div>
              <textarea
                id="prompt-input"
                maxLength={1000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setStatus("idle");
                }}
                placeholder="1girl, silver hair, looking at viewer, rainy night…"
              />

              <details className="advanced-settings" open>
                <summary>高级生成参数</summary>
                <div className="size-presets">
                  {SIZE_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.label}
                      className={
                        width === preset.width && height === preset.height
                          ? "active"
                          : ""
                      }
                      onClick={() => applySizePreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="advanced-grid">
                  <label>
                    <span>宽度</span>
                    <input
                      type="number"
                      min={512}
                      max={1536}
                      step={64}
                      value={width}
                      onChange={(event) =>
                        updateCanvasDimension(
                          Number(event.target.value),
                          height,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>高度</span>
                    <input
                      type="number"
                      min={512}
                      max={1536}
                      step={64}
                      value={height}
                      onChange={(event) =>
                        updateCanvasDimension(
                          width,
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>采样步数</span>
                    <input
                      type="number"
                      min={10}
                      max={60}
                      value={steps}
                      onChange={(event) => setSteps(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>CFG</span>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      step={0.5}
                      value={guidanceScale}
                      onChange={(event) =>
                        setGuidanceScale(Number(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    <span>随机种子（-1 随机）</span>
                    <input
                      type="number"
                      min={-1}
                      max={4294967295}
                      value={seed}
                      onChange={(event) => setSeed(Number(event.target.value))}
                    />
                  </label>
                  <label>
                    <span>Clip Skip</span>
                    <select
                      value={clipSkip}
                      onChange={(event) =>
                        setClipSkip(Number(event.target.value))
                      }
                    >
                      <option value={1}>1</option>
                      <option value={2}>2（推荐）</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </label>
                  <label className="wide-control">
                    <span>采样器</span>
                    <select
                      value={sampler}
                      onChange={(event) => setSampler(event.target.value)}
                    >
                      {SAMPLERS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wide-control">
                    <span>质量约束</span>
                    <select
                      value={qualityGuard}
                      onChange={(event) => {
                        setQualityGuard(event.target.value);
                        setStatus("idle");
                      }}
                    >
                      <option value="">暂不设置</option>
                      {QUALITY_GUARD_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>

              <details className="negative-settings">
                <summary>负面提示词</summary>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => {
                    setNegativePrompt(event.target.value);
                    setStatus("idle");
                  }}
                  aria-label="负面提示词"
                />
                {compiled.negativeAdditions.length > 0 && (
                  <p className="negative-additions">
                    已按当前选择自动补充：
                    {compiled.negativeAdditions.join(", ")}
                  </p>
                )}
              </details>

              <div className="compiled-prompt">
                <span>COMPILED MODEL PROMPT</span>
                <p>
                  {effectivePrompt ||
                    "选择参数或输入描述后，将在这里组合提示词。"}
                </p>
              </div>
              {(compiled.warnings.length > 0 ||
                effectiveDiagnostics?.warnings.length ||
                inspectionError) && (
                <div className="prompt-diagnostics" role="status">
                  {[...compiled.warnings, ...(effectiveDiagnostics?.warnings ?? [])]
                    .filter(
                      (warning, index, items) =>
                        items.indexOf(warning) === index,
                    )
                    .map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  {inspectionError && <p>{inspectionError}</p>}
                </div>
              )}
              {effectiveDiagnostics &&
                effectiveDiagnostics.omitted_segments.length > 0 && (
                  <div className="omitted-tags">
                    <strong>为满足 token 上限，本次自动省略</strong>
                    <span>
                      {effectiveDiagnostics.omitted_segments
                        .map((segment) => segment.label)
                        .join("、")}
                    </span>
                  </div>
                )}
              <div className="prompt-actions">
                <button
                  className="copy-button"
                  type="button"
                  disabled={!effectivePrompt}
                  onClick={copyPrompt}
                >
                  {copied ? "已复制" : "复制提示词"}
                </button>
                <button
                  className="generate-button"
                  type="button"
                  disabled={
                    !compiled.prompt ||
                    status === "generating" ||
                    visibleInspectionStatus === "checking" ||
                    visibleInspectionStatus === "error"
                  }
                  onClick={handleGenerate}
                >
                  <span>{status === "generating" ? "生成中" : "调用 GPU 生成"}</span>
                  <i aria-hidden="true">↗</i>
                </button>
              </div>
            </div>

            <details className="payload-preview">
              <summary>查看服务器请求载荷</summary>
              <pre>{JSON.stringify(payload, null, 2)}</pre>
            </details>

            <p className="license-note">
              运行方式：本地模型进程或 SSH 云端工作节点
              <br />
              每个模型的许可证不同，商用前仍需单独核对模型与素材权利。
            </p>
          </aside>
        </div>
      </section>

      <footer>
        <span>MUSE / ANIME PROMPT STUDIO</span>
        <span>LOCAL GATEWAY · HYBRID GPU · 2026</span>
      </footer>
    </main>
  );
}
