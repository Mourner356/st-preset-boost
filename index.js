import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE = 'preset_boost';

const DEFAULTS = {
    enabled: true,
    dragBoost: true,
    lazyRows: true,
    killBlur: false,
    // v1.1.0 新增
    deepEditBoost: true,
    buttonFeedback: true,
    disableSpellcheck: true,
    editDebounce: 500
};

const LIST_SELECTOR = [
    '#completion_prompt_manager_list',
    '.completion_prompt_manager_list',
    '#completion_prompt_manager',
].join(',');

const ROW_SELECTOR = '.completion_prompt_manager_prompt';

// v1.1.0 新增：编辑器选择器
const EDITOR_SELECTORS = [
    'textarea[data-prompt-role]',
    '.completion_prompt_manager textarea',
    '#completion_prompt_manager textarea',
    'textarea[placeholder*="prompt"], textarea[placeholder*="Prompt"]'
];

let rippleStyle = null;
let editorObserver = null;

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

/* ---------- 把开关状态映射到 body 的 class ---------- */
function applyClasses() {
    const s = cfg();
    const b = document.body;
    b.classList.toggle('pb-on', s.enabled);
    b.classList.toggle('pb-lazy', s.enabled && s.lazyRows);
    b.classList.toggle('pb-noblur', s.enabled && s.killBlur);
    // v1.1.0 新增
    b.classList.toggle('pb-edit-boost', s.enabled && s.deepEditBoost);
    b.classList.toggle('pb-btn-feedback', s.enabled && s.buttonFeedback);
}

/* ---------- 拖拽优化（保持不变） ---------- */
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
    const opts = { passive: true, capture: true };
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('pointerup', onPointerUp, opts);
    document.addEventListener('pointercancel', onPointerUp, opts);
    window.addEventListener('blur', onPointerUp, { passive: true });
}

/* ---------- v1.1.0 新增：深度编辑优化 ---------- */
function optimizeEditor(textarea) {
    if (textarea.hasAttribute('data-pb-optimized')) return;
    
    const s = cfg();
    if (!s.deepEditBoost) return;
    
    console.log('[Preset Boost] 优化编辑器:', textarea);
    
    // 禁用拼写检查和语法检查
    if (s.disableSpellcheck) {
        textarea.spellcheck = false;
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocomplete', 'off');
    }
    
    // 优化输入处理 - 防抖
    let inputTimer = null;
    const originalHandler = textarea.oninput;
    
    textarea.addEventListener('input', function(e) {
        // 立即更新字符计数显示，避免延迟感
        const counter = this.parentElement.querySelector('.character_counter, .char-counter');
        if (counter) {
            counter.textContent = `${this.value.length} characters`;
        }
        
        // 实际保存操作延迟处理
        if (originalHandler) {
            clearTimeout(inputTimer);
            inputTimer = setTimeout(() => {
                originalHandler.call(this, e);
            }, s.editDebounce);
        }
    }, { passive: true });
    
    // 优化滚动性能
    textarea.style.containIntrinsicSize = 'auto 200px';
    
    // 标记已优化
    textarea.setAttribute('data-pb-optimized', 'true');
}

function scanAndOptimizeEditors() {
    const s = cfg();
    if (!s.enabled || !s.deepEditBoost) return;
    
    EDITOR_SELECTORS.forEach(selector => {
        document.querySelectorAll(selector).forEach(optimizeEditor);
    });
}

/* ---------- v1.1.0 新增：按钮反馈系统 ---------- */
function createRippleEffect(event) {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    const ripple = document.createElement('span');
    ripple.className = 'pb-ripple';
    ripple.style.cssText = `
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.6);
        transform: scale(0);
        animation: pb-ripple-anim 0.6s linear;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        pointer-events: none;
    `;
    
    button.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
}

function bindButtonFeedback() {
    const s = cfg();
    if (!s.enabled || !s.buttonFeedback) return;
    
    // 给常见按钮添加反馈效果
    const buttonSelectors = [
        'button',
        '.menu_button', 
        '.fa-solid',
        '.inline-drawer-toggle',
        '[role="button"]',
        '.clickable'
    ];
    
    buttonSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(btn => {
            if (btn.hasAttribute('data-pb-feedback')) return;
            
            btn.style.position = 'relative';
            btn.style.overflow = 'hidden';
            
            btn.addEventListener('pointerdown', createRippleEffect, { passive: true });
            btn.setAttribute('data-pb-feedback', 'true');
        });
    });
}

