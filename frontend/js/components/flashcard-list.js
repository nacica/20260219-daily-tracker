/**
 * 単語帳カード一覧画面
 * 2ペインレイアウト: 左に問題リスト、右に回答表示
 * キーボード↑↓ / タップで問題を切り替え
 * カードの追加・編集・削除 + 学習画面への遷移
 */

import { flashcardsApi } from "../api.js?v=20260406e";
import { showToast } from "../app.js?v=20260406e";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${mo}/${day}（${wd}）${h}:${m}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

let cards = [];
let selectedId = null;
let keyHandler = null;

// ページ遷移時にオーバーレイとキーハンドラを除去
window.addEventListener("hashchange", () => {
  const ov = document.getElementById("fc-mobile-overlay");
  if (ov) ov.remove();
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
});

export async function renderFlashcardList() {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>カードを読み込み中...</p>
    </div>`;

  // 前回のキーハンドラを除去
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }

  // 前回のオーバーレイを除去
  const oldOverlay = document.getElementById("fc-mobile-overlay");
  if (oldOverlay) oldOverlay.remove();

  cards = [];
  try {
    cards = await flashcardsApi.list();
  } catch (e) {
    showToast(`読み込みに失敗: ${e.message}`, "error");
  }

  // 作成順に番号を振る（APIは降順なので逆順に番号付け）
  cards.forEach((c, i) => { c._num = cards.length - i; });

  const totalCount = cards.length;
  const rememberedCount = cards.filter((c) => c.remembered).length;

  selectedId = cards.length > 0 ? cards[0].id : null;

  main.innerHTML = `
    <div class="fc-list-container">
      <div class="fc-list-header">
        <h2 class="fc-list-title">単語帳</h2>
        <div class="fc-list-stats">
          <span class="fc-stat">${totalCount} 枚</span>
          <span class="fc-stat remembered">✓ ${rememberedCount}</span>
          <span class="fc-stat not-yet">✗ ${totalCount - rememberedCount}</span>
        </div>
      </div>

      <div class="fc-actions-row">
        <button class="btn btn-primary fc-btn-add" id="fc-btn-add">＋ カード追加</button>
        <button class="btn btn-outline fc-btn-bulk" id="fc-btn-bulk">一括追加</button>
        ${totalCount > 0 ? `<button class="btn btn-outline fc-btn-study" id="fc-btn-study">学習を開始</button>` : ""}
      </div>

      <!-- 新規追加フォーム（非表示） -->
      <div class="fc-add-form card" id="fc-add-form" style="display:none;">
        <div class="fc-form-title">新しいカード</div>
        <label class="fc-label">表面（問題・単語）</label>
        <textarea class="fc-textarea" id="fc-new-front" rows="2" placeholder="覚えたい言葉や問題を入力..."></textarea>
        <label class="fc-label">裏面（答え・意味）</label>
        <textarea class="fc-textarea" id="fc-new-back" rows="2" placeholder="答えや意味を入力..."></textarea>
        <div class="fc-form-btns">
          <button class="btn btn-primary btn-sm" id="fc-save-new">保存</button>
          <button class="btn btn-outline btn-sm" id="fc-cancel-new">キャンセル</button>
        </div>
      </div>

      <!-- 一括追加フォーム（非表示） -->
      <div class="fc-add-form card" id="fc-bulk-form" style="display:none;">
        <div class="fc-form-title">一括追加</div>
        <div class="fc-bulk-help">
          <code>===</code> で表面と裏面を区切り、<code>---</code> でカード同士を区切ります。改行はそのまま反映されます。
        </div>
        <textarea class="fc-textarea" id="fc-bulk-input" rows="14"></textarea>
        <div class="fc-bulk-preview" id="fc-bulk-preview"></div>
        <div class="fc-form-btns">
          <button class="btn btn-primary btn-sm" id="fc-bulk-save">一括登録</button>
          <button class="btn btn-outline btn-sm" id="fc-bulk-preview-btn">プレビュー</button>
          <button class="btn btn-outline btn-sm" id="fc-bulk-cancel">キャンセル</button>
        </div>
      </div>

      <!-- 2ペインレイアウト -->
      ${cards.length === 0
        ? `<div class="empty-state">
            <div class="icon">🃏</div>
            <p>まだカードがありません。<br>「＋ カード追加」で最初の1枚を作りましょう。</p>
          </div>`
        : `<div class="fc-pane-wrap">
            <!-- 左ペイン: 問題リスト -->
            <div class="fc-pane-left" id="fc-pane-left">
              <div class="fc-pane-left-header">
                <span class="fc-pane-left-label">問題一覧</span>
                <span class="fc-pane-left-hint">↑↓キーで移動</span>
              </div>
              <div class="fc-pane-list" id="fc-pane-list">
                ${cards.map((c) => buildListRow(c)).join("")}
              </div>
            </div>
            <!-- 右ペイン: 回答表示（PC のみ表示） -->
            <div class="fc-pane-right" id="fc-pane-right">
              <div class="fc-pane-detail" id="fc-pane-detail">
                <div class="fc-detail-placeholder">← 問題を選択してください</div>
              </div>
            </div>
          </div>`
      }
    </div>`;

  // モバイルオーバーレイを body 直下に配置（既存があれば再利用）
  let overlay = document.getElementById("fc-mobile-overlay");
  if (overlay) overlay.remove();
  if (cards.length > 0) {
    overlay = document.createElement("div");
    overlay.className = "fc-mobile-overlay";
    overlay.id = "fc-mobile-overlay";
    overlay.innerHTML = `<div class="fc-mobile-overlay-inner" id="fc-mobile-overlay-inner"></div>`;
    document.body.appendChild(overlay);
  }

  if (cards.length > 0 && !isMobile()) {
    selectCard(selectedId);
  }
  attachEvents(cards);
}

function buildListRow(card) {
  const statusClass = card.remembered ? "remembered" : "not-yet";
  const statusIcon = card.remembered ? "✓" : "✗";
  // 表面テキストを1行に切り詰め
  const frontText = card.front.length > 60 ? card.front.substring(0, 60) + "…" : card.front;
  return `
    <div class="fc-row ${card.id === selectedId ? 'active' : ''}" data-id="${card.id}">
      <span class="fc-row-num">#${card._num}</span>
      <span class="fc-row-status ${statusClass}">${statusIcon}</span>
      <span class="fc-row-front">${escapeHtml(frontText)}</span>
    </div>`;
}

function buildDetailView(card) {
  const statusClass = card.remembered ? "remembered" : "not-yet";
  const statusLabel = card.remembered ? "覚えた" : "まだ";
  return `
    <div class="fc-detail-actions-top">
      <button class="btn btn-outline btn-sm fc-detail-toggle-status" data-id="${card.id}" style="color: ${card.remembered ? 'var(--neon-red)' : 'var(--neon-green)'}; border-color: ${card.remembered ? 'rgba(255,51,102,0.3)' : 'rgba(0,255,148,0.3)'};">${card.remembered ? '「まだ」に戻す' : '「覚えた」にする'}</button>
      <button class="btn btn-outline btn-sm fc-detail-edit" data-id="${card.id}">編集</button>
      <button class="btn btn-outline btn-sm fc-detail-delete" data-id="${card.id}" style="color: var(--neon-red); border-color: rgba(255,51,102,0.3);">削除</button>
    </div>
    <div class="fc-detail-header">
      <span class="fc-detail-num">#${card._num}</span>
      <span class="fc-item-status ${statusClass}">${statusLabel}</span>
      <span class="fc-detail-date">${formatDateTime(card.created_at)}</span>
    </div>
    <div class="fc-detail-section">
      <div class="fc-detail-label">表面</div>
      <div class="fc-detail-front">${escapeHtml(card.front)}</div>
    </div>
    <div class="fc-detail-divider"></div>
    <div class="fc-detail-section">
      <div class="fc-detail-label">裏面</div>
      <div class="fc-detail-back">${escapeHtml(card.back)}</div>
    </div>
    <div class="fc-detail-actions">
      <button class="btn btn-outline btn-sm fc-detail-toggle-status" data-id="${card.id}" style="color: ${card.remembered ? 'var(--neon-red)' : 'var(--neon-green)'}; border-color: ${card.remembered ? 'rgba(255,51,102,0.3)' : 'rgba(0,255,148,0.3)'};">${card.remembered ? '「まだ」に戻す' : '「覚えた」にする'}</button>
      <button class="btn btn-outline btn-sm fc-detail-edit" data-id="${card.id}">編集</button>
      <button class="btn btn-outline btn-sm fc-detail-delete" data-id="${card.id}" style="color: var(--neon-red); border-color: rgba(255,51,102,0.3);">削除</button>
    </div>
    <!-- 編集フォーム（非表示） -->
    <div class="fc-detail-edit-form" data-id="${card.id}" style="display:none;">
      <label class="fc-label">表面</label>
      <textarea class="fc-textarea fc-edit-front" rows="2">${escapeHtml(card.front)}</textarea>
      <label class="fc-label">裏面</label>
      <textarea class="fc-textarea fc-edit-back" rows="3">${escapeHtml(card.back)}</textarea>
      <div class="fc-form-btns">
        <button class="btn btn-primary btn-sm fc-detail-save-edit" data-id="${card.id}">保存</button>
        <button class="btn btn-outline btn-sm fc-detail-cancel-edit" data-id="${card.id}">キャンセル</button>
      </div>
    </div>`;
}

function selectCard(id) {
  selectedId = id;
  const card = cards.find((c) => c.id === id);
  if (!card) return;

  // 左ペインのアクティブ行を更新
  const rows = document.querySelectorAll(".fc-row");
  rows.forEach((r) => r.classList.toggle("active", r.dataset.id === id));

  // アクティブ行をスクロールに収める
  const activeRow = document.querySelector(`.fc-row[data-id="${id}"]`);
  if (activeRow) {
    activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 右ペインに詳細を表示
  const detail = document.getElementById("fc-pane-detail");
  if (detail) {
    detail.innerHTML = buildDetailView(card);
    attachDetailEvents();
  }
}

function selectCardMobile(id) {
  selectCard(id);
  const overlay = document.getElementById("fc-mobile-overlay");
  const inner = document.getElementById("fc-mobile-overlay-inner");
  const card = cards.find((c) => c.id === id);
  if (!overlay || !inner || !card) return;

  inner.innerHTML = `
    <button class="btn btn-outline btn-sm fc-mobile-back" id="fc-mobile-back">← 一覧に戻る</button>
    ${buildDetailView(card)}`;
  overlay.classList.add("open");

  document.getElementById("fc-mobile-back").addEventListener("click", () => {
    overlay.classList.remove("open");
  });
  attachDetailEvents(inner);
}

function isMobile() {
  return window.innerWidth < 768;
}

function moveTo(direction) {
  if (cards.length === 0) return;
  const idx = cards.findIndex((c) => c.id === selectedId);
  let newIdx = idx + direction;
  if (newIdx < 0) newIdx = 0;
  if (newIdx >= cards.length) newIdx = cards.length - 1;
  if (newIdx !== idx) {
    if (isMobile()) {
      selectCardMobile(cards[newIdx].id);
    } else {
      selectCard(cards[newIdx].id);
    }
  }
}

/** 一括入力テキストをパースしてカード配列を返す */
function parseBulkInput(text) {
  const result = [];
  const rawCards = text.split(/^---$/m);
  for (const block of rawCards) {
    const parts = block.split(/^===$/m);
    if (parts.length < 2) continue;
    const front = parts[0].trim();
    const back = parts.slice(1).join("===").trim();
    if (front && back) {
      result.push({ front, back });
    }
  }
  return result;
}

function attachDetailEvents(container) {
  const root = container || document.getElementById("fc-pane-detail");
  if (!root) return;

  // 編集ボタン（上部・下部の両方）
  root.querySelectorAll(".fc-detail-edit").forEach((editBtn) => {
    editBtn.addEventListener("click", () => {
      const id = editBtn.dataset.id;
      const form = root.querySelector(`.fc-detail-edit-form[data-id="${id}"]`);
      const sections = root.querySelectorAll(".fc-detail-section, .fc-detail-divider, .fc-detail-actions, .fc-detail-actions-top");
      sections.forEach((s) => (s.style.display = "none"));
      form.style.display = "block";
      form.querySelector(".fc-edit-front").focus();
    });
  });

  // 編集キャンセル
  root.querySelectorAll(".fc-detail-cancel-edit").forEach((cancelBtn) => {
    cancelBtn.addEventListener("click", () => {
      const sections = root.querySelectorAll(".fc-detail-section, .fc-detail-divider, .fc-detail-actions, .fc-detail-actions-top");
      sections.forEach((s) => (s.style.display = ""));
      root.querySelector(".fc-detail-edit-form").style.display = "none";
    });
  });

  // 編集保存
  root.querySelectorAll(".fc-detail-save-edit").forEach((saveBtn) => {
    saveBtn.addEventListener("click", async () => {
      const id = saveBtn.dataset.id;
      const front = root.querySelector(".fc-edit-front").value.trim();
      const back = root.querySelector(".fc-edit-back").value.trim();
      if (!front || !back) {
        showToast("表面と裏面の両方を入力してください", "error");
        return;
      }
      try {
        await flashcardsApi.update(id, { front, back });
        showToast("カードを更新しました", "success");
        renderFlashcardList();
      } catch (e) {
        showToast(`更新に失敗: ${e.message}`, "error");
      }
    });
  });

  // ステータス切り替えボタン
  root.querySelectorAll(".fc-detail-toggle-status").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      const newStatus = !card.remembered;
      try {
        await flashcardsApi.mark(id, newStatus);
        card.remembered = newStatus;
        showToast(newStatus ? "「覚えた」に変更しました" : "「まだ」に戻しました", "success");
        renderFlashcardList();
      } catch (e) {
        showToast(`変更に失敗: ${e.message}`, "error");
      }
    });
  });

  // 削除ボタン（上部・下部の両方）
  root.querySelectorAll(".fc-detail-delete").forEach((deleteBtn) => {
    deleteBtn.addEventListener("click", async () => {
      const id = deleteBtn.dataset.id;
      if (!confirm("このカードを削除しますか？")) return;
      try {
        await flashcardsApi.delete(id);
        showToast("カードを削除しました", "success");
        renderFlashcardList();
      } catch (e) {
        showToast(`削除に失敗: ${e.message}`, "error");
      }
    });
  });
}

function attachEvents() {
  const addBtn = document.getElementById("fc-btn-add");
  const addForm = document.getElementById("fc-add-form");
  const bulkBtn = document.getElementById("fc-btn-bulk");
  const bulkForm = document.getElementById("fc-bulk-form");
  const studyBtn = document.getElementById("fc-btn-study");

  // 学習開始
  if (studyBtn) {
    studyBtn.addEventListener("click", () => {
      window.location.hash = "/flashcards/study";
    });
  }

  // 追加フォーム表示
  addBtn.addEventListener("click", () => {
    bulkForm.style.display = "none";
    addForm.style.display = addForm.style.display === "none" ? "block" : "none";
    if (addForm.style.display === "block") {
      document.getElementById("fc-new-front").focus();
    }
  });

  // 一括追加テンプレート生成
  function buildBulkTemplate() {
    const lines = [];
    for (let i = 1; i <= 20; i++) {
      if (i > 1) lines.push("---");
      lines.push("");
      lines.push("===");
      lines.push("");
    }
    return lines.join("\n");
  }

  // 一括追加フォーム表示
  bulkBtn.addEventListener("click", () => {
    addForm.style.display = "none";
    bulkForm.style.display = bulkForm.style.display === "none" ? "block" : "none";
    if (bulkForm.style.display === "block") {
      const input = document.getElementById("fc-bulk-input");
      if (!input.value.trim()) {
        input.value = buildBulkTemplate();
      }
      input.focus();
      input.setSelectionRange(0, 0);
    }
  });

  // キャンセル
  document.getElementById("fc-cancel-new").addEventListener("click", () => {
    addForm.style.display = "none";
    document.getElementById("fc-new-front").value = "";
    document.getElementById("fc-new-back").value = "";
  });

  // 保存
  document.getElementById("fc-save-new").addEventListener("click", async () => {
    const front = document.getElementById("fc-new-front").value.trim();
    const back = document.getElementById("fc-new-back").value.trim();
    if (!front || !back) {
      showToast("表面と裏面の両方を入力してください", "error");
      return;
    }
    try {
      await flashcardsApi.create(front, back);
      showToast("カードを追加しました", "success");
      renderFlashcardList();
    } catch (e) {
      showToast(`追加に失敗: ${e.message}`, "error");
    }
  });

  // 一括追加 — キャンセル
  document.getElementById("fc-bulk-cancel").addEventListener("click", () => {
    bulkForm.style.display = "none";
    document.getElementById("fc-bulk-input").value = buildBulkTemplate();
    document.getElementById("fc-bulk-preview").innerHTML = "";
  });

  // 一括追加 — プレビュー
  document.getElementById("fc-bulk-preview-btn").addEventListener("click", () => {
    const text = document.getElementById("fc-bulk-input").value;
    const parsed = parseBulkInput(text);
    const previewEl = document.getElementById("fc-bulk-preview");
    if (parsed.length === 0) {
      previewEl.innerHTML = `<div class="fc-bulk-preview-empty">カードが検出されませんでした。形式を確認してください。</div>`;
      return;
    }
    previewEl.innerHTML = `
      <div class="fc-bulk-preview-title">${parsed.length} 枚のカードを検出</div>
      ${parsed.map((c, i) => `
        <div class="fc-bulk-preview-card">
          <div class="fc-bulk-preview-num">#${i + 1}</div>
          <div class="fc-bulk-preview-front">${escapeHtml(c.front)}</div>
          <div class="fc-bulk-preview-sep">↓</div>
          <div class="fc-bulk-preview-back">${escapeHtml(c.back)}</div>
        </div>
      `).join("")}`;
  });

  // 一括追加 — 保存
  document.getElementById("fc-bulk-save").addEventListener("click", async () => {
    const text = document.getElementById("fc-bulk-input").value;
    const parsed = parseBulkInput(text);
    if (parsed.length === 0) {
      showToast("カードが検出されませんでした。=== と --- の形式を確認してください", "error");
      return;
    }
    const saveBtn = document.getElementById("fc-bulk-save");
    saveBtn.disabled = true;
    saveBtn.textContent = `登録中... (0/${parsed.length})`;
    let successCount = 0;
    for (let i = 0; i < parsed.length; i++) {
      try {
        await flashcardsApi.create(parsed[i].front, parsed[i].back);
        successCount++;
        saveBtn.textContent = `登録中... (${successCount}/${parsed.length})`;
      } catch (e) {
        showToast(`カード${i + 1}の登録に失敗: ${e.message}`, "error");
      }
    }
    showToast(`${successCount} 枚のカードを登録しました`, "success");
    renderFlashcardList();
  });

  // 左ペインのクリックイベント
  const listEl = document.getElementById("fc-pane-list");
  if (listEl) {
    listEl.addEventListener("click", (e) => {
      const row = e.target.closest(".fc-row");
      if (!row) return;
      const id = row.dataset.id;
      if (isMobile()) {
        selectCardMobile(id);
      } else {
        selectCard(id);
      }
    });
  }

  // キーボード ↑↓ 操作
  keyHandler = (e) => {
    // テキスト入力中は無視
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      moveTo(1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      moveTo(-1);
    }
  };
  document.addEventListener("keydown", keyHandler);
}
