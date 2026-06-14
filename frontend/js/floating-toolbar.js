/**
 * 共有フローティング書式ツールバー
 *
 * 単一の B / 赤A / A− / A / A+ ツールバーを body 直下に1つだけ生成し、
 * 登録済みエディタ内でテキストを範囲選択した時に、選択範囲の上にフロート表示する。
 *
 * 仕様:
 *   - エディタは contenteditable な要素を想定
 *   - 太字: <strong> ⇔ **bold** マークダウンで往復
 *   - 文字色（赤）: <span style="color:#e53e3e"> ⇔ 同形式のインライン HTML で往復（トグル）
 *   - サイズ: <span style="font-size:Xem"> ⇔ 同形式のインライン HTML で往復
 *   - サイズは 0.8x / 1.0x / 1.25x / 1.5x / 2.0x の 5 段階を順送り、中央 A でリセット
 *   - 表示中は位置を固定（選択範囲の rect が変わってもツールバーは動かない）
 *
 * API:
 *   - attachFloatingToolbar(editor): エディタを登録（ツールバー生成 + Ctrl+B キーバインド）
 *   - appendMarkdownToEditor(editor, markdown, opts): markdown → DOM 展開
 *   - serializeEditorMarkdown(editor, opts): DOM → markdown シリアライズ
 *   - SIZE_SPAN_STRIP: 表示用に size span タグだけ剥がす正規表現
 *   - SIZE_LEVELS, DEFAULT_SIZE
 */

export const SIZE_LEVELS = [0.8, 1.0, 1.25, 1.5, 2.0];
export const DEFAULT_SIZE = 1.0;
// 表示用プレビューから size / color span タグを剥がす（中身は残す）
export const SIZE_SPAN_STRIP = /<span\s+style="(?:font-size|color):[^"]*"\s*>|<\/span>/gi;

// 文字色トグルで使う色（赤）。保存データにもこの hex がそのまま入る。
export const TEXT_COLOR = "#e53e3e";

const BOLD_MATCH = /\*\*([^\n*][^\n]*?)\*\*/g;

// ========== エディタ登録 ==========

const editorRegistry = new WeakSet();

export function attachFloatingToolbar(editor) {
  if (!editor || editor.nodeType !== Node.ELEMENT_NODE) return;
  if (editorRegistry.has(editor)) return;
  editorRegistry.add(editor);

  ensureToolbar();
  editor.addEventListener("keydown", handleEditorBoldShortcut);
}

function handleEditorBoldShortcut(e) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    toggleBoldOnSelection();
  }
}

/** 現在の選択範囲を含む登録済みエディタを返す。なければ null */
function getActiveEditor() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node) {
    if (editorRegistry.has(node)) return node;
    node = node.parentElement;
  }
  return null;
}

// ========== ツールバー UI ==========

let toolbarEl = null;
let toolbarInited = false;
// 選択が確定したら位置を固定（ピン留め）し、B/A 操作の度に飛び跳ねないようにする。
// ドラッグ中（選択を広げている最中）は false のままにして、選択範囲の上端に追従させる。
let toolbarPinned = false;

