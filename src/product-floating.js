const STORAGE_KEY = 'shiyi-memory-floating-ui-v1';
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
const ratio = value => Number.isFinite(value) ? clamp(value, 0, 1) : null;

// Presentation-only, device-local preferences: never store chat content or keys.
export function floatingPreferences(value) {
  const point = (p, fallback) => ({ x: ratio(p?.x) ?? fallback.x, y: ratio(p?.y) ?? fallback.y });
  return { version: 1, bubble: point(value?.bubble, { x: 1, y: .65 }), window: point(value?.window, { x: .5, y: .3 }), showLauncher: value?.showLauncher !== false };
}

export function floatingBounds({ width, height, layoutHeight = height, left = 0, top = 0, insets = {}, bottomInset = 0 }) {
  const safe = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const x = left + safe(insets.left) + 8, y = top + safe(insets.top) + 8;
  // VisualViewport can already exclude the keyboard. Do not subtract it twice.
  const right = left + width - safe(insets.right) - 8;
  const bottom = Math.min(top + height - safe(insets.bottom), layoutHeight - Math.max(safe(bottomInset), safe(insets.bottom))) - 8;
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function floatingPosition(point, size, frame) {
  return { x: frame.x + (ratio(point.x) ?? 0) * Math.max(0, frame.width - size.width), y: frame.y + (ratio(point.y) ?? 0) * Math.max(0, frame.height - size.height) };
}

/** One persistent non-modal window. Closing only hides UI, not the application. */
export function mountFloatingProduct({ panel, documentRef, host, version, onClose = () => {} }) {
  const win = documentRef.defaultView ?? host;
  let preferences;
  try { preferences = floatingPreferences(JSON.parse(win.localStorage.getItem(STORAGE_KEY))); }
  catch { preferences = floatingPreferences(); }
  const save = () => { try { win.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* still usable without storage */ } };
  const layer = documentRef.createElement('div'); layer.id = 'shiyi-floating-layer';
  layer.setAttribute('data-tt-mobile-surface', 'none');
  const launcher = documentRef.createElement('button'); launcher.id = 'shiyi-floating-launcher'; launcher.type = 'button';
  launcher.textContent = '拾忆'; launcher.setAttribute('aria-label', '打开拾忆'); launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'shiyi-floating-window'); launcher.setAttribute('data-tt-mobile-surface', 'free-window');
  launcher.title = '打开拾忆 · 拖动可移动';
  const windowEl = documentRef.createElement('section'); windowEl.id = 'shiyi-floating-window'; windowEl.className = 'sy-workbench';
  windowEl.hidden = true; windowEl.setAttribute('role', 'dialog'); windowEl.setAttribute('aria-modal', 'false');
  windowEl.setAttribute('aria-label', '拾忆悬浮窗'); windowEl.setAttribute('data-tt-mobile-surface', 'free-window');
  const header = documentRef.createElement('header'); header.className = 'sy-workbench-header';
  const grip = documentRef.createElement('button'); grip.type = 'button'; grip.className = 'sy-workbench-drag';
  grip.textContent = `⠿  拾忆  ${version}`; grip.setAttribute('aria-label', '移动拾忆窗口'); grip.title = '拖动移动；方向键也可移动';
  const closeButton = documentRef.createElement('button'); closeButton.type = 'button'; closeButton.className = 'sy-workbench-close';
  closeButton.textContent = '收起'; closeButton.setAttribute('aria-label', '收起拾忆');
  const content = documentRef.createElement('div'); content.className = 'sy-workbench-content'; content.appendChild(panel);
  header.append(grip, closeButton); windowEl.append(header, content); layer.append(launcher, windowEl); documentRef.body.appendChild(layer);
  // A manual popover is non-modal and escapes drawer/theme stacking contexts.
  // Old WebViews retain a fixed high-z-index surface; no showModal or scroll lock.
  if (typeof layer.showPopover === 'function') {
    layer.setAttribute('popover', 'manual');
    try { layer.showPopover(); } catch { layer.removeAttribute('popover'); }
  }
  const shortcut = documentRef.createElement('div'); shortcut.id = 'shiyi-extension-shortcut';
  const shortcutButton = documentRef.createElement('button'); shortcutButton.type = 'button'; shortcutButton.textContent = '打开拾忆悬浮窗';
  const toggleLabel = documentRef.createElement('label'), toggle = documentRef.createElement('input');
  toggle.type = 'checkbox'; toggle.checked = preferences.showLauncher;
  toggleLabel.append(toggle, documentRef.createTextNode(' 显示悬浮按钮')); shortcut.append(shortcutButton, toggleLabel);
  documentRef.getElementById('extensions_settings2')?.appendChild(shortcut);
  let disposed = false, raf = null, unsubscribe = null;
  const cleanup = [];
  function listen(target, type, fn, options) { target?.addEventListener?.(type, fn, options); cleanup.push(() => target?.removeEventListener?.(type, fn, options)); }
  // A touch opens on pointerup and hides its target. Some WebViews then retarget
  // the compatibility click to the newly exposed window control under the finger.
  // Consume only that gesture's click; a new pointerdown or keyboard click is free.
  let openingGesture = null;
  listen(documentRef, 'pointerdown', () => { openingGesture = null; }, true);
  listen(documentRef, 'click', event => {
    const g = openingGesture; openingGesture = null;
    if (g && event.detail !== 0 && Date.now() - g.at < 700 && Math.hypot(event.clientX - g.x, event.clientY - g.y) < 20) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  const px = (style, name) => Math.max(0, Number.parseFloat(style.getPropertyValue(name)) || 0);
  function frameFor(element) {
    const rootStyle = win.getComputedStyle(documentRef.documentElement), localStyle = win.getComputedStyle(element);
    const vv = win.visualViewport;
    return floatingBounds({ width: vv?.width ?? win.innerWidth, height: vv?.height ?? win.innerHeight,
      left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0, layoutHeight: win.innerHeight,
      insets: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, px(rootStyle, `--tt-inset-${side}`)])),
      bottomInset: Math.max(px(localStyle, '--tt-viewport-bottom-inset'), px(localStyle, '--tt-ime-bottom')) });
  }
  function setPx(element, key, number) {
    const value = `${Math.round(number * 100) / 100}px`;
    if (element.style[key] !== value) element.style[key] = value;
  }
  function place(element, point) {
    const frame = frameFor(element), size = element.getBoundingClientRect(), position = floatingPosition(point, size, frame);
    setPx(element, 'left', position.x); setPx(element, 'top', position.y);
  }
  function layout() {
    if (disposed) return;
    const frame = frameFor(windowEl);
    // Leave room to drag even on a narrow screen; content scrolls below the grip.
    setPx(windowEl, 'width', Math.min(660, frame.width));
    setPx(windowEl, 'height', Math.min(720, frame.height * .92));
    if (!windowEl.hidden) place(windowEl, preferences.window);
    if (!launcher.hidden) place(launcher, preferences.bubble);
  }
  function schedule() { if (raf === null && !disposed) raf = win.requestAnimationFrame(() => { raf = null; layout(); }); }
  function show() {
    if (disposed) return;
    windowEl.hidden = false; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'true'); layout();
    grip.focus({ preventScroll: true });
  }
  function hide() {
    windowEl.hidden = true; launcher.hidden = !preferences.showLauncher; launcher.setAttribute('aria-expanded', 'false'); layout();
    onClose(); (launcher.hidden ? shortcutButton : launcher).focus({ preventScroll: true });
  }
  function move(element, kind, x, y, persist = false) {
    const frame = frameFor(element), size = element.getBoundingClientRect();
    const maxX = Math.max(0, frame.width - size.width), maxY = Math.max(0, frame.height - size.height);
    x = clamp(x, frame.x, frame.x + maxX); y = clamp(y, frame.y, frame.y + maxY);
    setPx(element, 'left', x); setPx(element, 'top', y);
    if (persist) { preferences[kind] = { x: maxX ? (x - frame.x) / maxX : preferences[kind].x, y: maxY ? (y - frame.y) / maxY : preferences[kind].y }; save(); }
  }
  function draggable(handle, element, kind, tap) {
    let drag = null, suppressClick = false;
    listen(handle, 'pointerdown', event => {
      if (event.isPrimary === false || event.button !== 0) return;
      const r = element.getBoundingClientRect(); suppressClick = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: r.left, top: r.top, moved: false };
      try { handle.setPointerCapture(event.pointerId); } catch { /* fallback listeners still work */ }
      event.preventDefault();
    });
    listen(handle, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) >= 6) drag.moved = true;
      if (drag.moved) { event.preventDefault(); move(element, kind, drag.left + dx, drag.top + dy); }
    });
    const finish = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const previous = drag; drag = null; suppressClick = previous.moved;
      if (event.type === 'pointercancel') { suppressClick = true; place(element, preferences[kind]); }
      else if (previous.moved) { const r = element.getBoundingClientRect(); move(element, kind, r.left, r.top, true); }
      try { handle.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      if (event.type === 'pointerup' && !previous.moved && tap) {
        // Some Android WebViews suppress/delay the compatibility click after
        // pointer capture. Complete taps here and ignore the duplicate click.
        suppressClick = true; event.preventDefault();
        openingGesture = { x: event.clientX, y: event.clientY, at: Date.now() };
        tap();
      }
    };
    listen(handle, 'pointerup', finish); listen(handle, 'pointercancel', finish);
    listen(handle, 'lostpointercapture', event => { if (drag?.id === event.pointerId) { drag = null; suppressClick = true; place(element, preferences[kind]); } });
    listen(handle, 'click', event => { if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; } tap?.(); });
    listen(handle, 'keydown', event => {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault(); const r = element.getBoundingClientRect(), step = event.shiftKey ? 40 : 16;
      move(element, kind, r.left + direction[0] * step, r.top + direction[1] * step, true);
    });
  }
  draggable(launcher, launcher, 'bubble', show); draggable(grip, windowEl, 'window');
  listen(closeButton, 'click', hide); listen(shortcutButton, 'click', show);
  listen(toggle, 'change', () => { preferences.showLauncher = toggle.checked; launcher.hidden = !windowEl.hidden || !toggle.checked; save(); layout(); });
  listen(windowEl, 'keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); hide(); } });
  listen(win, 'resize', schedule); listen(win, 'orientationchange', schedule);
  listen(win.visualViewport, 'resize', schedule); listen(win.visualViewport, 'scroll', schedule);
  // Ignore our own left/top writes in both our observer and TT's subscription:
  // otherwise reapplying saved coordinates would snap an active drag back.
  let geometrySignature = JSON.stringify([frameFor(windowEl), frameFor(launcher)]);
  function geometryChanged() {
    const next = JSON.stringify([frameFor(windowEl), frameFor(launcher)]);
    if (next !== geometrySignature) { geometrySignature = next; schedule(); }
  }
  let observer;
  if (win.MutationObserver) {
    observer = new win.MutationObserver(geometryChanged);
    for (const element of [documentRef.documentElement, windowEl, launcher]) observer.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'data-tt-ime-active'] });
  }
  // Prefer TT's subscription when present; CSS/viewport observers remain the fallback.
  Promise.resolve(host?.__TAURITAVERN__?.ready).then(async () => {
    if (disposed) return;
    const subscription = await host?.__TAURITAVERN__?.api?.layout?.subscribe?.(geometryChanged);
    if (disposed) await subscription?.(); else unsubscribe = subscription;
  }).catch(() => { /* CSS contract remains available */ });
  launcher.hidden = !preferences.showLauncher; layout();
  return { layer, launcher, window: windowEl, content, shortcut, show, hide,
    destroy() { disposed = true; if (raf !== null) win.cancelAnimationFrame(raf); observer?.disconnect(); for (const off of cleanup) off(); Promise.resolve().then(() => unsubscribe?.()).catch(() => {}); layer.remove(); shortcut.remove(); } };
}
