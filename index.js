import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'preset_boost';

const DEFAULTS = {
    enabled: true,
    dragBoost: true,
    lazyRows: true,
    killBlur: false,
};

// 预设列表的可能选择器（不同版本略有差异，全部覆盖）
const LIST_SELECTOR = [
    '#completion_prompt_manager_list',
    '.completion_prompt_manager_list',
    '#completion_prompt_manager',
].join(',');

const ROW_SELECTOR = '.completion_prompt_manager_prompt';

/* ---------- 设置读写 ---------- */

function cfg() {
    if (!extension_settings[MODULE]) {
        extension_settings[MODULE] = { ...DEFAULTS };
    }
    // 补齐新版本新增的字段
    for (const key of Object.keys(DEFAULTS)) {
        if (extension_settings[MODULE][key] === undefined) {
            extension_settings[MODULE][key] = DEFAULTS[key];
        }
    }
    return extension_settings[MODULE];
}

/* ---------- 把开关状态映射到 body 的 class ---------- */

function applyClasses() {
    const s = cfg();
    const b = document.body;
    b.classList.toggle('pb-on', s.enabled);
    b.classList.toggle('pb-lazy', s.enabled && s.lazyRows);
    b.classList.toggle('pb-noblur', s.enabled && s.killBlur);
}

/* ---------- 拖拽期间进入低开销模式 ---------- */

function onPointerDown(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onPointerUp() {
    document.body.classList.remove('pb-dragging');
}

function bindDragHooks() {
    // passive + capture：只观察，不拦截酒馆自己的拖拽逻辑
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('pointerup', onPointerUp, opts);
    document.addEventListener('pointercancel', onPointerUp, opts);
    // 兜底：某些浏览器 pointerup 丢失时用 mouseleave 复位
    window.addEventListener('blur', onPointerUp, { passive: true });
}

/* ---------- 设置面板 ---------- */

function buildPanel() {
    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!host) return false;
    if (document.getElementById('pb_settings')) return true;

    const s = cfg();
    const wrap = document.createElement('div');
    wrap.id = 'pb_settings';
    wrap.className = 'pb-settings-block';
    wrap.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>预设性能加速</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input type="checkbox" id="pb_enabled" ${s.enabled ? 'checked' : ''}>
                    <span>启用加速</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="pb_dragBoost" ${s.dragBoost ? 'checked' : ''}>
                    <span>拖拽时关闭动画与阴影</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="pb_lazyRows" ${s.lazyRows ? 'checked' : ''}>
                    <span>屏幕外条目延迟渲染</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="pb_killBlur" ${s.killBlur ? 'checked' : ''}>
                    <span>关闭毛玻璃模糊（提速明显，界面会变扁平）</span>
                </label>
                <div class="pb-stat">
                    当前预设条目：<span id="pb_count">—</span>
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
            saveSettingsDebounced();
        });
    }

    return true;
}

function refreshCount() {
    const el = document.getElementById('pb_count');
    if (!el) return;
    el.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
}

/* ---------- 启动 ---------- */

function boot() {
    cfg();
    applyClasses();
    bindDragHooks();

    // 设置面板可能还没挂载，轮询几次直到成功
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (buildPanel() || tries > 40) clearInterval(timer);
    }, 500);

    setInterval(refreshCount, 3000);

    console.log('[Preset Boost] 已启动');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