function ensureToolbar() {
  if (toolbarInited) return;
  toolbarInited = true;

  toolbarEl = document.createElement("div");
  toolbarEl.id = "ft-floating-toolbar";
  toolbarEl.className = "ft-floating-toolbar";
  toolbarEl.setAttribute("role", "toolbar");
  toolbarEl.setAttribute("aria-label", "テキスト書式");
  toolbarEl.style.display = "none";
  toolbarEl.innerHTML = [
    `<button type="button" class="ft-btn ft-btn-bold" title="太字 (Ctrl+B)" aria-label="太字"><b>B</b></button>`,
    `<button type="button" class="ft-btn ft-btn-color" title="文字を赤色に" aria-label="文字を赤色に"><b style="color:${TEXT_COLOR}">A</b></button>`,
    `<span class="ft-sep" aria-hidden="true"></span>`,
    `<button type="button" class="ft-btn ft-btn-size-down" title="文字を小さく" aria-label="文字を小さく">A<span class="ft-sub">−</span></button>`,
    `<button type="button" class="ft-btn ft-btn-size-reset" title="文字サイズをデフォルトに戻す" aria-label="文字サイズをデフォルトに戻す">A</button>`,
    `<button type="button" class="ft-btn ft-btn-size-up" title="文字を大きく" aria-label="文字を大きく">A<span class="ft-sup">+</span></button>`,
  ].join("");
  document.body.appendChild(toolbarEl);

  const bindBtn = (sel, fn) => {
    const b = toolbarEl.querySelector(sel);
    if (!b) return;
    b.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
    b.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  bindBtn(".ft-btn-bold", () => toggleBoldOnSelection());
  bindBtn(".ft-btn-color", () => toggleColorOnSelection());
  bindBtn(".ft-btn-size-down", () => bumpSelectionFontSize(-1));
  bindBtn(".ft-btn-size-reset", () => setSelectionFontSize(DEFAULT_SIZE));
  bindBtn(".ft-btn-size-up", () => bumpSelectionFontSize(+1));

  document.addEventListener("selectionchange", updateToolbarPosition);
  window.addEventListener("scroll", updateToolbarPosition, true);
  window.addEventListener("resize", updateToolbarPosition);
  // ドラッグ開始（pointerdown）でピンを外して選択に追従させ、
  // 離した（pointerup）時点で現在の選択範囲の真上に置き直してから固定する。
  document.addEventListener("pointerdown", onSelectionPointerDown, true);
  document.addEventListener("pointerup", onSelectionPointerUp, true);
}

/** ツールバー自身のボタン上で起きたイベントか */
function isToolbarEvent(e) {
  return !!(toolbarEl && e.target && toolbarEl.contains(e.target));
}

function onSelectionPointerDown(e) {
  if (isToolbarEvent(e)) return; // ボタン操作では追従を再開しない
  toolbarPinned = false; // 新しい選択を開始 → 追従モードへ
}

function onSelectionPointerUp(e) {
  if (isToolbarEvent(e)) return;
  // 選択確定: 現在の選択範囲を基準に一度だけ置き直してからピン留め
  toolbarPinned = false;
  updateToolbarPosition();
  toolbarPinned = true;
}

function updateToolbarPosition() {
  const tb = toolbarEl;
  if (!tb) return;
  const editor = getActiveEditor();
  if (!editor) {
    tb.style.display = "none";
    toolbarPinned = false;
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    tb.style.display = "none";
    toolbarPinned = false;
    return;
  }
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    tb.style.display = "none";
    toolbarPinned = false;
    return;
  }
  // 選択確定後は位置を固定（B/A 操作の度に飛び跳ねないように）。
  // ドラッグ中（未ピン）は選択範囲の上端へ追従し続ける。
  if (toolbarPinned && tb.style.display !== "none") return;

  tb.style.visibility = "hidden";
  tb.style.display = "";
  const tbW = tb.offsetWidth;
  const tbH = tb.offsetHeight;
  let top = window.scrollY + rect.top - tbH - 10;
  let left = window.scrollX + rect.left + rect.width / 2 - tbW / 2;
  const minLeft = window.scrollX + 4;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - tbW - 4;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  if (top < window.scrollY + 4) {
    top = window.scrollY + rect.bottom + 8;
  }
  tb.style.top = top + "px";
  tb.style.left = left + "px";
  tb.style.visibility = "";
}

// ========== 太字トグル ==========

function toggleBoldOnSelection() {
  const editor = getActiveEditor();
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  if (document.activeElement !== editor) editor.focus({ preventScroll: true });
  try {
    document.execCommand("bold", false, null);
  } catch {
    return;
  }
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

// ========== 文字色トグル（赤） ==========

/** 色文字列を computed な rgb(...) 形式に正規化して比較できるようにする */
function normalizeColor(c) {
  if (!c) return "";
  const probe = document.createElement("span");
  probe.style.color = c;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb;
}

/** 選択開始位置がすでに赤色 span 内にあるか */
function selectionIsColored() {
  const editor = getActiveEditor();
  if (!editor) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const target = normalizeColor(TEXT_COLOR);
  while (node && node !== editor) {
    if (node.style && node.style.color) {
      return normalizeColor(node.style.color) === target;
    }
    if (node.tagName === "FONT" && node.getAttribute("color")) {
      return normalizeColor(node.getAttribute("color")) === target;
    }
    node = node.parentElement;
  }
  return false;
}

/** 選択範囲に交差する color span / <font color> を中身だけ残して剥がす */
function stripColorSpansInSelection(editor) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const nodes = editor.querySelectorAll('span[style*="color"], font[color]');
  nodes.forEach((node) => {
    if (!range.intersectsNode(node)) return;
    // 背景色やサイズ span はそのまま残し、文字色専用 span / font のみ剥がす
    const isColorOnly =
      node.tagName === "FONT" ||
      (node.style && node.style.color && !node.style.backgroundColor && !node.style.fontSize);
    if (!isColorOnly) return;
    while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
    node.remove();
  });
}

