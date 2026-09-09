// DOM の小道具と共通 UI 部品 (シート、トースト、ステッパーなど)。

import { num, round } from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function applyProps(node, props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return parent;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

// --- トースト ---------------------------------------------------------------

export function toast(message, kind = '', ms = 2200) {
  const root = document.getElementById('toast-root');
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

// --- シート -----------------------------------------------------------------

const sheetStack = [];

/**
 * ボトムシートを開く。
 * body には要素の配列か、body 要素を受け取る関数を渡す。
 * 戻り値の close() で閉じられる。
 */
export function openSheet(opts) {
  const root = document.getElementById('sheet-root');

  const bodyEl = el('div', { class: 'sheet-body' });
  const headChildren = [];
  headChildren.push(
    opts.left === null
      ? el('span', { style: { minWidth: '56px' } })
      : el('button', {
          class: 'icon-btn',
          type: 'button',
          text: opts.left || 'キャンセル',
          onclick: () => (opts.onLeft ? opts.onLeft(handle) : handle.close()),
        }),
  );
  headChildren.push(el('h2', { class: 'sheet-title', text: opts.title || '' }));
  headChildren.push(
    opts.right
      ? el('button', {
          class: 'icon-btn',
          type: 'button',
          text: opts.right,
          onclick: () => opts.onRight && opts.onRight(handle),
        })
      : el('span', { style: { minWidth: '56px' } }),
  );

  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet-head' }, headChildren),
    bodyEl,
  ]);

  if (opts.footer) {
    panel.appendChild(el('div', { class: 'sheet-foot' }, opts.footer));
  }

  const backdrop = el('div', { class: 'sheet-backdrop' }, [panel]);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && opts.dismissible !== false) handle.close();
  });

  const handle = {
    body: bodyEl,
    panel,
    setFooter(children) {
      let foot = panel.querySelector('.sheet-foot');
      if (!foot) {
        foot = el('div', { class: 'sheet-foot' });
        panel.appendChild(foot);
      }
      append(clear(foot), children);
    },
    close() {
      const i = sheetStack.indexOf(handle);
      if (i >= 0) sheetStack.splice(i, 1);
      backdrop.remove();
      if (!sheetStack.length) document.body.style.overflow = '';
      if (opts.onClose) opts.onClose();
    },
  };

  append(bodyEl, typeof opts.body === 'function' ? opts.body(handle) || [] : opts.body || []);

  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  sheetStack.push(handle);
  return handle;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetStack.length) {
    sheetStack[sheetStack.length - 1].close();
  }
});

/** はい / いいえ の確認。Promise<boolean> を返す。 */
export function confirmSheet({ title, message, okLabel = 'OK', cancelLabel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      if (answered) return;
      answered = true;
      handle.close();
      resolve(v);
    };
    const handle = openSheet({
      title,
      left: null,
      body: [el('p', { class: 'note', text: message })],
      footer: [
        el('button', { class: 'btn', type: 'button', text: cancelLabel, onclick: () => done(false) }),
        el('button', {
          class: `btn ${danger ? 'danger' : 'primary'}`,
          type: 'button',
          text: okLabel,
          onclick: () => done(true),
        }),
      ],
      onClose: () => {
        if (!answered) {
          answered = true;
          resolve(false);
        }
      },
    });
  });
}

// --- 入力部品 ---------------------------------------------------------------

/**
 * ＋ / − 付きの数値入力。
 * 戻り値: { root, get(), set(v), focus(), showError(msg), clearError() }
 */
