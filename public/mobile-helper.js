/**
 * 📱 苹果 / 安卓通用图片压缩 & HEIC 自动转码器
 * @param {File} file - <input type="file"> 选中的文件
 * @param {'avatar'|'chat'|'widget'|'bg'} scene - 不同场景自动匹配最爽的清晰度
 * @returns {Promise<string>} 压缩后的 data:image/... Base64（直接沿用你现有上传接口！）
 */
async function compressImageFile(file, scene = 'chat') {
    if (!file) return '';

    // 1. 如果是动图 GIF 且小于 4MB，跳过 Canvas 压缩，保住动图不变成静态图！
    if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // 不同场景的黄金参数：肉眼超清，体积不到原图 3%
    const presets = {
        avatar: { maxSide: 400,  quality: 0.85 }, // 头像：~30KB
        chat:   { maxSide: 1280, quality: 0.80 }, // 聊天发图：~150KB（大模型识图最舒服的尺寸！）
        widget: { maxSide: 1280, quality: 0.82 }, // 桌面相框：~160KB
        bg:     { maxSide: 1920, quality: 0.82 }  // 全局壁纸：~300KB
    };
    const { maxSide, quality } = presets[scene] || presets.chat;

    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            try {
                let { width, height } = img;
                // 等比缩放，不拉伸变形
                if (width > maxSide || height > maxSide) {
                    if (width >= height) {
                        height = Math.round((height * maxSide) / width);
                        width = maxSide;
                    } else {
                        width = Math.round((width * maxSide) / height);
                        height = maxSide;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                // 如果原图是带透明底的小 PNG，画之前不用铺白底；但转 JPEG 铺一层白底防透明变黑块
                const isSmallPng = file.type === 'image/png' && file.size < 300 * 1024 && scene === 'avatar';
                if (!isSmallPng) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                }
                ctx.drawImage(img, 0, 0, width, height);

                // 统一输出 JPEG（苹果 Safari 对 canvas.toDataURL('image/webp') 兼容性差，JPEG 才是双端真神！）
                const outMime = isSmallPng ? 'image/png' : 'image/jpeg';
                const dataUrl = canvas.toDataURL(outMime, quality);

                URL.revokeObjectURL(objectUrl);
                resolve(dataUrl);
            } catch (err) {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            // 万一碰到极其奇葩的格式无法画到 Canvas，兜底退回原始 FileReader
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        };

        img.src = objectUrl;
    });
}
async function startMobileVoiceRecord() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        alert('🔒 手机使用麦克风需要通过 HTTPS 域名访问自习室哦～');
        return null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    const candidates = [
        { mime: 'audio/webm;codecs=opus', fmt: 'webm' },
        { mime: 'audio/webm', fmt: 'webm' },
        { mime: 'audio/mp4;codecs=mp4a.40.2', fmt: 'm4a' },
        { mime: 'audio/mp4', fmt: 'm4a' },
        { mime: 'audio/aac', fmt: 'aac' }
    ];
    const picked = candidates.find(c => window.MediaRecorder && MediaRecorder.isTypeSupported(c.mime))
        || { mime: '', fmt: 'mp4' };

    const recorder = new MediaRecorder(stream, picked.mime ? { mimeType: picked.mime } : {});
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.start(250); // 苹果 Safari 关键参数，避免最后收不到音频块

    return {
        stop: () => new Promise((resolve, reject) => {
            recorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop()); // 关掉顶部录音小红点
                const finalMime = recorder.mimeType || picked.mime || 'audio/mp4';
                const finalFmt = finalMime.includes('webm') ? 'webm' : (finalMime.includes('ogg') ? 'ogg' : 'm4a');
                const blob = new Blob(chunks, { type: finalMime });
                const reader = new FileReader();
                reader.onloadend = () => resolve({ audioData: reader.result, audioFormat: finalFmt });
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            };
            recorder.stop();
        })
    };
}