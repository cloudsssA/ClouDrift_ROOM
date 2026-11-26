const DEFAULT_SYSTEM = require('./presets').FACTORY_DEFAULTS.theaterSystem;

const defaults = { model: '', timeout: 180, limit: 30, repair: true, history: true, count: 100, inject: false, system: '', style: '' };

function decode(text) {
    const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (raw, key) => {
        if (key[0] !== '#') return names[key.toLowerCase()];
        const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
}

// Ignore raw-text elements before looking for structural tags or extracting prose.
function inspect(html) {
    const visible = html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
    const plain = s => decode(s.replace(/<[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const body = visible.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    return {
        complete: Boolean(/^(?:\s*<!doctype\s+html[^>]*>)?\s*<html\b/i.test(visible) && body && /<\/html\s*>\s*$/i.test(visible)),
        title: plain(visible.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
        text: plain(body?.[1] || '')
    };
}

async function generate({ client, model, settings, context, prompt, prior, progress }) {
    const messages = [
        { role: 'system', content: [settings.system || DEFAULT_SYSTEM, settings.style, context].filter(Boolean).join('\n\n') },
        { role: 'user', content: prior ? prompt + '\n接着前篇剧情写下一篇，输出独立完整的新网页。\n前篇：\n' + prior : prompt }
    ];
    let html = '';
    const attempts = settings.repair ? 4 : 1;
    for (let i = 0; i < attempts; i++) {
        progress(i ? '补写中 ' + i + '/3' : '正在创作');
        const request = messages.slice();
        if (i && html) request.push({ role: 'assistant', content: html });
        if (i) request.push({ role: 'user', content: html ? '从断点继续输出剩余 HTML，直到 </html>。' : '上一条为空，请重新生成完整 HTML。' });
        const result = await client.chat.completions.create({ model, messages: request }, { timeout: settings.timeout * 1000, maxRetries: 0 });
        const raw = result.choices?.[0]?.message?.content || '';
        const part = raw.replace(/^\s*\x60{3}(?:html)?[^\S\n]*\n?/i, '').replace(/\n?\x60{3}\s*$/, '');
        if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(part)) html = part;
        else html += part;
        const info = inspect(html);
        if (info.complete) return { html, ...info };
    }
    throw new Error(html.trim() ? '网页仍未完整闭合，本次未保存。' : '模型返回空内容，本次未保存。');
}

module.exports = { DEFAULT_SYSTEM, defaults, generate, inspect };
