// public/desk-widgets.js —— 左侧书桌小组件（状态标签 + 今日待办清单 + 今日专注统计）
(function () {
    const STORAGE_KEY_TODOS = 'study_room_todos_v1';
    const STORAGE_KEY_STATS = 'study_room_stats_v1';
    const STORAGE_KEY_MOOD = 'study_room_mood_v1';

    const MOODS = [
        { id: 'reading', label: '📖 沉浸阅读' },
        { id: 'writing', label: '💻 工作输出' },
        { id: 'review', label: '🧠 刷题背书' },
        { id: 'chill', label: '☕ 轻松摸鱼' }
    ];

    function getTodayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    function loadTodos() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY_TODOS) || '[]'); }
        catch { return []; }
    }

    function saveTodos(list) {
        localStorage.setItem(STORAGE_KEY_TODOS, JSON.stringify(list));
    }

    function loadStats() {
        const today = getTodayStr();
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_STATS) || '{}');
            if (raw.date === today) return raw;
        } catch {}
        return { date: today, totalMinutes: 0, sessions: 0 };
    }

    function saveStats(stats) {
        localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
    }

    function loadMood() {
        return localStorage.getItem(STORAGE_KEY_MOOD) || '📖 沉浸阅读';
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function render() {
        const mount = document.getElementById('deskWidgetsMount');
        if (!mount) return;

        const todos = loadTodos();
        const stats = loadStats();
        const currentMood = loadMood();
        const doneCount = todos.filter(t => t.done).length;

        mount.innerHTML = `
            <!-- 1. 今日专注战绩 -->
            <div class="glass-card desk-stat-card">
                <div class="desk-card-title">
                    <span>📊 今日专注战绩</span>
                    <span class="desk-date-tag">${stats.date}</span>
                </div>
                <div class="desk-stat-grid">
                    <div class="desk-stat-item">
                        <div class="desk-stat-num">${stats.totalMinutes}<span class="desk-stat-unit">m</span></div>
                        <div class="desk-stat-label">累计专注</div>
                    </div>
                    <div class="desk-stat-divider"></div>
                    <div class="desk-stat-item">
                        <div class="desk-stat-num">${stats.sessions}<span class="desk-stat-unit">轮</span></div>
                        <div class="desk-stat-label">完成番茄</div>
                    </div>
                </div>
            </div>

            <!-- 2. 此刻状态标签 -->
            <div class="glass-card desk-mood-card">
                <div class="desk-card-title"><span>✨ 此刻桌面状态</span></div>
                <div class="desk-mood-chips">
                    ${MOODS.map(m => `
                        <button class="desk-mood-chip ${currentMood === m.label ? 'active' : ''}"
                                onclick="window.DeskWidgets.setMood('${m.label}')">
                            ${m.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- 3. 今日自习待办清单 -->
            <div class="glass-card desk-todo-card">
                <div class="desk-card-title">
                    <span>🎯 自习待办清单</span>
                    <span class="desk-date-tag">${doneCount}/${todos.length}</span>
                </div>
                <div class="desk-todo-input-row">
                    <input id="deskTodoInput" class="desk-todo-input" placeholder="写个小目标回车添加..."
                           onkeydown="if(event.key==='Enter') window.DeskWidgets.addTodo()">
                    <button class="desk-todo-add-btn" onclick="window.DeskWidgets.addTodo()">+</button>
                </div>
                <div class="desk-todo-list">
                    ${todos.length === 0
                        ? `<div class="desk-todo-empty">还没列计划？写一条今天想搞定的事吧～</div>`
                        : todos.map(item => `
                            <div class="desk-todo-item ${item.done ? 'done' : ''}">
                                <label class="desk-todo-check">
                                    <input type="checkbox" ${item.done ? 'checked' : ''}
                                           onchange="window.DeskWidgets.toggleTodo(${item.id})">
                                    <span>${escapeHtml(item.text)}</span>
                                </label>
                                <button class="desk-todo-del" onclick="window.DeskWidgets.deleteTodo(${item.id})" title="删除">×</button>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        `;
    }

    window.DeskWidgets = {
        init() { render(); },
        setMood(label) {
            localStorage.setItem(STORAGE_KEY_MOOD, label);
            render();
        },
        addTodo() {
            const input = document.getElementById('deskTodoInput');
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
            const list = loadTodos();
            list.unshift({ id: Date.now(), text, done: false });
            saveTodos(list);
            render();
        },
        toggleTodo(id) {
            const list = loadTodos().map(item => item.id === id ? { ...item, done: !item.done } : item);
            saveTodos(list);
            render();
        },
        deleteTodo(id) {
            const list = loadTodos().filter(item => item.id !== id);
            saveTodos(list);
            render();
        },
        // 完整走完一轮：累计时长 + 完成轮数 +1
        recordCompletedMinutes(mins) {
            const stats = loadStats();
            stats.totalMinutes += Math.max(1, Math.round(mins));
            stats.sessions += 1;
            saveStats(stats);
            render();
        },
        // 中途放弃但已专注满 1 分钟：仅累计实际专注时长，不加完成轮数
        recordPartialMinutes(mins) {
            const actual = Math.floor(mins);
            if (actual < 1) return;
            const stats = loadStats();
            stats.totalMinutes += actual;
            saveStats(stats);
            render();
        },
        getContextSummary() {
            const mood = loadMood();
            const pending = loadTodos().filter(t => !t.done).slice(0, 3).map(t => t.text);
            const stats = loadStats();
            const taskText = pending.length ? pending.join('、') : '暂未写具体待办';
            return `桌面状态：${mood}；今日已专注 ${stats.totalMinutes} 分钟；待完成目标：${taskText}`;
        }
    };

    window.addEventListener('DOMContentLoaded', () => window.DeskWidgets.init());
})();