export function numberField({
  label,
  unit = '',
  step = 1,
  decimals = 1,
  value = null,
  required = false,
  placeholder = '',
  hint = '',
  min = 0,
}) {
  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    value: value === null || value === undefined ? '' : String(value),
    placeholder,
    'aria-label': label,
  });

  const bump = (dir) => {
    const current = num(input.value);
    const base = current === null ? Number(value ?? 0) : current;
    let next = round(base + dir * step, decimals + 1);
    if (min !== null && next < min) next = min;
    input.value = String(round(next, decimals));
    clearError();
    // 押している間は input、指を離したときに change。
    // 保存や再描画は change 側で拾うので、連続増減の途中で走らない。
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /**
   * ＋ / − ボタン。軽く 1 回押すと 1 段階、押しっぱなしで連続増減。
   *
   * 大事なのは「指が触れた瞬間には何もしない」こと。触れた時点で増減させると、
   * スクロールしようとして指がボタンに乗っただけで値が変わってしまう。
   * そのため:
   *   - 増減するのは指を離したとき。しかも指が 10px 以上動いていたら
   *     スクロールとみなして何もしない
   *   - 長押しの連続増減も、動かずに 450ms 経ってから始める
   *
   * 指を離す判定は button ではなく document で拾う。押したまま指がボタンの
   * 外に滑っても、離した時点で確実に止まるようにするため。
   */
  const MOVE_LIMIT = 10; // これ以上動いたらスクロール操作とみなす

  function stepButton(text, dir, aria) {
    const btn = el('button', { type: 'button', text, 'aria-label': aria });
    let holdTimer = null;
    let repeatTimer = null;
    let tracking = false;
    let moved = false;
    let bumped = false;
    let startX = 0;
    let startY = 0;
    let lastTouchAt = 0;

    const clearTimers = () => {
      clearTimeout(holdTimer);
      clearInterval(repeatTimer);
      holdTimer = null;
      repeatTimer = null;
    };

    const settle = () => {
      clearTimers();
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onCancel);
      document.removeEventListener('mouseup', onMouseUp);
      const changed = bumped;
      tracking = false;
      moved = false;
      bumped = false;
      if (changed) input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // 動かずに 450ms 経ったら連続増減を始める
    const armHold = () => {
      holdTimer = setTimeout(() => {
        if (!tracking || moved) return;
        bump(dir);
        bumped = true;
        repeatTimer = setInterval(() => {
          if (!btn.isConnected || moved) {
            settle();
            return;
          }
          bump(dir);
          bumped = true;
        }, 100);
      }, 450);
    };

    function onMove(e) {
      if (!tracking || moved) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startX) > MOVE_LIMIT || Math.abs(t.clientY - startY) > MOVE_LIMIT) {
        moved = true; // スクロール操作。増減はしない
        clearTimers();
      }
    }

    function onTouchEnd() {
      if (!tracking) return;
      if (!moved && !bumped) {
        bump(dir); // 動かずに離した = 軽いタップ
        bumped = true;
      }
      settle();
    }

    // ブラウザがスクロールを始めるとこれが飛んでくる。増減はしない。
    function onCancel() {
      if (!tracking) return;
      moved = true;
      settle();
    }

    function onMouseUp() {
      if (!tracking) return;
      if (!bumped) {
        bump(dir);
        bumped = true;
      }
      settle();
    }

    btn.addEventListener('touchstart', (e) => {
      if (tracking) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      lastTouchAt = Date.now();
      tracking = true;
      moved = false;
      bumped = false;
      startX = t.clientX;
      startY = t.clientY;
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onCancel);
      armHold();
    }, { passive: true }); // preventDefault しないので、スクロールを妨げない

    btn.addEventListener('mousedown', () => {
      if (tracking) return;
      if (Date.now() - lastTouchAt < 700) return; // タッチ由来の合成マウスイベント
      tracking = true;
      moved = false;
      bumped = false;
      document.addEventListener('mouseup', onMouseUp);
      armHold();
    });

    // キーボード操作向けの保険 (連続増減はしない)
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      bump(dir);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return btn;
  }

  const stepper = el('div', { class: 'stepper' }, [
    stepButton('−', -1, `${label}を減らす`),
    input,
    stepButton('＋', 1, `${label}を増やす`),
  ]);

  const errorEl = el('div', { class: 'field-error', hidden: true });

  const root = el('div', { class: 'field' }, [
    el('div', { class: 'field-label' }, [label, required ? el('span', { class: 'req', text: '必須' }) : null]),
    el('div', { class: 'stepper-wrap' }, [stepper, unit ? el('span', { class: 'unit', text: unit }) : null]),
    hint ? el('div', { class: 'field-hint', text: hint }) : null,
    errorEl,
  ]);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    stepper.classList.add('invalid');
  }
  function clearError() {
    errorEl.hidden = true;
    stepper.classList.remove('invalid');
  }
  input.addEventListener('input', clearError);

  return {
    root,
    input,
    required,
    label,
    get: () => num(input.value),
    set: (v) => {
      input.value = v === null || v === undefined ? '' : String(v);
      clearError();
    },
    focus: () => input.focus(),
    showError,
    clearError,
  };
}

/** ふつうのテキスト入力。 */
export function textField({ label, value = '', placeholder = '', required = false, multiline = false, hint = '' }) {
  const input = multiline
    ? el('textarea', { class: 'textarea', placeholder, 'aria-label': label })
    : el('input', { class: 'input', type: 'text', placeholder, 'aria-label': label });
  input.value = value || '';

  const errorEl = el('div', { class: 'field-error', hidden: true });
  const root = el('div', { class: 'field' }, [
    label ? el('div', { class: 'field-label' }, [label, required ? el('span', { class: 'req', text: '必須' }) : null]) : null,
    input,
    hint ? el('div', { class: 'field-hint', text: hint }) : null,
    errorEl,
  ]);

  input.addEventListener('input', () => {
    errorEl.hidden = true;
    input.classList.remove('invalid');
  });

  return {
    root,
    input,
    get: () => input.value.trim(),
    set: (v) => { input.value = v || ''; },
    focus: () => input.focus(),
    showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
      input.classList.add('invalid');
    },
  };
}

