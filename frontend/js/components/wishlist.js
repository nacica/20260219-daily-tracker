/**
 * やりたいことリスト画面
 *
 * - 「やりたい」「達成済み」の2タブ切替
 * - カード表示/リスト表示のトグル(設定は LocalStorage に保存)
 * - 優先度(★1-5)高い順、タイブレークは作成日新しい順
 * - チェックで達成済みへ移動(達成日自動記録)、達成済みタブからは戻すこともできる
 * - 編集・削除メニュー(各項目)
 */

import { wishlistApi } from "../api.js?v=20260614c";
import { showToast } from "../app.js?v=20260614c";
import {
  attachFloatingToolbar,
  appendMarkdownToEditor,
  serializeEditorMarkdown,
} from "../floating-toolbar.js?v=20260614c";

/** **bold** + <span style="font-size:Xem"> を保ったまま、テキスト部分はエスケープ + 改行→<br> */
function renderWishlistNotes(text) {
  if (!text) return "";
  return renderWlInlineFormatting(text).replace(/\n/g, "<br>");
}
function renderWlInlineFormatting(text) {
  if (!text) return "";
  const sizeRegex = /<span\s+style="font-size:\s*([0-9.]+)em\s*">([\s\S]*?)<\/span>/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = sizeRegex.exec(text)) !== null) {
    result += renderWlBoldAndEscape(text.slice(lastIndex, m.index));
    const em = parseFloat(m[1]);
    const inner = m[2];
    if (!isNaN(em) && em > 0 && em !== 1.0) {
      result += `<span style="font-size:${em}em">${renderWlBoldAndEscape(inner)}</span>`;
    } else {
      result += renderWlBoldAndEscape(inner);
    }
    lastIndex = sizeRegex.lastIndex;
  }
  result += renderWlBoldAndEscape(text.slice(lastIndex));
  return result;
}
function renderWlBoldAndEscape(text) {
  if (!text) return "";
  const boldRegex = /\*\*([^\n*][^\n]*?)\*\*/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = boldRegex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, m.index));
    result += `<strong>${escapeHtml(m[1])}</strong>`;
    lastIndex = boldRegex.lastIndex;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

const PRESET_CATEGORIES = ["住居", "家電", "趣味・ガジェット", "旅行・体験", "学び", "その他"];
const VIEW_MODE_KEY = "wishlist_view_mode_v1"; // "card" | "list"
const TAB_KEY = "wishlist_tab_v1";             // "active" | "done"

// カテゴリごとの絵文字アイコン(チップ表示用)
const CATEGORY_ICON = {
  "住居": "🏠",
  "家電": "📺",
  "趣味・ガジェット": "🎮",
  "旅行・体験": "✈️",
  "学び": "📚",
  "その他": "✨",
};

// カテゴリごとのテーマクラス(色アクセント)
const CATEGORY_THEME_CLASS = {
  "住居": "wl-theme-housing",
  "家電": "wl-theme-appliance",
  "趣味・ガジェット": "wl-theme-hobby",
  "旅行・体験": "wl-theme-travel",
  "学び": "wl-theme-learn",
  "その他": "wl-theme-other",
};

// 「動詞」プリセット(クイック入力時にタイトル先頭に挿入)
const VERB_PRESETS = [
  { icon: "🛒", label: "買いたい" },
  { icon: "🚶", label: "行きたい" },
  { icon: "🎯", label: "やってみたい" },
  { icon: "💬", label: "会いたい" },
  { icon: "📖", label: "学びたい" },
  { icon: "🏡", label: "住みたい" },
];

const state = {
  items: [],
  customCategories: [], // 直近のエントリから動的に集めるユーザー追加カテゴリ
  tab: "active",
  viewMode: "card",
  editingId: null,
  formOpen: false,
  quickCategory: "その他", // クイック追加で選択中のカテゴリ
};

