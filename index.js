import { extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'preset_boost';

const DEFAULTS = {
    enabled: true,
    dragBoost: true,
    lazyRows: true,
    scrollBoost: true,
    killBlur: false,
    editBoost: true,
    noSpellcheck: true,
    tapFeedback: true,
    ripple: true,
    streamStable: true,
    streamLight: true,
};

// v1.1.0 遗留键名 -> v1.2.0 键名，迁移后删除旧键
const MIGRATE = {
    deepEditBoost: 'editBoost',
    disableSpellcheck: 'noSpellcheck',
    buttonFeedback: 'tapFeedback',
};

const LIST_SELECTOR = [
    '#completion_prompt_manager_list',
    '.completion_prompt_manager_list',
    '#completion_prompt_manager',
].join(',');

const ROW_SELECTOR = '.completion_prompt_manager_prompt';

const TAP_SELECTOR = [
    'button',
    '.menu_button',
    '.drawer-icon',
    '.inline-drawer-toggle',
    '.right_menu_button',
    '[role="button"]',
    '.prompt_manager_prompt_controls .fa-solid',
].join(',');

const EDIT_SELECTOR = [
    '#completion_prompt_manager_popup_entry_form_prompt',
    '#completion_prompt_manager_popup_edit textarea',
    '#completion_prompt_manager textarea',
    '.completion_prompt_manager textarea',
].join(',');

let rippleLayer = null;
let scrollIdleTimer = null;
let scrollActive = false;
let streamWatchdog = null;
let lastRowHeight = 0;
let tickTimer = null;

/* ---------- 设置读写 ---------- */

function migrateOldKeys() {
    const s = extension_settings[MODULE];
    if (!s) return;
    for (const [oldKey, newKey] of Object.entries(MIGRATE)) {
        if (typeof s[oldKey] === 'boolean' && s[newKey] === undefined) {
            s[newKey] = s[oldKey];
        }
        delete s[oldKey];
    }
    // 这个滑块在 v1.1.0 里是空转的，直接清掉
    delete s.editDebounce;
}

function cfg() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = { ...DEFAULTS };
    }
    migrateOldKeys();
    const s = extension_settings[MODULE];
    for (const key of Object.keys(DEFAULTS)) {
        if (s[key] === undefined) s[key] = DEFAULTS[key];
    }
    return s;
}

function applyClasses() {
    const s = cfg();
    const b = document.body;
    const on = s.enabled;
    b.classList.toggle('pb-on', on);
    b.classList.toggle('pb-lazy', on && s.lazyRows);
    b.classList.toggle('pb-noblur', on && s.killBlur);
    b.classList.toggle('pb-edit', on && s.editBoost);
    b.classList.toggle('pb-tap', on && s.tapFeedback);
    b.classList.toggle('pb-ripple', on && s.tapFeedback && s.ripple);
    b.classList.toggle('pb-slight', on && s.streamLight);

    // 关掉时立刻收拾现场，不留任何残留效果
    if (!(on && s.tapFeedback)) {
        document.querySelectorAll('.pb-pressed').forEach(el => el.classList.remove('pb-pressed'));
    }
    if (!(on && s.tapFeedback && s.ripple)) {
        purgeRipples();
    }
    if (!(on && s.scrollBoost)) {
        scrollActive = false;
        b.classList.remove('pb-scrolling');
    }
    if (!(on && s.streamStable)) {
        b.classList.remove('pb-stream');
    }
}

/* ---------- 拖拽降开销 ---------- */

