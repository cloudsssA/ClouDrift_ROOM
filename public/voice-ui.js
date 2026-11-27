// public/voice-ui.js —— 独立角色语音前端模块（MiniMax/自定义设置 + 双方统一微信风声波气泡 + 用户麦克风录音自动转标准 WAV 适配 Gemini！）
(function () {
    const voiceAudioStore = new Map();
    let voiceSeq = 0;
    let activeAudio = null;
    let activePlayBtn = null;

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function toggleEye(inputId, btn) {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        const isPwd = inp.type === 'password';
        inp.type = isPwd ? 'text' : 'password';
        if (btn) btn.innerText = isPwd ? '🙈' : '👁️';
    }

    // 根据 WAV DataURL 直接免解码算出精准秒数（秒显示如 4"！）
    function estimateWavSeconds(dataUrl) {
        try {
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/wav;base64,')) return 0;
            const b64 = dataUrl.slice('data:audio/wav;base64,'.length);
            const headBin = atob(b64.slice(0, 64));
            if (headBin.length < 44) return 0;
            const bytes = new Uint8Array(headBin.length);
            for (let i = 0; i < headBin.length; i++) bytes[i] = headBin.charCodeAt(i);
            const view = new DataView(bytes.buffer);
            const byteRate = view.getUint32(28, true);
            const dataSize = view.getUint32(40, true);
            if (byteRate > 0 && dataSize > 0) {
                return Math.max(1, Math.round(dataSize / byteRate));
            }
        } catch {}
        return 0;
    }

    // 浏览器原生将任意录音 Blob 转码为 16kHz 单声道 16-bit WAV（100% 兼容 Gemini / OpenAI，告别 audio/webm 500 报错！）
    async function convertBlobToWavDataUrl(blob) {
        const arrBuf = await blob.arrayBuffer();
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        try {
            const decoded = await ctx.decodeAudioData(arrBuf);
            const targetRate = 16000;
            const dur = Math.max(0.25, decoded.duration || 1);
            const frameCount = Math.max(1, Math.ceil(dur * targetRate));
            const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const offline = new OfflineCtx(1, frameCount, targetRate);
            const src = offline.createBufferSource();
            src.buffer = decoded;
            src.connect(offline.destination);
            src.start(0);
            const rendered = await offline.startRendering();
            const pcm = rendered.getChannelData(0);

            const dataSize = pcm.length * 2;
            const wavBuf = new ArrayBuffer(44 + dataSize);
            const view = new DataView(wavBuf);
            const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + dataSize, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, targetRate, true);
            view.setUint32(28, targetRate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeStr(36, 'data');
            view.setUint32(40, dataSize, true);

            let offset = 44;
            for (let i = 0; i < pcm.length; i++) {
                const s = Math.max(-1, Math.min(1, pcm[i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
                offset += 2;
            }

            const outBytes = new Uint8Array(wavBuf);
            let binary = '';
            const chunk = 0x8000;
            for (let i = 0; i < outBytes.length; i += chunk) {
                binary += String.fromCharCode.apply(null, outBytes.subarray(i, i + chunk));
            }
            return `data:audio/wav;base64,${btoa(binary)}`;
        } finally {
            try { ctx.close(); } catch {}
        }
    }

    // 1. 注入专属样式（双方统一微信风动态声波气泡 + 覆写药丸 + 密码小眼睛）
    function injectStyles() {
        if (document.getElementById('voiceUiStyles')) return;
        const style = document.createElement('style');
        style.id = 'voiceUiStyles';
        style.textContent = `
            .voice-msg-card { display: flex; flex-direction: column; gap: 6px; min-width: 146px; }
            .voice-play-row { display: flex; align-items: center; gap: 7px; }
            .voice-play-pill {
                flex: 1; display: inline-flex; align-items: center; gap: 8px;
                background: rgba(255, 255, 255, 0.12); border: 1px solid rgba(255, 255, 255, 0.2);
                color: inherit; padding: 6px 12px; border-radius: 999px; cursor: pointer;
                font-size: 12.5px; font-weight: 500; transition: all 0.2s; user-select: none;
            }
            .voice-play-pill:hover { background: rgba(255, 255, 255, 0.2); border-color: var(--accent, #d97706); }
            .voice-play-pill.playing {
                background: rgba(217, 119, 6, 0.30); border-color: var(--accent, #d97706); color: #fef3c7;
            }
            .im-bubble-row.user .voice-play-pill {
                background: rgba(255, 255, 255, 0.16);
                border-color: rgba(255, 255, 255, 0.26);
                justify-content: space-between;
            }
            .im-bubble-row.user .voice-play-pill.playing {
                background: rgba(255, 255, 255, 0.28);
                border-color: rgba(255, 255, 255, 0.55);
                color: inherit;
            }
            .voice-bars { display: inline-flex; align-items: flex-end; gap: 2.5px; height: 14px; flex-shrink: 0; }
            .voice-bars i {
                display: block; width: 2.5px; border-radius: 99px; background: currentColor;
                height: 5px; transition: height 0.15s;
            }
            .voice-bars i:nth-child(2) { height: 10px; }
            .voice-bars i:nth-child(3) { height: 7px; }
            .voice-bars i:nth-child(4) { height: 12px; }
            .voice-play-pill.playing .voice-bars i { animation: voiceWave 0.72s ease-in-out infinite alternate; }
            .voice-play-pill.playing .voice-bars i:nth-child(2) { animation-delay: 0.15s; }
            .voice-play-pill.playing .voice-bars i:nth-child(3) { animation-delay: 0.3s; }
            .voice-play-pill.playing .voice-bars i:nth-child(4) { animation-delay: 0.45s; }
            @keyframes voiceWave {
                0% { height: 4px; opacity: 0.55; }
                100% { height: 14px; opacity: 1; }
            }
            .voice-trans-btn {
                background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.16);
                color: inherit; opacity: 0.9; font-size: 11px; padding: 5px 8px; border-radius: 999px;
                cursor: pointer; white-space: nowrap; transition: all 0.18s;
            }
            .voice-trans-btn:hover { background: rgba(255, 255, 255, 0.2); opacity: 1; }
            .voice-transcript {
                display: none; font-size: 13px; line-height: 1.5; color: inherit; opacity: 0.94;
                padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.22);
                white-space: pre-wrap; word-break: break-word;
            }
            .voice-transcript.show { display: block; }
            .voice-extra-text {
                font-size: 13px; line-height: 1.48; padding-top: 4px;
                border-top: 1px dashed rgba(255, 255, 255, 0.22);
                white-space: pre-wrap; word-break: break-word;
            }
            .voice-pwd-wrap { position: relative; display: flex; align-items: center; }
            .voice-pwd-wrap input { width: 100%; padding-right: 34px !important; }
            .voice-eye-btn {
                position: absolute; right: 6px; background: none; border: none; color: #a8a29e;
                cursor: pointer; font-size: 13px; padding: 4px 6px; border-radius: 6px; line-height: 1;
            }
            .voice-eye-btn:hover { color: #fef3c7; background: rgba(255,255,255,0.08); }
            .char-voice-body { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #33302d; }
            .char-voice-body.open { display: block; }
            .char-voice-mode-badge {
                display: inline-block; font-size: 10.5px; padding: 1px 8px; border-radius: 999px;
                background: rgba(74, 222, 128, 0.14); color: #86efac; border: 1px solid rgba(74, 222, 128, 0.35);
                font-weight: 500;
            }
            .char-voice-mode-badge.custom {
                background: rgba(217, 119, 6, 0.24); color: #fde68a; border-color: rgba(217, 119, 6, 0.55);
            }
        `;
        document.head.appendChild(style);
    }

    // 2. 注入 ⚙️ 设置中的 TTS 语音引擎配置
    function injectSettingsSection() {
        const modal = document.getElementById('settingsModal');
        if (!modal || document.getElementById('ttsSettingsSection')) return;

        const anchor = document.getElementById('apiTestStatus')?.closest('.form-group');
        const box = document.createElement('div');
        box.id = 'ttsSettingsSection';
        box.className = 'settings-section-box';
        box.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;">
                <span style="font-size:13px;color:#fef3c7;font-weight:500;">🎙️ 角色语音引擎（默认 MiniMax · 支持自定义）</span>
                <button class="mini-btn" type="button" id="ttsTestGlobalBtn" onclick="window.VoiceUI.testTts('global')">🔊 试听测试</button>
            </div>
            <div class="form-group">
                <label>TTS 接口地址（支持 MiniMax T2A v2 或 OpenAI 兼容 /audio/speech）</label>
                <input id="cfgTtsBaseUrl" placeholder="https://api.minimax.chat/v1/t2a_v2">
            </div>
            <div class="form-group">
                <label>语音 API Key（加密隐藏，点小眼睛可查看）</label>
                <div class="voice-pwd-wrap">
                    <input id="cfgTtsApiKey" type="password" placeholder="粘贴 MiniMax 或自定义语音 API Key">
                    <button type="button" class="voice-eye-btn" onclick="window.VoiceUI.toggleEye('cfgTtsApiKey', this)" title="显示/隐藏语音密钥">👁️</button>
                </div>
            </div>
            <div class="color-grid">
                <div class="form-group" style="margin-bottom:4px;">
                    <label>GroupId（MiniMax 必填，其他可留空）</label>
                    <input id="cfgTtsGroupId" placeholder="例如：1823456789...">
                </div>
                <div class="form-group" style="margin-bottom:4px;">
                    <label>语音模型名称</label>
                    <input id="cfgTtsModel" placeholder="speech-02-hd">
                </div>
            </div>
            <div class="status-msg" id="ttsTestStatus"></div>
        `;
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(box, anchor.nextSibling);
        } else {
            const boxInner = modal.querySelector('.modal-box');
            const submitBtn = boxInner?.querySelector('.btn-primary');
            if (boxInner && submitBtn) boxInner.insertBefore(box, submitBtn);
        }
    }

    // 3. 注入 🪪 角色卡中的角色专属语音覆写区
    function injectCharacterSection() {
        const modal = document.getElementById('characterModal');
        if (!modal || document.getElementById('charVoiceSection')) return;

        const anchor = document.getElementById('cfgPersona')?.closest('.form-group');
        const box = document.createElement('div');
        box.id = 'charVoiceSection';
        box.className = 'settings-section-box';
        box.innerHTML = `
            <label class="switch-row" style="padding:0;">
                <span>🎙️ 启用该角色的语音消息<small>开启后可在通讯中用 &lt;voice&gt; 开口说话（发语音前自动清理括号动作旁白）</small></span>
                <input type="checkbox" id="cfgCharVoiceEnabled" onchange="window.VoiceUI.syncCharVoiceToggle()">
            </label>
            <div class="char-voice-body" id="charVoiceBody">
                <div class="color-grid">
                    <div class="form-group">
                        <label>专属音色 Voice ID</label>
                        <input id="cfgCharVoiceId" placeholder="male-qn-jingying">
                    </div>
                    <div class="form-group">
                        <label>语速：<span id="charVoiceSpeedVal">1.00x</span></label>
                        <input type="range" id="cfgCharVoiceSpeed" min="0.6" max="1.6" step="0.05" value="1.0" oninput="document.getElementById('charVoiceSpeedVal').innerText = Number(this.value).toFixed(2) + 'x'">
                    </div>
                </div>
                <div class="form-group" style="margin-bottom:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap;">
                        <label style="margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                            <span>📜 角色专属语音覆写（选填）</span>
                            <span class="char-voice-mode-badge" id="charVoiceModeBadge">🌐 跟随预设圣殿（热同步）</span>
                        </label>
                        <button type="button" class="mini-btn" style="padding:2px 8px;font-size:11px;" onclick="window.VoiceUI.clearVoicePrompt()">🧹 清空（跟随全局）</button>
                    </div>
                    <textarea id="cfgCharVoicePrompt" style="min-height:86px;line-height:1.52;" placeholder="留空即可！留空时自动热同步「🎛️ 配置 → 预设圣殿」里的全局语音触发规则；仅当想给这个角色单独定制特殊发语音习惯/频率时，才需要写在这里～" oninput="window.VoiceUI.syncVoicePromptBadge()"></textarea>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                    <div class="status-msg" id="charVoiceTestStatus" style="margin:0;flex:1;"></div>
                    <button type="button" class="mini-btn" id="ttsTestCharBtn" onclick="window.VoiceUI.testTts('char')">🔊 试听此音色</button>
                </div>
            </div>
        `;
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(box, anchor.nextSibling);
        }
    }

    function syncCharVoiceToggle() {
        const enabled = Boolean(document.getElementById('cfgCharVoiceEnabled')?.checked);
        document.getElementById('charVoiceBody')?.classList.toggle('open', enabled);
    }

    function syncVoicePromptBadge() {
        const prm = document.getElementById('cfgCharVoicePrompt');
        const badge = document.getElementById('charVoiceModeBadge');
        if (!prm || !badge) return;
        const hasCustom = Boolean(prm.value.trim());
        badge.classList.toggle('custom', hasCustom);
        badge.innerText = hasCustom ? '✨ 角色专属覆写生效中' : '🌐 跟随预设圣殿（热同步）';
    }

    function fillTtsSettingsForm() {
        if (typeof appConfig === 'undefined') return;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
        setVal('cfgTtsBaseUrl', appConfig.ttsBaseURL || 'https://api.minimax.chat/v1/t2a_v2');
        setVal('cfgTtsApiKey', appConfig.ttsApiKey || '');
        setVal('cfgTtsGroupId', appConfig.ttsGroupId || '');
        setVal('cfgTtsModel', appConfig.ttsModel || 'speech-02-hd');
        const st = document.getElementById('ttsTestStatus');
        if (st) st.innerText = '';
    }

    function fillCharVoiceForm(src) {
        const chk = document.getElementById('cfgCharVoiceEnabled');
        const vid = document.getElementById('cfgCharVoiceId');
        const spd = document.getElementById('cfgCharVoiceSpeed');
        const spdLbl = document.getElementById('charVoiceSpeedVal');
        const prm = document.getElementById('cfgCharVoicePrompt');
        const st = document.getElementById('charVoiceTestStatus');

        const enabled = Boolean(src?.voiceEnabled ?? src?.voice_enabled);
        const speedNum = parseFloat(src?.voiceSpeed ?? src?.voice_speed) || 1.0;
        const factoryVoice = (typeof appConfig !== 'undefined' && appConfig.factoryVoicePrompt || '').trim();
        const rawOverride = String(src?.voicePrompt ?? src?.voice_prompt ?? '').trim();
        const finalOverride = (rawOverride && rawOverride !== factoryVoice) ? rawOverride : '';

        if (chk) chk.checked = enabled;
        if (vid) vid.value = (src?.voiceId ?? src?.voice_id) || 'male-qn-jingying';
        if (spd) spd.value = String(speedNum);
        if (spdLbl) spdLbl.innerText = `${speedNum.toFixed(2)}x`;
        if (prm) prm.value = finalOverride;
        if (st) st.innerText = '';
        syncCharVoiceToggle();
        syncVoicePromptBadge();
    }

    function clearVoicePrompt() {
        const prm = document.getElementById('cfgCharVoicePrompt');
        if (prm) prm.value = '';
        syncVoicePromptBadge();
    }

    function stopActiveAudio() {
        if (activeAudio) {
            try { activeAudio.pause(); activeAudio.currentTime = 0; } catch {}
            activeAudio = null;
        }
        if (activePlayBtn) {
            activePlayBtn.classList.remove('playing');
            const label = activePlayBtn.querySelector('.voice-btn-label');
            if (label) label.innerText = activePlayBtn.dataset.idleLabel || '播放语音';
            activePlayBtn = null;
        }
    }

    function playVoice(storeKey, btnEl) {
        const src = voiceAudioStore.get(storeKey);
        if (!src) return;
        const isSame = activePlayBtn === btnEl;
        stopActiveAudio();
        if (isSame) return;

        const audio = new Audio(src);
        activeAudio = audio;
        activePlayBtn = btnEl;
        btnEl.classList.add('playing');
        const label = btnEl.querySelector('.voice-btn-label');
        if (label) label.innerText = '播放中...';

        audio.onended = () => stopActiveAudio();
        audio.onerror = () => {
            stopActiveAudio();
            if (typeof showCommBanner === 'function') showCommBanner('⚠️ 语音播放失败', '音频数据无法解码或链接已过期', false);
        };
        audio.play().catch(err => {
            stopActiveAudio();
            if (typeof showCommBanner === 'function') showCommBanner('⚠️ 浏览器拦截了自动播放', err.message, false);
        });
    }

    function toggleTranscript(btnEl) {
        const card = btnEl.closest('.voice-msg-card');
        const box = card?.querySelector('.voice-transcript');
        if (!box) return;
        const shown = box.classList.toggle('show');
        btnEl.innerText = shown ? '收起文字' : '📄 转文字';
    }

    async function testTts(source) {
        const isChar = source === 'char';
        const btn = document.getElementById(isChar ? 'ttsTestCharBtn' : 'ttsTestGlobalBtn');
        const st = document.getElementById(isChar ? 'charVoiceTestStatus' : 'ttsTestStatus');
        if (btn) btn.disabled = true;
        if (st) { st.style.color = '#fbbf24'; st.innerText = '🎙️ 正在请求语音合成...'; }

        const payload = {
            text: '（轻轻叹气推了下眼镜）连线测试成功，快专心看书吧。',
            ttsBaseURL: document.getElementById('cfgTtsBaseUrl')?.value.trim() || appConfig.ttsBaseURL,
            ttsApiKey: document.getElementById('cfgTtsApiKey')?.value.trim() || appConfig.ttsApiKey,
            ttsGroupId: document.getElementById('cfgTtsGroupId')?.value.trim() ?? appConfig.ttsGroupId,
            ttsModel: document.getElementById('cfgTtsModel')?.value.trim() || appConfig.ttsModel,
            voiceId: document.getElementById('cfgCharVoiceId')?.value.trim() || appConfig.voiceId,
            voiceSpeed: parseFloat(document.getElementById('cfgCharVoiceSpeed')?.value) || appConfig.voiceSpeed || 1.0
        };

        try {
            const res = await fetch(`${API_BASE}/api/tts/test`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok || !data.success || !data.audioData) throw new Error(data.message || `HTTP ${res.status}`);

            stopActiveAudio();
            const testAudio = new Audio(data.audioData);
            activeAudio = testAudio;
            testAudio.play().catch(() => {});
            if (st) {
                st.style.color = '#4ade80';
                st.innerText = `✅ 试听成功！清洗后朗读：“${data.spokenText}”`;
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // 4. 升级麦克风录音：录完自动转成标准 16kHz 单声道 WAV，彻底修复 Gemini 不支持 audio/webm 的报错！
    const voiceButton = document.getElementById('chatVoiceBtn');
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm';
    picker.hidden = true;
    voiceButton.after(picker);
    let take = null;
    let fileMode = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
    function refreshButton() {
        voiceButton.textContent = fileMode ? '🎵' : '🎙️';
        voiceButton.title = fileMode ? '选择语音文件发送' : '点击录音，再点完成';
        voiceButton.setAttribute('aria-label',voiceButton.title);
        voiceButton.classList.remove('recording');
    }
    function current(t) { return take === t && t.owner === chatKey(); }
    function status(message) { document.getElementById('imSubStatus').textContent = message; }
    function release(t) { t?.stream?.getTracks().forEach(track=>track.stop()); }
    function cancelVoice() {
        const old = take;
        take = null;
        if (old?.recorder?.state === 'recording') old.recorder.stop();
        release(old);
        refreshButton();
    }
    async function attach(t,blob) {
        if (!current(t)) return;
        try {
            if (!blob.size) throw Error('录音为空，请重新录制');
            if (blob.size > 16*1024*1024) throw Error('语音文件过大，请剪短后再发送');
            status('正在准备语音…');
            let data, format;
            try {
                data = await convertBlobToWavDataUrl(blob);
                format = 'wav';
            } catch {
                const ext = (blob.name || '').split('.').pop().toLowerCase();
                const mime = blob.type.split(';')[0].toLowerCase();
                const types = {'audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/webm':'webm'};
                format = types[mime] || (Object.values(types).includes(ext) ? ext : '');
                if (!format) throw Error('无法读取这段音频，请选择 M4A、WAV 或 MP3');
                const normalized = blob.slice(0,blob.size,Object.keys(types).find(k=>types[k]===format));
                data = await new Promise((resolve,reject)=>{
                    const reader = new FileReader();
                    reader.onload = ()=>resolve(reader.result);
                    reader.onerror = ()=>reject(Error('文件读取失败'));
                    reader.readAsDataURL(normalized);
                });
            }
            if (!current(t)) return;
            if (data.length > 22*1024*1024) throw Error('语音太长，请剪短后再发送');
            pendingAudioBase64 = data;
            pendingAudioFormat = format;
            updateAttachPreviewUI();
            status('语音已就绪，可试听后发送');
        } catch (err) {
            if (current(t)) status(err.message || '读取语音失败，请重试');
        } finally {
            if (take === t) take = null;
        }
    }
    picker.onchange = () => {
        const file = picker.files[0];
        if (take && file) attach(take,file);
    };
    window.toggleVoiceRecording = async function () {
        if (take?.recorder?.state === 'recording') {
            take.recorder.stop();
            refreshButton();
            return;
        }
        if (take?.starting) return;
        cancelVoice();
        const t = {owner:chatKey()};
        take = t;
        if (fileMode) {
            picker.value = '';
            status('选择录好的音频；iPhone 可从「文件」选取语音备忘录');
            picker.click();
            return;
        }
        t.starting = true;
        try {
            t.stream = await navigator.mediaDevices.getUserMedia({audio:true});
            if (!current(t)) { release(t); return; }
            const mime = ['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(type=>MediaRecorder.isTypeSupported?.(type));
            const recorder = mime ? new MediaRecorder(t.stream,{mimeType:mime}) : new MediaRecorder(t.stream);
            const chunks = [];
            t.recorder = recorder;
            recorder.ondataavailable = e=>{ if(e.data.size) chunks.push(e.data); };
            recorder.onerror = () => {
                if (current(t)) { cancelVoice(); status('录音中断，请重试'); }
                release(t);
            };
            recorder.onstop = () => {
                release(t);
                if (!current(t)) return;
                refreshButton();
                attach(t,new Blob(chunks,{type:recorder.mimeType || chunks[0]?.type}));
            };
            recorder.start();
            voiceButton.classList.add('recording');
            voiceButton.textContent = '⏹️';
            status('正在录音，再点一次完成');
        } catch (err) {
            release(t);
            if (current(t)) {
                take = null;
                fileMode = true;
                refreshButton();
                status('麦克风不可用，点 🎵 可发送已有录音；允许麦克风后刷新可重试');
            }
        } finally { t.starting = false; }
    };
    refreshButton();

    // 5. 升级聊天气泡渲染：用户发出的语音 & 角色发出的语音统一渲染成微信风动态声波条！
    const origRenderBubbleInnerHtml = window.renderBubbleInnerHtml;
    window.renderBubbleInnerHtml = function (rawContent) {
        if (typeof parseMessageContent === 'function') {
            const obj = parseMessageContent(rawContent);
            if (obj && obj.audioData && !obj.isMusicClip) {
                const key = `v_${++voiceSeq}`;
                voiceAudioStore.set(key, obj.audioData);
                const secs = estimateWavSeconds(obj.audioData);
                const idleLabel = secs > 0 ? `语音 ${secs}"` : '播放语音';
                const textPart = String(obj.text || '').trim();
                const imgHtml = obj.imageData
                    ? `<img class="im-bubble-img" src="${obj.imageData}" alt="图片" onclick="window.open('${obj.imageData}', '_blank')">`
                    : '';

                // 角色语音（带折叠转文字按钮）
                if (obj.isVoiceMsg) {
                    const transBtn = textPart
                        ? `<button type="button" class="voice-trans-btn" onclick="window.VoiceUI.toggleTranscript(this)">📄 转文字</button>`
                        : '';
                    const transBody = textPart
                        ? `<div class="voice-transcript">${esc(textPart)}</div>`
                        : '';
                    return `<div class="voice-msg-card">
                        ${imgHtml}
                        <div class="voice-play-row">
                            <button type="button" class="voice-play-pill" data-idle-label="${esc(idleLabel)}" onclick="window.VoiceUI.playVoice('${key}', this)">
                                <span class="voice-bars"><i></i><i></i><i></i><i></i></span>
                                <span class="voice-btn-label">${esc(idleLabel)}</span>
                            </button>
                            ${transBtn}
                        </div>
                        ${transBody}
                    </div>`;
                }

                // 用户自己发出的语音（同款微信声波气泡！如附带文字则直接展示在下方）
                const extraTextHtml = textPart ? `<div class="voice-extra-text">${esc(textPart)}</div>` : '';
                return `<div class="voice-msg-card">
                    ${imgHtml}
                    <div class="voice-play-row">
                        <button type="button" class="voice-play-pill" data-idle-label="${esc(idleLabel)}" onclick="window.VoiceUI.playVoice('${key}', this)">
                            <span class="voice-btn-label">${esc(idleLabel)}</span>
                            <span class="voice-bars"><i></i><i></i><i></i><i></i></span>
                        </button>
                    </div>
                    ${extraTextHtml}
                </div>`;
            }
        }
        return origRenderBubbleInnerHtml ? origRenderBubbleInnerHtml(rawContent) : esc(rawContent);
    };

    // 6. 无感挂钩设置与角色卡弹窗
    function hookModals() {
        if (typeof window.openSettingsModal === 'function') {
            const orig = window.openSettingsModal;
            window.openSettingsModal = function () {
                orig.apply(this, arguments);
                fillTtsSettingsForm();
            };
        }
        if (typeof window.saveSettingsPanel === 'function') {
            const orig = window.saveSettingsPanel;
            window.saveSettingsPanel = async function () {
                try {
                    await fetch(`${API_BASE}/api/config`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            ttsBaseURL: document.getElementById('cfgTtsBaseUrl')?.value.trim() || 'https://api.minimax.chat/v1/t2a_v2',
                            ttsApiKey: document.getElementById('cfgTtsApiKey')?.value.trim() || '',
                            ttsGroupId: document.getElementById('cfgTtsGroupId')?.value.trim() || '',
                            ttsModel: document.getElementById('cfgTtsModel')?.value.trim() || 'speech-02-hd'
                        })
                    });
                } catch {}
                return orig.apply(this, arguments);
            };
        }
        if (typeof window.openCharacterModal === 'function') {
            const orig = window.openCharacterModal;
            window.openCharacterModal = async function () {
                await orig.apply(this, arguments);
                fillCharVoiceForm(appConfig);
            };
        }
        if (typeof window.applyCharacterCard === 'function') {
            const orig = window.applyCharacterCard;
            window.applyCharacterCard = function (id) {
                orig.apply(this, arguments);
                if (typeof savedCharacters !== 'undefined') {
                    const card = savedCharacters.find(x => x.id === id);
                    if (card) fillCharVoiceForm(card);
                }
            };
        }
        if (typeof window.saveCharacterPanel === 'function') {
            const orig = window.saveCharacterPanel;
            window.saveCharacterPanel = async function () {
                try {
                    await fetch(`${API_BASE}/api/config`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            voiceEnabled: Boolean(document.getElementById('cfgCharVoiceEnabled')?.checked),
                            voiceId: document.getElementById('cfgCharVoiceId')?.value.trim() || 'male-qn-jingying',
                            voiceSpeed: parseFloat(document.getElementById('cfgCharVoiceSpeed')?.value) || 1.0,
                            voicePrompt: document.getElementById('cfgCharVoicePrompt')?.value.trim() || ''
                        })
                    });
                } catch {}
                return orig.apply(this, arguments);
            };
        }
        window.saveAsNewCharacterCard = async function () {
            const fb = document.getElementById('presetFeedback');
            const char_name = document.getElementById('cfgCharName').value.trim();
            const persona = document.getElementById('cfgPersona').value.trim();
            if (!char_name || !persona) {
                if (fb) { fb.style.color = '#f87171'; fb.innerText = '⚠️ 请先填好名字和人设哦！'; }
                return;
            }
            const res = await fetch(`${API_BASE}/api/characters`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    char_name, persona,
                    avatar: typeof draftCharAvatar !== 'undefined' ? draftCharAvatar : '',
                    ink_color: appConfig.inkColor,
                    note_color: appConfig.noteColor,
                    voice_enabled: document.getElementById('cfgCharVoiceEnabled')?.checked ? 1 : 0,
                    voice_id: document.getElementById('cfgCharVoiceId')?.value.trim() || 'male-qn-jingying',
                    voice_speed: parseFloat(document.getElementById('cfgCharVoiceSpeed')?.value) || 1.0,
                    voice_prompt: document.getElementById('cfgCharVoicePrompt')?.value.trim() || ''
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                if (fb) { fb.style.color = '#f87171'; fb.innerText = `❌ ${data.message}`; }
                return;
            }
            if (data.card?.char_key && typeof draftActiveCharKey !== 'undefined') {
                draftActiveCharKey = data.card.char_key;
            }
            if (fb) { fb.style.color = '#4ade80'; fb.innerText = `✅ 角色卡【${char_name}】连同专属语音配置已存入仓库！（点下方「应用当前角色卡」即可切换）`; }
            if (typeof loadCharacterCards === 'function') await loadCharacterCards();
        };
    }

    window.VoiceUI = {
        cancelVoice,
        toggleEye,
        syncCharVoiceToggle,
        syncVoicePromptBadge,
        clearVoicePrompt,
        resetVoicePrompt: clearVoicePrompt,
        playVoice,
        toggleTranscript,
        testTts
    };

    injectStyles();
    injectSettingsSection();
    injectCharacterSection();
    hookModals();
})();