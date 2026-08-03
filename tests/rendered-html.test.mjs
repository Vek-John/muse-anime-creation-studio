import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the anime prompt studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MUSE — 二次元文生图创作台<\/title>/i);
  assert.doesNotMatch(html, /把灵感|调成画面/);
  assert.match(html, /定义你的画面/);
  assert.match(html, /风格定位类/);
  assert.match(html, /核心形象类/);
  assert.match(html, /模型提示词/);
  assert.match(html, /模型运行环境/);
  assert.match(html, /本地 GPU/);
  assert.match(html, /云端 GPU/);
  assert.match(html, /高级生成参数/);
  assert.match(html, /连接 GPU 后计算 TOKENS/);
  assert.match(html, /solo, safe, masterpiece/);
  assert.doesNotMatch(
    html,
    /1girl, solo, looking back at viewer, gentle smile/,
  );
  assert.doesNotMatch(html, /质量约束/);
  assert.doesNotMatch(html, /技术优化类/);
  assert.match(html, /查看服务器请求载荷/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