function onDragStart(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onDragEnd() {
    document.body.classList.remove('pb-dragging');
}

/* ---------- 点按反馈：每次触发都重读设置 ---------- */

function purgeRipples() {
    if (!rippleLayer) return;
    rippleLayer.querySelectorAll('.pb-dot').forEach(dot => dot.remove());
}

function ensureRippleLayer() {
    if (rippleLayer && document.body.contains(rippleLayer)) return rippleLayer;
    rippleLayer = document.createElement('div');
    rippleLayer.id = 'pb-ripple-layer';
    document.body.appendChild(rippleLayer);
    return rippleLayer;
}

function onTapDown(event) {
    const s = cfg();

    // 关键修复点：开关在这里实时判定，关了就直接返回
    if (!s.enabled || !s.tapFeedback) return;
    if (!(event.target instanceof Element)) return;

    const target = event.target.closest(TAP_SELECTOR);
    if (!target) return;

    target.classList.add('pb-pressed');
    setTimeout(() => target.classList.remove('pb-pressed'), 160);

    if (!s.ripple) return;

    const layer = ensureRippleLayer();
    const dot = document.createElement('span');
    dot.className = 'pb-dot';
    dot.style.left = `${event.clientX}px`;
    dot.style.top = `${event.clientY}px`;
    layer.appendChild(dot);
    dot.addEventListener('animationend', () => dot.remove(), { once: true });
    setTimeout(() => dot.remove(), 700);
}

/* ---------- 预设列表滚动降开销 ---------- */

function isPresetScroll(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(LIST_SELECTOR)) return true;
    return !!target.querySelector(LIST_SELECTOR);
}

function onScroll(event) {
    const s = cfg();
    if (!s.enabled || !s.scrollBoost) return;

    if (!scrollActive) {
        if (!isPresetScroll(event.target)) return;
        scrollActive = true;
        document.body.classList.add('pb-scrolling');
    }

    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
        scrollActive = false;
        document.body.classList.remove('pb-scrolling');
    }, 140);
}

/* ---------- 条目真实高度同步 ----------
   往回滚卡顿的主因：contain-intrinsic-size 写死 34px，
   和真实行高不符时，浏览器每次复原被跳过的行都要重算滚动高度。
   量一次真实值写进 CSS 变量，这个抖动就没了。 */

function syncRowHeight() {
    const row = document.querySelector(ROW_SELECTOR);
    if (!row) return;
    const h = Math.round(row.getBoundingClientRect().height);
    if (h > 8 && h !== lastRowHeight) {
        lastRowHeight = h;
        document.documentElement.style.setProperty('--pb-row-h', `${h}px`);
    }
}

/* ---------- 编辑框 ---------- */

function tuneEditor(el) {
    if (el.dataset.pbTuned === '1') return;
    if (cfg().noSpellcheck) {
        el.spellcheck = false;
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocomplete', 'off');
    }
    el.dataset.pbTuned = '1';
}

function scanEditors() {
    const s = cfg();
    if (!s.enabled || !s.editBoost) return;
    document.querySelectorAll(EDIT_SELECTOR).forEach(tuneEditor);
}

/* ---------- 流式输出稳定 ---------- */

function streamOn() {
    const s = cfg();
    if (!s.enabled || !s.streamStable) return;
    document.body.classList.add('pb-stream');
    armWatchdog();
}

function streamOff() {
    document.body.classList.remove('pb-stream');
    clearTimeout(streamWatchdog);
}

function armWatchdog() {
    // 万一结束事件丢了，30 秒无新 token 自动复位，避免一直挂着 class
    clearTimeout(streamWatchdog);
    streamWatchdog = setTimeout(streamOff, 30000);
}

function onToken() {
    if (document.body.classList.contains('pb-stream')) armWatchdog();
}

const START_EVENTS = ['GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS'];
const END_EVENTS = ['GENERATION_ENDED', 'GENERATION_STOPPED', 'CHARACTER_MESSAGE_RENDERED', 'CHAT_CHANGED'];

function bindStreamHooks() {
    if (!eventSource || !event_types) return;
    for (const name of START_EVENTS) {
        const key = event_types[name];
        if (key) eventSource.on(key, streamOn);
    }
    for (const name of END_EVENTS) {
        const key = event_types[name];
        if (key) eventSource.on(key, streamOff);
    }
    const tokenKey = event_types.STREAM_TOKEN_RECEIVED;
    if (tokenKey) eventSource.on(tokenKey, onToken);
}