function createRippleStyles() {
    if (rippleStyle) return;
    
    rippleStyle = document.createElement('style');
    rippleStyle.textContent = `
        @keyframes pb-ripple-anim {
            to {
                transform: scale(4);
                opacity: 0;
            }
        }
        
        .pb-ripple {
            z-index: 1;
        }
    `;
    document.head.appendChild(rippleStyle);
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
                <b>预设性能加速 v1.1.0</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="pb-section">
                    <h4>基础优化</h4>
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
                        <span>关闭毛玻璃模糊（提速明显，界面变扁平）</span>
                    </label>
                </div>
                
                <div class="pb-section">
                    <h4>编辑器增强 🆕</h4>
                    <label class="checkbox_label">
                        <input type="checkbox" id="pb_deepEditBoost" ${s.deepEditBoost ? 'checked' : ''}>
                        <span>深度编辑优化（防抖、禁用语法检查）</span>
                    </label>
                    <label class="checkbox_label">
                        <input type="checkbox" id="pb_disableSpellcheck" ${s.disableSpellcheck ? 'checked' : ''}>
                        <span>禁用拼写检查</span>
                    </label>
                    <div class="pb-range">
                        <label>输入防抖延迟: <span id="pb_debounce_val">${s.editDebounce}ms</span></label>
                        <input type="range" id="pb_editDebounce" min="100" max="1000" step="100" value="${s.editDebounce}">
                    </div>
                </div>
                
                <div class="pb-section">
                    <h4>界面增强 🆕</h4>
                    <label class="checkbox_label">
                        <input type="checkbox" id="pb_buttonFeedback" ${s.buttonFeedback ? 'checked' : ''}>
                        <span>按钮点击反馈（波纹效果）</span>
                    </label>
                </div>
                
                <div class="pb-stat">
                    当前预设条目：<span id="pb_count">—</span> | 
                    已优化编辑器：<span id="pb_editor_count">—</span>
                </div>
            </div>
        </div>
    `;
    host.appendChild(wrap);

    // 绑定事件
    for (const key of Object.keys(DEFAULTS)) {
        const input = document.getElementById(`pb_${key}`);
        if (!input) continue;
        
        if (input.type === 'range') {
            const valSpan = document.getElementById(`pb_${key}_val`);
            input.addEventListener('input', () => {
                cfg()[key] = parseInt(input.value);
                if (valSpan) valSpan.textContent = input.value + 'ms';
                applyClasses();
                saveSettingsDebounced();
            });
        } else {
            input.addEventListener('change', () => {
                cfg()[key] = input.checked;
                applyClasses();
                
                // 应用新设置
                if (key === 'deepEditBoost' && input.checked) {
                    scanAndOptimizeEditors();
                }
                if (key === 'buttonFeedback' && input.checked) {
                    createRippleStyles();
                    bindButtonFeedback();
                }
                
                saveSettingsDebounced();
            });
        }
    }

    return true;
}

function refreshCount() {
    const countEl = document.getElementById('pb_count');
    const editorCountEl = document.getElementById('pb_editor_count');
    if (!countEl) return;
    
    countEl.textContent = String(document.querySelectorAll(ROW_SELECTOR).length);
    
    if (editorCountEl) {
        editorCountEl.textContent = String(document.querySelectorAll('[data-pb-optimized]').length);
    }
}

/* ---------- 启动 ---------- */
function boot() {
    cfg();
    applyClasses();
    bindDragHooks();
    
    // v1.1.0 新增初始化
    if (cfg().buttonFeedback) {
        createRippleStyles();
        bindButtonFeedback();
    }
    
    // 编辑器优化 - 立即扫描 + 监听新增
    scanAndOptimizeEditors();
    
    // 监听DOM变化，优化新出现的编辑器和按钮
    editorObserver = new MutationObserver(() => {
        scanAndOptimizeEditors();
        if (cfg().buttonFeedback) {
            bindButtonFeedback();
        }
    });
    
    editorObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 设置面板
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (buildPanel() || tries > 40) clearInterval(timer);
    }, 500);

    setInterval(refreshCount, 3000);

    console.log('[Preset Boost v1.1.0] 已启动 - 新增编辑器优化 + 按钮反馈');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}

// 清理函数
window.addEventListener('beforeunload', () => {
    if (editorObserver) {
        editorObserver.disconnect();
    }
});
