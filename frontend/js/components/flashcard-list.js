/**
 * 単語帳カード一覧画面
 * カードの追加・編集・削除 + 学習画面への遷移
 */

import { flashcardsApi } from "../api.js?v=20260401g";
import { showToast } from "../app.js?v=20260401g";

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

export async function renderFlashcardList() {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>カードを読み込み中...</p>
    </div>`;

  let cards = [];
  try {
    cards = await flashcardsApi.list();
  } catch (e) {
    showToast(`読み込みに失敗: ${e.message}`, "error");
  }

  // 作成順に番号を振る（APIは降順なので逆順に番号付け）
  cards.forEach((c, i) => { c._num = cards.length - i; });

  const totalCount = cards.length;
  const rememberedCount = cards.filter((c) => c.remembered).length;

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

      <!-- カード一覧 -->
      <div class="fc-card-list" id="fc-card-list">
        ${cards.length === 0
          ? `<div class="empty-state">
              <div class="icon">🃏</div>
              <p>まだカードがありません。<br>「＋ カード追加」で最初の1枚を作りましょう。</p>
            </div>`
          : cards.map((c) => buildCardItem(c)).join("")
        }
      </div>
    </div>`;

  attachEvents(cards);
}

function buildCardItem(card) {
  const statusClass = card.remembered ? "remembered" : "not-yet";
  const statusLabel = card.remembered ? "覚えた" : "まだ";
  return `
    <div class="fc-item card" data-id="${card.id}">
      <div class="fc-item-header">
        <span class="fc-item-num">#${card._num}</span>
        <span class="fc-item-status ${statusClass}">${statusLabel}</span>
        <span class="fc-item-date">${formatDateTime(card.created_at)}</span>
      </div>
      <div class="fc-item-body">
        <div class="fc-item-front">${escapeHtml(card.front)}</div>
        <div class="fc-item-divider">↓</div>
        <div class="fc-item-back">${escapeHtml(card.back)}</div>
      </div>
      <div class="fc-item-actions">
        <button class="btn btn-outline btn-sm fc-edit-btn" data-id="${card.id}">編集</button>
        <button class="btn btn-outline btn-sm fc-delete-btn" data-id="${card.id}" style="color: var(--neon-red); border-color: rgba(255,51,102,0.3);">削除</button>
      </div>
      <!-- 編集フォーム（非表示） -->
      <div class="fc-edit-form" data-id="${card.id}" style="display:none;">
        <label class="fc-label">表面</label>
        <textarea class="fc-textarea fc-edit-front" rows="2">${escapeHtml(card.front)}</textarea>
        <label class="fc-label">裏面</label>
        <textarea class="fc-textarea fc-edit-back" rows="2">${escapeHtml(card.back)}</textarea>
        <div class="fc-form-btns">
          <button class="btn btn-primary btn-sm fc-save-edit" data-id="${card.id}">保存</button>
          <button class="btn btn-outline btn-sm fc-cancel-edit" data-id="${card.id}">キャンセル</button>
        </div>
      </div>
    </div>`;
}

function attachEvents(cards) {
  const addBtn = document.getElementById("fc-btn-add");
  const addForm = document.getElementById("fc-add-form");
  const studyBtn = document.getElementById("fc-btn-study");

  // 学習開始
  if (studyBtn) {
    studyBtn.addEventListener("click", () => {
      window.location.hash = "/flashcards/study";
    });
  }

  // 追加フォーム表示
  addBtn.addEventListener("click", () => {
    addForm.style.display = addForm.style.display === "none" ? "block" : "none";
    if (addForm.style.display === "block") {
      document.getElementById("fc-new-front").focus();
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

  // カード一覧のイベント委任
  const listEl = document.getElementById("fc-card-list");
  listEl.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".fc-edit-btn");
    const deleteBtn = e.target.closest(".fc-delete-btn");
    const saveEditBtn = e.target.closest(".fc-save-edit");
    const cancelEditBtn = e.target.closest(".fc-cancel-edit");

    if (editBtn) {
      const id = editBtn.dataset.id;
      const item = listEl.querySelector(`.fc-item[data-id="${id}"]`);
      const form = item.querySelector(".fc-edit-form");
      const body = item.querySelector(".fc-item-body");
      const actions = item.querySelector(".fc-item-actions");
      form.style.display = "block";
      body.style.display = "none";
      actions.style.display = "none";
    }

    if (cancelEditBtn) {
      const id = cancelEditBtn.dataset.id;
      const item = listEl.querySelector(`.fc-item[data-id="${id}"]`);
      item.querySelector(".fc-edit-form").style.display = "none";
      item.querySelector(".fc-item-body").style.display = "";
      item.querySelector(".fc-item-actions").style.display = "";
    }

    if (saveEditBtn) {
      const id = saveEditBtn.dataset.id;
      const item = listEl.querySelector(`.fc-item[data-id="${id}"]`);
      const front = item.querySelector(".fc-edit-front").value.trim();
      const back = item.querySelector(".fc-edit-back").value.trim();
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
    }

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      if (!confirm("このカードを削除しますか？")) return;
      try {
        await flashcardsApi.delete(id);
        showToast("カードを削除しました", "success");
        renderFlashcardList();
      } catch (e) {
        showToast(`削除に失敗: ${e.message}`, "error");
      }
    }
  });
}
