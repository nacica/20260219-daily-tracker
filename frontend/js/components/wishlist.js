/**
 * やりたいことリスト画面
 *
 * - 「やりたい」「達成済み」の2タブ切替
 * - カード表示/リスト表示のトグル(設定は LocalStorage に保存)
 * - 優先度(★1-5)高い順、タイブレークは作成日新しい順
 * - チェックで達成済みへ移動(達成日自動記録)、達成済みタブからは戻すこともできる
 * - 編集・削除メニュー(各項目)
 */

import { wishlistApi } from "../api.js?v=20260505b";
import { showToast } from "../app.js?v=20260505b";

const PRESET_CATEGORIES = ["住居", "家電", "趣味・ガジェット", "旅行・体験", "学び", "その他"];
const VIEW_MODE_KEY = "wishlist_view_mode_v1"; // "card" | "list"
const TAB_KEY = "wishlist_tab_v1";             // "active" | "done"

const state = {
  items: [],
  customCategories: [], // 直近のエントリから動的に集めるユーザー追加カテゴリ
  tab: "active",
  viewMode: "card",
  editingId: null,
  formOpen: false,
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

      <button class="btn btn-primary wl-add-btn" id="wl-add-btn" type="button">＋ やりたいことを追加</button>

      <div id="wl-form-container"></div>
      <div id="wl-list-container" class="wl-list-container"></div>
    </div>
  `;
}

function renderList() {
  const container = document.getElementById("wl-list-container");
  if (!container) return;

  if (state.items.length === 0) {
    container.innerHTML = `
      <div class="empty-state wl-empty">
        <div class="icon">${state.tab === "active" ? "🎯" : "🏆"}</div>
        <p>${state.tab === "active"
            ? "まだ何も登録されていません。<br>欲しい物や行きたい場所を書き出してみましょう。"
            : "まだ達成済みの項目はありません。"}</p>
      </div>`;
    return;
  }

  if (state.viewMode === "card") {
    container.innerHTML = `<div class="wl-card-grid">${state.items.map(buildCardHTML).join("")}</div>`;
  } else {
    container.innerHTML = `<div class="wl-list">${state.items.map(buildRowHTML).join("")}</div>`;
  }
}

function buildCardHTML(item) {
  const cost = formatYen(item.estimated_cost);
  const completedClass = item.completed ? " wl-card-done" : "";
  const completedDate = item.completed && item.completed_at
    ? `<span class="wl-completed-date">達成: ${formatDate(item.completed_at)}</span>`
    : "";
  const refLink = item.reference_url
    ? `<a class="wl-ref-link" href="${escapeAttr(item.reference_url)}" target="_blank" rel="noopener noreferrer">参考リンク↗</a>`
    : "";
  const notes = item.notes
    ? `<div class="wl-card-notes">${escapeHtml(item.notes)}</div>`
    : "";
  const targetPeriod = item.target_period
    ? `<span class="wl-meta-tag">📅 ${escapeHtml(item.target_period)}</span>`
    : "";

  return `
    <div class="wl-card${completedClass}" data-id="${escapeAttr(item.id)}">
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
          <span class="wl-category-tag">${escapeHtml(item.category || "その他")}</span>
          <div class="wl-stars">${buildStarsHTML(item.priority)}</div>
        </div>
        <h3 class="wl-card-title">${escapeHtml(item.title)}</h3>
        <div class="wl-card-meta">
          ${cost ? `<span class="wl-cost">${cost}</span>` : ""}
          ${targetPeriod}
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

      <label class="wl-field">
        <span class="wl-field-label">画像URL</span>
        <input type="url" name="image_url" maxlength="2000" value="${escapeAttr(data.image_url || "")}" placeholder="https://..." />
      </label>

      <label class="wl-field">
        <span class="wl-field-label">参考リンク</span>
        <input type="url" name="reference_url" maxlength="2000" value="${escapeAttr(data.reference_url || "")}" placeholder="https://..." />
      </label>

      <label class="wl-field">
        <span class="wl-field-label">メモ</span>
        <textarea name="notes" rows="3" maxlength="2000" placeholder="なぜ欲しいか、どこで買うかなど自由に">${escapeHtml(data.notes || "")}</textarea>
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
      notes: String(fd.get("notes") || "").trim() || null,
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

function attachEvents() {
  // 追加ボタン
  document.getElementById("wl-add-btn")?.addEventListener("click", () => {
    if (state.formOpen && !state.editingId) {
      closeForm();
    } else {
      showForm(null);
    }
  });

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

  // 一覧内のアクション(編集/削除/達成切替)
  document.getElementById("wl-list-container")?.addEventListener("click", async (e) => {
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
  await loadItems();
  renderList();
  attachEvents();
}
