#!/usr/bin/env node
// server/mcp-stdio.js —— 零依赖 MCP Stdio 桥接器（让 Claude Desktop / Cursor / 本地命令行客户端直连正在运行的自习室）
const readline = require('readline');

const TARGET_URL = (process.env.STUDY_ROOM_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '') + '/mcp';
const MCP_TOKEN = (process.env.STUDY_ROOM_MCP_TOKEN || '').trim();

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
        msg = JSON.parse(trimmed);
    } catch {
        return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (MCP_TOKEN) headers['Authorization'] = `Bearer ${MCP_TOKEN}`;

    try {
        const resp = await fetch(TARGET_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(msg)
        });
        if (resp.status === 202 || resp.status === 204) return;
        const text = await resp.text();
        if (text && text.trim()) {
            process.stdout.write(text.trim() + '\n');
        }
    } catch (err) {
        if (msg.id !== undefined) {
            const errResp = {
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32000, message: `无法连接自习室后端 (${TARGET_URL})：${err.message}` }
            };
            process.stdout.write(JSON.stringify(errResp) + '\n');
        }
    }
});