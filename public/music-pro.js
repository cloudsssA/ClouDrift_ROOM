// public/music-pro.js —— 本地音频上传命名 + 60秒可视化波形裁剪器 + 多模态分享卡片气泡
(function () {
    const MAX_CLIP_SEC = 60;
    const MIN_CLIP_SEC = 2;

    let clipTrack = null;
    let decodedBuffer = null;
    let clipStart = 0;
    let clipEnd = 20;
    let previewCtx = null;
    let previewSource = null;
    let previewStartedAt = 0;
    let previewRaf = null;
    let isPreviewPlaying = false;
    let wavePeaks = [];

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function fmtTime(sec) {
        const s = Math.max(0, Math.floor(Number(sec) || 0));
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${mm}:${ss}`;
    }

    function isLocalSong(song) {
        return Boolean(song && typeof song.url === 'string' && song.url.startsWith('/music-files/'));
    }

    function injectStyles() {
        if (document.getElementById('musicProStyles')) return;
        const style = document.createElement('style');
        style.id = 'musicProStyles';
        style.textContent = `
            .music-upload-zone {
                background: rgba(217, 119, 6, 0.10);
                border: 1.5px dashed rgba(217, 119, 6, 0.52);
                border-radius: 13px;
                padding: 13px;
                margin-bottom: 14px;
            }
            .music-upload-zone h4 {
                font-size: 13px;
                color: #fef3c7;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .music-divider {
                text-align: center;
                font-size: 11px;
                color: #78716c;
                margin: 12px 0;
                position: relative;
            }
            .music-divider::before, .music-divider::after {
                content: '';
                position: absolute;
                top: 50%;
                width: 34%;
                height: 1px;
                background: #33302d;
            }
            .music-divider::before { left: 0; }
            .music-divider::after { right: 0; }

            /* 波形裁剪器弹窗 */
            #musicClipModal .modal-box {
                max-width: 520px;
                width: 94%;
            }
            .clip-wave-wrap {
                position: relative;
                width: 100%;
                height: 92px;
                border-radius: 12px;
                background: #141312;
                border: 1px solid #3f3b37;
                overflow: hidden;
                margin-bottom: 12px;
                cursor: pointer;
            }
            .clip-wave-canvas {
                width: 100%;
                height: 100%;
                display: block;
            }
            .clip-range-info {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                font-size: 12px;
                color: #fde68a;
                margin-bottom: 8px;
                font-variant-numeric: tabular-nums;
            }
            .clip-slider-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
                margin-bottom: 12px;
            }
            .clip-slider-box {
                background: #181715;
                border: 1px solid #33302d;
                border-radius: 10px;
                padding: 8px 10px;
                font-size: 11.5px;
                color: #d6d3d1;
            }
            .clip-slider-box input[type="range"] {
                width: 100%;
                margin-top: 5px;
                accent-color: var(--accent, #d97706);
                cursor: pointer;
            }

            /* 聊天框内的黑胶风音乐分享卡片气泡 */
            .music-clip-bubble {
                display: flex;
                flex-direction: column;
                gap: 6px;
                min-width: 190px;
            }
            .music-clip-head {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .music-clip-disc {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background: radial-gradient(circle, #fbbf24 0%, #fbbf24 22%, #1c1917 24%, #1c1917 100%);
                border: 2px solid rgba(255, 255, 255, 0.25);
                flex-shrink: 0;
            }
            .music-clip-meta {
                min-width: 0;
                flex: 1;
            }
            .music-clip-title {
                font-size: 12.5px;
                font-weight: 600;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .music-clip-range {
                font-size: 10.5px;
                opacity: 0.82;
                font-variant-numeric: tabular-nums;
            }
            .music-clip-comment {
                font-size: 13px;
                line-height: 1.48;
                padding-top: 4px;
                border-top: 1px dashed rgba(255, 255, 255, 0.22);
            }
        `;
        document.head.appendChild(style);
    }

    // 1. 升级「+ 加歌」弹窗：置顶本地 MP3 上传 + 自由命名区！
    function upgradeSongModal() {
        const modal = document.getElementById('songModal');
        if (!modal || document.getElementById('localAudioUploadZone')) return;
        const box = modal.querySelector('.modal-box');
        const heading = box?.querySelector('h3');
        if (!box || !heading) return;

        const zone = document.createElement('div');
        zone.id = 'localAudioUploadZone';
        zone.className = 'music-upload-zone';
        zone.innerHTML = `
            <h4>
                <span>📁 上传本地音频（无版权限制 · 可剪片段分享给 TA）</span>
            </h4>
            <div class="form-group" style="margin-bottom:9px;">
                <label>选择本地音乐文件（MP3 / WAV / OGG / M4A / FLAC，上限 50MB）</label>
                <input type="file" id="localAudioFileInput" accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/*" onchange="window.MusicPro.onLocalFilePicked(event)">
            </div>
            <div class="form-group" style="margin-bottom:10px;">
                <label>给这首歌起个名字（自动识别文件名，可自由修改）</label>
                <input id="localAudioTitleInput" placeholder="例如：夜曲 - 自存版 / 某首很喜欢的BGM">
            </div>
            <button type="button" class="btn btn-primary" id="uploadLocalAudioBtn" style="width:100%;" onclick="window.MusicPro.uploadLocalAudio()">🎵 上传并加入留声机歌单</button>
            <div class="status-msg" id="localAudioUploadStatus"></div>
        `;

        const divider = document.createElement('div');
        divider.className = 'music-divider';
        divider.innerText = '或粘贴外链 / 网易云 ID';

        heading.insertAdjacentElement('afterend', divider);
        heading.insertAdjacentElement('afterend', zone);
    }

    // 2. 在留声机卡片顶部加一个「🎧 剪给TA」按钮（当前曲目为本地音频时立即可用！）
    function mountVinylShareButton() {
        const topBar = document.querySelector('.vinyl-top-bar > div');
        if (!topBar || document.getElementById('vinylClipShareBtn')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'vinylClipShareBtn';
        btn.className = 'mini-btn ai-only';
        btn.style.cssText = 'padding:3px 8px;font-size:11px;border-color:rgba(217,119,6,0.55);color:#fde68a;';
        btn.innerText = '🎧 剪给TA';
        btn.title = '从当前本地音频截取 2~60 秒片段发给 TA 一起听';
        btn.onclick = () => openClipModalForCurrent();
        topBar.insertBefore(btn, topBar.firstChild);
    }

    // 3. 创建「🎧 截取音乐片段分享给 TA」弹窗
    function mountClipModal() {
        if (document.getElementById('musicClipModal')) return;
        const wrap = document.createElement('div');
        wrap.id = 'musicClipModal';
        wrap.className = 'modal-backdrop';
        wrap.style.zIndex = '270';
        wrap.onclick = (e) => { if (e.target === wrap) closeClipModal(); };
        wrap.innerHTML = `
            <div class="modal-box">
                <h3>
                    <span>🎧 截取音乐片段分享给 TA</span>
                    <span style="cursor:pointer;color:#a8a29e" onclick="window.MusicPro.closeClipModal()">✕</span>
                </h3>
                <div style="font-size:12.5px;color:#e7e5e4;margin-bottom:10px;">
                    曲目：<strong id="clipTrackTitleLabel" style="color:#fef3c7;"></strong>
                    <span id="clipTotalDurLabel" style="font-size:11.5px;color:#a8a29e;margin-left:6px;"></span>
                </div>

                <div class="clip-wave-wrap" id="clipWaveWrap" title="点击波形图可快速把起点定位到该位置">
                    <canvas class="clip-wave-canvas" id="clipWaveCanvas" width="460" height="92"></canvas>
                </div>

                <div class="clip-range-info">
                    <span id="clipRangeText">选中片段：00:00 ~ 00:20（20 秒）</span>
                    <span style="font-size:11px;color:#a8a29e;">单次上限 60 秒 · 防 Token 爆炸</span>
                </div>

                <div class="clip-slider-grid">
                    <div class="clip-slider-box">
                        <div>起点：<strong id="clipStartVal">00:00</strong></div>
                        <input type="range" id="clipStartSlider" min="0" max="100" step="1" value="0" oninput="window.MusicPro.onStartSlider(this.value)">
                    </div>
                    <div class="clip-slider-box">
                        <div>终点：<strong id="clipEndVal">00:20</strong></div>
                        <input type="range" id="clipEndSlider" min="2" max="100" step="1" value="20" oninput="window.MusicPro.onEndSlider(this.value)">
                    </div>
                </div>

                <div class="form-group" style="margin-bottom:12px;">
                    <label>附带一句想对 TA 说的话（选填）</label>
                    <input id="clipUserCommentInput" placeholder="例如：听听看这段副歌！超级好听～">
                </div>

                <div class="status-msg" id="clipStatusMsg" style="margin-bottom:10px;"></div>

                <div style="display:flex;gap:10px;">
                    <button type="button" class="btn btn-secondary" id="clipPreviewBtn" style="flex:0.9;" onclick="window.MusicPro.togglePreview()">▶ 试听片段</button>
                    <button type="button" class="btn btn-primary" id="clipSendBtn" style="flex:1.2;" onclick="window.MusicPro.sendClipToAI()">📤 分享给 TA 听</button>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        // 点击波形快速定位起点
        document.getElementById('clipWaveWrap')?.addEventListener('click', (e) => {
            if (!decodedBuffer) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const total = decodedBuffer.duration;
            const curLen = Math.min(MAX_CLIP_SEC, Math.max(MIN_CLIP_SEC, clipEnd - clipStart));
            const nextStart = Math.min(Math.max(0, Math.floor(total - MIN_CLIP_SEC)), Math.floor(ratio * total));
            const nextEnd = Math.min(total, nextStart + curLen);
            clipStart = nextStart;
            clipEnd = Math.max(clipStart + MIN_CLIP_SEC, Math.min(total, nextEnd));
            syncClipSlidersAndCanvas();
        });
    }

    // 4. 本地文件上传与命名
    function onLocalFilePicked(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const titleInp = document.getElementById('localAudioTitleInput');
        if (titleInp) {
            titleInp.value = file.name.replace(/\.[^.]+$/, '');
        }
        const st = document.getElementById('localAudioUploadStatus');
        if (st) {
            st.style.color = '#a8a29e';
            st.innerText = `已选择：${file.name}（${(file.size / 1024 / 1024).toFixed(2)} MB）`;
        }
    }

    async function uploadLocalAudio() {
        const fileInp = document.getElementById('localAudioFileInput');
        const titleInp = document.getElementById('localAudioTitleInput');
        const btn = document.getElementById('uploadLocalAudioBtn');
        const st = document.getElementById('localAudioUploadStatus');
        const file = fileInp?.files?.[0];

        if (!file) {
            if (st) { st.style.color = '#f87171'; st.innerText = '⚠️ 请先选择一个本地音频文件哦～'; }
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            if (st) { st.style.color = '#f87171'; st.innerText = '⚠️ 单个音频文件请控制在 50MB 以内哦～'; }
            return;
        }

        const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();
        const title = (titleInp?.value || '').trim() || file.name.replace(/\.[^.]+$/, '');

        if (btn) { btn.disabled = true; btn.innerText = '⏳ 正在上传入库...'; }
        if (st) { st.style.color = '#fbbf24'; st.innerText = '正在保存到 data/music/files/...'; }

        try {
            const url = `${API_BASE}/api/music-pro/upload?title=${encodeURIComponent(title)}&ext=${encodeURIComponent(ext)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': file.type || 'application/octet-stream' },
                body: file
            });
            const data = await res.json();
            if (!res.ok || !data.success || !data.song) throw new Error(data.message || `HTTP ${res.status}`);

            if (typeof playlist !== 'undefined') {
                playlist.push(data.song);
                if (typeof renderPlaylistDirectory === 'function') renderPlaylistDirectory();
            }
            fileInp.value = '';
            if (titleInp) titleInp.value = '';
            if (st) st.innerText = '';
            if (typeof closeModal === 'function') closeModal('songModal');
            if (typeof showCommBanner === 'function') {
                showCommBanner('🎵 本地音乐已入库', `《${data.song.title}》已加入歌单！点「🎵 歌单」可播放或截取片段分享给 TA～`, false);
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = '🎵 上传并加入留声机歌单'; }
        }
    }

    // 5. 波形绘制 + 滑块同步 + 试听 + 编码轻量化 WAV
    function stopPreview() {
        isPreviewPlaying = false;
        if (previewSource) {
            try { previewSource.stop(); } catch {}
            previewSource = null;
        }
        if (previewRaf) {
            cancelAnimationFrame(previewRaf);
            previewRaf = null;
        }
        const btn = document.getElementById('clipPreviewBtn');
        if (btn) btn.innerText = '▶ 试听片段';
        drawWaveform();
    }

    function computePeaks(audioBuf, barCount = 110) {
        const ch = audioBuf.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / barCount));
        const peaks = [];
        for (let i = 0; i < barCount; i++) {
            let max = 0;
            const start = i * step;
            const end = Math.min(ch.length, start + step);
            for (let j = start; j < end; j += Math.max(1, Math.floor(step / 40))) {
                const v = Math.abs(ch[j]);
                if (v > max) max = v;
            }
            peaks.push(max);
        }
        const globalMax = Math.max(0.05, ...peaks);
        return peaks.map(p => p / globalMax);
    }

    function drawWaveform(playheadSec = null) {
        const canvas = document.getElementById('clipWaveCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (!decodedBuffer || !wavePeaks.length) {
            ctx.fillStyle = '#78716c';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('⏳ 正在解码音频波形...', W / 2, H / 2 + 4);
            return;
        }

        const total = decodedBuffer.duration || 1;
        const startX = (clipStart / total) * W;
        const endX = (clipEnd / total) * W;

        // 选中区间高亮背景
        ctx.fillStyle = 'rgba(217, 119, 6, 0.22)';
        ctx.fillRect(startX, 0, Math.max(2, endX - startX), H);

        // 绘制声波柱
        const barW = W / wavePeaks.length;
        for (let i = 0; i < wavePeaks.length; i++) {
            const x = i * barW;
            const barH = Math.max(4, wavePeaks[i] * (H - 18));
            const y = (H - barH) / 2;
            const inSel = x >= startX && x <= endX;
            ctx.fillStyle = inSel ? '#fbbf24' : 'rgba(168, 162, 158, 0.34)';
            ctx.fillRect(x + 1, y, Math.max(1.5, barW - 2), barH);
        }

        // 起止边界线
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(startX, 0, 2, H);
        ctx.fillRect(Math.max(0, endX - 2), 0, 2, H);

        // 试听播放扫描线
        if (playheadSec !== null && playheadSec >= clipStart && playheadSec <= clipEnd) {
            const px = (playheadSec / total) * W;
            ctx.fillStyle = '#38bdf8';
            ctx.fillRect(px, 0, 2, H);
        }
    }

    function syncClipSlidersAndCanvas() {
        if (!decodedBuffer) return;
        const total = Math.floor(decodedBuffer.duration);
        const sEl = document.getElementById('clipStartSlider');
        const eEl = document.getElementById('clipEndSlider');
        if (sEl) { sEl.max = String(Math.max(0, total - MIN_CLIP_SEC)); sEl.value = String(Math.floor(clipStart)); }
        if (eEl) { eEl.min = String(MIN_CLIP_SEC); eEl.max = String(Math.max(MIN_CLIP_SEC, total)); eEl.value = String(Math.ceil(clipEnd)); }

        const dur = Math.max(1, Math.round(clipEnd - clipStart));
        const sv = document.getElementById('clipStartVal');
        const ev = document.getElementById('clipEndVal');
        const rt = document.getElementById('clipRangeText');
        if (sv) sv.innerText = fmtTime(clipStart);
        if (ev) ev.innerText = fmtTime(clipEnd);
        if (rt) rt.innerText = `选中片段：${fmtTime(clipStart)} ~ ${fmtTime(clipEnd)}（共 ${dur} 秒）`;
        drawWaveform();
    }

    function onStartSlider(val) {
        if (!decodedBuffer) return;
        stopPreview();
        const total = decodedBuffer.duration;
        clipStart = Math.max(0, Math.min(total - MIN_CLIP_SEC, Number(val) || 0));
        if (clipEnd - clipStart < MIN_CLIP_SEC) clipEnd = Math.min(total, clipStart + MIN_CLIP_SEC);
        if (clipEnd - clipStart > MAX_CLIP_SEC) clipEnd = Math.min(total, clipStart + MAX_CLIP_SEC);
        syncClipSlidersAndCanvas();
    }

    function onEndSlider(val) {
        if (!decodedBuffer) return;
        stopPreview();
        const total = decodedBuffer.duration;
        clipEnd = Math.max(MIN_CLIP_SEC, Math.min(total, Number(val) || MIN_CLIP_SEC));
        if (clipEnd - clipStart < MIN_CLIP_SEC) clipStart = Math.max(0, clipEnd - MIN_CLIP_SEC);
        if (clipEnd - clipStart > MAX_CLIP_SEC) clipStart = Math.max(0, clipEnd - MAX_CLIP_SEC);
        syncClipSlidersAndCanvas();
    }

    function togglePreview() {
        if (!decodedBuffer) return;
        if (isPreviewPlaying) {
            stopPreview();
            return;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!previewCtx) previewCtx = new AudioCtx();
        if (previewCtx.state === 'suspended') previewCtx.resume();

        const src = previewCtx.createBufferSource();
        src.buffer = decodedBuffer;
        src.connect(previewCtx.destination);
        const dur = Math.max(1, clipEnd - clipStart);
        previewSource = src;
        previewStartedAt = previewCtx.currentTime;
        isPreviewPlaying = true;
        const btn = document.getElementById('clipPreviewBtn');
        if (btn) btn.innerText = '⏹ 停止试听';

        src.onended = () => {
            if (previewSource === src) stopPreview();
        };
        src.start(0, clipStart, dur);

        const tick = () => {
            if (!isPreviewPlaying) return;
            const elapsed = previewCtx.currentTime - previewStartedAt;
            drawWaveform(clipStart + elapsed);
            previewRaf = requestAnimationFrame(tick);
        };
        previewRaf = requestAnimationFrame(tick);
    }

    // 浏览器原生零依赖编码：把 AudioBuffer 片段重采样成轻量 16-bit 单声道 WAV DataURL！
    async function encodeSliceToWavDataUrl(audioBuf, startSec, endSec) {
        const dur = Math.min(MAX_CLIP_SEC, Math.max(1, endSec - startSec));
        // <=35s 用 22.05kHz 更清亮；36~60s 用 16kHz 控体积 (<1.9MB)
        const targetRate = dur <= 35 ? 22050 : 16000;
        const frameCount = Math.max(1, Math.ceil(dur * targetRate));
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineCtx(1, frameCount, targetRate);
        const src = offline.createBufferSource();
        src.buffer = audioBuf;
        src.connect(offline.destination);
        src.start(0, startSec, dur);
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
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
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

        const bytes = new Uint8Array(wavBuf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return `data:audio/wav;base64,${btoa(binary)}`;
    }

    async function openClipModalForSong(song) {
        if (typeof appConfig !== 'undefined' && appConfig.soloMode) {
            if (typeof showCommBanner === 'function') showCommBanner('🧘 单人专注模式中', '切回线上陪伴模式就可以把音乐片段分享给 TA 听啦～', false);
            return;
        }
        if (!isLocalSong(song)) {
            if (typeof showCommBanner === 'function') showCommBanner('📁 仅支持本地上传的音频', '点留声机「+ 加歌」上传本地 MP3/音频后，就可以自由截取 60 秒片段分享给 TA 听哦～', false);
            return;
        }

        stopPreview();
        clipTrack = song;
        decodedBuffer = null;
        wavePeaks = [];

        document.getElementById('clipTrackTitleLabel').innerText = `《${song.title}》`;
        document.getElementById('clipTotalDurLabel').innerText = '解码中...';
        document.getElementById('clipUserCommentInput').value = '';
        const st = document.getElementById('clipStatusMsg');
        if (st) { st.style.color = '#fbbf24'; st.innerText = '⏳ 正在加载本地音频并生成声波图...'; }
        const sendBtn = document.getElementById('clipSendBtn');
        const prevBtn = document.getElementById('clipPreviewBtn');
        if (sendBtn) sendBtn.disabled = true;
        if (prevBtn) prevBtn.disabled = true;

        document.getElementById('musicClipModal')?.classList.add('open');
        drawWaveform();

        try {
            const resp = await fetch(`${API_BASE}${song.url}`);
            if (!resp.ok) throw new Error(`音频文件读取失败 (${resp.status})`);
            const arrBuf = await resp.arrayBuffer();
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!previewCtx) previewCtx = new AudioCtx();
            decodedBuffer = await previewCtx.decodeAudioData(arrBuf);

            const total = decodedBuffer.duration;
            clipStart = 0;
            clipEnd = Math.min(total, Math.min(30, total));
            wavePeaks = computePeaks(decodedBuffer, 110);

            document.getElementById('clipTotalDurLabel').innerText = `总长 ${fmtTime(total)}`;
            if (st) { st.style.color = '#4ade80'; st.innerText = '✨ 拖动下方起止滑块或点波形图选择片段（最多 60 秒）'; }
            if (sendBtn) sendBtn.disabled = false;
            if (prevBtn) prevBtn.disabled = false;
            syncClipSlidersAndCanvas();
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ 音频解码失败：${e.message}`; }
        }
    }

    function openClipModalForCurrent() {
        if (typeof playlist === 'undefined' || !playlist.length) return;
        const cur = playlist[currentSongIndex];
        openClipModalForSong(cur);
    }

    function openClipModalByIndex(idx, ev) {
        if (ev) ev.stopPropagation();
        if (typeof closeModal === 'function') closeModal('playlistModal');
        if (typeof playlist !== 'undefined' && playlist[idx]) {
            openClipModalForSong(playlist[idx]);
        }
    }

    function closeClipModal() {
        stopPreview();
        if (typeof closeModal === 'function') closeModal('musicClipModal');
    }

    async function sendClipToAI() {
        if (!decodedBuffer || !clipTrack) return;
        stopPreview();

        const sendBtn = document.getElementById('clipSendBtn');
        const st = document.getElementById('clipStatusMsg');
        const comment = document.getElementById('clipUserCommentInput')?.value.trim() || '';

        if (sendBtn) { sendBtn.disabled = true; sendBtn.innerText = '⏳ 正在切片并传给 TA...'; }
        if (st) { st.style.color = '#fbbf24'; st.innerText = '🎧 正在裁剪音频并直通模型倾听...'; }

        try {
            const wavDataUrl = await encodeSliceToWavDataUrl(decodedBuffer, clipStart, clipEnd);
            const res = await fetch(`${API_BASE}/api/music-pro/share-clip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    trackTitle: clipTrack.title,
                    startSec: Math.floor(clipStart),
                    endSec: Math.ceil(clipEnd),
                    audioData: wavDataUrl,
                    audioFormat: 'wav',
                    userComment: comment,
                    ...(typeof getFocusPayload === 'function' ? getFocusPayload() : {}),
                    currentSong: (typeof playlist !== 'undefined' && playlist[currentSongIndex]?.title) || clipTrack.title,
                    deskSummary: typeof getDeskSummary === 'function' ? getDeskSummary() : ''
                })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);

            closeClipModal();

            // 同步更新聊天框气泡（优先无缝衔接打开通讯抽屉！）
            if (data.userMsg) {
                if (typeof chatHistory !== 'undefined') chatHistory.push(data.userMsg);
                if (typeof window.appendBubble === 'function') {
                    window.appendBubble('user', data.userMsg.content, false, { msgId: data.userMsg.id });
                }
            }

            const drawer = document.getElementById('commDrawer');
            if (drawer && !drawer.classList.contains('open') && typeof toggleChatDrawer === 'function') {
                toggleChatDrawer();
            }

            const replies = Array.isArray(data.replyMsgs) ? data.replyMsgs : [];
            for (const rm of replies) {
                if (typeof chatHistory !== 'undefined') chatHistory.push(rm);
                if (typeof window.appendBubble === 'function') {
                    window.appendBubble('assistant', rm.content, false, { msgId: rm.id });
                }
            }

            if (typeof showCommBanner === 'function') {
                const firstReply = replies[0]?.content || '';
                const previewTxt = firstReply.startsWith('{') ? '发来了一条听歌语音回应～' : firstReply;
                showCommBanner(`🎧 ${appConfig.charName || 'TA'} 听完了《${clipTrack.title}》`, previewTxt || '已收到你的音乐片段！', false);
            }
        } catch (e) {
            if (st) { st.style.color = '#f87171'; st.innerText = `❌ ${e.message}`; }
        } finally {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerText = '📤 分享给 TA 听'; }
        }
    }

    // 6. 升级聊天气泡渲染：把音乐片段分享渲染成黑胶小卡片！
    function hookBubbleRenderer() {
        const orig = window.renderBubbleInnerHtml;
        window.renderBubbleInnerHtml = function (rawContent) {
            if (typeof parseMessageContent === 'function') {
                const obj = parseMessageContent(rawContent);
                if (obj && obj.isMusicClip) {
                    const commentHtml = obj.text
                        ? `<div class="music-clip-comment">${esc(obj.text)}</div>`
                        : '';
                    const audioHtml = obj.audioData
                        ? `<audio class="im-bubble-audio" controls src="${obj.audioData}"></audio>`
                        : '';
                    return `<div class="music-clip-bubble">
                        <div class="music-clip-head">
                            <span class="music-clip-disc"></span>
                            <div class="music-clip-meta">
                                <div class="music-clip-title">🎵 《${esc(obj.trackTitle || '音乐片段')}》</div>
                                <div class="music-clip-range">截取 ${esc(obj.clipRange || '')}${obj.clipDuration ? ` · ${obj.clipDuration}s` : ''}</div>
                            </div>
                        </div>
                        ${audioHtml}
                        ${commentHtml}
                    </div>`;
                }
            }
            return orig ? orig(rawContent) : esc(rawContent);
        };
    }

    // 7. 升级歌单目录渲染 + 本地音频删除同步清理物理文件
    function hookPlaylistUI() {
        window.renderPlaylistDirectory = function () {
            const box = document.getElementById('playlistCatalogList')
                || document.getElementById('playlistDirectoryList')
                || document.getElementById('playlistList');
            const hint = document.getElementById('playlistHintText') || document.getElementById('playlistSummaryText');
            if (typeof playlist === 'undefined') return;
            if (hint) {
                hint.innerText = `共 ${playlist.length} 首曲目 · 本地音频支持自由播放与截取 60 秒片段分享给 TA～`;
            }
            if (!box) return;
            box.innerHTML = playlist.map((s, idx) => {
                const isCur = idx === currentSongIndex;
                const isBuiltin = String(s.id).startsWith('builtin-');
                const isLocal = isLocalSong(s);
                const badgeTxt = isCur ? '正在播放' : (isBuiltin ? '内置白噪音' : (isLocal ? '📁 本地音频' : '🌐 网络链接'));
                const clipBtn = isLocal
                    ? `<button type="button" class="mini-btn ai-only" style="padding:3px 7px;border-color:rgba(217,119,6,0.5);color:#fde68a;" onclick="window.MusicPro.openClipModalByIndex(${idx}, event)" title="截取最多60秒分享给 TA 听">🎧 剪给TA</button>`
                    : '';
                const delBtn = isBuiltin
                    ? ''
                    : `<button type="button" class="mini-btn" style="padding:3px 7px;color:#fca5a5;border-color:rgba(239,68,68,0.35);" onclick="deleteSongFromPlaylist(${s.id}, event)" title="删除歌曲">🗑️</button>`;
                return `<div class="catalog-item ${isCur ? 'active' : ''}" onclick="selectSongFromDirectory(${idx})">
                    <div class="catalog-info">
                        <div class="catalog-title">${isCur ? '🎵 ' : ''}${esc(s.title)}</div>
                        <div class="catalog-meta">
                            <span class="catalog-tag ${isCur ? 'cur' : ''}">${badgeTxt}</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:5px;flex-shrink:0;">${clipBtn}${delBtn}</div>
                </div>`;
            }).join('');
        };

        window.deleteSongFromPlaylist = async function (songId, event) {
            if (event) event.stopPropagation();
            if (!confirm('确定要从歌单移除这首歌吗？（本地音频文件会同步清理）')) return;
            await fetch(`${API_BASE}/api/music-pro/track/${songId}`, { method: 'DELETE' });
            const idx = playlist.findIndex(s => s.id === songId);
            if (idx !== -1) {
                playlist.splice(idx, 1);
                if (currentSongIndex >= playlist.length) currentSongIndex = 0;
                if (typeof updateMusicUI === 'function') updateMusicUI();
            }
            if (typeof renderPlaylistDirectory === 'function') renderPlaylistDirectory();
        };
    }

    window.MusicPro = {
        onLocalFilePicked,
        uploadLocalAudio,
        openClipModalForCurrent,
        openClipModalByIndex,
        closeClipModal,
        onStartSlider,
        onEndSlider,
        togglePreview,
        sendClipToAI
    };

    injectStyles();
    upgradeSongModal();
    mountVinylShareButton();
    mountClipModal();
    hookBubbleRenderer();
    hookPlaylistUI();
})();