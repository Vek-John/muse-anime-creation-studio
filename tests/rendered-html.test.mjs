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
  assert.match(html, /把灵感/);
  assert.match(html, /风格定位类/);
  assert.match(html, /核心形象类/);
  assert.match(html, /描述你想生成的画面/);
  assert.match(html, /查看后端请求载荷/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
