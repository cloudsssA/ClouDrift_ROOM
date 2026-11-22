// public/vault-ui.js —— 用户人设卡仓库 + 角色卡绑定预设套装 + 独立记忆库路径展示
(function () {
    let savedUserCards = [];
    let draftActiveUserId = null;
    let draftEditingCharId = null;
    let availablePresetProfiles = [];

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function injectStyles() {
        if (document.getElementById('vaultUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'vaultUiStyles';
        style.textContent = `
            .vault-chip.active-card {
                border-color: var(--accent, #d97706) !important;
                background: rgba(217, 119, 6, 0.22) !important;
                color: #fef3c7 !important;
            }
            .vault-tag-mini {
                font-size: 10px;
                padding: 1px 6px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.08);
                color: #d6d3d1;
            }
            .vault-mem-path {
                font-size: 11px;
                color: #86efac;
                background: rgba(74, 222, 128, 0.1);
                border: 1px solid rgba(74, 222, 128, 0.28);
                border-radius: 8px;
                padding: 6px 10px;
                margin-top: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .vault-mem-path code {
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 11px;
                color: #bbf7d0;
            }
        `;
        document.head.appendChild(style);
    }

    // 1. 给「👤 用户」弹窗注入用户人设卡仓库
    function injectUserCardsWarehouse() {
        const modal = document.getElementById('userModal');
        if (!modal || document.getElementById('userCardsBar')) return;
        const box = modal.querySelector('.modal-box');
        const heading = box?.querySelector('h3');
        if (!box || !heading) return;

        const bar = document.createElement('div');
        bar.id = 'userCardsBar';
        bar.className = 'preset-bar';
        bar.innerHTML = `
            <div class="preset-bar-header" style="gap:6px;flex-wrap:wrap;">
                <span>🗂️ 已存用户人设卡库（存于 users.db · 一键切马甲）</span>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                    <button type="button" class="mini-btn" id="updateUserCardBtn" style="display:none;padding:3px 9px;font-size:11px;border-color:#60a5fa;color:#bfdbfe;" onclick="window.VaultUI.updateCurrentUserCard()">💾 更新此卡</button>
                    <button type="button" class="mini-btn" style="padding:3px 10px;font-size:11px;border-color:var(--accent);color:#fde68a;" onclick="window.VaultUI.saveAsNewUserCard()">+ 存为新用户卡</button>
                </div>
            </div>
            <div class="preset-chips" id="userPresetsList"></div>
            <div id="userPresetFeedback" style="font-size:11px;margin-top:6px;"></div>
        `;
        heading.insertAdjacentElement('afterend', bar);
    }

    // 2. 给「🪪 角色卡」弹窗注入：原地更新按钮 + 绑定预设套装 + 独立记忆库路径提示
    function injectCharacterVaultExtensions() {
        const modal = document.getElementById('characterModal');
        if (!modal) return;

        // 2.1 在「+ 存为新角色卡」左侧加一个「💾 更新此卡」按钮
        const saveNewBtn = modal.querySelector('.preset-bar-header button');
        if (saveNewBtn && !document.getElementById('updateCharCardBtn')) {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
            const updBtn = document.createElement('button');
            updBtn.type = 'button';
            updBtn.id = 'updateCharCardBtn';
            updBtn.className = 'mini-btn';
            updBtn.style.cssText = 'display:none;padding:3px 9px;font-size:11px;border-color:#60a5fa;color:#bfdbfe;';
            updBtn.innerText = '💾 更新此卡';
            updBtn.onclick = () => window.VaultUI.updateCurrentCharCard();
            saveNewBtn.parentNode.insertBefore(wrap, saveNewBtn);
            wrap.appendChild(updBtn);
            wrap.appendChild(saveNewBtn);
        }

        // 2.2 注入「📚 绑定专属预设套装 + 独立记忆库文件展示」区块
        if (!document.getElementById('charPresetBindingSection')) {
            const anchor = document.getElementById('charVoiceSection')
                || document.getElementById('cfgPersona')?.closest('.form-group');
            const box = document.createElement('div');
            box.id = 'charPresetBindingSection';
            box.className = 'settings-section-box';
            box.innerHTML = `
                <div class="form-group" style="margin-bottom:4px;">
                    <label style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                        <span>📚 绑定专属预设套装（选填）</span>
                        <span style="font-size:11px;color:#78716c;">切换此卡应用时自动联动切换预设圣殿</span>
                    </label>
                    <select id="cfgCharPresetProfile">
                        <option value="">🌐 不绑定（跟随当前预设圣殿）</option>
                    </select>
                </div>
                <div class="vault-mem-path">
                    <span>🧠 一人一库物理隔离</span>
                    <code id="charMemoryFileLabel">data/memory/default.db</code>
                </div>
            `;
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(box, anchor.nextSibling);
            }
        }
    }

    function updateCharEditStateUI(charKey, memFile) {
        const match = String(charKey || '').match(/^card_(\d+)$/);
        draftEditingCharId = match ? parseInt(match[1], 10) : null;
        const updBtn = document.getElementById('updateCharCardBtn');
        if (updBtn) updBtn.style.display = draftEditingCharId ? 'inline-block' : 'none';
        const fileLbl = document.getElementById('charMemoryFileLabel');
        if (fileLbl) {
            const safe = memFile || `${String(charKey || 'default').replace(/[\\/:*?"<>|.\s]+/g, '_')}.db`;
            fileLbl.innerText = `data/memory/${safe}`;
        }
    }

    async function refreshPresetProfileSelect(selectedName = '') {
        try {
            const res = await fetch(`${API_BASE}/api/presets`);
            const data = await res.json();
            if (res.ok && data.success) {
                availablePresetProfiles = data.profiles || [];
            }
        } catch {}

        const sel = document.getElementById('cfgCharPresetProfile');
        if (!sel) return;
        const opts = [`<option value="">🌐 不绑定（跟随当前预设圣殿）</option>`];
        const names = new Set();
        for (const p of availablePresetProfiles) {
            names.add(p.name);
            opts.push(`<option value="${esc(p.name)}">📦 ${esc(p.name)}</option>`);
        }
        if (selectedName && !names.has(selectedName)) {
            opts.push(`<option value="${esc(selectedName)}">⚠️ ${esc(selectedName)}（套装已删）</option>`);
        }
        sel.innerHTML = opts.join('');
        sel.value = selectedName || '';
    }

    // --- 👤 用户人设卡仓库逻辑 ---
    async function loadUserCards() {
        try {
            const res = await fetch(`${API_BASE}/api/users`);
            const data = await res.json();
            savedUserCards = (res.ok && data.success) ? (data.data || []) : [];
            renderUserCardChips();
        } catch {}
    }

    function renderUserCardChips() {
        const box = document.getElementById('userPresetsList');
        const updBtn = document.getElementById('updateUserCardBtn');
        if (updBtn) updBtn.style.display = draftActiveUserId ? 'inline-block' : 'none';
        if (!box) return;
        if (!savedUserCards.length) {
            box.innerHTML = `<span style="font-size:12px;color:#57534e;">暂无保存的用户卡，填好下方自设点「+ 存为新用户卡」即可建立你的 OC/马甲仓库～</span>`;
            return;
        }
        box.innerHTML = savedUserCards.map(u => {
            const isAct = String(u.id) === String(draftActiveUserId);
            const relHint = (u.use_quick_relation && u.user_relation) ? `<span class="vault-tag-mini">${esc(u.user_relation.slice(0, 8))}</span>` : '';
            return `<div class="preset-chip vault-chip ${isAct ? 'active-card' : ''}" onclick="window.VaultUI.applyUserCard(${u.id})">
                ${u.avatar ? `<img class="chip-ava" src="${u.avatar}">` : `<span class="dot" style="background:var(--accent)"></span>`}
                <span>${esc(u.user_name)}</span>
                ${relHint}
                <span class="del-x" onclick="event.stopPropagation();window.VaultUI.deleteUserCard(${u.id})" title="删除该用户卡">×</span>
            </div>`;
        }).join('');
    }

    function applyUserCard(id) {
        const u = savedUserCards.find(x => x.id === id);
        if (!u) return;
        draftActiveUserId = u.id;
        document.getElementById('cfgUserName').value = u.user_name || '';
        document.getElementById('cfgUserRelation').value = u.user_relation || '';
        document.getElementById('cfgCharCallUser').value = u.char_call_user || '';
        document.getElementById('cfgUserPersona').value = u.user_persona || '';
        if (typeof draftUserAvatar !== 'undefined') draftUserAvatar = u.avatar || '';
        if (typeof draftUseQuickRelation !== 'undefined') draftUseQuickRelation = Boolean(u.use_quick_relation);
        const preview = document.getElementById('userAvatarPreview');
        if (preview && typeof renderAvatarHtml === 'function') {
            preview.innerHTML = renderAvatarHtml(u.avatar || '', u.user_name || '我');
        }
        if (typeof syncQuickRelationUI === 'function') syncQuickRelationUI();
        renderUserCardChips();
        const fb = document.getElementById('userPresetFeedback');
        if (fb) {
            fb.style.color = '#fbbf24';
            fb.innerText = `✨ 已载入用户人设卡【${u.user_name}】，点下方「保存我的设定」即可正式切换马甲！`;
        }
    }

    function readUserFormPayload() {
        const user_name = document.getElementById('cfgUserName')?.value.trim() || '';
        const user_relation = document.getElementById('cfgUserRelation')?.value.trim() || '';
        const char_call_user = document.getElementById('cfgCharCallUser')?.value.trim() || '';
        const user_persona = document.getElementById('cfgUserPersona')?.value.trim() || '';
        const use_quick_relation = (typeof draftUseQuickRelation !== 'undefined' && draftUseQuickRelation && Boolean(user_relation || char_call_user)) ? 1 : 0;
        const avatar = typeof draftUserAvatar !== 'undefined' ? draftUserAvatar : '';
        return { user_name, avatar, use_quick_relation, user_relation, char_call_user, user_persona };
    }

    async function saveAsNewUserCard() {
        const fb = document.getElementById('userPresetFeedback');
        const payload = readUserFormPayload();
        if (!payload.user_name) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = '⚠️ 请先填好你的名字再存入仓库哦～'; }
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/users`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '保存失败');
            draftActiveUserId = data.card.id;
            await loadUserCards();
            if (fb) { fb.style.color = '#4ade80'; fb.innerText = `✅ 用户人设卡【${payload.user_name}】已存入 data/users/users.db！`; }
        } catch (e) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = `❌ ${e.message}`; }
        }
    }

    async function updateCurrentUserCard() {
        if (!draftActiveUserId) return;
        const fb = document.getElementById('userPresetFeedback');
        const payload = readUserFormPayload();
        if (!payload.user_name) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = '⚠️ 名字不能为空哦～'; }
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/users/${draftActiveUserId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '更新失败');
            await loadUserCards();
            if (fb) { fb.style.color = '#4ade80'; fb.innerText = `✅ 已覆盖更新用户卡【${payload.user_name}】！`; }
        } catch (e) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = `❌ ${e.message}`; }
        }
    }

    async function deleteUserCard(id) {
        if (!confirm('确定删除这张用户人设卡吗？（不会影响任何角色的聊天记忆）')) return;
        await fetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' });
        if (String(draftActiveUserId) === String(id)) draftActiveUserId = null;
        await loadUserCards();
    }

    // --- 🪪 角色卡原地更新 + 绑定预设 ---
    function readCharFormPayload() {
        return {
            char_name: document.getElementById('cfgCharName')?.value.trim() || '',
            persona: document.getElementById('cfgPersona')?.value.trim() || '',
            avatar: typeof draftCharAvatar !== 'undefined' ? draftCharAvatar : '',
            ink_color: (typeof appConfig !== 'undefined' && appConfig.inkColor) || '#1c1917',
            note_color: (typeof appConfig !== 'undefined' && appConfig.noteColor) || '#fef08a',
            voice_enabled: document.getElementById('cfgCharVoiceEnabled')?.checked ? 1 : 0,
            voice_id: document.getElementById('cfgCharVoiceId')?.value.trim() || 'male-qn-jingying',
            voice_speed: parseFloat(document.getElementById('cfgCharVoiceSpeed')?.value) || 1.0,
            voice_prompt: document.getElementById('cfgCharVoicePrompt')?.value.trim() || '',
            preset_profile: document.getElementById('cfgCharPresetProfile')?.value.trim() || ''
        };
    }

    async function updateCurrentCharCard() {
        if (!draftEditingCharId) return;
        const fb = document.getElementById('presetFeedback');
        const payload = readCharFormPayload();
        if (!payload.char_name || !payload.persona) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = '⚠️ 角色名和人设不能为空哦！'; }
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/api/characters/${draftEditingCharId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || '更新失败');
            if (typeof loadCharacterCards === 'function') await loadCharacterCards();
            if (fb) { fb.style.color = '#4ade80'; fb.innerText = `✅ 角色卡【${payload.char_name}】已原地覆盖更新！（记得点下方应用生效）`; }
        } catch (e) {
            if (fb) { fb.style.color = '#f87171'; fb.innerText = `❌ ${e.message}`; }
        }
    }

    // 3. 升级角色卡芯片渲染（高亮当前选中 + 显示绑定预设套装标签）
    function enhanceCharacterChips() {
        window.renderCharacterPresets = function () {
            const box = document.getElementById('characterPresetsList');
            if (!box || typeof savedCharacters === 'undefined') return;
            if (!savedCharacters.length) {
                box.innerHTML = `<span style="font-size:12px;color:#57534e;">暂无保存的角色卡，填好下方信息点右上角即可保存～</span>`;
                return;
            }
            const curKey = typeof draftActiveCharKey !== 'undefined' ? draftActiveCharKey : (appConfig?.activeCharKey || '');
            box.innerHTML = savedCharacters.map(c => {
                const isAct = c.char_key === curKey;
                const presetTag = c.preset_profile ? `<span class="vault-tag-mini" title="绑定预设套装：${esc(c.preset_profile)}">📚${esc(c.preset_profile.slice(0, 6))}</span>` : '';
                return `<div class="preset-chip vault-chip ${isAct ? 'active-card' : ''}" onclick="applyCharacterCard(${c.id})">
                    ${c.avatar ? `<img class="chip-ava" src="${c.avatar}">` : `<span class="dot" style="background:${c.ink_color || '#1c1917'}"></span>`}
                    <span>${esc(c.char_name)}</span>
                    <span style="opacity:0.65;font-size:10.5px;">(${c.memory_count || 0})</span>
                    ${presetTag}
                    <span class="del-x" onclick="event.stopPropagation();deleteCharacterCard(${c.id})">×</span>
                </div>`;
            }).join('');
        };
    }

    // 4. 无感挂钩弹窗与保存流程（完全兼容 voice-ui.js）
    function hookModals() {
        // 用户卡弹窗
        if (typeof window.openUserModal === 'function') {
            const orig = window.openUserModal;
            window.openUserModal = async function () {
                orig.apply(this, arguments);
                draftActiveUserId = (typeof appConfig !== 'undefined' && appConfig.activeUserId) ? parseInt(appConfig.activeUserId, 10) || null : null;
                const fb = document.getElementById('userPresetFeedback');
                if (fb) fb.innerText = '';
                await loadUserCards();
            };
        }
        if (typeof window.saveUserPanel === 'function') {
            const orig = window.saveUserPanel;
            window.saveUserPanel = async function () {
                try {
                    await fetch(`${API_BASE}/api/config`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ activeUserId: draftActiveUserId ? String(draftActiveUserId) : '' })
                    });
                } catch {}
                return orig.apply(this, arguments);
            };
        }

        // 角色卡弹窗
        if (typeof window.openCharacterModal === 'function') {
            const orig = window.openCharacterModal;
            window.openCharacterModal = async function () {
                await orig.apply(this, arguments);
                updateCharEditStateUI(appConfig?.activeCharKey, appConfig?.memoryFile);
                await refreshPresetProfileSelect(appConfig?.presetProfile || '');
            };
        }
        if (typeof window.applyCharacterCard === 'function') {
            const orig = window.applyCharacterCard;
            window.applyCharacterCard = function (id) {
                orig.apply(this, arguments);
                if (typeof savedCharacters !== 'undefined') {
                    const card = savedCharacters.find(x => x.id === id);
                    if (card) {
                        updateCharEditStateUI(card.char_key, card.memory_file);
                        refreshPresetProfileSelect(card.preset_profile || '');
                        if (typeof renderCharacterPresets === 'function') renderCharacterPresets();
                    }
                }
            };
        }
        if (typeof window.saveCharacterPanel === 'function') {
            const orig = window.saveCharacterPanel;
            window.saveCharacterPanel = async function () {
                const selectedProfile = document.getElementById('cfgCharPresetProfile')?.value.trim() || '';
                let appliedName = '';
                try {
                    const res = await fetch(`${API_BASE}/api/config`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            presetProfile: selectedProfile,
                            applyPresetProfile: Boolean(selectedProfile)
                        })
                    });
                    const d = await res.json();
                    appliedName = d.appliedProfileName || '';
                } catch {}
                const ret = await orig.apply(this, arguments);
                if (appliedName && typeof showCommBanner === 'function') {
                    showCommBanner('✨ 已切换角色与专属预设', `已自动联动启用预设套装【${appliedName}】～`, false);
                }
                return ret;
            };
        }

        // 存为新角色卡（完整携带音色 + 绑定预设套装）
        window.saveAsNewCharacterCard = async function () {
            const fb = document.getElementById('presetFeedback');
            const payload = readCharFormPayload();
            if (!payload.char_name || !payload.persona) {
                if (fb) { fb.style.color = '#f87171'; fb.innerText = '⚠️ 请先填好名字和人设哦！'; }
                return;
            }
            const res = await fetch(`${API_BASE}/api/characters`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                if (fb) { fb.style.color = '#f87171'; fb.innerText = `❌ ${data.message}`; }
                return;
            }
            if (data.card?.char_key && typeof draftActiveCharKey !== 'undefined') {
                draftActiveCharKey = data.card.char_key;
            }
            updateCharEditStateUI(data.card?.char_key, data.card?.memory_file);
            if (fb) {
                fb.style.color = '#4ade80';
                fb.innerText = `✅ 角色卡【${payload.char_name}】已存入 characters.db 并分配独立库 ${data.card?.memory_file}！（点下方应用切换）`;
            }
            if (typeof loadCharacterCards === 'function') await loadCharacterCards();
        };
    }

    window.VaultUI = {
        applyUserCard,
        saveAsNewUserCard,
        updateCurrentUserCard,
        deleteUserCard,
        updateCurrentCharCard
    };

    injectStyles();
    injectUserCardsWarehouse();
    injectCharacterVaultExtensions();
    enhanceCharacterChips();
    hookModals();
})();