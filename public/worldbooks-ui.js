(() => {
    const dialog = document.createElement('dialog');
    dialog.className = 'theater-dialog wb-dialog';
    dialog.setAttribute('aria-label','世界书仓库');
    document.body.append(dialog);
    const bind = document.querySelector('#wb-bind');
    const key = () => draftActiveCharKey || 'custom_' + (document.querySelector('#cfgCharName').value.trim() || '连线搭子');
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function api(path = '', method = 'GET', data) {
        const r = await fetch('/api/worldbooks' + path, {method, headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        if (!r.ok) throw Error(await r.text());
        return r.status === 204 ? null : r.json();
    }
    let books = [], editing;
    dialog.innerHTML = '<header><h2>📚 世界书仓库</h2><button data-action="close">关闭 ✕</button></header><div class="wb-body"></div><small role="status"></small>';
    const body = dialog.querySelector('.wb-body');
    const notice = dialog.querySelector('[role=status]');
    async function list() {
        books = await api(); editing = null;
        body.innerHTML = '<button class="th-primary" data-action="new">＋ 新世界书</button>' + books.map(b =>
            '<article><div class="th-byline">' + (b.global ? '全局共用' : '角色关联') + ' · ' + b.entries.length + ' 条设定</div><h3>' + esc(b.name) + '</h3><p>' + esc(b.entries[0]?.content) + '</p><button data-action="edit" data-id="'+esc(b.id)+'">编辑</button> <button data-action="delete" data-id="'+esc(b.id)+'">删除</button></article>'
        ).join('') + (books.length ? '' : '<p>把人物、地点或故事规则写成条目，再从角色卡中勾选这本书。</p>');
    }
    function entry(e = {}) {
        return '<fieldset><legend>设定条目</legend><label class="th-field">条目名<input name="label" value="'+esc(e.name)+'"></label><label class="th-field">触发方式<select name="mode">'+[['keyword','关键词触发'],['always','常驻'],['off','停用']].map(([k,v])=>'<option value="'+k+'" '+(k===e.mode?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label class="th-field wb-keys">关键词（任一命中，用逗号分隔）<input name="keys" value="'+esc(e.keys?.join('，'))+'"></label><label class="th-field">同层顺序（小值优先）<input type="number" min="0" max="9999" name="order" value="'+(e.order??100)+'"></label><label class="th-field">设定正文<textarea required name="content">'+esc(e.content)+'</textarea></label><button type="button" data-action="drop">移除条目</button></fieldset>';
    }
    function modes() {
        for (const f of body.querySelectorAll('fieldset')) f.querySelector('.wb-keys').style.display = f.querySelector('select').value === 'keyword' ? '' : 'none';
    }
    function edit(b) {
        editing = b;
        body.innerHTML = '<form><label class="th-field">书名<input required name="title" value="'+esc(b?.name)+'"></label><label class="th-check"><input name="global" type="checkbox" '+(b?.global?'checked':'')+' >所有角色共用</label><label class="th-check"><input type="checkbox" name="enabled" '+(b?.enabled!==false?'checked':'')+'>启用本书</label><div class="th-pair"><label class="th-field">扫描最近消息数<input name="depth" type="number" min="0" max="100" value="'+(b?.depth??5)+'"></label><label class="th-field">最多追加扫描层数<input name="layers" type="number" min="0" max="8" value="'+(b?.layers??2)+'"></label></div><label class="th-check"><input type="checkbox" name="recursive" '+(b?.recursive?'checked':'')+'>用命中条目继续匹配本书</label><section>'+ (b?.entries || [{}]).map(entry).join('')+'</section><button type="button" data-action="add">＋ 条目</button><div class="th-end"><button type="button" data-action="list">取消</button><button class="th-primary">保存世界书</button></div></form>';
        modes();
    }
    dialog.addEventListener('change',modes);
    dialog.addEventListener('click',async event => {
        const btn=event.target.closest('[data-action]'); if (!btn) return;
        const b=books.find(x=>x.id===btn.dataset.id);
        try {
            switch(btn.dataset.action) {
                case 'close': dialog.close(); break;
                case 'list': await list(); break;
                case 'new': edit(null); break;
                case 'edit': edit(b); break;
                case 'add': body.querySelector('section').insertAdjacentHTML('beforeend',entry()); modes(); break;
                case 'drop': btn.closest('fieldset').remove(); break;
                case 'delete': if(confirm('删除《'+b.name+'》及其条目？')) { await api('/'+b.id+'?version='+b.version,'DELETE'); await list(); } break;
            }
        } catch(err) { notice.textContent=err.message; }
    });
    dialog.addEventListener('submit',async event => {
        event.preventDefault();
        const f=event.target;
        const entries=[...f.querySelectorAll('fieldset')].map(el=>({
            name:el.elements.label.value, order:Number(el.elements.order.value), mode:el.elements.mode.value,
            keys:el.elements.keys.value.split(/[,，、\n]/).map(k=>k.trim()).filter(Boolean),content:el.elements.content.value
        }));
        const button=event.submitter;
        if(button) button.disabled=true;
        try {
            await api('','POST',{id:editing?.id,version:editing?.version,name:f.elements.title.value,global:f.elements.global.checked,enabled:f.elements.enabled.checked,recursive:f.elements.recursive.checked,depth:Number(f.elements.depth.value),layers:Number(f.elements.layers.value),entries});
            await list(); notice.textContent='已保存';
        } catch(err) { notice.textContent=err.message; }
        finally { if(button) button.disabled=false; }
    });
    bind.addEventListener('toggle',async () => {
        if (!bind.open) return;
        const target=key(), box=bind.querySelector('div');
        box.textContent='读取中…';
        try {
            const rows=await api();
            if(target!==key() || !bind.open) return;
            box.innerHTML=rows.map(b=>'<label class="th-check"><input type="checkbox" data-id="'+esc(b.id)+'" '+(b.global || b.roles.includes(target)?'checked':'')+' '+(b.global?'disabled':'')+'>'+esc(b.name)+(b.global?' · 全局':'')+'</label>').join('') || '先从菜单中新建一本世界书。';
            box.dataset.key=target;
        } catch(err) {box.textContent=err.message;}
    });
    bind.addEventListener('change',async e=>{
        const input=e.target, target=bind.querySelector('div').dataset.key;
        if (target!==key()) {bind.open=false;return;}
        input.disabled=true;
        try {await api('/'+input.dataset.id+'/binding','PUT',{key:target,enabled:input.checked});}
        catch(err){input.checked=!input.checked;alert(err.message);}
        finally {input.disabled=false;}
    });
    window.Worldbooks={reset(){bind.open=false;},async open(){notice.textContent='';dialog.showModal();try{await list();}catch(err){notice.textContent=err.message;}}};
})();