export function selectField({ label, options, value, hint = '' }) {
  const select = el('select', { class: 'select', 'aria-label': label });
  for (const opt of options) {
    const o = el('option', { value: opt.value, text: opt.label });
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  const root = el('div', { class: 'field' }, [
    label ? el('div', { class: 'field-label', text: label }) : null,
    select,
    hint ? el('div', { class: 'field-hint', text: hint }) : null,
  ]);
  return { root, select, get: () => select.value, set: (v) => { select.value = v; } };
}

export function dateField({ label, value, hint = '' }) {
  const input = el('input', { class: 'input', type: 'date', 'aria-label': label });
  input.value = value || '';
  const root = el('div', { class: 'field' }, [
    label ? el('div', { class: 'field-label', text: label }) : null,
    input,
    hint ? el('div', { class: 'field-hint', text: hint }) : null,
  ]);
  return { root, input, get: () => input.value || null, set: (v) => { input.value = v || ''; } };
}

/** オン/オフのスイッチ行。 */
export function switchRow({ title, sub = '', checked = false, onChange }) {
  const btn = el('button', {
    class: 'switch',
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': title,
  });
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    if (onChange) onChange(next);
  });
  const root = el('div', { class: 'switch-row' }, [
    el('div', { class: 'main' }, [
      el('div', { class: 'title', text: title }),
      sub ? el('div', { class: 'sub', text: sub }) : null,
    ]),
    btn,
  ]);
  return { root, get: () => btn.getAttribute('aria-checked') === 'true', set: (v) => btn.setAttribute('aria-checked', v ? 'true' : 'false') };
}

/** セグメンテッドコントロール。 */
export function segmented(options, value, onChange) {
  const root = el('div', { class: 'seg', role: 'tablist' });
  for (const opt of options) {
    const b = el('button', {
      type: 'button',
      role: 'tab',
      text: opt.label,
      'aria-selected': opt.value === value ? 'true' : 'false',
    });
    b.addEventListener('click', () => {
      for (const child of root.children) child.setAttribute('aria-selected', 'false');
      b.setAttribute('aria-selected', 'true');
      onChange(opt.value);
    });
    root.appendChild(b);
  }
  return root;
}

// --- 表示部品 ---------------------------------------------------------------

export function card(title, children, actions = null) {
  const head = title || actions
    ? el('div', { class: 'card-head' }, [
        title ? el('h2', { class: 'card-title', text: title }) : null,
        actions ? el('div', { class: 'spacer' }) : null,
        actions,
      ])
    : null;
  return el('div', { class: 'card' }, [head, ...(Array.isArray(children) ? children : [children])]);
}

export function stat({ label, value, unit = '', sub = '', tone = '' }) {
  return el('div', { class: `stat ${tone}`.trim() }, [
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value' }, [String(value), unit ? el('span', { class: 'unit', text: unit }) : null]),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null,
  ]);
}

export function emptyState(title, detail = '') {
  return el('div', { class: 'empty' }, [el('strong', { text: title }), detail]);
}

export function chevron() {
  return svg('svg', { class: 'chevron', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true' }, [
    svg('path', { d: 'M9 6l6 6-6 6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }),
  ]);
}

/** 押せるリスト行。 */
export function listRow({ title, sub = '', trail = '', badge = null, onClick, chevronIcon = true }) {
  const node = el(onClick ? 'button' : 'div', { class: 'list-row', type: onClick ? 'button' : null }, [
    el('div', { class: 'main' }, [
      el('div', { class: 'title' }, [title, badge]),
      sub ? el('div', { class: 'sub', text: sub }) : null,
    ]),
    trail ? el('div', { class: 'trail', text: trail }) : null,
    onClick && chevronIcon ? chevron() : null,
  ]);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function list(children) {
  return el('div', { class: 'list' }, children);
}

export function progressBar({ ratio, leftLabel, rightLabel, tone = '' }) {
  const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return el('div', { class: 'progress' }, [
    el('div', { class: 'progress-track' }, [
      el('div', { class: `progress-fill ${tone}`.trim(), style: { width: `${pct}%` } }),
    ]),
    el('div', { class: 'progress-labels' }, [
      el('span', { text: leftLabel }),
      el('span', { text: rightLabel }),
    ]),
  ]);
}
