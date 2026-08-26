import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'preset_boost';

const DEFAULTS = {
    enabled: true,
    dragBoost: true,
    lazyRows: true,
    smoothScroll: true,
    killBlur: false,
    editBoost: true,
    noSpellcheck: true,
    tapFeedback: true,
    ripple: true,
    steadyStream: true,
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
let scanTimer = null;
let statTimer = null;
let scrollIdleTimer = null;

/* ---------- 设置读写 ---------- */

function cfg() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = { ...DEFAULTS };
    }
    const s = extension_settings[MODULE];
    // 补齐新字段
    for (const key of Object.keys(DEFAULTS)) {
        if (s[key] === undefined) s[key] = DEFAULTS[key];
    }
    // 清掉 v1.1.0 遗留的无效字段，避免存档里堆垃圾
    for (const dead of ['deepEditBoost', 'buttonFeedback', 'disableSpellcheck', 'editDebounce']) {
        if (dead in s) delete s[dead];
    }
    return s;
}

/* ---------- 开关 → body class ----------
   每个功能都同时有 JS 判断和 CSS gate 两道闸，
   任一道生效就能彻底关停，不会出现 v1.1.0 那种关不掉的情况 */

function applyClasses() {
    const s = cfg();
    const b = document.body;
    const on = s.enabled;

    b.classList.toggle('pb-on', on);
    b.classList.toggle('pb-lazy', on && s.lazyRows);
    b.classList.toggle('pb-smooth', on && s.smoothScroll);
    b.classList.toggle('pb-noblur', on && s.killBlur);
    b.classList.toggle('pb-edit', on && s.editBoost);
    b.classList.toggle('pb-tap', on && s.tapFeedback);
    b.classList.toggle('pb-ripple', on && s.tapFeedback && s.ripple);
    b.classList.toggle('pb-steady', on && s.steadyStream);

    // 波纹关掉时，顺手把残留的图层和光点清干净
    if (!(on && s.tapFeedback && s.ripple) && rippleLayer) {
        rippleLayer.remove();
        rippleLayer = null;
    }
}

/* ---------- 拖拽降开销 ---------- */

function onDragStart(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onDragEnd() {
    document.body.classList.remove('pb-dragging');
}

/* ---------- 点按反馈（事件委托，不改写任何元素） ---------- */

function ensureRippleLayer() {
    if (rippleLayer && document.body.contains(rippleLayer)) return rippleLayer;
    rippleLayer = document.createElement('div');
    rippleLayer.id = 'pb-ripple-layer';
    document.body.appendChild(rippleLayer);
    return rippleLayer;
}

function onTapDown(event) {
    const s = cfg();
    if (!s.enabled || !s.tapFeedback) return;

    const target = event.target.closest(TAP_SELECTOR);
    if (!target) return;

    target.classList.add('pb-pressed');
    setTimeout(() => target.classList.remove('pb-pressed'), 160);

    // 波纹的第二道判断，与 CSS gate 独立
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

/* ---------- 滚动期间降开销 ----------
   scroll 事件不冒泡，但在 document 上用 capture 能抓到 */

function onAnyScroll(event) {
    const s = cfg();
    if (!s.enabled || !s.smoothScroll) return;

    const t = event.target;
    if (!(t instanceof Element)) return;
    if (!t.closest(LIST_SELECTOR)) return;

    document.body.classList.add('pb-scrolling');
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
        document.body.classList.remove('pb-scrolling');
    }, 140);
}

function bindGlobalHooks() {
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onDragStart, opts);
    document.addEventListener('pointerup', onDragEnd, opts);
    document.addEventListener('pointercancel', onDragEnd, opts);
    window.addEventListener('blur', onDragEnd, { passive: true });
    document.addEventListener('pointerdown', onTapDown, opts);
    document.addEventListener('scroll', onAnyScroll, opts);
}

/* ---------- 实测条目高度 ----------
   往回滚卡顿的根源：content-visibility 跳过屏幕外条目后，
   回滚时要按 contain-intrinsic-size 的估算值重建布局。
   估算值和真实高度差得越远，回滚越颤。这里量一次真值写进 CSS 变量。 */

function measureRowHeight() {
    const s = cfg();
    if (!s.enabled || !s.lazyRows) return;

    const rows = document.querySelectorAll(ROW_SELECTOR);
    if (!rows.length) return;

    // 取第二个：首项常带额外上边距，不具代表性
    const probe = rows[Math.min(1, rows.length - 1)];
    const h = Math.round(probe.getBoundingClientRect().height);

    // 合理区间外的读数丢弃（元素可能正被隐藏或折叠）
    if (h < 16 || h > 200) return;

    const current = document.documentElement.style.getPropertyValue('--pb-row-h');
    if (current === `${h}px`) return;

    document.documentElement.style.setProperty('--pb-row-h', `${h}px`);
}

/* ---------- 编辑框优化 ---------- */

function tuneEditor(el) {
    if (el.dataset.pbTuned === '1') return;
    const s = cfg();

    if (s.noSpellcheck) {
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

function periodicWork() {
    scanEditors();
    measureRowHeight();
}

/* ---------- 设置面板 ---------- */

const LABELS = {
    enabled: '启用加速（总开关）',
    dragBoost: '拖拽时关闭动画与阴影',
    lazyRows: '屏幕外条目延迟渲染',
    smoothScroll: '滚动时降低渲染开销',
    killBlur: '关闭毛玻璃模糊（提速最明显，界面变扁平）',
    editBoost: '编辑框优化（去文字阴影 · 快速渲染）',
    noSpellcheck: '关闭拼写检查与自动纠正',
    tapFeedback: '点按缩放反馈',
    ripple: '点按波纹（需上一项开启）',
    steadyStream: '流式输出防抖动',
};

const GROUPS = [
    { title: '总开关', keys: ['enabled'] },
    { title: '预设列表', keys: ['dragBoost', 'lazyRows', 'smoothScroll', 'killBlur'] },
    { title: '编辑框', keys: ['editBoost', 'noSpellcheck'] },
    { title: '点按反馈', keys: ['tapFeedback', 'ripple'] },
    { title: '聊天区', keys: ['steadyStream'] },
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
                    实测行高 <span id="pb_rowh">—</span> ·
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
            if (key === 'lazyRows') measureRowHeight();
            saveSettingsDebounced();
        });
    }

    return true;
}

function refreshStat() {
    const a = document.getElementById('pb_count');
    const b = document.getElementById('pb_rowh');
    const c = document.getElementById('pb_edit_count');
    if (a) a.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
    if (b) {
        const v = document.documentElement.style.getPropertyValue('--pb-row-h');
        b.textContent = v || '未测';
    }
    if (c) c.textContent = String(document.querySelectorAll('[data-pb-tuned="1"]').length);
}

/* ---------- 启动 ---------- */

function boot() {
    cfg();
    applyClasses();
    bindGlobalHooks();
    periodicWork();

    scanTimer = setInterval(periodicWork, 1500);
    statTimer = setInterval(refreshStat, 3000);

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
    if (scanTimer) clearInterval(scanTimer);
    if (statTimer) clearInterval(statTimer);
});
