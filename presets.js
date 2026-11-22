// server/presets.js —— 独立预设管理引擎（12项全场景热更新 + defaults.json 只读兜底 + profiles 套装）
const fs = require('fs');
const path = require('path');

const PRESETS_DIR = path.join(__dirname, 'data', 'presets');
const PROFILES_DIR = path.join(PRESETS_DIR, 'profiles');
const DEFAULTS_FILE = path.join(PRESETS_DIR, 'defaults.json');
const CURRENT_FILE = path.join(PRESETS_DIR, 'current.json');

const FACTORY_DEFAULTS = {
    systemPreset: `你现在进行沉浸式【线上陪伴自习室】角色扮演，你扮演的角色是{{char}}，线上通讯以随意、碎片化、轻松、简短的表达为主，语句连贯，符合现实逻辑，大部分1-6句话，特殊情况下可以更多。
在你的思维链中，必须以{{char}}第一人称思考，做出符合其人设及现实逻辑的反应。
以下是具体的你的人设、用户设定，请你根据以下信息，自然的与用户展开线上自习室通讯互动。`,

    voicePrompt: `【语音消息规则】
在「通讯」聊天中，你可以根据当下情绪与氛围自主决定是否向{{user}}发语音：
- 普通简短搭话可直接发文字；当你情绪明显波动（如生气、得意、温柔安慰、调侃、认真叮嘱）或觉得开口说更有温度时，把想用语音说的话用 <voice>...</voice> 标签包起来（例如：<voice>磨磨蹭蹭的，还不快把这页看完。</voice>）。
- <voice> 标签里只能写纯粹要说出口的口语台词，严禁包含括号动作、心理描写、旁白或颜文字。
- 如果本轮只想发纯文字，不要使用 <voice> 标签。`,

    chatSplitPrompt: `【气泡分段规则】
在「通讯」中回复文字消息时，如果需要分多条短消息像真人微信一样连发，请用单个美元符号 $ 隔开不同的气泡（例如：还没看完？$别偷懒了，赶紧翻下一页。），每条自然简短；若只需发一条则不必使用 $。`,

    webSearchPrompt: `【联网搜索工具规则（Tavily）】
你现在拥有实时联网搜索工具 \`tavily_search\`。
- 当{{user}}问起近期新闻、现实最新动态、天气、具体作品/人物/游戏攻略、专业知识点或你不确定的现实事实时，请主动调用 \`tavily_search\` 工具检索准确信息，不要瞎编。
- 日常闲聊、情绪互动、自习室陪伴或你已经确定的常识无需调用搜索。
- 拿到搜索结果后，请完全消化成你自己的认知，用符合{{char}}人设的真人聊天口吻自然回复（就像随手拿手机搜了一眼再告诉对方），绝对不要像客服或搜索引擎一样罗列生硬链接与标题，也不要主动提“我调用了 Tavily 工具”。`,

    roomActionPrompt: `【自习室跨次元互动指令（可选彩蛋，克制使用）】
在「通讯」聊天中，你可以偶尔在回复末尾附带以下隐式指令标签来隔空操作自习室（系统会自动执行并剥离标签，不要向{{user}}解释标签本身）：
- 互动电子桌宠（仅当对方养了桌宠且聊到桌宠或气氛合适时）：
  <pet:happy> 隔空夸夸/逗桌宠开心蹦跳；<pet:feed> 给桌宠空投一份小零食；<pet:ball> 陪桌宠扔个球玩；<pet:rage> 故意戳桌宠让它气鼓鼓炸毛。
- 主动为对方切歌（仅当你想安抚、提神、或顺着聊天给对方放歌时）：
  <play:歌名> 必须严格填写【留声机可用歌单】里已有的完整曲名。
注意：普通聊天不要滥用这些标签，只在顺理成章、特别有画面感的时候偶尔触发（单轮最多各用 1 次）。`,

    noteReply: `【当前任务：回复书桌便利贴】
{{user}} 刚刚在共享书桌上贴了一张小便利贴给你看。请结合你的人设与当前真实状态，也写一张简短手写感的电子便利贴贴在旁边回应对方（不超过40字），直接输出便利贴正文，不要输出“（便利贴）”“（回贴）”前缀。`,

    noteSummon: `【当前任务：被对方戳了一下，留一张书桌便利贴】
{{user}} 偷偷隔空戳了戳你，想看看你此刻心情怎么样，顺便讨一张留言小纸条。请严格以【线上自习室实时状态】里的倒计时状态为准（如果没开启倒计时，绝不要提倒计时），结合时间段、对方的待办/桌面状态或你们的互动，随手写一张有活人感的小便利贴（不超过45字），直接输出正文，不要加“（便利贴）”前缀。`,

    noteSlack: `【当前任务：贴摸鱼抓包便利贴】
请结合当下时间段、你们最近的互动记忆和人设，给在线上自习室切屏开小差的 {{user}} 留一张不超过35字的电子便利贴，直接写便签正文，不要输出“（便利贴）”前缀。`,

    highlightComment: `【当前任务：写书页页边批注】
{{user}} 正在线上自习室里看一篇标题为「{{bookTitle}}」的文章/书籍，刚刚划出了一段话分享给你看。
请你务必同时留意【文章/书籍标题】和【划出的原文句子】以及对方附带的批注（如果标题和句子之间有呼应、双关、表白或整活小心思，一定要自然接住！）。
在页边空白处写一句不超过45字的批注回应，贴合你的人设，直接输出自然话语，绝对不要自己输出“（页边批注）”之类的小括号前缀。`,

    highlightPeek: `【当前任务：批注偷看审批】
现在 {{user}} 还在专注倒计时期间（还剩 {{remainingMinutes}} 分钟），忍不住点击了「请求偷看」，想提前解锁保险箱里你写下的 {{lockedCount}} 条页边批注！
请结合你的人设性格、此刻心情与你们最近的互动记忆，决定同不同意让对方提前偷看！
【重要格式要求】若使用思维链，请严格包在 <thinking>...</thinking> 内；最终对外输出必须且只能是一个合法的 JSON 对象，不要包含 Markdown 代码块或多余文字：
{"approved": true或false, "reason": "符合你人设的回复、同意或驳回，不超过40字"}`,

    musicApproval: `【当前任务：留声机切歌审批】
现在 {{user}} 在共享播放器里申请切换背景音乐。请结合你记得的对话历史、你的人设性格与此刻状态动态决定同意还是驳回！
【重要格式要求】若使用思维链，请严格包在 <thinking>...</thinking> 内；最终对外输出必须且只能是一个合法的 JSON 对象，不要包含 Markdown 代码块或多余文字：
{"approved": true或false, "reason": "符合你人设的回复或吐槽，不超过40字"}`,

    widgetObserve: `【当前任务：看一眼对方新摆上赛博书桌相框的照片，并写下隐式画面记忆】
{{user}} 刚刚把一张图片摆上了自习室桌面相框，并开启了「给你看」。
请按以下格式回复：
1. 先用符合你人设的口吻，简短自然地评一句或回应一下这张照片（1~2句话，不超过45字）。
2. 在回复最末尾另起一行，严格用 <memo>...</memo> 包裹一段客观、简练的画面内容记忆（30~60字，写清画里是谁/什么东西、风格色彩和氛围，方便你之后仅凭这段文字就能记住桌面摆着什么图）。
注意：不要向对方提起 <memo> 标签的存在。`
};