function toggleColorOnSelection() {
  const editor = getActiveEditor();
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  if (document.activeElement !== editor) editor.focus({ preventScroll: true });
  try {
    if (selectionIsColored()) {
      stripColorSpansInSelection(editor);
    } else {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("foreColor", false, TEXT_COLOR);
    }
  } catch {
    return;
  }
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

// ========== サイズ操作 ==========

function getCurrentSelectionFontSize() {
  const editor = getActiveEditor();
  if (!editor) return DEFAULT_SIZE;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return DEFAULT_SIZE;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== editor) {
    if (node.style && node.style.fontSize && node.style.fontSize.endsWith("em")) {
      const em = parseFloat(node.style.fontSize);
      if (!isNaN(em) && em > 0) return em;
    }
    node = node.parentElement;
  }
  return DEFAULT_SIZE;
}

function nearestSizeLevelIndex(em) {
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 0; i < SIZE_LEVELS.length; i++) {
    const diff = Math.abs(SIZE_LEVELS[i] - em);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

function bumpSelectionFontSize(dir) {
  const cur = getCurrentSelectionFontSize();
  const idx = nearestSizeLevelIndex(cur);
  const nextIdx = Math.max(0, Math.min(SIZE_LEVELS.length - 1, idx + dir));
  setSelectionFontSize(SIZE_LEVELS[nextIdx]);
}

function setSelectionFontSize(targetEm) {
  const editor = getActiveEditor();
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let range = sel.getRangeAt(0);
  if (range.collapsed) return;
  // 画像が含まれる範囲には適用しない
  const peek = range.cloneContents();
  if (peek.querySelector && peek.querySelector("img")) return;

  if (document.activeElement !== editor) editor.focus({ preventScroll: true });

  // 祖先 size span を分割して持ち上げ（em のネスト累積を防ぐ）
  for (let safety = 0; safety < 5; safety++) {
    const enclosing = findEnclosingSizeSpan(editor, range);
    if (!enclosing) break;
    const lifted = splitSizeSpanAroundRange(enclosing, range);
    if (!lifted) return;
    range = lifted;
  }

  const fragment = range.extractContents();
  fragment.querySelectorAll("span").forEach((s) => {
    if (s.style && s.style.fontSize && s.style.fontSize.endsWith("em")) {
      while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
      s.remove();
    }
  });

  const newRange = document.createRange();
  if (Math.abs(targetEm - DEFAULT_SIZE) < 1e-3) {
    const firstChild = fragment.firstChild;
    const lastChild = fragment.lastChild;
    range.insertNode(fragment);
    if (firstChild && lastChild) {
      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);
    } else {
      newRange.setStart(range.startContainer, range.startOffset);
      newRange.collapse(true);
    }
  } else {
    const span = document.createElement("span");
    span.style.fontSize = `${targetEm}em`;
    span.appendChild(fragment);
    range.insertNode(span);
    newRange.selectNodeContents(span);
  }
  sel.removeAllRanges();
  sel.addRange(newRange);

  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function findEnclosingSizeSpan(editor, range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== editor) {
    if (node.tagName === "SPAN" && node.style && node.style.fontSize && node.style.fontSize.endsWith("em")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function splitSizeSpanAroundRange(span, range) {
  const fontSize = span.style.fontSize;
  const parent = span.parentNode;
  if (!parent) return null;

  const afterRange = document.createRange();
  afterRange.selectNodeContents(span);
  afterRange.setStart(range.endContainer, range.endOffset);
  const afterFrag = afterRange.extractContents();

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(span);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeFrag = beforeRange.extractContents();

  if (beforeFrag.firstChild) {
    const bs = document.createElement("span");
    bs.style.fontSize = fontSize;
    bs.appendChild(beforeFrag);
    parent.insertBefore(bs, span);
  }
  if (afterFrag.firstChild) {
    const as_ = document.createElement("span");
    as_.style.fontSize = fontSize;
    as_.appendChild(afterFrag);
    parent.insertBefore(as_, span.nextSibling);
  }

  const middleFrag = document.createDocumentFragment();
  while (span.firstChild) middleFrag.appendChild(span.firstChild);
  const firstMid = middleFrag.firstChild;
  const lastMid = middleFrag.lastChild;
  parent.insertBefore(middleFrag, span);
  span.remove();

  if (!firstMid || !lastMid) return null;

  const newRange = document.createRange();
  newRange.setStartBefore(firstMid);
  newRange.setEndAfter(lastMid);
  return newRange;
}

// ========== Markdown ⇔ DOM 変換ヘルパー ==========

function appendTextLines(target, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) target.appendChild(document.createElement("br"));
    if (lines[i]) target.appendChild(document.createTextNode(lines[i]));
  }
}

function appendTextWithBold(parent, text) {
  const re = new RegExp(BOLD_MATCH.source, "g");
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) appendTextLines(parent, text.slice(lastIdx, m.index));
    const strong = document.createElement("strong");
    appendTextLines(strong, m[1]);
    if (strong.childNodes.length > 0) parent.appendChild(strong);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) appendTextLines(parent, text.slice(lastIdx));
}

