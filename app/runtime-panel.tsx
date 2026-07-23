"use client";

import { useState } from "react";

export type ConnectionStatus =
  | "unchecked"
  | "checking"
  | "starting"
  | "connected"
  | "error";

type RuntimeMode = "local" | "cloud";
type SshAuthMethod = "password" | "private_key";

type DirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "model_file";
};

type DirectoryListing = {
  current: string;
  parent: string | null;
  entries: DirectoryEntry[];
};

type RuntimePanelProps = {
  gatewayUrl: string;
  connection: ConnectionStatus;
  connectionMessage: string;
  onGatewayUrlChange: (value: string) => void;
  onConnectionChange: (
    status: ConnectionStatus,
    message: string,
  ) => void;
};

function normalizeGatewayUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function RuntimePanel({
  gatewayUrl,
  connection,
  connectionMessage,
  onGatewayUrlChange,
  onConnectionChange,
}: RuntimePanelProps) {
  const [mode, setMode] = useState<RuntimeMode>("local");
  const [modelPath, setModelPath] = useState("");
  const [lowVram, setLowVram] = useState(false);
  const [torchDtype, setTorchDtype] = useState<"float16" | "bfloat16">(
    "float16",
  );

  const [sshCommand, setSshCommand] = useState("");
  const [sshAuthMethod, setSshAuthMethod] =
    useState<SshAuthMethod>("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState("");
  const [sshPrivateKeyPassphrase, setSshPrivateKeyPassphrase] = useState("");
  const [remoteApiKey, setRemoteApiKey] = useState("");
  const [remotePort, setRemotePort] = useState(6006);

  const [browserOpen, setBrowserOpen] = useState(false);
  const [directory, setDirectory] = useState<DirectoryListing | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");

  function markChanged() {
    onConnectionChange("unchecked", "配置有变化，请重新连接");
  }

  async function checkConnection() {
    const baseUrl = normalizeGatewayUrl(gatewayUrl);
    if (!baseUrl) {
      onConnectionChange("error", "请填写本机 Gateway 地址");
      return;
    }

    onConnectionChange("checking", "正在检查运行环境");
    try {
      const response = await fetch(`${baseUrl}/v1/status`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || `Gateway 返回 ${response.status}`);
      }
      if (body.model_loaded) {
        onConnectionChange(
          "connected",
          `${body.runtime?.mode === "local" ? "本地" : "云端"} · ${body.model} · ${body.device}`,
        );
      } else {
        onConnectionChange(
          "starting",
          `${body.model || "模型"}正在加载，可稍后检查状态`,
        );
      }
    } catch (error) {
      onConnectionChange(
        "error",
        error instanceof Error ? error.message : "无法连接本机 Gateway",
      );
    }
  }

  async function configureRuntime() {
    const baseUrl = normalizeGatewayUrl(gatewayUrl);
    if (!baseUrl) {
      onConnectionChange("error", "请填写本机 Gateway 地址");
      return;
    }
    if (mode === "local" && !modelPath.trim()) {
      onConnectionChange("error", "请选择本地模型目录或模型文件");
      return;
    }
    if (
      mode === "cloud" &&
      (!sshCommand.trim() ||
        !remoteApiKey ||
        (sshAuthMethod === "password" && !sshPassword) ||
        (sshAuthMethod === "private_key" && !sshPrivateKeyPath.trim()))
    ) {
      onConnectionChange("error", "请完整填写 SSH 与远端服务信息");
      return;
    }

    onConnectionChange(
      "checking",
      mode === "local" ? "正在启动本地模型" : "正在建立 SSH 隧道",
    );
    const payload =
      mode === "local"
        ? {
            mode: "local",
            model_path: modelPath.trim(),
            torch_dtype: torchDtype,
            low_vram: lowVram,
          }
        : {
            mode: "cloud",
            ssh_command: sshCommand.trim(),
            auth_method: sshAuthMethod,
            ssh_password: sshPassword,
            ssh_private_key_path: sshPrivateKeyPath.trim(),
            ssh_private_key_passphrase: sshPrivateKeyPassphrase,
            remote_api_key: remoteApiKey,
            remote_port: remotePort,
          };

    try {
      const response = await fetch(`${baseUrl}/v1/runtime/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || `配置失败（${response.status}）`);
      }

      if (mode === "cloud") {
        setSshPassword("");
        setSshPrivateKeyPassphrase("");
        setRemoteApiKey("");
      }
      await checkConnection();
    } catch (error) {
      onConnectionChange(
        "error",
        error instanceof Error ? error.message : "运行环境配置失败",
      );
    }
  }

  async function browseDirectory(path?: string) {
    const baseUrl = normalizeGatewayUrl(gatewayUrl);
    if (!baseUrl) {
      onConnectionChange("error", "请先填写本机 Gateway 地址");
      return;
    }

    setBrowserOpen(true);
    setBrowserLoading(true);
    setBrowserError("");
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(
        `${baseUrl}/v1/runtime/directories${query}`,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail || `目录读取失败（${response.status}）`);
      }
      setDirectory(body as DirectoryListing);
    } catch (error) {
      setBrowserError(
        error instanceof Error ? error.message : "无法读取本机目录",
      );
    } finally {
      setBrowserLoading(false);
    }
  }

  function selectModelPath(path: string) {
    setModelPath(path);
    setBrowserOpen(false);
    markChanged();
  }

  return (
    <div className="server-fields">
      <div className="gateway-note">
        <strong>本机 Runtime Gateway</strong>
        <span>浏览器只连接 127.0.0.1，负责切换本地或云端 GPU。</span>
      </div>

      <label>
        <span>Gateway 地址</span>
        <input
          type="url"
          value={gatewayUrl}
          onChange={(event) => {
            onGatewayUrlChange(event.target.value);
            markChanged();
          }}
          placeholder="http://127.0.0.1:8000"
          spellCheck={false}
        />
      </label>

      <div className="runtime-mode-switch" aria-label="模型运行方式">
        <button
          className={mode === "local" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("local");
            markChanged();
          }}
        >
          <strong>本地 GPU</strong>
          <span>选择本机模型路径</span>
        </button>
        <button
          className={mode === "cloud" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("cloud");
            markChanged();
          }}
        >
          <strong>云端 GPU</strong>
          <span>通过 SSH 隧道连接</span>
        </button>
      </div>

      {mode === "local" ? (
        <div className="runtime-config-block">
          <label>
            <span>本地模型路径</span>
            <div className="path-input-row">
              <input
                type="text"
                value={modelPath}
                onChange={(event) => {
                  setModelPath(event.target.value);
                  markChanged();
                }}
                placeholder="/models/animagine-xl-4.0"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => browseDirectory(modelPath || undefined)}
              >
                选择
              </button>
            </div>
          </label>

          {browserOpen && (
            <div className="path-browser">
              <div className="path-browser-head">
                <strong>选择模型路径</strong>
                <button type="button" onClick={() => setBrowserOpen(false)}>
                  关闭
                </button>
              </div>
              {directory && (
                <code title={directory.current}>{directory.current}</code>
              )}
              <div className="path-browser-list">
                {directory?.parent && (
                  <button
                    type="button"
                    onClick={() => browseDirectory(directory.parent || undefined)}
                  >
                    <span>↑</span>
                    <strong>上一级</strong>
                  </button>
                )}
                {directory?.entries.map((entry) =>
                  entry.kind === "directory" ? (
                    <div className="path-entry" key={entry.path}>
                      <button
                        type="button"
                        onClick={() => browseDirectory(entry.path)}
                        title={entry.path}
                      >
                        <span>DIR</span>
                        <strong>{entry.name}</strong>
                      </button>
                      <button
                        type="button"
                        onClick={() => selectModelPath(entry.path)}
                      >
                        选用
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      key={entry.path}
                      onClick={() => selectModelPath(entry.path)}
                      title={entry.path}
                    >
                      <span>MODEL</span>
                      <strong>{entry.name}</strong>
                    </button>
                  ),
                )}
              </div>
              {directory && (
                <button
                  className="use-current-path"
                  type="button"
                  onClick={() => selectModelPath(directory.current)}
                >
                  选用当前目录
                </button>
              )}
              {browserLoading && <p>正在读取目录…</p>}
              {browserError && <p className="field-error">{browserError}</p>}
            </div>
          )}

          <div className="runtime-inline-fields">
            <label>
              <span>精度</span>
              <select
                value={torchDtype}
                onChange={(event) => {
                  setTorchDtype(
                    event.target.value as "float16" | "bfloat16",
                  );
                  markChanged();
                }}
              >
                <option value="float16">FP16</option>
                <option value="bfloat16">BF16</option>
              </select>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={lowVram}
                onChange={(event) => {
                  setLowVram(event.target.checked);
                  markChanged();
                }}
              />
              <span>低显存模式</span>
            </label>
          </div>
        </div>
      ) : (
        <div className="runtime-config-block">
          <label>
            <span>SSH 地址</span>
            <input
              type="text"
              value={sshCommand}
              onChange={(event) => {
                setSshCommand(event.target.value);
                markChanged();
              }}
              placeholder="ssh -p 47740 root@gpu.example.com"
              spellCheck={false}
            />
          </label>
          <div className="runtime-inline-fields">
            <label>
              <span>SSH 认证</span>
              <select
                value={sshAuthMethod}
                onChange={(event) => {
                  setSshAuthMethod(event.target.value as SshAuthMethod);
                  markChanged();
                }}
              >
                <option value="password">密码</option>
                <option value="private_key">私钥路径</option>
              </select>
            </label>
            <label>
              <span>远端服务端口</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={remotePort}
                onChange={(event) => {
                  setRemotePort(Number(event.target.value));
                  markChanged();
                }}
              />
            </label>
          </div>

          {sshAuthMethod === "password" ? (
            <label>
              <span>SSH 密码</span>
              <input
                type="password"
                value={sshPassword}
                onChange={(event) => {
                  setSshPassword(event.target.value);
                  markChanged();
                }}
                placeholder="仅发送到本机 Gateway"
                autoComplete="off"
              />
            </label>
          ) : (
            <>
              <label>
                <span>SSH 私钥路径</span>
                <input
                  type="text"
                  value={sshPrivateKeyPath}
                  onChange={(event) => {
                    setSshPrivateKeyPath(event.target.value);
                    markChanged();
                  }}
                  placeholder="~/.ssh/id_ed25519"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>私钥口令（可选）</span>
                <input
                  type="password"
                  value={sshPrivateKeyPassphrase}
                  onChange={(event) => {
                    setSshPrivateKeyPassphrase(event.target.value);
                    markChanged();
                  }}
                  placeholder="仅发送到本机 Gateway"
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <label>
            <span>远端模型 API 密钥</span>
            <input
              type="password"
              value={remoteApiKey}
              onChange={(event) => {
                setRemoteApiKey(event.target.value);
                markChanged();
              }}
              placeholder="通过 SSH 隧道使用，连接后自动清空"
              autoComplete="off"
            />
          </label>
        </div>
      )}

      <div className="runtime-actions">
        <button
          className="configure-runtime-button"
          type="button"
          disabled={connection === "checking"}
          onClick={configureRuntime}
        >
          {connection === "checking"
            ? "连接中…"
            : mode === "local"
              ? "启动本地模型"
              : "建立 SSH 隧道"}
        </button>
        <button
          type="button"
          disabled={connection === "checking"}
          onClick={checkConnection}
        >
          检查状态
        </button>
      </div>
      <p className={`runtime-message message-${connection}`}>
        {connectionMessage}
      </p>
    </div>
  );
}