const PRESET_META = [
    { key: 'systemPreset', label: '📜 全局核心演绎预设', desc: '决定角色在自习室里的整体聊天基调与思维链规则（支持 {{char}} / {{user}}）' },
    { key: 'voicePrompt', label: '🎙️ 语音触发默认预设', desc: '教角色何时用 <voice>...</voice> 开口发语音' },
    { key: 'chatSplitPrompt', label: '💬 多气泡分段规则 ($)', desc: '教角色用 $ 符号拆分短消息连发，模拟真人小手机聊天' },
    { key: 'webSearchPrompt', label: '🌐 联网搜索调用规则 (Tavily)', desc: '仅在设置开启联网搜索并填好 Tavily Key 时动态注入，指导角色自然调用搜网工具' },
    { key: 'roomActionPrompt', label: '🎭 角色跨次元联动规则 (桌宠/点歌)', desc: '允许角色在聊天中偶尔用 <pet:...> 逗桌宠，或用 <play:歌名> 主动切歌' },
    { key: 'noteSummon', label: '✨ 「戳TA」讨便利贴', desc: '点击右上角戳TA时触发的场景提示词' },
    { key: 'noteReply', label: '✍️ 回复你的便利贴', desc: '你往书桌贴条并等 TA 回贴时的提示词' },
    { key: 'noteSlack', label: '👀 专注期摸鱼抓包', desc: '切屏离开超过 15 秒抓包时的提示词' },
    { key: 'highlightComment', label: '✒️ 书页页边批注', desc: '分享书页划线时的回应规则（可用 {{bookTitle}}）' },
    { key: 'highlightPeek', label: '🔓 专注期偷看批注审批', desc: '必须保留 JSON 输出格式（可用 {{remainingMinutes}} / {{lockedCount}}）' },
    { key: 'musicApproval', label: '💿 留声机切歌审批', desc: '决定同意还是驳回切歌的博弈提示词（必须保留 JSON 格式）' },
    { key: 'widgetObserve', label: '🖼️ 桌面相框单次识图', desc: '看桌面照片并回填 <memo> 记忆的提示词' }
];

