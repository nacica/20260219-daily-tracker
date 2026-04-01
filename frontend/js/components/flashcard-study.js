/**
 * 単語帳カード学習画面
 * タップで裏返し、スワイプ or ボタンで「覚えた/まだ」評価
 * 学習中のカード編集にも対応
 */

import { flashcardsApi } from "../api.js?v=20260401a";
import { showToast } from "../app.js?v=20260401a";

let allCards = [];
let deck = [];       // シャッフル済み出題リスト
let currentIndex = 0;
let isFlipped = false;
let isEditing = false;
let touchStartX = 0;
let touchStartY = 0;
let touchDeltaX = 0;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

export async function renderFlashcardStudy() {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>カードを読み込み中...</p>
    </div>`;

  try {
    allCards = await flashcardsApi.list();
  } catch (e) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">❌</div>
        <p>読み込みに失敗しました</p>
        <button class="btn btn-outline" onclick="window.location.hash='/flashcards'">戻る</button>
      </div>`;
    return;
  }

  if (allCards.length === 0) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">🃏</div>
        <p>カードがありません。<br>まずカードを追加してください。</p>
        <button class="btn btn-primary" onclick="window.location.hash='/flashcards'">カード一覧へ</button>
      </div>`;
    return;
  }

  deck = shuffle(allCards);
  currentIndex = 0;
  isFlipped = false;
  isEditing = false;

  renderStudyUI(main);
}

function renderStudyUI(main) {
  const card = deck[currentIndex];
  const total = deck.length;
  const progress = currentIndex;

  main.innerHTML = `
    <div class="fcs-container">
      <div class="fcs-top-bar">
        <button class="btn btn-outline btn-sm fcs-back-btn" id="fcs-back">← 一覧に戻る</button>
        <span class="fcs-progress">${progress} / ${total}</span>
      </div>

      <div class="fcs-card-wrapper" id="fcs-card-wrapper">
        <div class="fcs-card ${isFlipped ? 'flipped' : ''}" id="fcs-card">
          <div class="fcs-card-face fcs-front">
            <div class="fcs-face-label">表面</div>
            <div class="fcs-face-content" id="fcs-front-content">${escapeHtml(card.front)}</div>
            <div class="fcs-tap-hint">タップで裏面を表示</div>
          </div>
          <div class="fcs-card-face fcs-back">
            <div class="fcs-face-label">裏面</div>
            <div class="fcs-face-content" id="fcs-back-content">${escapeHtml(card.back)}</div>
          </div>
        </div>
      </div>

      <!-- 編集フォーム（非表示） -->
      <div class="fcs-edit-form card" id="fcs-edit-form" style="display:none;">
        <label class="fc-label">表面</label>
        <textarea class="fc-textarea" id="fcs-edit-front" rows="2">${escapeHtml(card.front)}</textarea>
        <label class="fc-label">裏面</label>
        <textarea class="fc-textarea" id="fcs-edit-back" rows="2">${escapeHtml(card.back)}</textarea>
        <div class="fc-form-btns">
          <button class="btn btn-primary btn-sm" id="fcs-save-edit">保存</button>
          <button class="btn btn-outline btn-sm" id="fcs-cancel-edit">キャンセル</button>
        </div>
      </div>

      <!-- 評価ボタン -->
      <div class="fcs-actions" id="fcs-actions" style="${isFlipped ? '' : 'visibility:hidden;'}">
        <button class="btn fcs-btn-forgot" id="fcs-forgot">まだ ✗</button>
        <button class="btn btn-outline btn-sm fcs-btn-edit" id="fcs-edit">編集</button>
        <button class="btn fcs-btn-remembered" id="fcs-remembered">覚えた ✓</button>
      </div>

      <!-- スワイプヒント -->
      <div class="fcs-swipe-hint" id="fcs-swipe-hint" style="${isFlipped ? '' : 'visibility:hidden;'}">
        ← まだ　|　覚えた →
      </div>
    </div>`;

  attachStudyEvents();
}

function attachStudyEvents() {
  const main = document.querySelector("main");
  const cardEl = document.getElementById("fcs-card");
  const wrapper = document.getElementById("fcs-card-wrapper");

  // 一覧に戻る
  document.getElementById("fcs-back").addEventListener("click", () => {
    window.location.hash = "/flashcards";
  });

  // タップで裏返し
  cardEl.addEventListener("click", (e) => {
    if (isEditing) return;
    if (!isFlipped) {
      isFlipped = true;
      cardEl.classList.add("flipped");
      document.getElementById("fcs-actions").style.visibility = "";
      document.getElementById("fcs-swipe-hint").style.visibility = "";
    }
  });

  // スワイプ
  wrapper.addEventListener("touchstart", (e) => {
    if (isEditing) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchDeltaX = 0;
  }, { passive: true });

  wrapper.addEventListener("touchmove", (e) => {
    if (isEditing || !isFlipped) return;
    touchDeltaX = e.touches[0].clientX - touchStartX;
    const deltaY = Math.abs(e.touches[0].clientY - touchStartY);
    // 横方向の動きが大きい場合のみカードを動かす
    if (Math.abs(touchDeltaX) > deltaY) {
      cardEl.style.transform = `rotateY(180deg) translateX(${touchDeltaX}px) rotate(${touchDeltaX * 0.05}deg)`;
      cardEl.style.transition = "none";
      // 色でフィードバック
      if (touchDeltaX > 50) {
        wrapper.style.boxShadow = "inset 0 0 40px rgba(0,255,148,0.15)";
      } else if (touchDeltaX < -50) {
        wrapper.style.boxShadow = "inset 0 0 40px rgba(255,51,102,0.15)";
      } else {
        wrapper.style.boxShadow = "";
      }
    }
  }, { passive: true });

  wrapper.addEventListener("touchend", () => {
    if (isEditing || !isFlipped) return;
    wrapper.style.boxShadow = "";
    cardEl.style.transition = "";
    cardEl.style.transform = "";

    if (touchDeltaX > 80) {
      markAndNext(true);  // 右スワイプ = 覚えた
    } else if (touchDeltaX < -80) {
      markAndNext(false); // 左スワイプ = まだ
    }
    touchDeltaX = 0;
  });

  // ボタン
  document.getElementById("fcs-remembered").addEventListener("click", () => markAndNext(true));
  document.getElementById("fcs-forgot").addEventListener("click", () => markAndNext(false));

  // 編集
  document.getElementById("fcs-edit").addEventListener("click", () => {
    isEditing = true;
    document.getElementById("fcs-edit-form").style.display = "block";
    document.getElementById("fcs-card-wrapper").style.display = "none";
    document.getElementById("fcs-actions").style.display = "none";
    document.getElementById("fcs-swipe-hint").style.display = "none";
    document.getElementById("fcs-edit-front").focus();
  });

  document.getElementById("fcs-cancel-edit").addEventListener("click", () => {
    isEditing = false;
    document.getElementById("fcs-edit-form").style.display = "none";
    document.getElementById("fcs-card-wrapper").style.display = "";
    document.getElementById("fcs-actions").style.display = "";
    document.getElementById("fcs-swipe-hint").style.display = "";
  });

  document.getElementById("fcs-save-edit").addEventListener("click", async () => {
    const front = document.getElementById("fcs-edit-front").value.trim();
    const back = document.getElementById("fcs-edit-back").value.trim();
    if (!front || !back) {
      showToast("表面と裏面の両方を入力してください", "error");
      return;
    }
    const card = deck[currentIndex];
    try {
      await flashcardsApi.update(card.id, { front, back });
      // ローカルデータも更新
      card.front = front;
      card.back = back;
      const orig = allCards.find((c) => c.id === card.id);
      if (orig) { orig.front = front; orig.back = back; }

      showToast("カードを更新しました", "success");
      isEditing = false;
      // 画面を再描画
      document.getElementById("fcs-front-content").textContent = front;
      document.getElementById("fcs-back-content").textContent = back;
      document.getElementById("fcs-edit-form").style.display = "none";
      document.getElementById("fcs-card-wrapper").style.display = "";
      document.getElementById("fcs-actions").style.display = "";
      document.getElementById("fcs-swipe-hint").style.display = "";
    } catch (e) {
      showToast(`更新に失敗: ${e.message}`, "error");
    }
  });
}

async function markAndNext(remembered) {
  const card = deck[currentIndex];
  try {
    await flashcardsApi.mark(card.id, remembered);
    card.remembered = remembered;
    const orig = allCards.find((c) => c.id === card.id);
    if (orig) orig.remembered = remembered;
  } catch {
    // マーク失敗しても学習は続行
  }

  currentIndex++;
  if (currentIndex >= deck.length) {
    showComplete();
    return;
  }

  isFlipped = false;
  isEditing = false;
  renderStudyUI(document.querySelector("main"));
}

function showComplete() {
  const remembered = deck.filter((c) => c.remembered).length;
  const total = deck.length;
  const main = document.querySelector("main");

  main.innerHTML = `
    <div class="fcs-complete">
      <div class="fcs-complete-icon">🎉</div>
      <h2>学習完了！</h2>
      <div class="fcs-complete-stats">
        <div class="fcs-stat-item">
          <span class="fcs-stat-num" style="color: var(--neon-green);">${remembered}</span>
          <span class="fcs-stat-label">覚えた</span>
        </div>
        <div class="fcs-stat-item">
          <span class="fcs-stat-num" style="color: var(--neon-red);">${total - remembered}</span>
          <span class="fcs-stat-label">まだ</span>
        </div>
      </div>
      <div class="fcs-complete-actions">
        <button class="btn btn-primary" id="fcs-retry">もう一度</button>
        <button class="btn btn-outline" id="fcs-to-list">一覧に戻る</button>
      </div>
    </div>`;

  document.getElementById("fcs-retry").addEventListener("click", () => {
    deck = shuffle(allCards);
    currentIndex = 0;
    isFlipped = false;
    renderStudyUI(main);
  });
  document.getElementById("fcs-to-list").addEventListener("click", () => {
    window.location.hash = "/flashcards";
  });
}
