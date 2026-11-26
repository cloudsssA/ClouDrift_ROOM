(() => {
    const modal = document.createElement('dialog');
    modal.className = 'theater-dialog';
    modal.setAttribute('aria-labelledby', 'theater-title');
    const preview = document.createElement('dialog');
    preview.className = 'theater-dialog theater-preview';
    preview.setAttribute('aria-label', '作品预览');
    document.body.append(modal, preview);
    const tabs = ['生成', '成品', '模板', '设置'];
    let state, tab, key, draft = '', query = '', generation = 0, selectedBooks, selectedTemplate = '';
    const $ = selector => modal.querySelector(selector);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const btn = (label, action, id = '', cls = '') => `<button type="button" data-act="${action}" data-id="${esc(id)}" class="${cls}">${label}</button>`;
    const option = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
    const field = (label, control) => `<label class="th-field"><span>${label}</span>${control}</label>`;
    const area = (id, value, hint = '') => `<textarea id="${id}" placeholder="${esc(hint)}">${esc(value)}</textarea>`;
    const workUrl = id => state.readerOrigin
        ? state.readerOrigin + '/works/' + encodeURIComponent(id)
        : '/api/theater/works/' + encodeURIComponent(id) + '/html';
    const character = () => state.characters.find(c => c.key === key);
    const api = async (path, method = 'GET', data) => {
        const res = await fetch('/api/theater' + path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
        if (!res.ok) throw Error((await res.json().catch(() => ({}))).error || '请求失败 ' + res.status);
        return res.headers.get('content-type')?.includes('json') ? res.json() : null;
    };
    const refresh = async () => { state = await api('/state'); };
    const status = text => { if ($('#th-note')) $('#th-note').textContent = text; };
    const selectChar = () => field('角色', '<select id="th-char">' + state.characters.map(c => option(c.key, c.name, key)).join('') + '</select>');
    const renderGenerate = () => {
        const c = character();
        return `<div class="th-pair">${selectChar()}${field('用户人设', '<select id="th-user">' + option(0, '跟随房间 · ' + (c.user.id ? '当前用户' : c.user.name), c.user.id) + state.users.map(u => option(u.id, u.user_name, c.user.id)).join('') + '</select>')}</div>
        <details><summary>查看本次人设</summary><p>${esc(c.persona || '角色人设尚未填写')}</p><p>${esc([c.user.name, c.user.persona, c.user.relation].filter(Boolean).join(' · '))}</p></details>
        <fieldset><legend>世界书</legend>${c.books.map(b => `<label class="th-check"><input type="checkbox" data-book="${b.id}" ${selectedBooks?.includes(b.id) ? 'checked' : ''}>${esc(b.name)} · ${b.global ? '全局' : '角色'}</label>`).join('') || '<small>从菜单的世界书仓库添加设定，在角色卡中勾选。</small>'}</fieldset>
        ${field('剧本模板', '<select id="th-choice">' + option('', '自由创作', selectedTemplate) + state.templates.map(t => option(t.id, t.name, selectedTemplate)).join('') + '</select>')}
        ${field('本次提示词', area('th-prompt', draft, '写下场景、剧情，或你希望网页呈现的互动……'))}
        <div class="th-end">${btn('生成小剧场', 'generate', '', 'th-primary')}</div>`;
    };
    const editTemplate = t => `<form data-form="template" data-id="${t?.id || ''}">${field('模板名称', '<input required name="name" value="' + esc(t?.name) + '">')}${field('提示词', area('th-tpl', t?.prompt, '{{char}} 与 {{user}} 的故事……'))}<div class="th-end">${btn('取消','templates')}<button class="th-primary">保存模板</button></div></form>`;
    function settingsPanel() {
        const s = state.settings;
        const number = (k, label, max) => field(label, `<input name="${k}" type="number" min="1" max="${max}" required value="${s[k]}">`);
        const check = (k, label) => `<label class="th-check"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}>${label}</label>`;
        const models = typeof fetchedModelsList === 'undefined' ? [] : fetchedModelsList;
        return `<form data-form="settings">${field('聊天模型', '<input name="model" list="th-models" value="' + esc(s.model) + '" placeholder="跟随房间 · ' + esc(state.model) + '">')}
        <datalist id="th-models">${[...new Set([state.model, ...models])].map(m => option(m,m,'')).join('')}</datalist>${btn('获取模型列表','models')}
        <div class="th-pair">${number('timeout','单次超时（秒）',1800)}${number('limit','成品保留上限',10000)}</div>
        ${check('repair','空回或截断时最多补写三次')}${check('history','携带所选角色的最近聊天')}${number('count','最近聊天条数',1000)}
        ${check('inject','生成后将纯正文加入当前角色会话')}
        <small class="th-preset-note">📜 这两项与配置里的预设殿堂共用，换预设套装也会一起更新。</small>
        ${field('系统提示词',area('th-system',s.system,state.defaultSystem))}${field('文风提示词',area('th-style',s.style,'例如：深夜电台的口吻，少用旁白。'))}
        <div class="th-end"><button class="th-primary">保存设置</button></div></form>
`;
    }
    async function listWorks() {
        const version = ++generation;
        const rows = await api('/works?q=' + encodeURIComponent(query));
        if (version !== generation || !$('#th-works')) return;
        $('#th-works').innerHTML = rows.map(w => {
            const url = esc(workUrl(w.id));
            return `<article><div class="th-byline">${esc(w.char_name)} · ${esc(new Date(w.created).toLocaleString())}</div><h3>${esc(w.title)}</h3><p>${esc(w.summary)}</p>
            <div class="th-actions">${btn('预览','preview',w.id,'th-primary')}<a href="${url}" target="_blank" rel="noopener noreferrer">新标签页 ↗</a>
            ${btn(w.starred ? '★ 已收藏' : '☆ 收藏',w.starred ? 'unstar' : 'star',w.id)}${btn('重试','retry',w.id)}${btn('续写','continue',w.id)}${btn('删除','remove',w.id)}</div></article>`;
        }).join('') || '<p class="th-empty">' + (query ? '没有找到匹配的作品。' : '这里会收录你生成的每一篇小剧场。') + '</p>';
    }
    function panel() {
        for (const b of modal.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', b.dataset.tab === tab);
        const content = $('#th-panel');
        if (tab === '生成') content.innerHTML = renderGenerate();
        if (tab === '设置') content.innerHTML = settingsPanel();
        if (tab === '模板') content.innerHTML = btn('＋ 新模板','edit','','th-primary') + state.templates.map(t => `<article><h3>${esc(t.name)}</h3><p>${esc(t.prompt)}</p><div class="th-actions">${btn('编辑','edit',t.id)}${btn('删除','del-template',t.id)}</div></article>`).join('');
        if (tab === '成品') {
            content.innerHTML = field('搜索成品','<input type="search" id="th-search" placeholder="搜索标题或正文" value="' + esc(query) + '">') + '<div id="th-works"></div>';
            listWorks().catch(err => status(err.message));
        }
    }
    let active = [], polling = false, initialized = false;
    const seen = new Set();
    const tracked = new Set();
    const notifications = [];
    function showProgress() {
        const box = $('#th-jobs');
        if (!box || !modal.open) return;
        const signature = JSON.stringify(active.map(j => [j.id, j.label, j.status]));
        if (box.dataset.signature !== signature) {
            box.dataset.signature = signature;
            box.innerHTML = active.map(j => {
                const label = esc(j.label);
                const repair = j.status.startsWith('补写') ? ` · ${esc(j.status)}` : '';
                return `<div class="th-job"><div class="th-job-label"><span aria-hidden="true">✨</span><b title="${label}">${label}</b><span>正在生成</span></div><div class="th-job-meta"><small>${repair}</small><time></time></div></div>`;
            }).join('');
        }
        box.querySelectorAll('time').forEach((el, i) => {
            const value = Math.max(0, Math.floor((Date.now() - active[i].startedAt) / 1000)) + ' 秒';
            if (el.textContent !== value) el.textContent = value;
        });
    }
    function notify() {
        if (modal.open || preview.open || document.hidden || !notifications.length ||
            document.getElementById('commToastBanner')?.classList.contains('show')) return;
        const job = notifications.shift();
        const title = job.title || job.label;
        showCommBanner(job.work ? '✨ 小剧场生成完成' : '⚠️ 小剧场生成失败',
            '《' + title + '》' + (job.work && job.status === '已收入成品' ? '已收入成品 💗' : ' · ' + job.status),
            false, { icon:'🎭', onClick:() => open('成品') });
    }
    async function poll() {
        if (polling) return;
        polling = true;
        try {
            const jobs = await api('/jobs');
            active = jobs.filter(j => !j.done);
            let finished = false;
            for (const job of jobs.filter(j => j.done).reverse()) {
                if (seen.has(job.id)) continue;
                seen.add(job.id);
                if (initialized || tracked.has(job.id) || job.finishedAt >= pageOpenedAt) {
                    notifications.push(job);
                    finished = true;
                }
                tracked.delete(job.id);
            }
            initialized = true;
            showProgress();
            if (finished && modal.open && tab === '成品') await listWorks();
        } catch {
            // A reconnect will fetch current server-side job state on the next poll.
        } finally {
            polling = false;
            notify();
        }
    }
    const pageOpenedAt = Date.now();
    setInterval(() => { showProgress(); notify(); }, 1000);
    setInterval(poll, 2200);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    async function open(initial = '生成') {
        if (modal.open) return;
        tab = initial;
        modal.innerHTML = `<header><h2 id="theater-title">🎭 小剧场</h2>${btn('关闭 ✕','close')}</header><nav>${tabs.map(t => `<button data-tab="${t}">${t}</button>`).join('')}</nav><div id="th-jobs"></div><div id="th-note" role="status"></div><section id="th-panel"></section>`;
        modal.showModal();
        try {
            await refresh();
            if (!state.characters.some(c => c.key === key)) key = state.active;
            selectedBooks = character().books.map(b => b.id);
            panel(); showProgress(); poll();
        } catch (err) { status(err.message); }
    }
    modal.addEventListener('close', notify);
    modal.addEventListener('input', e => {
        if (e.target.id === 'th-search') { query = e.target.value; listWorks().catch(err => status(err.message)); }
        if (e.target.id === 'th-prompt') draft = e.target.value;
    });
    modal.addEventListener('change', async e => {
        try {
            if (e.target.id === 'th-char') { key = e.target.value; selectedBooks = character().books.map(b => b.id); panel(); }
            if (e.target.id === 'th-user') { character().user = await api('/users','PUT',{key,id:Number(e.target.value)}); panel(); }
            if (e.target.id === 'th-choice') { selectedTemplate = e.target.value; draft = state.templates.find(t => t.id === Number(selectedTemplate))?.prompt || ''; $('#th-prompt').value = draft; }
            if (e.target.hasAttribute('data-book')) selectedBooks = [...modal.querySelectorAll('[data-book]:checked')].map(el => el.dataset.book);
        } catch (err) { status(err.message); }
    });
    modal.addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.target, data = Object.fromEntries(new FormData(form));
        try {
            if (form.dataset.form === 'template') await api('/templates','POST',{ ...data, id:Number(form.dataset.id), prompt:$('#th-tpl').value });
            if (form.dataset.form === 'settings') {
                for (const k of ['repair','history','inject']) data[k] = form.elements[k].checked;
                if ($('#th-system').value !== state.settings.system) data.system = $('#th-system').value;
                if ($('#th-style').value !== state.settings.style) data.style = $('#th-style').value;
                await api('/settings','PUT',data);
            }
            await refresh(); panel(); status('已保存');
        } catch (err) { status(err.message); }
    });
    modal.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b || b.type === 'submit' && !b.dataset.tab) return;
        const {act,id} = b.dataset;
        if (act === 'close') return modal.close();
        if (!state) return;
        if (b.dataset.tab) { tab = b.dataset.tab; status(''); return panel(); }
        b.disabled = true;
        try {
            if (act === 'generate' || act === 'retry' || act === 'continue') {
                const job = act === 'generate'
                    ? await api('/jobs','POST',{key, prompt:draft, books:selectedBooks,
                        label:state.templates.find(t => t.id === Number(selectedTemplate))?.name})
                    : await api('/works/' + id + '/' + act,'POST',{});
                tracked.add(job.id);
                if (!active.some(item => item.id === job.id) && !seen.has(job.id)) active.unshift(job);
                status(''); showProgress(); poll();
            }
            if (act === 'edit') $('#th-panel').innerHTML = editTemplate(state.templates.find(t => t.id === Number(id)));
            if (act === 'templates') panel();
            if (act === 'models') {
                const res = await fetch('/api/llm/models',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
                const data = await res.json(); if (!res.ok) throw Error(data.message);
                $('#th-models').innerHTML = data.models.map(m => option(m,m,'')).join('');
                if (typeof fetchedModelsList !== 'undefined') fetchedModelsList.splice(0,fetchedModelsList.length,...data.models);
                status('已载入 ' + data.models.length + ' 个模型');
            }
            if (['del-template','remove'].includes(act) && confirm('确认删除这一项？')) {
                await api(({ 'del-template':'/templates/', remove:'/works/' })[act]+id,'DELETE');
                await refresh(); panel();
            }
            if (act === 'star' || act === 'unstar') { await api('/works/'+id+'/star','PUT',{starred:act==='star'}); await listWorks(); }
            if (act === 'preview') {
                const url = esc(workUrl(id));
                preview.innerHTML = '<header><h2>作品预览</h2><a download="小剧场.html" href="/api/theater/works/'+encodeURIComponent(id)+'/html">保存 HTML</a><a target="_blank" rel="noopener noreferrer" href="'+url+'">新标签页 ↗</a><button type="button">关闭 ✕</button></header><iframe title="小剧场作品" src="'+url+'"></iframe>';
                preview.querySelector('button').onclick = () => preview.close(); preview.showModal();
            }
        } catch (err) { status(err.message); }
        finally { b.disabled = false; }
    });
    preview.addEventListener('close', () => preview.replaceChildren());
    window.CloudTheater = { open };
    poll();
})();