// ===== ユーティリティ =====

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function formatYen(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  if (!Number.isFinite(num)) return "";
  return "¥" + num.toLocaleString("ja-JP");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateJa(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildStarsHTML(priority, interactive = false) {
  const p = Math.max(1, Math.min(5, Number(priority) || 3));
  let html = "";
  for (let i = 1; i <= 5; i++) {
    const cls = i <= p ? "wl-star wl-star-on" : "wl-star wl-star-off";
    if (interactive) {
      html += `<button type="button" class="${cls}" data-star="${i}" aria-label="優先度 ${i}">★</button>`;
    } else {
      html += `<span class="${cls}">★</span>`;
    }
  }
  return html;
}

function getAllCategories() {
  const set = new Set(PRESET_CATEGORIES);
  state.customCategories.forEach((c) => set.add(c));
  state.items.forEach((it) => { if (it.category) set.add(it.category); });
  return Array.from(set);
}

// ===== レンダリング =====

function buildSkeleton() {
  return `
    <div class="wishlist-page">
      <div class="wl-header">
        <h1 class="wl-title">やりたいことリスト</h1>
        <p class="wl-subtitle">将来の欲しい物・行きたい場所・実現したい体験を書き出す</p>
      </div>

      <div class="wl-controls">
        <div class="wl-tabs">
          <button class="wl-tab ${state.tab === "active" ? "active" : ""}" data-tab="active" type="button">やりたい</button>
          <button class="wl-tab ${state.tab === "done" ? "active" : ""}" data-tab="done" type="button">達成済み</button>
        </div>
        <div class="wl-view-toggle">
          <button class="wl-view-btn ${state.viewMode === "card" ? "active" : ""}" data-view="card" type="button" title="カード表示" aria-label="カード表示">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button class="wl-view-btn ${state.viewMode === "list" ? "active" : ""}" data-view="list" type="button" title="リスト表示" aria-label="リスト表示">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
              <circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
            </svg>
          </button>
        </div>
      </div>

      <div id="wl-quick-add-container"></div>

      <div id="wl-form-container"></div>
      <div id="wl-list-container" class="wl-list-container"></div>
    </div>
  `;
}

function renderQuickAdd() {
  const wrap = document.getElementById("wl-quick-add-container");
  if (!wrap) return;
  if (state.tab !== "active") {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = buildQuickAddHTML();
  attachQuickAddEvents();
}

function buildQuickAddHTML() {
  const catChips = PRESET_CATEGORIES.map((c) => {
    const active = c === state.quickCategory ? " is-active" : "";
    const icon = CATEGORY_ICON[c] || "✨";
    return `<button type="button" class="wl-chip wl-chip-cat${active}" data-quick-cat="${escapeAttr(c)}">
      <span class="wl-chip-icon">${icon}</span>${escapeHtml(c)}
    </button>`;
  }).join("");

  const verbChips = VERB_PRESETS.map((v) => `
    <button type="button" class="wl-chip wl-chip-verb" data-quick-verb="${escapeAttr(v.label)}">
      <span class="wl-chip-icon">${v.icon}</span>${escapeHtml(v.label)}
    </button>
  `).join("");

  return `
    <div class="wl-quick-add" id="wl-quick-add">
      <div class="wl-quick-input-row">
        <span class="wl-quick-pen" aria-hidden="true">✏️</span>
        <input type="text" id="wl-quick-input" class="wl-quick-input"
               maxlength="200"
               placeholder="思いついたやりたいことを書いて Enter…" />
        <button type="button" class="wl-quick-detail" id="wl-quick-detail" title="詳細を入力して追加">
          詳細 ▾
        </button>
      </div>
      <div class="wl-chip-row" id="wl-quick-cats">${catChips}</div>
      <div class="wl-chip-row wl-chip-row-verbs">${verbChips}</div>
    </div>
  `;
}

function renderList() {
  const container = document.getElementById("wl-list-container");
  if (!container) return;

  const isActive = state.tab === "active";

  if (state.items.length === 0) {
    if (isActive && state.viewMode === "card") {
      // 0件 でもクイック追加への導線として点線カードを 1 枚出す
      container.innerHTML = `<div class="wl-card-grid">${buildPlaceholderCardHTML()}</div>`;
    } else {
      container.innerHTML = `
        <div class="empty-state wl-empty">
          <div class="icon">${isActive ? "🎯" : "🏆"}</div>
          <p>${isActive
              ? "まだ何も登録されていません。<br>上の入力欄に思いついたものを書いてみましょう。"
              : "まだ達成済みの項目はありません。"}</p>
        </div>`;
    }
    return;
  }

  if (state.viewMode === "card") {
    const cards = state.items.map(buildCardHTML).join("");
    const placeholder = isActive ? buildPlaceholderCardHTML() : "";
    container.innerHTML = `<div class="wl-card-grid">${cards}${placeholder}</div>`;
  } else {
    container.innerHTML = `<div class="wl-list">${state.items.map(buildRowHTML).join("")}</div>`;
  }
}

function buildPlaceholderCardHTML() {
  return `
    <button type="button" class="wl-card-placeholder" id="wl-placeholder-card" aria-label="新しいやりたいことを追加">
      <div class="wl-placeholder-plus">＋</div>
      <div class="wl-placeholder-text">ここに次の夢を書こう</div>
      <div class="wl-placeholder-hint">タップで入力欄へ</div>
    </button>
  `;
}

function buildCardHTML(item) {
  const cost = formatYen(item.estimated_cost);
  const completedClass = item.completed ? " wl-card-done" : "";
  const themeClass = " " + (CATEGORY_THEME_CLASS[item.category] || "wl-theme-other");
  const catIcon = CATEGORY_ICON[item.category] || "✨";
  const completedDate = item.completed && item.completed_at
    ? `<span class="wl-completed-date">達成: ${formatDate(item.completed_at)}</span>`
    : "";
  const refLink = item.reference_url
    ? `<a class="wl-ref-link" href="${escapeAttr(item.reference_url)}" target="_blank" rel="noopener noreferrer">参考リンク↗</a>`
    : "";
  const notes = item.notes
    ? `<div class="wl-card-notes">${renderWishlistNotes(item.notes)}</div>`
    : "";
  const targetPeriod = item.target_period
    ? `<span class="wl-meta-tag">📅 ${escapeHtml(item.target_period)}</span>`
    : "";
  const createdAt = item.created_at
    ? `<span class="wl-meta-tag wl-created-at" title="作成日">📝 ${formatDateJa(item.created_at)}</span>`
    : "";

  return `
    <div class="wl-card${completedClass}${themeClass}" data-id="${escapeAttr(item.id)}">
      <div class="wl-card-accent" aria-hidden="true"></div>
      <button class="wl-check-btn" data-action="toggle-complete" data-id="${escapeAttr(item.id)}"
              title="${item.completed ? "やりたいに戻す" : "達成済みにする"}"
              aria-label="${item.completed ? "やりたいに戻す" : "達成済みにする"}">
        ${item.completed ? "✓" : ""}
      </button>
      ${item.image_url
        ? `<div class="wl-card-image"><img src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.title)}" loading="lazy" onerror="this.parentElement.style.display='none'"/></div>`
        : ""}
      <div class="wl-card-body">
        <div class="wl-card-row-top">
          <span class="wl-category-tag">
            <span class="wl-cat-icon">${catIcon}</span>${escapeHtml(item.category || "その他")}
          </span>
          <div class="wl-stars">${buildStarsHTML(item.priority)}</div>
        </div>
        <h3 class="wl-card-title">${escapeHtml(item.title)}</h3>
        <div class="wl-card-meta">
          ${cost ? `<span class="wl-cost">${cost}</span>` : ""}
          ${targetPeriod}
          ${createdAt}
          ${completedDate}
        </div>
        ${notes}
        <div class="wl-card-actions">
          ${refLink}
          <button class="wl-action-btn" data-action="edit" data-id="${escapeAttr(item.id)}" type="button">編集</button>
          <button class="wl-action-btn wl-action-danger" data-action="delete" data-id="${escapeAttr(item.id)}" type="button">削除</button>
        </div>
      </div>
    </div>
  `;
}

function buildRowHTML(item) {
  const cost = formatYen(item.estimated_cost);
  const completedClass = item.completed ? " wl-row-done" : "";
  const thumb = item.image_url
    ? `<div class="wl-row-thumb"><img src="${escapeAttr(item.image_url)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'"/></div>`
    : `<div class="wl-row-thumb wl-row-thumb-placeholder">💭</div>`;

  return `
    <div class="wl-row${completedClass}" data-id="${escapeAttr(item.id)}">
      <button class="wl-check-btn wl-check-btn-row" data-action="toggle-complete" data-id="${escapeAttr(item.id)}"
              title="${item.completed ? "やりたいに戻す" : "達成済みにする"}"
              aria-label="${item.completed ? "やりたいに戻す" : "達成済みにする"}">
        ${item.completed ? "✓" : ""}
      </button>
      ${thumb}
      <div class="wl-row-main">
        <div class="wl-row-line1">
          <span class="wl-row-title">${escapeHtml(item.title)}</span>
          <div class="wl-stars wl-stars-sm">${buildStarsHTML(item.priority)}</div>
        </div>
        <div class="wl-row-line2">
          <span class="wl-category-tag">${escapeHtml(item.category || "その他")}</span>
          ${cost ? `<span class="wl-cost">${cost}</span>` : ""}
          ${item.target_period ? `<span class="wl-meta-tag">📅 ${escapeHtml(item.target_period)}</span>` : ""}
          ${item.created_at ? `<span class="wl-meta-tag wl-created-at" title="作成日">📝 ${formatDateJa(item.created_at)}</span>` : ""}
          ${item.completed && item.completed_at ? `<span class="wl-completed-date">達成: ${formatDate(item.completed_at)}</span>` : ""}
        </div>
      </div>
      <div class="wl-row-actions">
        <button class="wl-action-btn" data-action="edit" data-id="${escapeAttr(item.id)}" type="button">編集</button>
        <button class="wl-action-btn wl-action-danger" data-action="delete" data-id="${escapeAttr(item.id)}" type="button">削除</button>
      </div>
    </div>
  `;
}

// ===== フォーム =====

function buildFormHTML(item) {
  const isEdit = !!item;
  const data = item || {
    title: "", estimated_cost: "", category: "その他", priority: 3,
    target_period: "", notes: "", image_url: "", reference_url: "",
  };
  const categoryOptions = getAllCategories()
    .map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

  return `
    <form class="wl-form card" id="wl-form" data-id="${isEdit ? escapeAttr(item.id) : ""}">
      <div class="wl-form-title">${isEdit ? "編集" : "新しいやりたいこと"}</div>

      <label class="wl-field">
        <span class="wl-field-label">タイトル <span class="wl-required">*</span></span>
        <input type="text" name="title" required maxlength="200" value="${escapeAttr(data.title)}" placeholder="例: 1LDKに引っ越す / 10万円のロードバイクを買う" />
      </label>

      <div class="wl-field-row">
        <label class="wl-field">
          <span class="wl-field-label">概算金額(円)</span>
          <input type="number" name="estimated_cost" min="0" step="1000" value="${data.estimated_cost ?? ""}" placeholder="例: 100000" />
        </label>

        <label class="wl-field">
          <span class="wl-field-label">目標時期</span>
          <input type="text" name="target_period" maxlength="50" value="${escapeAttr(data.target_period || "")}" placeholder="例: 2027年内 / いつか" />
        </label>
      </div>

      <label class="wl-field">
        <span class="wl-field-label">カテゴリ</span>
        <input type="text" name="category" list="wl-category-list" maxlength="50" value="${escapeAttr(data.category || "その他")}" placeholder="例: 家電" />
        <datalist id="wl-category-list">${categoryOptions}</datalist>
      </label>

      <div class="wl-field">
        <span class="wl-field-label">優先度</span>
        <div class="wl-stars wl-stars-input" id="wl-stars-input" data-priority="${data.priority || 3}">
          ${buildStarsHTML(data.priority || 3, true)}
        </div>
        <input type="hidden" name="priority" value="${data.priority || 3}" />
      </div>

      <div class="wl-field">
        <span class="wl-field-label">画像（コピーした画像をここに貼り付け）</span>
        <div class="wl-image-drop ${data.image_url ? "has-image" : ""}" id="wl-image-drop" tabindex="0">
          ${data.image_url
            ? `<img class="wl-image-preview" src="${escapeAttr(data.image_url)}" alt="貼り付けた画像" />
               <button type="button" class="wl-image-remove" id="wl-image-remove" aria-label="画像を削除">×</button>`
            : `<div class="wl-image-hint">
                 <div class="wl-image-hint-icon">🖼️</div>
                 <div class="wl-image-hint-text">ここをクリックして <kbd>Ctrl</kbd>+<kbd>V</kbd>／ドラッグ&ドロップ</div>
                 <div class="wl-image-hint-sub">スマホはファイルから選択 ↓</div>
                 <input type="file" id="wl-image-file" accept="image/*" class="wl-image-file" />
               </div>`}
        </div>
        <input type="hidden" name="image_url" id="wl-image-url-input" value="${escapeAttr(data.image_url || "")}" />
      </div>

      <label class="wl-field">
        <span class="wl-field-label">参考リンク</span>
        <input type="url" name="reference_url" maxlength="2000" value="${escapeAttr(data.reference_url || "")}" placeholder="https://..." />
      </label>

      <label class="wl-field">
        <span class="wl-field-label">メモ</span>
        <div
          class="wl-notes-editor"
          id="wl-notes-editor"
          contenteditable="true"
          spellcheck="false"
          data-placeholder="なぜ欲しいか、どこで買うかなど自由に"
          data-initial="${escapeAttr(encodeURIComponent(data.notes || ""))}"
        ></div>
      </label>

      <div class="wl-form-actions">
        <button type="button" class="btn btn-outline btn-sm" id="wl-form-cancel">キャンセル</button>
        <button type="submit" class="btn btn-primary btn-sm">${isEdit ? "更新" : "追加"}</button>
      </div>
    </form>
  `;
}

function showForm(item) {
  state.formOpen = true;
  state.editingId = item ? item.id : null;
  const container = document.getElementById("wl-form-container");
  container.innerHTML = buildFormHTML(item);
  // メモ欄を contenteditable として初期化（data-initial から markdown 取り込み）
  const notesEditor = container.querySelector("#wl-notes-editor");
  if (notesEditor) {
    const initial = decodeURIComponent(notesEditor.dataset.initial || "");
    appendMarkdownToEditor(notesEditor, initial);
    notesEditor.removeAttribute("data-initial");
    attachFloatingToolbar(notesEditor);
  }
  attachFormEvents();
  // フォーム上部にスクロール
  container.scrollIntoView({ behavior: "smooth", block: "start" });
  const titleInput = container.querySelector('input[name="title"]');
  if (titleInput && !item) titleInput.focus();
}

function closeForm() {
  state.formOpen = false;
  state.editingId = null;
  const container = document.getElementById("wl-form-container");
  if (container) container.innerHTML = "";
}

// ===== 画像ペースト/D&D + 自動圧縮 =====

// Firestore 1MB ドキュメント上限を考慮し、data URL を ~900KB 以下に収める
const IMAGE_MAX_DATA_URL_LEN = 900_000;
const IMAGE_RESIZE_STEPS = [
  { maxSide: 1280, quality: 0.82 },
  { maxSide: 1024, quality: 0.78 },
  { maxSide: 800,  quality: 0.74 },
  { maxSide: 640,  quality: 0.7  },
  { maxSide: 512,  quality: 0.65 },
];

async function fileToCompressedDataURL(blob) {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  let imgEl = null;
  let srcW, srcH;
  if (bitmap) {
    srcW = bitmap.width; srcH = bitmap.height;
  } else {
    // createImageBitmap 非対応のブラウザは <img> 経由でフォールバック
    imgEl = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      im.src = url;
    });
    srcW = imgEl.naturalWidth; srcH = imgEl.naturalHeight;
  }
  if (!srcW || !srcH) throw new Error("画像サイズを取得できませんでした");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  for (const step of IMAGE_RESIZE_STEPS) {
    const longest = Math.max(srcW, srcH);
    const scale = longest > step.maxSide ? step.maxSide / longest : 1;
    const w = Math.round(srcW * scale);
    const h = Math.round(srcH * scale);
    canvas.width = w; canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    if (bitmap) ctx.drawImage(bitmap, 0, 0, w, h);
    else ctx.drawImage(imgEl, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", step.quality);
    if (dataUrl.length <= IMAGE_MAX_DATA_URL_LEN) {
      bitmap?.close?.();
      return dataUrl;
    }
  }
  bitmap?.close?.();
  throw new Error("画像が大きすぎます (圧縮後も上限を超えました)");
}

function attachImageDropzone(form) {
  const drop = form.querySelector("#wl-image-drop");
  const hidden = form.querySelector("#wl-image-url-input");
  if (!drop || !hidden) return;

  async function setImageFromBlob(blob) {
    if (!blob || !blob.type || !blob.type.startsWith("image/")) return false;
    drop.classList.add("is-busy");
    try {
      const dataUrl = await fileToCompressedDataURL(blob);
      hidden.value = dataUrl;
      drop.classList.remove("is-busy");
      drop.classList.add("has-image");
      drop.innerHTML = `
        <img class="wl-image-preview" src="${escapeAttr(dataUrl)}" alt="貼り付けた画像" />
        <button type="button" class="wl-image-remove" id="wl-image-remove" aria-label="画像を削除">×</button>
      `;
      drop.querySelector("#wl-image-remove")?.addEventListener("click", clearImage);
      return true;
    } catch (err) {
      drop.classList.remove("is-busy");
      showToast(`画像処理に失敗: ${err.message}`, "error");
      return false;
    }
  }

  function clearImage(e) {
    e?.stopPropagation();
    hidden.value = "";
    drop.classList.remove("has-image");
    drop.innerHTML = `
      <div class="wl-image-hint">
        <div class="wl-image-hint-icon">🖼️</div>
        <div class="wl-image-hint-text">ここをクリックして <kbd>Ctrl</kbd>+<kbd>V</kbd>／ドラッグ&ドロップ</div>
        <div class="wl-image-hint-sub">スマホはファイルから選択 ↓</div>
        <input type="file" id="wl-image-file" accept="image/*" class="wl-image-file" />
      </div>
    `;
    bindFileInput();
  }

  function bindFileInput() {
    const fileInput = drop.querySelector("#wl-image-file");
    if (!fileInput) return;
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (f) await setImageFromBlob(f);
    });
  }
  bindFileInput();
  drop.querySelector("#wl-image-remove")?.addEventListener("click", clearImage);

  // クリックでフォーカスが当たり、貼り付けを受け付けやすくする
  drop.addEventListener("click", (e) => {
    // ファイル input への透過クリック以外は dropzone をフォーカス
    if (e.target === drop || e.target.classList.contains("wl-image-hint") ||
        e.target.classList.contains("wl-image-hint-text") ||
        e.target.classList.contains("wl-image-hint-icon") ||
        e.target.classList.contains("wl-image-hint-sub")) {
      drop.focus();
    }
  });

  // フォーム全体での paste をフックして画像があれば取り込む
  form.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
        e.preventDefault();
        const blob = it.getAsFile();
        await setImageFromBlob(blob);
        return;
      }
    }
  });

  // ドラッグ&ドロップ
  ["dragenter", "dragover"].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.add("is-dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    drop.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove("is-dragover");
    })
  );
  drop.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) await setImageFromBlob(f);
  });
}

function attachFormEvents() {
  const form = document.getElementById("wl-form");
  if (!form) return;

  // ★ 優先度の入力(クリックで設定)
  const starsBox = form.querySelector("#wl-stars-input");
  const priorityInput = form.querySelector('input[name="priority"]');
  if (starsBox) {
    starsBox.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-star]");
      if (!btn) return;
      const v = parseInt(btn.dataset.star, 10);
      if (!Number.isFinite(v)) return;
      priorityInput.value = String(v);
      starsBox.dataset.priority = String(v);
      starsBox.innerHTML = buildStarsHTML(v, true);
    });
  }

  document.getElementById("wl-form-cancel")?.addEventListener("click", closeForm);

  // 画像ドロップゾーン (貼り付け / D&D / ファイル選択)
  attachImageDropzone(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = String(fd.get("title") || "").trim();
    if (!title) {
      showToast("タイトルを入力してください", "error");
      return;
    }
    const costRaw = String(fd.get("estimated_cost") || "").trim();
    const data = {
      title,
      estimated_cost: costRaw === "" ? null : Math.max(0, parseInt(costRaw, 10) || 0),
      category: String(fd.get("category") || "その他").trim() || "その他",
      priority: Math.max(1, Math.min(5, parseInt(fd.get("priority"), 10) || 3)),
      target_period: String(fd.get("target_period") || "").trim() || null,
      notes: (() => {
        const editor = form.querySelector("#wl-notes-editor");
        const md = editor ? serializeEditorMarkdown(editor).trim() : "";
        return md || null;
      })(),
      image_url: String(fd.get("image_url") || "").trim() || null,
      reference_url: String(fd.get("reference_url") || "").trim() || null,
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = state.editingId ? "更新中..." : "追加中...";

    try {
      if (state.editingId) {
        await wishlistApi.update(state.editingId, data);
        showToast("更新しました", "success");
      } else {
        await wishlistApi.create(data);
        showToast("追加しました", "success");
      }
      closeForm();
      await loadItems();
      renderList();
    } catch (err) {
      showToast(`保存に失敗: ${err.message}`, "error");
      submitBtn.disabled = false;
      submitBtn.textContent = state.editingId ? "更新" : "追加";
    }
  });
}

// ===== データ読み込み =====

async function loadItems() {
  try {
    state.items = await wishlistApi.list(state.tab === "done");
  } catch (e) {
    showToast(`読み込みに失敗: ${e.message}`, "error");
    state.items = [];
  }
}

// ===== イベント委任 =====

function attachQuickAddEvents() {
  const wrap = document.getElementById("wl-quick-add");
  if (!wrap) return;

  const input = wrap.querySelector("#wl-quick-input");

  // カテゴリチップ
  wrap.querySelectorAll("[data-quick-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.quickCategory = btn.dataset.quickCat;
      wrap.querySelectorAll("[data-quick-cat]").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.quickCat === state.quickCategory)
      );
      input?.focus();
    });
  });

  // 動詞チップ → タイトル先頭に挿入
  wrap.querySelectorAll("[data-quick-verb]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!input) return;
      const verb = btn.dataset.quickVerb;
      const cur = input.value.trim();
      const stripped = cur.replace(/^(買いたい|行きたい|やってみたい|会いたい|学びたい|住みたい)[::]\s*/, "");
      input.value = `${verb}: ${stripped}`;
      input.focus();
      // カーソルを末尾に
      const len = input.value.length;
      try { input.setSelectionRange(len, len); } catch (_) {}
    });
  });

  // Enter で即追加
  input?.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    await submitQuickAdd();
  });

  // 詳細ボタン → 既存の詳細フォームを開く
  document.getElementById("wl-quick-detail")?.addEventListener("click", () => {
    const draftTitle = (input?.value || "").trim();
    showForm(null);
    // 入力中のテキストを引き継ぎ
    const titleInput = document.querySelector('#wl-form input[name="title"]');
    if (titleInput && draftTitle) titleInput.value = draftTitle;
    const catInput = document.querySelector('#wl-form input[name="category"]');
    if (catInput) catInput.value = state.quickCategory || "その他";
    titleInput?.focus();
  });
}

async function submitQuickAdd() {
  const input = document.getElementById("wl-quick-input");
  if (!input) return;
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  const data = {
    title,
    estimated_cost: null,
    category: state.quickCategory || "その他",
    priority: 3,
    target_period: null,
    notes: null,
    image_url: null,
    reference_url: null,
  };
  try {
    await wishlistApi.create(data);
    input.value = "";
    showToast("追加しました ✨", "success");
    await loadItems();
    renderList();
    input.focus();
  } catch (err) {
    showToast(`追加に失敗: ${err.message}`, "error");
  }
}

function attachEvents() {
  // タブ切替
  document.querySelectorAll(".wl-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = btn.dataset.tab;
      if (next === state.tab) return;
      state.tab = next;
      localStorage.setItem(TAB_KEY, next);
      document.querySelectorAll(".wl-tab").forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === next)
      );
      closeForm();
      renderQuickAdd();
      await loadItems();
      renderList();
    });
  });

  // 表示モード切替
  document.querySelectorAll(".wl-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.view;
      if (next === state.viewMode) return;
      state.viewMode = next;
      localStorage.setItem(VIEW_MODE_KEY, next);
      document.querySelectorAll(".wl-view-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.view === next)
      );
      renderList();
    });
  });

  // 一覧内のアクション(編集/削除/達成切替/プレースホルダー)
  document.getElementById("wl-list-container")?.addEventListener("click", async (e) => {
    // 末尾のプレースホルダーカード → クイック入力欄にフォーカス
    if (e.target.closest("#wl-placeholder-card")) {
      const input = document.getElementById("wl-quick-input");
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => input.focus(), 250);
      }
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;
    const id = actionBtn.dataset.id;
    const action = actionBtn.dataset.action;
    if (!id || !action) return;

    if (action === "edit") {
      const item = state.items.find((x) => x.id === id);
      if (item) showForm(item);
    } else if (action === "delete") {
      if (!confirm("この項目を削除しますか？")) return;
      try {
        await wishlistApi.delete(id);
        showToast("削除しました", "success");
        await loadItems();
        renderList();
      } catch (err) {
        showToast(`削除に失敗: ${err.message}`, "error");
      }
    } else if (action === "toggle-complete") {
      const item = state.items.find((x) => x.id === id);
      if (!item) return;
      const nextDone = !item.completed;
      try {
        await wishlistApi.complete(id, nextDone);
        showToast(nextDone ? "達成済みにしました 🎉" : "やりたいに戻しました", "success");
        await loadItems();
        renderList();
      } catch (err) {
        showToast(`更新に失敗: ${err.message}`, "error");
      }
    }
  });
}

// ===== エントリポイント =====

export async function renderWishlist() {
  const main = document.querySelector("main");

  // LocalStorage から保存値を復元
  state.viewMode = localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "card";
  state.tab = localStorage.getItem(TAB_KEY) === "done" ? "done" : "active";
  state.formOpen = false;
  state.editingId = null;

  main.innerHTML = buildSkeleton();
  renderQuickAdd();
  await loadItems();
  renderList();
  attachEvents();
}
