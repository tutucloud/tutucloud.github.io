// POST /api/ai/chat 的处理函数（由 src/index.js 路由调用）。
// 代理调用 Workers AI（免费额度，前端无需配置密钥）。
// 请求：{ messages: [{ role, content }...], max_tokens? }
// 响应：{ ok: true, text } 或 { ok: false, error }
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
// 允许前端按工具指定模型（白名单），默认小 Llama；中文任务建议用 Qwen 系
const MODEL_ALLOW = new Set([
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
]);

export async function handleChat(request, env) {
  if (!env.AI) {
    return Response.json(
      { ok: false, error: "Workers AI binding (AI) is not enabled. Add \"ai\": { \"binding\": \"AI\" } to wrangler.jsonc." },
      { status: 500 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (!messages || !messages.length || messages.length > 20) {
    return Response.json({ ok: false, error: "messages required (max 20)" }, { status: 400 });
  }
  // 总输入长度上限，防滥用
  const totalLen = messages.reduce((n, m) => n + String(m.content || "").length, 0);
  if (totalLen > 20000) {
    return Response.json({ ok: false, error: "input too long" }, { status: 413 });
  }

  try {
    const model = typeof body.model === "string" && MODEL_ALLOW.has(body.model)
      ? body.model : MODEL;
    const result = await env.AI.run(model, {
      messages,
      max_tokens: typeof body.max_tokens === "number" ? Math.min(body.max_tokens, 2048) : 1024,
    });
    const text = typeof result === "string" ? result : result.response;
    if (typeof text !== "string") {
      return Response.json({ ok: false, error: "empty model response" }, { status: 502 });
    }
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
