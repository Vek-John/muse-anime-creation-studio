"use client";

import { useMemo, useState } from "react";
import { DEFAULT_SELECTIONS, PARAMETER_GROUPS } from "./studio-config";

const FIELD_LABELS = Object.fromEntries(
  PARAMETER_GROUPS.flatMap((group) =>
    group.fields.map((field) => [field.id, field.label]),
  ),
);

type GenerationStatus = "idle" | "generating" | "ready";

export default function Home() {
  const [selections, setSelections] =
    useState<Record<string, string>>(DEFAULT_SELECTIONS);
  const [description, setDescription] = useState(
    "一个在樱花树下回头微笑的动漫少女，柔和逆光，画面干净通透",
  );
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [copied, setCopied] = useState(false);

  const selectedEntries = useMemo(
    () => Object.entries(selections).filter(([, value]) => Boolean(value)),
    [selections],
  );

  const combinedPrompt = useMemo(() => {
    const parameterText = selectedEntries.map(([, value]) => value).join("，");
    return [description.trim(), parameterText].filter(Boolean).join("，");
  }, [description, selectedEntries]);

  const payload = useMemo(
    () => ({
      prompt: description.trim(),
      parameters: selections,
      compiledPrompt: combinedPrompt,
    }),
    [combinedPrompt, description, selections],
  );

  function updateSelection(fieldId: string, value: string) {
    setSelections((current) => ({
      ...current,
      [fieldId]: value,
    }));
    setStatus("idle");
  }

  function removeSelection(fieldId: string) {
    setSelections((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setStatus("idle");
  }

  function resetForm() {
    setSelections(DEFAULT_SELECTIONS);
    setDescription("");
    setStatus("idle");
  }

  async function copyPrompt() {
    if (!combinedPrompt) return;
    await navigator.clipboard.writeText(combinedPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function handleGenerate() {
    if (!combinedPrompt || status === "generating") return;
    setStatus("generating");
    window.setTimeout(() => setStatus("ready"), 1100);
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MUSE 首页">
          <span className="brand-mark">M</span>
          <span>
            <strong>MUSE</strong>
            <small>ANIME PROMPT STUDIO</small>
          </span>
        </a>

        <div className="topbar-actions">
          <span className="api-status">
            <i aria-hidden="true" />
            API 待接入
          </span>
          <a className="ghost-link" href="#parameters">
            参数配置
          </a>
          <a className="primary-link" href="#prompt">
            开始创作
          </a>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">GENERATION CONSOLE / 01</p>
          <h1>
            把灵感，
            <br />
            <em>调成画面。</em>
          </h1>
          <p className="hero-description">
            面向二次元创作的文生图参数工作台。组合角色、场景与情绪，
            一键整理成可供 Diffusion 模型使用的结构化提示词。
          </p>
          <div className="hero-meta">
            <span>08 参数域</span>
            <span>22 控制项</span>
            <span>结构化载荷</span>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <span className="visual-label">PROMPT / VISUAL LANGUAGE</span>
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="orb orb-three" />
          <div className="grid-lines" />
          <span className="visual-coordinates">31°14&apos;N / 121°29&apos;E</span>
          <span className="visual-index">01</span>
        </div>
      </section>

      <section className="workspace" id="parameters">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PARAMETER MATRIX / 02</p>
            <h2>定义你的画面</h2>
          </div>
          <p>
            大类负责方向，小类负责精度。
            <br />
            每个字段都已预留后端映射键。
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
              <span>TEXT TO IMAGE</span>
              <span>V0.1 / FRAMEWORK</span>
            </div>

            <div className={`preview-stage preview-${status}`}>
              <div className="preview-noise" />
              <div className="preview-shape shape-a" />
              <div className="preview-shape shape-b" />
              <div className="preview-shape shape-c" />

              {status === "generating" && (
                <div className="preview-message" role="status">
                  <span className="loader" />
                  正在整理生成请求
                </div>
              )}

              {status === "ready" && (
                <div className="preview-message" role="status">
                  <strong>接口位置已预留</strong>
                  <span>下一步将此请求载荷发送给后端模型服务</span>
                </div>
              )}

              {status === "idle" && (
                <div className="preview-caption">
                  <span>CANVAS PREVIEW</span>
                  <small>1:1 / 1024 × 1024</small>
                </div>
              )}
            </div>

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
            </div>

            <div className="prompt-box">
              <div className="prompt-heading">
                <label htmlFor="prompt-input">描述你想生成的画面</label>
                <span>{description.length} / 500</span>
              </div>
              <textarea
                id="prompt-input"
                maxLength={500}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setStatus("idle");
                }}
                placeholder="例如：雨夜公交站里，一个戴着耳机的银发少年望向窗外……"
              />
              <div className="compiled-prompt">
                <span>COMPILED PROMPT</span>
                <p>{combinedPrompt || "选择参数或输入描述后，将在这里组合提示词。"}</p>
              </div>
              <div className="prompt-actions">
                <button
                  className="copy-button"
                  type="button"
                  disabled={!combinedPrompt}
                  onClick={copyPrompt}
                >
                  {copied ? "已复制" : "复制提示词"}
                </button>
                <button
                  className="generate-button"
                  type="button"
                  disabled={!combinedPrompt || status === "generating"}
                  onClick={handleGenerate}
                >
                  <span>{status === "generating" ? "整理中" : "生成画面"}</span>
                  <i aria-hidden="true">↗</i>
                </button>
              </div>
            </div>

            <details className="payload-preview">
              <summary>查看后端请求载荷</summary>
              <pre>{JSON.stringify(payload, null, 2)}</pre>
            </details>
          </aside>
        </div>
      </section>

      <footer>
        <span>MUSE / ANIME PROMPT STUDIO</span>
        <span>FRONTEND FRAMEWORK · 2026</span>
      </footer>
    </main>
  );
}