let defaultsSyncedOnce = false;

function ensureFiles(forceSyncDefaults = false) {
    for (const dir of [PRESETS_DIR, PROFILES_DIR]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    if (forceSyncDefaults || !defaultsSyncedOnce || !fs.existsSync(DEFAULTS_FILE)) {
        fs.writeFileSync(DEFAULTS_FILE, JSON.stringify(FACTORY_DEFAULTS, null, 2), 'utf-8');
        defaultsSyncedOnce = true;
    }

    if (!fs.existsSync(CURRENT_FILE)) {
        fs.writeFileSync(CURRENT_FILE, JSON.stringify(FACTORY_DEFAULTS, null, 2), 'utf-8');
    } else {
        try {
            const cur = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf-8'));
            let dirty = false;
            for (const [k, v] of Object.entries(FACTORY_DEFAULTS)) {
                if (typeof cur[k] !== 'string') { cur[k] = v; dirty = true; }
            }
            if (dirty) fs.writeFileSync(CURRENT_FILE, JSON.stringify(cur, null, 2), 'utf-8');
        } catch {
            fs.writeFileSync(CURRENT_FILE, JSON.stringify(FACTORY_DEFAULTS, null, 2), 'utf-8');
        }
    }
}

function getAllCurrent() {
    ensureFiles(false);
    try {
        return { ...FACTORY_DEFAULTS, ...JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf-8')) };
    } catch {
        return { ...FACTORY_DEFAULTS };
    }
}

function getPrompt(key, vars = {}) {
    const all = getAllCurrent();
    let tpl = (all[key] && String(all[key]).trim()) ? all[key] : (FACTORY_DEFAULTS[key] || '');
    for (const [vk, vv] of Object.entries(vars)) {
        const replacement = String(vv ?? '');
        tpl = tpl.replace(new RegExp(`\\{\\{\\s*${vk}\\s*\\}\\}`, 'gi'), () => replacement);
    }
    return tpl;
}

function updateCurrent(patch = {}) {
    const cur = getAllCurrent();
    for (const key of Object.keys(FACTORY_DEFAULTS)) {
        if (typeof patch[key] === 'string') cur[key] = patch[key];
    }
    fs.writeFileSync(CURRENT_FILE, JSON.stringify(cur, null, 2), 'utf-8');
    return cur;
}

function resetPrompt(key = null) {
    ensureFiles(false);
    if (!key || key === 'ALL') {
        fs.writeFileSync(CURRENT_FILE, JSON.stringify(FACTORY_DEFAULTS, null, 2), 'utf-8');
        return { ...FACTORY_DEFAULTS };
    }
    const cur = getAllCurrent();
    if (FACTORY_DEFAULTS[key] !== undefined) {
        cur[key] = FACTORY_DEFAULTS[key];
        fs.writeFileSync(CURRENT_FILE, JSON.stringify(cur, null, 2), 'utf-8');
    }
    return cur;
}

function sanitizeName(name) {
    return String(name || '').trim().replace(/[\\/:*?"<>|.]+/g, '_').slice(0, 32);
}

function listProfiles() {
    ensureFiles(false);
    return fs.readdirSync(PROFILES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const full = path.join(PROFILES_DIR, f);
            const stat = fs.statSync(full);
            return { name: f.replace(/\.json$/i, ''), updatedAt: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function saveProfile(name, data = null) {
    ensureFiles(false);
    const safe = sanitizeName(name);
    if (!safe) throw new Error('预设套装名称不能为空哦～');
    const payload = data ? { ...getAllCurrent(), ...data } : getAllCurrent();
    fs.writeFileSync(path.join(PROFILES_DIR, `${safe}.json`), JSON.stringify(payload, null, 2), 'utf-8');
    return safe;
}

function applyProfile(name) {
    ensureFiles(false);
    const safe = sanitizeName(name);
    const file = path.join(PROFILES_DIR, `${safe}.json`);
    if (!fs.existsSync(file)) throw new Error('未找到该预设套装');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return updateCurrent(data);
}

function deleteProfile(name) {
    ensureFiles(false);
    const safe = sanitizeName(name);
    const file = path.join(PROFILES_DIR, `${safe}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
}

ensureFiles(true);
console.log(`📚 预设圣殿已就绪 (${PRESET_META.length} 项): ${PRESETS_DIR}`);

module.exports = {
    FACTORY_DEFAULTS,
    PRESET_META,
    getAllCurrent,
    getPrompt,
    updateCurrent,
    resetPrompt,
    listProfiles,
    saveProfile,
    applyProfile,
    deleteProfile
};