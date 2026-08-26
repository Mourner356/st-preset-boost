import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'preset_boost';

const DEFAULTS = {
    enabled: true,
    dragBoost: true,
    lazyRows: true,
    killBlur: false,
    editBoost: true,
    noSpellcheck: true,
    tapFeedback: true,
    ripple: true,
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

/* ---------- 设置读写 ---------- */
function cfg() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = { ...DEFAULTS };
    }
    for (const key of Object.keys(DEFAULTS)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = DEFAULTS[key];
        }
    }
    return extension_settings[MODULE];
}

function applyClasses() {
    const s = cfg();
    const b = document.body;
    b.classList.toggle('pb-on', s.enabled);
    b.classList.toggle('pb-lazy', s.enabled && s.lazyRows);
    b.classList.toggle('pb-noblur', s.enabled && s.killBlur);
    b.classList.toggle('pb-edit', s.enabled && s.editBoost);
    b.classList.toggle('pb-tap', s.enabled && s.tapFeedback);
}

/* ---------- 拖拽优化 ---------- */
function onDragStart(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onDragEnd() {
    document.body.classList.remove('pb-dragging');
}

/* ---------- 点按反馈 ---------- */
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

function bindGlobalHooks() {
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onDragStart, opts);
    document.addEventListener('pointerup', onDragEnd, opts);
    document.addEventListener('pointercancel', onDragEnd, opts);
    window.addEventListener('blur', onDragEnd, { passive: true });
    document.addEventListener('pointerdown', onTapDown, opts);
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

/* ---------- 设置面板 ---------- */
const LABELS = {
    enabled: '启用加速',
    dragBoost: '拖拽时关闭动画与阴影',
    lazyRows: '屏幕外条目延迟渲染',
    killBlur: '关闭毛玻璃模糊（提速明显，界面变扁平）',
    editBoost: '编辑框优化（关阴影·快速文字渲染）',
    noSpellcheck: '关闭拼写检查与自动纠正',
    tapFeedback: '点按缩放反馈',
    ripple: '点按波纹（依赖上一项）',
};

const GROUPS = [
    { title: '预设列表', keys: ['enabled', 'dragBoost', 'lazyRows', 'killBlur'] },
    { title: '编辑框', keys: ['editBoost', 'noSpellcheck'] },
    { title: '点按反馈', keys: ['tapFeedback', 'ripple'] },
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
                <b>预设性能加速 v1.1.1 稳定版</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="pb-rollback-notice">
                    ℹ️ 已回滚到稳定版本，暂时移除聊天优化功能
                </div>
                ${groupsHtml}
                <div class="pb-stat">
                    预设条目 <span id="pb_count">—</span> ·
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
            if (key === 'ripple' || key === 'tapFeedback') {
                if (!input.checked && rippleLayer) {
                    rippleLayer.remove();
                    rippleLayer = null;
                }
            }
            saveSettingsDebounced();
        });
    }

    return true;
}

function refreshStat() {
    const a = document.getElementById('pb_count');
    const b = document.getElementById('pb_edit_count');
    if (a) a.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
    if (b) b.textContent = String(document.querySelectorAll('[data-pb-tuned="1"]').length);
}

/* ---------- 启动 ---------- */
function boot() {
    cfg();
    applyClasses();
    bindGlobalHooks();
    scanEditors();

    scanTimer = setInterval(scanEditors, 1500);
    setInterval(refreshStat, 3000);

    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (buildPanel() || tries > 40) clearInterval(timer);
    }, 500);

    console.log('[Preset Boost v1.1.1] 已启动 - 稳定版');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

window.addEventListener('beforeunload', () => {
    if (scanTimer) clearInterval(scanTimer);
});
