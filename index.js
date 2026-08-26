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

// v1.1.3 修复：更精确的聊天容器选择器
const CHAT_SELECTOR = '#chat';

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
    b.classList.toggle('pb-smooth', s.enabled && s.smoothScroll);
    b.classList.toggle('pb-stream', s.enabled && s.streamOptim);
}

/* ---------- 拖拽优化（不变） ---------- */
function onDragStart(event) {
    const s = cfg();
    if (!s.enabled || !s.dragBoost) return;
    if (!event.target.closest(LIST_SELECTOR)) return;
    document.body.classList.add('pb-dragging');
}

function onDragEnd() {
    document.body.classList.remove('pb-dragging');
}

/* ---------- 点按反馈（不变） ---------- */
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

/* ---------- v1.1.3 修复：流式输出优化重写 ---------- */
function optimizeStreamOutput() {
    const s = cfg();
    if (!s.enabled || !s.streamOptim) return;

    const chatContainer = document.querySelector(CHAT_SELECTOR);
    if (!chatContainer || chatContainer.dataset.pbStreamFixed === '1') return;

    // v1.1.3 修复：只做最小必要的优化，不影响消息显示
    console.log('[Preset Boost] 应用流式输出优化到聊天容器');

    // 清理旧的监听器
    if (streamObserver) {
        streamObserver.disconnect();
        streamObserver = null;
    }

    // 重新创建监听器，只监听消息插入，强制刷新渲染防卡住
    streamObserver = new MutationObserver((mutations) => {
        let hasNewMessage = false;
        
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (
                        node.classList?.contains('mes') ||
                        node.querySelector?.('.mes')
                    )) {
                        hasNewMessage = true;
                        break;
                    }
                }
            }
            if (hasNewMessage) break;
        }
        
        if (hasNewMessage) {
            // v1.1.3 修复：更温和的防卡住机制
            // 强制触发一次重排，防止DOM更新卡住
            chatContainer.scrollTop = chatContainer.scrollTop;
            
            // 平滑滚动到底部（如果用户在底部附近）
            requestAnimationFrame(() => {
                const isNearBottom = (chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight) < 100;
                if (isNearBottom) {
                    chatContainer.scrollTo({
                        top: chatContainer.scrollHeight,
                        behavior: 'smooth'
                    });
                }
            });
        }
    });
    
    streamObserver.observe(chatContainer, {
        childList: true,
        subtree: true
    });
    
    chatContainer.dataset.pbStreamFixed = '1';
}

function bindGlobalHooks() {
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onDragStart, opts);
    document.addEventListener('pointerup', onDragEnd, opts);
    document.addEventListener('pointercancel', onDragEnd, opts);
    window.addEventListener('blur', onDragEnd, { passive: true });
    document.addEventListener('pointerdown', onTapDown, opts);
}

/* ---------- 编辑框优化（不变） ---------- */
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
    smoothScroll: '预设列表滚动优化',
    streamOptim: '流式输出防卡顿（聊天时）',
};

const GROUPS = [
    { title: '预设列表', keys: ['enabled', 'dragBoost', 'lazyRows', 'killBlur', 'smoothScroll'] },
    { title: '编辑框', keys: ['editBoost', 'noSpellcheck'] },
    { title: '点按反馈', keys: out;
}

body.pb-tap button:active,
body.pb-tap .menu_button:active,
body.pb-tap .drawer-icon:active {
    transform: scale(0.94);
}

/* 波纹图层 */
#pb-ripple-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 99999;
    overflow: hidden;
}

#pb-ripple-layer .pb-dot {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: var(--SmartThemeQuoteColor, #8aa4ff);
    opacity: 0.55;
    animation: pb-dot-out 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}

@keyframes pb-dot-out {
    from { transform: scale(0.4); opacity: 0.55; }
    to   { transform: scale(4.2); opacity: 0; }
}

/* ========== 预设列表滚动优化 ========== */
body.pb-smooth #completion_prompt_manager_list,
body.pb-smooth .completion_prompt_manager_list {
    scroll-behavior: smooth;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    will-change: scroll-position;
    transform: translateZ(0);
}

body.pb-smooth #completion_prompt_manager_list::-webkit-scrollbar,
body.pb-smooth .completion_prompt_manager_list::-webkit-scrollbar {
    width: 8px;
}

body.pb-smooth #completion_prompt_manager_list::-webkit-scrollbar-track,
body.pb-smooth .completion_prompt_manager_list::-webkit-scrollbar-track {
    background: transparent;
}

body.pb-smooth #completion_prompt_manager_list::-webkit-scrollbar-thumb,
body.pb-smooth .completion_prompt_manager_list::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.3);
    border-radius: 4px;
    transition: background 0.2s ease;
}

body.pb-smooth #completion_prompt_manager_list::-webkit-scrollbar-thumb:hover,
body.pb-smooth .completion_prompt_manager_list::-webkit-scrollbar-thumb:hover {
    background: rgba(128, 128, 128, 0.5);
}

/* ========== v1.1.3 修复：移除有问题的聊天容器CSS ========== */
/* 
之前的聊天容器 contain 规则太激进，导致消息内容不显示
现在只在 JS 里做最小必要的优化，不影响消息显示
*/

/* ========== 设置面板样式 ========== */
.pb-settings-block .pb-group {
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

.pb-settings-block .pb-group:last-of-type {
    border-bottom: none;
}

.pb-settings-block .pb-group-title {
    font-size: 0.85em;
    font-weight: bold;
    opacity: 0.7;
    margin-bottom: 6px;
}

.pb-settings-block .checkbox_label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    font-size: 0.9em;
}

/* v1.1.3 新增：热修复通知样式 */
.pb-settings-block .pb-hotfix-notice {
    background: rgba(255, 152, 0, 0.15);
    border: 1px solid rgba(255, 152, 0, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 12px;
    font-size: 0.85em;
    color: #ff9800;
}

.pb-settings-block .pb-debug {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(128, 128, 128, 0.25);
    font-size: 0.8em;
}

.pb-settings-block .pb-debug-title {
    font-weight: bold;
    opacity: 0.7;
    margin-bottom: 6px;
}

.pb-settings-block .pb-debug-line {
    margin-bottom: 3px;
    opacity: 0.6;
}

.pb-settings-block .pb-debug-line span {
    font-weight: bold;
    opacity: 1;
}

/* 尊重系统减少动态效果设置 */
@media (prefers-reduced-motion: reduce) {
    #pb-ripple-layer .pb-dot { 
        animation-duration: 0.01s; 
    }
    body.pb-tap .pb-pressed,
    body.pb-tap button,
    body.pb-tap .menu_button { 
        transition-duration: 0.01s; 
    }
    body.pb-smooth #completion_prompt_manager_list,
    body.pb-smooth .completion_prompt_manager_list {
        scroll-behavior: auto;
    }
}

/* 移动端适配 */
@media (max-width: 768px) {
    body.pb-lazy .completion_prompt_manager_prompt {
        contain-intrinsic-size: auto 40px;
    }
    #pb-ripple-layer .pb-dot {
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
    }
}