/* ---------- 全局钩子 ---------- */

function bindGlobalHooks() {
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onDragStart, opts);
    document.addEventListener('pointerup', onDragEnd, opts);
    document.addEventListener('pointercancel', onDragEnd, opts);
    window.addEventListener('blur', onDragEnd, { passive: true });
    document.addEventListener('pointerdown', onTapDown, opts);
    document.addEventListener('scroll', onScroll, opts);
}

/* ---------- 设置面板 ---------- */

const LABELS = {
    enabled: '启用加速（总开关）',
    dragBoost: '拖拽时关闭动画与阴影',
    lazyRows: '屏幕外条目延迟渲染',
    scrollBoost: '滚动时关闭阴影与模糊',
    killBlur: '关闭毛玻璃模糊（提速最明显，界面变扁平）',
    editBoost: '编辑框优化（去阴影 · 快速文字渲染）',
    noSpellcheck: '关闭拼写检查与自动纠正',
    tapFeedback: '点按缩放反馈',
    ripple: '点按波纹（依赖上一项）',
    streamStable: '流式输出防颤动',
    streamLight: '流式输出时减负（去阴影去模糊）',
};

const GROUPS = [
    { title: '预设列表', keys: ['enabled', 'dragBoost', 'lazyRows', 'scrollBoost', 'killBlur'] },
    { title: '编辑框', keys: ['editBoost', 'noSpellcheck'] },
    { title: '点按反馈', keys: ['tapFeedback', 'ripple'] },
    { title: '流式输出', keys: ['streamStable', 'streamLight'] },
];

function buildPanel() {
    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!host) return false;
    if (document.getElementById('pb_settings')) return true;

    const s = cfg();
    const groupsHtml = GROUPS.map(g => `
        <div class="pb-group">
            <div class="pb-group-title">${g.title}</div>
            ${g.keys.map(k => `
                <label class="checkbox_label">
                    <input type="checkbox" id="pb_${k}" ${s[k] ? 'checked' : ''}>
                    <span>${LABELS[k]}</span>
                </label>
            `).join('')}
        </div>
    `).join('');

    const wrap = document.createElement('div');
    wrap.id = 'pb_settings';
    wrap.className = 'pb-settings-block';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>预设性能加速 v1.2.0</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ${groupsHtml}
                <div class="pb-stat">
                    预设条目 <span id="pb_count">—</span> ·
                    行高 <span id="pb_rowh">—</span> ·
                    编辑框已优化 <span id="pb_edit_count">—</span>
                </div>
            </div>
        </div>
    `;
    host.appendChild(wrap);

    for (const key of Object.keys(DEFAULTS)) {
        const input = document.getElementById(`pb_${key}`);
        if (!input) continue;
        input.addEventListener('change', () => {
            cfg()[key] = input.checked;
            applyClasses();
            if (key === 'editBoost' || key === 'noSpellcheck') scanEditors();
            saveSettingsDebounced();
        });
    }

    return true;
}

function refreshStat() {
    const c = document.getElementById('pb_count');
    const r = document.getElementById('pb_rowh');
    const e = document.getElementById('pb_edit_count');
    if (c) c.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
    if (r) r.textContent = lastRowHeight ? `${lastRowHeight}px` : '—';
    if (e) e.textContent = String(document.querySelectorAll('[data-pb-tuned="1"]').length);
}

/* ---------- 启动 ---------- */

function tick() {
    syncRowHeight();
    scanEditors();
    refreshStat();
}

function boot() {
    cfg();
    applyClasses();
    bindGlobalHooks();
    bindStreamHooks();
    tick();

    tickTimer = setInterval(tick, 1500);

    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (buildPanel() || tries > 40) clearInterval(timer);
    }, 500);

    console.log('[Preset Boost v1.2.0] 已启动');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

window.addEventListener('beforeunload', () => {
    clearInterval(tickTimer);
    clearTimeout(scrollIdleTimer);
    clearTimeout(streamWatchdog);
});
