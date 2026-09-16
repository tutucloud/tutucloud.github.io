# Tu-X — 单页站点 / Single-page site

纯静态单页应用：项目展示 + 浏览器端小工具。零依赖、免构建，直接部署任意静态目录即可。

## 使用

用任何静态服务器指向本目录即可，例如：

```bash
python -m http.server 8080
# 或
npx serve .
```

## 特性

- **零依赖**：不使用任何第三方库，无需 CDN，流量消耗极小。
- **国际化**：中/英双语，语言保存在 localStorage，可切换；文案集中在 `assets/i18n.js`。
- **深浅色主题**：自动跟随按钮切换并持久化，全部基于 CSS 变量。
- **子路径友好**：所有资源使用相对路径（`./assets/...`），可挂载在任意 URL 子路径下。
- **响应式**：桌面 / 平板 / 手机自适应，移动端有折叠导航。

## 目录结构

```
index.html          页面结构
assets/style.css    全部样式（设计令牌在 :root）
assets/i18n.js      多语言文案
assets/data.js      项目数据（卡片列表）
assets/app.js       交互逻辑（i18n、主题、工具）
```

## 修改内容

- **添加/修改项目**：编辑 `assets/data.js`，每条记录支持按语言的字段 `{ "zh-CN": ..., "en": ... }` 或直接给字符串。
- **添加语言**：在 `assets/i18n.js` 中增加一个键，并把它加入 `app.js` 顶部的 `LANGS` 数组。
- **调整配色**：修改 `assets/style.css` 中 `:root` 与 `[data-theme="dark"]` 的 CSS 变量。

## 以后接入后端

`assets/data.js` 中的 `window.PROJECTS` 是唯一数据源。接后端时只需把它替换为一次 API 请求（返回同构的数组），渲染逻辑无需改动。

## 内置工具

- JSON 格式化 / 压缩
- Base64 编码 / 解码（Unicode 安全）
- SHA-1 / SHA-256 / SHA-512 哈希（点击结果可复制）

全部在浏览器本地运行，数据不出设备。
