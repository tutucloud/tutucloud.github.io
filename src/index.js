// Workers 入口：静态资源之外的请求在这里路由。
// 静态文件由 wrangler.jsonc 的 assets.directory（./public）自动服务，
// 命中静态资源的请求不会进入本脚本；/api/* 交由对应处理函数。
import { handleChat } from "./api/ai/chat.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ai/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