// 過去のバグで <span size=1.5><span size=1.25>X</span></span> のような入れ子が
// 保存データに混入することがあった。非貪欲な単発正規表現マッチでは入れ子に対応できず、
// 最初の </span> で止まってしまい残りがリテラル <span> 文字として描画される。
// open/close をスタックで追跡し、最も内側の size を有効として平坦化する。
function appendTextWithSizeAndBold(parent, text) {
  // size span と color span の開きタグを 1 つの正規表現で拾う（どちらか一方の style を想定）
  const openRe = /<span\s+style="font-size:\s*([0-9.]+)em\s*">|<span\s+style="color:\s*([^";]+?)\s*">/gi;
  const closeRe = /<\/span>/g;
  const tokens = [];
  let m;
  while ((m = openRe.exec(text)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: "open", em: parseFloat(m[1]), start: m.index, end: m.index + m[0].length });
    } else {
      tokens.push({ type: "open", color: m[2], start: m.index, end: m.index + m[0].length });
    }
  }
  while ((m = closeRe.exec(text)) !== null) {
    tokens.push({ type: "close", start: m.index, end: m.index + m[0].length });
  }
  tokens.sort((a, b) => a.start - b.start);

  const styleStack = [];
  const emitText = (txt) => {
    if (!txt) return;
    // スタックの内側から有効な size / color を探す
    let effectiveSize = null;
    let effectiveColor = null;
    for (let i = styleStack.length - 1; i >= 0; i--) {
      const s = styleStack[i];
      if (effectiveSize == null && s.em != null && !isNaN(s.em) && s.em > 0 && s.em !== DEFAULT_SIZE) {
        effectiveSize = s.em;
      }
      if (effectiveColor == null && s.color != null) {
        effectiveColor = s.color;
      }
    }
    if (effectiveSize == null && effectiveColor == null) {
      appendTextWithBold(parent, txt);
      return;
    }
    // 外側に size span、内側に color span をネスト（描画は同じ）
    let outer = null;
    let inner = null;
    if (effectiveSize != null) {
      outer = document.createElement("span");
      outer.style.fontSize = `${effectiveSize}em`;
      inner = outer;
    }
    if (effectiveColor != null) {
      const cspan = document.createElement("span");
      cspan.style.color = effectiveColor;
      if (inner) inner.appendChild(cspan);
      else outer = cspan;
      inner = cspan;
    }
    appendTextWithBold(inner, txt);
    if (inner.childNodes.length > 0) parent.appendChild(outer);
  };

  let pos = 0;
  for (const tok of tokens) {
    if (tok.start > pos) emitText(text.slice(pos, tok.start));
    if (tok.type === "open") {
      styleStack.push(tok);
    } else if (styleStack.length > 0) {
      styleStack.pop();
    }
    pos = tok.end;
  }
  if (pos < text.length) emitText(text.slice(pos));
}

/**
 * markdown 文字列を editor 内に DOM として展開する。
 * options.imgPattern: 画像マークダウンの RegExp (g フラグ付推奨。例: /!\[([^\]]*)\]\(([^)]+)\)/g)
 * options.imgFactory: (matchResult) => Element 画像 DOM ノードを返す関数
 * imgPattern が無ければ画像処理は省略され、全部テキストとして処理される。
 */
