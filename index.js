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
    // v1.1.2 新增
    smoothScroll: true,
    streamOptim: true,
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

// v1.1.2 新增：聊天容器选择器
const CHAT_SELECTOR = [
    '#chat',
    '.chat',
    '#sheld',
].join(',');

let rippleLayer = null;
let scanTimer = null;
let streamObserver = null;

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
    // v1.1.2 新增
    b.classList.toggle('pb-smooth', s.enabled && s.smoothScroll);
    b.classList.toggle('pb-stream', s.enabled && s.streamOptim);
}

/* ---------- 拖拽优化（沿用，已验证） ---------- */
function onDragStart(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onDragEnd() {
    document.body.classList.remove('pb-dragging');
}

/* ---------- 点按反馈：修复开关状态检查bug ---------- */
function ensureRippleLayer() {
    if (rippleLayer && document.body.contains(rippleLayer)) return rippleLayer;
    rippleLayer = document.createElement('div');
    rippleLayer.id = 'pb-ripple-layer';
    document.body.appendChild(rippleLayer);
    return rippleLayer;
}

function onTapDown(event) {
    const s = cfg();
    // 修复：正确检查开关状态
    if (!s.enabled || !s.tapFeedback) return;

    const target = event.target.closest(TAP_SELECTOR);
    if (!target) return;

    // 缩放反馈
    target.classList.add('pb-pressed');
    setTimeout(() => target.classList.remove('pb-pressed'), 160);

    // 波纹效果 - 修复：检查波纹开关
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

/* ---------- v1.1.2 新增：流式输出优化 ---------- */
function optimizeStreamOutput() {
    const s = cfg();
    if (!s.enabled || !s.streamOptim) return;

    const chatContainer = document.querySelector(CHAT_SELECTOR);
    if (!chatContainer) return;

    // 防止流式输出时的高度跳跃
    if (!chatContainer.dataset.pbStreamFixed) {
        // 固定聊天容器的滚动基线
        chatContainer.style.contain = 'layout style';
        chatContainer.style.overflowAnchor = 'auto';
        
        // 监听新消息插入，立即刷新渲染
        if (!streamObserver) {
            streamObserver = new MutationObserver((mutations) => {
                let needsFlush = false;
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        // 检查是否是消息节点
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === 1 && (
                                node.classList?.contains('mes') || 
                                node.querySelector?.('.mes') ||
                                node.classList?.contains('swipe_right') ||
                                node.classList?.contains('swipe_left')
                            )) {
                                needsFlush = true;
                                break;
                            }
                        }
                    }
                });
                
                if (needsFlush) {
                    // 强制刷新渲染，防止卡住
                    chatContainer.style.contain = 'none';
                    requestAnimationFrame(() => {
                        chatContainer.style.contain = 'layout style';
                        // 平滑滚动到底部
                        chatContainer.scrollTo({
                            top: chatContainer.scrollHeight,
                            behavior: 'smooth'
                        });
                    });
                }
            });
            
            streamObserver.observe(chatContainer, {
                childList: true,
                subtree: true
            });
        }
        
        chatContainer.dataset.pbStreamFixed = '1';
        console.log('[Preset Boost] 流式输出优化已应用到聊天容器');
    }
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

/* ---------- 设置面板（修复防抖显示bug） ---------- */
const LABELS = {
    enabled: '启用加速',
    dragBoost: '拖拽时关闭动画与阴影',
    lazyRows: '屏幕外条目延迟渲染',
    killBlur: '关闭毛玻璃模糊（提速明显，界面变扁平）',
    editBoost: '编辑框优化（关阴影·快速文字渲染）',
    noSpellcheck: '关闭拼写检查与自动纠正',
    tapFeedback: '点按缩放反馈',
    ripple: '点按波纹（依赖上一项）',
    // v1.1.2 新增
    smoothScroll: '预设列表滚动优化',
    streamOptim: '流式输出防抖动（聊天时）',
};

const GROUPS = [
    { title: '预设列表', keys: ['enabled', 'dragBoost', 'lazyRows', 'killBlur', 'smoothScroll'] },
    { title: '编辑框', keys: ['editBoost', 'noSpellcheck'] },
    { title: '点按反馈', keys: ['tapFeedback', 'ripple'] },
    { title: '聊天优化', keys: ['streamOptim'] },
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
                <b>预设性能加速 v1.1.2 🐛修复版</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                ${groupsHtml}
                <div class="pb-debug">
                    <div class="pb-debug-title">调试信息</div>
                    <div class="pb-debug-line">预设条目: <span id="pb_count">—</span></div>
                    <div class="pb-debug-line">编辑框已优化: <span id="pb_edit_count">—</span></div>
                    <div class="pb-debug-line">聊天容器: <span id="pb_chat_status">—</span></div>
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
            
            // 应用特定设置
            if (key === 'editBoost' || key === 'noSpellcheck') {
                scanEditors();
            }
            if (key === 'streamOptim') {
                optimizeStreamOutput();
            }
            // 修复：重新创建/移除波纹图层
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
    const countEl = document.getElementById('pb_count');
    const editEl = document.getElementById('pb_edit_count');
    const chatEl = document.getElementById('pb_chat_status');
    
    if (countEl) countEl.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
    if (editEl) editEl.textContent = String(document.querySelectorAll('[data-pb-tuned="1"]').length);
    if (chatEl) {
        const chatContainer = document.querySelector(CHAT_SELECTOR);
        chatEl.textContent = chatContainer ? 
            (chatContainer.dataset.pbStreamFixed === '1' ? '已优化' : '待优化') : 
            '未找到';
    }
}

/* ---------- 启动 ---------- */
function boot() {
    cfg();
    applyClasses();
    bindGlobalHooks();
    scanEditors();
    optimizeStreamOutput();

    scanTimer = setInterval(() => {
        scanEditors();
        optimizeStreamOutput();
    }, 2000);
    
    setInterval(refreshStat, 3000);

    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (buildPanel() || tries > 40) clearInterval(timer);
    }, 500);

    console.log('[Preset Boost v1.1.2] 已启动 - 修复版');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

window.addEventListener('beforeunload', () => {
    if (scanTimer) clearInterval(scanTimer);
    if (streamObserver) streamObserver.disconnect();
});
