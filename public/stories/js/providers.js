// Preset LLM providers. All listed providers expose OpenAI-compatible
// /chat/completions endpoints (incl. Anthropic & Gemini compatibility modes),
// so a single request path covers everything.
export const PROVIDERS = [
  { id: 'openai',      name: 'OpenAI',            baseUrl: 'https://api.openai.com/v1',                              model: 'gpt-4o-mini' },
  { id: 'anthropic',   name: 'Anthropic Claude',  baseUrl: 'https://api.anthropic.com/v1',                           model: 'claude-sonnet-4-20250514' },
  { id: 'gemini',      name: 'Google Gemini',     baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { id: 'deepseek',    name: 'DeepSeek 深度求索',  baseUrl: 'https://api.deepseek.com/v1',                            model: 'deepseek-chat' },
  { id: 'moonshot',    name: 'Moonshot Kimi 月之暗面', baseUrl: 'https://api.moonshot.cn/v1',                         model: 'moonshot-v1-8k' },
  { id: 'zhipu',       name: 'Zhipu GLM 智谱',     baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                   model: 'glm-4-flash' },
  { id: 'qwen',        name: 'Alibaba Qwen 通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',   model: 'qwen-plus' },
  { id: 'minimax',     name: 'MiniMax',           baseUrl: 'https://api.minimax.chat/v1',                            model: 'abab6.5s-chat' },
  { id: 'siliconflow', name: 'SiliconFlow 硅基流动', baseUrl: 'https://api.siliconflow.cn/v1',                        model: 'deepseek-ai/DeepSeek-V3' },
  { id: 'yi',          name: '01.AI 零一万物',     baseUrl: 'https://api.lingyiwanwu.com/v1',                         model: 'yi-large' },
  { id: 'openrouter',  name: 'OpenRouter',        baseUrl: 'https://openrouter.ai/api/v1',                           model: 'openai/gpt-4o-mini' },
  { id: 'groq',        name: 'Groq',              baseUrl: 'https://api.groq.com/openai/v1',                         model: 'llama-3.3-70b-versatile' },
  { id: 'mistral',     name: 'Mistral',           baseUrl: 'https://api.mistral.ai/v1',                              model: 'mistral-large-latest' },
  { id: 'ollama',      name: 'Ollama (Local 本地)', baseUrl: 'http://localhost:11434/v1',                            model: 'llama3' },
];
