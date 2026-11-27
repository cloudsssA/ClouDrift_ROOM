(() => {
    const menu = document.getElementById('contactMenu');
    const trigger = document.getElementById('contactButton');
    const drawer = document.getElementById('commDrawer');
    let version = 0;
    function position(anchor) {
        const rect = anchor.getBoundingClientRect();
        const bar = document.getElementById('topBar').getBoundingClientRect();
        const right = Math.min(innerWidth - 12, Math.max(menu.offsetWidth + 12, rect.right));
        menu.style.setProperty('--contact-right', (bar.right - right) + 'px');
    }
    window.toggleContacts = async event => {
        event.stopPropagation();
        const anchor = event.currentTarget;
        const open = !menu.classList.contains('menu-open');
        closeTopBarPopovers();
        window.StudyPet?.closePanel?.();
        const load = ++version;
        if (!open) return;
        menu.textContent = '正在读取…';
        position(anchor);
        menu.inert = false;
        menu.classList.add('menu-open');
        trigger.setAttribute('aria-expanded','true');
        try {
            const res = await fetch(API_BASE + '/api/contacts');
            if (!res.ok) throw Error();
            const rows = await res.json();
            if (version !== load) return;
            menu.textContent = '';
            menu.append(...rows.map(friend => {
                const button = document.createElement('button');
                button.className = 'icon-btn';
                button.type = 'button';
                button.dataset.key = friend.key;
                button.innerHTML = '<span class="friend-avatar"></span><span class="friend-label"><strong></strong><small></small></span>';
                const avatar = button.firstChild;
                avatar.textContent = friend.name.slice(0,1);
                if (friend.avatar) {
                    const image = document.createElement('img');
                    image.src = friend.avatar;
                    image.alt = '';
                    avatar.textContent = ''; avatar.append(image);
                }
                button.querySelector('strong').textContent = friend.name;
                button.querySelector('small').textContent = friend.preview || '';
                button.onclick = () => openFriend(friend);
                if (!friend.removable) return button;
                const row = document.createElement('div');
                row.className = 'friend-row';
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'remove-friend';
                remove.textContent = '×';
                remove.setAttribute('aria-label','移除联系人 ' + friend.name);
                remove.onclick = async e => {
                    e.stopPropagation();
                    if (!confirm('从通讯录移除「' + friend.name + '」？聊天、记忆和便利贴会保留。')) return;
                    try {
                        const r = await fetch(API_BASE + '/api/contacts/' + encodeURIComponent(friend.key), {method:'DELETE'});
                        if (!r.ok) throw Error();
                        row.remove();
                        if (!menu.childElementCount) menu.textContent = '暂无联系人';
                    } catch { alert('移除失败，请重试'); }
                };
                row.append(button,remove);
                return row;
            }));
            if (!rows.length) menu.textContent = '暂无联系人';
        } catch { menu.textContent = '读取失败，请重新展开'; }
    };
    window.openFriend = async friend => {
        closeTopBarPopovers();
        if (appConfig.soloMode) return;
        const switching = friend.key !== chatKey();
        if (switching) {
            window.ChatPro.switchView();
            window.VoiceUI?.cancelVoice();
            clearPendingAttachment();
            document.getElementById('imInput').value = '';
            chatHistory = [];
        }
        chatContact = friend;
        document.getElementById('imCharName').textContent = friend.name;
        document.getElementById('imHeaderAvatar').innerHTML = renderAvatarHtml(friend.avatar, friend.name);
        if (switching) renderChatMessages([]);
        if (!drawer.classList.contains('open')) toggleChatDrawer();
        await Promise.all([loadChatHistory(switching), window.ChatPro.refreshView()]);
    };
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && menu.classList.contains('menu-open')) {
            closeTopBarPopovers();
            trigger.focus();
        }
    });
    window.addEventListener('resize', () => {
        if (menu.classList.contains('menu-open')) position(trigger);
    });
})();
