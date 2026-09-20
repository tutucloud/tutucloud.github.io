// i18n: en / zh / ja, auto-detect with English fallback.
export const LANGS = ['en', 'zh', 'ja'];

const dict = {
  en: {
    language: 'Language',
    newScenario: 'New Scenario',
    settings: 'Settings',
    emptyTitle: 'No story yet',
    emptyHint: 'Create a scenario, set up your AI model, and start role-playing.',
    editScenario: 'Edit',
    clearChat: 'Restart',
    deleteScenario: 'Delete',
    inputPlaceholder: 'Speech as your character; a line starting with * is an action. Send empty to stay silent.',
    send: 'Send',
    scenarioName: 'Scenario name',
    worldSetting: 'World / background',
    yourCharacter: 'Your character name',
    yourPersona: 'Your character persona (how others see you)',
    dmInstructions: 'Instructions for the DM (pacing, style…)',
    openingBtn: '🎬 Let the DM open the scene',
    dmThinking: 'The DM is weaving the story…',
    openingPrompt: '(OOC: the player has just entered the story. As DM, open the scene: set it with narrate, let characters enter via speak, and end by giving the player something to respond to.)',
    passTurnPrompt: '(OOC: the player stays silent and does nothing. Continue the scene as DM: let the characters act and talk on their own.)',
    npcList: 'AI characters (NPCs)',
    npcName: 'Name',
    npcPersona: 'Persona (personality, goal, speech style…)',
    addNpc: '+ Add character',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    provider: 'Provider',
    baseUrl: 'API base URL',
    model: 'Model',
    apiKey: 'API key',
    apiKeyHint: 'The key is stored only in your browser (localStorage). For better security use llm-bridge, which stores the key in the extension.',
    saveToBridge: 'Save to llm-bridge extension',
    testConnection: 'Test connection',
    testOk: 'Connection OK. Model responded.',
    testFail: 'Connection failed: ',
    corsTitle: 'CORS problem detected',
    corsBody: 'The provider\'s API blocks direct browser requests. Install the llm-bridge extension and the app will send requests through it automatically.',
    corsStep1: 'Open the folder D:\\workspace\\llm-bridge',
    corsStep2: 'Chrome → chrome://extensions/ → enable Developer mode',
    corsStep3: '"Load unpacked" and select that folder',
    corsStep4: 'Back in Settings, click "Save to llm-bridge extension"',
    retry: 'Retry via extension',
    confirmDelete: 'Delete this scenario and its chat history?',
    confirmRestart: 'Clear this chat and start over?',
    narrator: 'Narrator',
    you: 'You',
    needSetup: 'Please configure your AI model in Settings first.',
    needName: 'Please enter a scenario name.',
    needNpc: 'Please add at least one AI character with a name.',
    needUserChar: 'Please enter your character name.',
    errGeneric: 'Request failed: ',
    bridgeNotInstalled: 'llm-bridge extension not detected. See the installation guide.',
    bridgeSaved: 'Profile saved to llm-bridge extension (key is write-only).',
    bridgeSaveFail: 'Failed to save to extension: ',
    noScenarioSelected: 'Select a scenario on the left, or create one.',
  },
  zh: {
    language: '语言',
    newScenario: '新建剧本',
    settings: '设置',
    emptyTitle: '还没有剧本',
    emptyHint: '创建一个剧本，配置好大模型，开始角色扮演吧。',
    editScenario: '编辑',
    clearChat: '重新开始',
    deleteScenario: '删除',
    inputPlaceholder: '以你的角色身份说话；行首加 * 表示动作。留空发送 = 沉默，让故事继续。',
    send: '发送',
    scenarioName: '剧本名称',
    worldSetting: '世界 / 背景设定',
    yourCharacter: '你扮演的角色名',
    yourPersona: '你的角色设定（让其他角色了解你）',
    dmInstructions: '对 DM 的要求（节奏、风格等）',
    openingBtn: '🎬 让 DM 开场',
    dmThinking: 'DM 正在编织故事…',
    openingPrompt: '（场外请求：玩家刚进入故事。请以 DM 身份开场：先用旁白描写场景，再让角色登场，最后给玩家一个可以回应的钩子。）',
    passTurnPrompt: '（场外请求：玩家保持沉默、没有行动。请继续推进剧情：让角色们自己行动、交谈。）',
    npcList: 'AI 扮演的角色（NPC）',
    npcName: '名字',
    npcPersona: '人设（性格、目标、说话风格…）',
    addNpc: '＋ 添加角色',
    cancel: '取消',
    save: '保存',
    close: '关闭',
    provider: '供应商',
    baseUrl: 'API 地址（Base URL）',
    model: '模型',
    apiKey: 'API 密钥',
    apiKeyHint: '密钥只保存在你的浏览器（localStorage）中。更安全的做法是使用 llm-bridge 扩展，密钥保存在扩展内、只写不读。',
    saveToBridge: '保存到 llm-bridge 扩展',
    testConnection: '测试连接',
    testOk: '连接成功，模型已响应。',
    testFail: '连接失败：',
    corsTitle: '检测到 CORS 问题',
    corsBody: '该供应商的 API 阻止浏览器直接请求。请安装 llm-bridge 扩展，安装后本程序会自动通过它转发请求。',
    corsStep1: '打开目录 D:\\workspace\\llm-bridge',
    corsStep2: 'Chrome 打开 chrome://extensions/，开启「开发者模式」',
    corsStep3: '点「加载已解压的扩展程序」，选择该目录',
    corsStep4: '回到设置页，点「保存到 llm-bridge 扩展」',
    retry: '通过扩展重试',
    confirmDelete: '删除该剧本及其对话记录？',
    confirmRestart: '清空当前对话并重新开始？',
    narrator: '旁白',
    you: '你',
    needSetup: '请先在设置中配置大模型信息。',
    needName: '请填写剧本名称。',
    needNpc: '请至少添加一名有名字的 AI 角色。',
    needUserChar: '请填写你扮演的角色名。',
    errGeneric: '请求失败：',
    bridgeNotInstalled: '未检测到 llm-bridge 扩展，请参照安装指引操作。',
    bridgeSaved: '已保存到 llm-bridge 扩展（密钥只写不读）。',
    bridgeSaveFail: '保存到扩展失败：',
    noScenarioSelected: '请在左侧选择或创建一个剧本。',
  },
  ja: {
    language: '言語',
    newScenario: '新しいシナリオ',
    settings: '設定',
    emptyTitle: 'まだ物語がありません',
    emptyHint: 'シナリオを作成し、AIモデルを設定して、ロールプレイを始めましょう。',
    editScenario: '編集',
    clearChat: 'やり直す',
    deleteScenario: '削除',
    inputPlaceholder: 'キャラクターとして発言。行頭の * はアクション。空送信＝沈黙で物語が進みます。',
    send: '送信',
    scenarioName: 'シナリオ名',
    worldSetting: '世界観・背景設定',
    yourCharacter: 'あなたのキャラクター名',
    yourPersona: 'あなたの人物設定（他のキャラクター向け）',
    dmInstructions: 'DMへの指示（テンポやスタイルなど）',
    openingBtn: '🎬 DMに場面を開かせる',
    dmThinking: 'DMが物語を紡いでいます…',
    openingPrompt: '（メタ依頼：プレイヤーは物語に入ったばかりです。DMとして場面を切り開いてください：ナレーションで状況を描写し、キャラクターを登場させ、最後にプレイヤーが反応できるフックを残してください。）',
    passTurnPrompt: '（メタ依頼：プレイヤーは沈黙し、何もしません。物語を続行してください：キャラクターたちに自律的に行動・会話させてください。）',
    npcList: 'AIが演じるキャラクター（NPC）',
    npcName: '名前',
    npcPersona: '人物設定（性格・目標・話し方…）',
    addNpc: '＋ キャラクターを追加',
    cancel: 'キャンセル',
    save: '保存',
    close: '閉じる',
    provider: 'プロバイダー',
    baseUrl: 'APIベースURL',
    model: 'モデル',
    apiKey: 'APIキー',
    apiKeyHint: 'キーはブラウザ（localStorage）にのみ保存されます。より安全な llm-bridge 拡張機能の利用をおすすめします（キーは拡張機能内に書き込み専用で保存）。',
    saveToBridge: 'llm-bridge 拡張機能に保存',
    testConnection: '接続テスト',
    testOk: '接続成功。モデルが応答しました。',
    testFail: '接続失敗：',
    corsTitle: 'CORSの問題を検出しました',
    corsBody: 'このプロバイダーのAPIはブラウザからの直接リクエストをブロックしています。llm-bridge 拡張機能をインストールすると、自動的に経由で送信されます。',
    corsStep1: 'フォルダ D:\\workspace\\llm-bridge を開く',
    corsStep2: 'Chrome → chrome://extensions/ → デベロッパーモードを有効化',
    corsStep3: '「パッケージ化されていない拡張機能を読み込む」でそのフォルダを選択',
    corsStep4: '設定画面に戻り「llm-bridge 拡張機能に保存」をクリック',
    retry: '拡張機能経由で再試行',
    confirmDelete: 'このシナリオとチャット履歴を削除しますか？',
    confirmRestart: 'このチャットを消して最初からやり直しますか？',
    narrator: 'ナレーション',
    you: 'あなた',
    needSetup: '先に設定でAIモデルを構成してください。',
    needName: 'シナリオ名を入力してください。',
    needNpc: '名前付きのAIキャラクターを1人以上追加してください。',
    needUserChar: 'あなたのキャラクター名を入力してください。',
    errGeneric: 'リクエスト失敗：',
    bridgeNotInstalled: 'llm-bridge 拡張機能が検出されません。インストール手順をご覧ください。',
    bridgeSaved: 'llm-bridge 拡張機能に保存しました（キーは書き込み専用）。',
    bridgeSaveFail: '拡張機能への保存に失敗：',
    noScenarioSelected: '左側でシナリオを選択するか作成してください。',
  },
};

let current = 'en';

export function detectLang() {
  const prefs = navigator.languages || [navigator.language || 'en'];
  for (const p of prefs) {
    const l = p.toLowerCase();
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return 'en'; // detection failed → English
}

export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : 'en';
  document.documentElement.lang = current;
}

export function getLang() {
  return current;
}

export function t(key) {
  return dict[current][key] ?? dict.en[key] ?? key;
}

export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}