export function appendMarkdownToEditor(editor, markdown, options = {}) {
  if (!editor) return;
  editor.innerHTML = "";
  const text = markdown || "";
  const { imgPattern, imgFactory } = options;

  if (imgPattern && imgFactory) {
    const segments = [];
    let lastIdx = 0;
    let m;
    const re = new RegExp(imgPattern.source, "g");
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIdx) segments.push({ type: "text", value: text.slice(lastIdx, m.index) });
      segments.push({ type: "img", match: m });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) segments.push({ type: "text", value: text.slice(lastIdx) });

    for (const seg of segments) {
      if (seg.type === "text") {
        appendTextWithSizeAndBold(editor, seg.value);
      } else {
        const node = imgFactory(seg.match);
        if (node) editor.appendChild(node);
      }
    }
  } else {
    appendTextWithSizeAndBold(editor, text);
  }

  if (editor.childNodes.length === 0) {
    editor.appendChild(document.createElement("br"));
  }
}

/**
 * editor の DOM を markdown 文字列にシリアライズする。
 * options.serializeImg(imgNode): 画像 <img> 要素を markdown 化する関数。
 *   string を返すと出力に追加。null/undefined ならスキップ。未指定なら <img> は無視。
 * options.serializeElement(node): 標準ハンドラに該当しない要素を独自処理するフック。
 *   string を返すと出力に追加して以降のデフォルト処理をスキップ。null/undefined なら
 *   デフォルト処理（ブロック改行 + 子要素の再帰 walk）にフォールスルー。
 *   独自要素を「無視」したい場合は空文字列 "" を返せばよい。
 */
export function serializeEditorMarkdown(editor, options = {}) {
  if (!editor) return "";
  const { serializeImg, serializeElement } = options;
  let out = "";

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === "BR") { out += "\n"; return; }
    if (tag === "IMG") {
      if (serializeImg) {
        const md = serializeImg(node);
        if (md) out += md;
      }
      return;
    }
    if (tag === "SPAN") {
      const fs = node.style && node.style.fontSize;
      if (fs && fs.endsWith("em")) {
        const em = parseFloat(fs);
        if (!isNaN(em) && em > 0 && em !== DEFAULT_SIZE) {
          const before = out.length;
          for (const child of node.childNodes) walk(child);
          const inner = out.slice(before);
          if (inner === "") return;
          out = out.slice(0, before) + `<span style="font-size:${em}em">` + inner + `</span>`;
          return;
        }
      }
      const col = node.style && node.style.color;
      if (col) {
        const before = out.length;
        for (const child of node.childNodes) walk(child);
        const inner = out.slice(before);
        if (inner === "") return;
        out = out.slice(0, before) + `<span style="color:${col}">` + inner + `</span>`;
        return;
      }
      // font-size / color 以外の span: カスタムハンドラがあれば優先
      if (serializeElement) {
        const custom = serializeElement(node);
        if (typeof custom === "string") { out += custom; return; }
      }
      for (const child of node.childNodes) walk(child);
      return;
    }
    // <font color="..."> (古い execCommand 出力) も color span として保存
    if (tag === "FONT" && node.getAttribute("color")) {
      const before = out.length;
      for (const child of node.childNodes) walk(child);
      const inner = out.slice(before);
      if (inner === "") return;
      out = out.slice(0, before) + `<span style="color:${node.getAttribute("color")}">` + inner + `</span>`;
      return;
    }
    if (tag === "STRONG" || tag === "B") {
      const before = out.length;
      for (const child of node.childNodes) walk(child);
      const inner = out.slice(before);
      if (inner.trim() === "") return;
      const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const left = m ? m[1] : "";
      const core = m ? m[2] : inner;
      const right = m ? m[3] : "";
      if (core.includes("**")) return;
      out = out.slice(0, before) + left + "**" + core + "**" + right;
      return;
    }
    // 標準ハンドラ外の要素: カスタムハンドラを試す
    if (serializeElement) {
      const custom = serializeElement(node);
      if (typeof custom === "string") { out += custom; return; }
    }
    const isBlock = (tag === "DIV" || tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE" || tag === "LI");
    if (isBlock && out.length > 0 && !out.endsWith("\n")) out += "\n";
    for (const child of node.childNodes) walk(child);
  };

  for (const child of editor.childNodes) walk(child);
  if (out.replace(/\n+/g, "").trim() === "" && !editor.querySelector("img")) return "";
  return out;
}
