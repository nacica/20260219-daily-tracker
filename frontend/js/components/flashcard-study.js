/**
 * 単語帳カード学習画面
 * タップで裏返し、スワイプ or ボタンで「覚えた/まだ」評価
 * 学習中のカード編集にも対応
 */

import { flashcardsApi } from "../api.js?v=20260424c";
import { showToast } from "../app.js?v=20260424c";

const ORDER_STORAGE_KEY = "flashcard-study-order";

let allCards = [];
let deck = [];       // 出題リスト
let currentIndex = 0;
let isFlipped = false;
let isEditing = false;

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

// テキスト + 画像マークダウン ![alt](url) を HTML に変換
function renderFaceContent(str) {
  if (!str) return "";
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = imgRegex.exec(str)) !== null) {
    const textBefore = str.slice(lastIndex, m.index);
    if (textBefore) result += escapeHtml(textBefore);
    const alt = escapeHtml(m[1] || "画像");
    const url = escapeHtml(m[2]);
    result += `<img class="fc-content-image" src="${url}" alt="${alt}" loading="lazy" />`;
    lastIndex = imgRegex.lastIndex;
  }
  result += escapeHtml(str.slice(lastIndex));
  return result;
}

// ========== contenteditable リッチエディタ（学習画面の編集用） ==========

function markdownToEditorHtml(md) {
  if (!md) return "";
  let result = "";
  let lastIndex = 0;
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = imgRegex.exec(md)) !== null) {
    const before = md.slice(lastIndex, m.index);
    result += escapeHtml(before).replace(/\n/g, "<br>");
    const alt = escapeHtml(m[1] || "画像");
    const url = escapeHtml(m[2]);
    result += `<span class="fc-inline-image-wrap" contenteditable="false">` +
      `<img class="fc-inline-image" src="${url}" alt="${alt}" loading="lazy" />` +
      `<button type="button" class="fc-inline-image-remove" title="この画像を削除">×</button>` +
      `</span>`;
    lastIndex = imgRegex.lastIndex;
  }
  result += escapeHtml(md.slice(lastIndex)).replace(/\n/g, "<br>");
  return result;
}

function editorToMarkdown(el) {
  let md = "";
  function walk(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        md += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === "img") {
          md += `![${child.getAttribute("alt") || "画像"}](${child.getAttribute("src") || ""})`;
          return;
        }
        if (tag === "br") {
          md += "\n";
          return;
        }
        if (child.classList && child.classList.contains("fc-inline-image-wrap")) {
          const img = child.querySelector("img");
          if (img) {
            md += `![${img.getAttribute("alt") || "画像"}](${img.getAttribute("src") || ""})`;
          }
          return;
        }
        if (tag === "div" || tag === "p") {
          if (md && !md.endsWith("\n")) md += "\n";
        }
        walk(child);
      }
    });
  }
  walk(el);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

function createInlineImageNode(url, alt) {
  const wrap = document.createElement("span");
  wrap.className = "fc-inline-image-wrap";
  wrap.setAttribute("contenteditable", "false");
  const img = document.createElement("img");
  img.className = "fc-inline-image";
  img.src = url;
  img.alt = alt || "画像";
  img.loading = "lazy";
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "fc-inline-image-remove";
  rm.title = "この画像を削除";
  rm.textContent = "×";
  wrap.appendChild(img);
  wrap.appendChild(rm);
  return wrap;
}

function insertPlainTextAtCursor(text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = document.createDocumentFragment();
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement("br"));
    frag.appendChild(document.createTextNode(line));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function insertNodeAtCursor(editor, node) {
  editor.focus();
  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

async function uploadAndInsertImage(editor, file) {
  const placeholder = document.createElement("span");
  placeholder.className = "fc-inline-uploading";
  placeholder.setAttribute("contenteditable", "false");
  placeholder.innerHTML = `<span class="fc-image-uploading-spinner"></span><span class="fc-image-uploading-label">アップロード中…</span>`;
  insertNodeAtCursor(editor, placeholder);

  try {
    const result = await flashcardsApi.uploadImage(file);
    placeholder.replaceWith(createInlineImageNode(result.url, "画像"));
    showToast("画像を貼り付けました", "success");
  } catch (err) {
    placeholder.remove();
    showToast(`画像アップロードに失敗: ${err.message}`, "error");
  }
}

async function handleStudyPaste(e) {
  const cd = e.clipboardData;
  if (!cd) return;

  let file = null;
  for (let i = 0; i < cd.files.length; i++) {
    if (cd.files[i].type.startsWith("image/")) { file = cd.files[i]; break; }
  }
  if (!file && cd.items) {
    for (let i = 0; i < cd.items.length; i++) {
      const item = cd.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        file = item.getAsFile();
        break;
      }
    }
  }

  if (file) {
    e.preventDefault();
    showToast("画像をアップロード中...");
    await uploadAndInsertImage(e.currentTarget, file);
    return;
  }

  const text = cd.getData("text/plain");
  if (text) {
    e.preventDefault();
    insertPlainTextAtCursor(text);
  }
}

function handleStudyEditorClick(e) {
  const rm = e.target.closest(".fc-inline-image-remove");
  if (!rm) return;
  e.preventDefault();
  e.stopPropagation();
  const wrap = rm.closest(".fc-inline-image-wrap");
  if (wrap) wrap.remove();
}

function setupStudyEditor(editor, initialMarkdown) {
  if (!editor) return;
  editor.innerHTML = markdownToEditorHtml(initialMarkdown || "");
  if (editor.dataset.editorBound) return;
  editor.dataset.editorBound = "1";
  editor.addEventListener("paste", handleStudyPaste);
  editor.addEventListener("click", handleStudyEditorClick);
}

function getSavedOrder() {
  return localStorage.getItem(ORDER_STORAGE_KEY) || "random";
}

function saveOrder(order) {
  localStorage.setItem(ORDER_STORAGE_KEY, order);
}

/** カード配列を指定順序で並べ替える */
function orderCards(cards, order) {
  switch (order) {
    case "random":
      return shuffle(cards);
    case "oldest":
      // _num が小さい順 = 古い順（#1 から）
      return [...cards].sort((a, b) => a._num - b._num);
    case "newest":
      // _num が大きい順 = 新しい順
      return [...cards].sort((a, b) => b._num - a._num);
    default:
      return shuffle(cards);
  }
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

  // 作成順に番号を振る（APIは降順なので逆順）
  allCards.forEach((c, i) => { c._num = allCards.length - i; });

  // 常にモード選択画面を表示（順序選択が必要なため）
  renderModeSelect(main);
}

function renderModeSelect(main) {
  const totalCount = allCards.length;
  const notYetCount = allCards.filter((c) => !c.remembered).length;
  const rememberedCount = totalCount - notYetCount;
  const savedOrder = getSavedOrder();

  // 未記憶カードの有無でボタン構成を決定
  const hasNotYet = notYetCount > 0;
  const hasRemembered = rememberedCount > 0;
  const showScopeChoice = hasNotYet && hasRemembered;

  main.innerHTML = `
    <div class="fcs-mode-select">
      <div class="fcs-mode-title">学習モードを選択</div>
      <div class="fcs-mode-stats">
        <span class="fc-stat">全 ${totalCount} 枚</span>
        <span class="fc-stat not-yet">✗ 未記憶 ${notYetCount}</span>
        <span class="fc-stat remembered">✓ 覚えた ${rememberedCount}</span>
      </div>

      <!-- 順序選択 -->
      <div class="fcs-order-select">
        <div class="fcs-order-label">カードの順番</div>
        <div class="fcs-order-buttons">
          <button class="btn btn-sm fcs-order-btn ${savedOrder === 'random' ? 'active' : ''}" data-order="random">🔀 ランダム</button>
          <button class="btn btn-sm fcs-order-btn ${savedOrder === 'newest' ? 'active' : ''}" data-order="newest">🆕 新しい順</button>
          <button class="btn btn-sm fcs-order-btn ${savedOrder === 'oldest' ? 'active' : ''}" data-order="oldest">📜 古い順</button>
        </div>
      </div>

      <!-- 範囲選択 & 開始ボタン -->
      <div class="fcs-mode-buttons">
        ${showScopeChoice ? `
          <button class="btn btn-primary fcs-mode-btn" id="fcs-mode-notyet">
            未記憶のみ（${notYetCount} 枚）
          </button>
          <button class="btn btn-outline fcs-mode-btn" id="fcs-mode-all">
            全カード（${totalCount} 枚）
          </button>
        ` : `
          <button class="btn btn-primary fcs-mode-btn" id="fcs-mode-all">
            学習を開始（${totalCount} 枚）
          </button>
        `}
      </div>
      <button class="btn btn-outline btn-sm" id="fcs-mode-back" style="margin-top: 20px;">← 一覧に戻る</button>
    </div>`;

  // 順序ボタンのイベント
  let currentOrder = savedOrder;
  main.querySelectorAll(".fcs-order-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentOrder = btn.dataset.order;
      saveOrder(currentOrder);
      main.querySelectorAll(".fcs-order-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // 開始ボタンのイベント
  const notYetBtn = document.getElementById("fcs-mode-notyet");
  if (notYetBtn) {
    notYetBtn.addEventListener("click", () => {
      startStudy(main, allCards.filter((c) => !c.remembered), currentOrder);
    });
  }
  document.getElementById("fcs-mode-all").addEventListener("click", () => {
    startStudy(main, allCards, currentOrder);
  });
  document.getElementById("fcs-mode-back").addEventListener("click", () => {
    window.location.hash = "/flashcards";
  });
}

function startStudy(main, cards, order) {
  deck = orderCards(cards, order);
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
        <div class="fcs-top-right">
          <button class="btn btn-outline btn-sm fcs-prev-btn" id="fcs-prev" ${currentIndex === 0 ? 'disabled' : ''}>← 前へ</button>
          <span class="fcs-progress">#${card._num}　${progress} / ${total}</span>
        </div>
      </div>

      <div class="fcs-edit-bar">
        <button class="btn btn-outline btn-sm fcs-btn-edit" id="fcs-edit">✏️ 編集</button>
      </div>

      <!-- 評価ボタン（カードの上に配置） -->
      <div class="fcs-actions" id="fcs-actions" style="${isFlipped ? '' : 'visibility:hidden;'}">
        <button class="btn fcs-btn-forgot" id="fcs-forgot">まだ ✗</button>
        <button class="btn btn-outline btn-sm fcs-btn-show-front" id="fcs-show-front">表面を見る</button>
        <button class="btn fcs-btn-remembered" id="fcs-remembered">覚えた ✓</button>
      </div>

      <div class="fcs-card-wrapper" id="fcs-card-wrapper">
        <div class="fcs-card ${isFlipped ? 'flipped' : ''}" id="fcs-card">
          <div class="fcs-card-face fcs-front">
            <div class="fcs-face-label">表面</div>
            <div class="fcs-face-content" id="fcs-front-content">${renderFaceContent(card.front)}</div>
          </div>
          <div class="fcs-card-face fcs-back">
            <div class="fcs-face-label">裏面</div>
            <div class="fcs-face-content" id="fcs-back-content">${renderFaceContent(card.back)}</div>
          </div>
        </div>
      </div>

      <!-- 削除ボタン -->
      <div class="fcs-delete-bar" id="fcs-delete-bar">
        <button class="btn btn-sm fcs-btn-delete" id="fcs-delete">削除</button>
      </div>

      <!-- 編集フォーム（非表示） -->
      <div class="fcs-edit-form card" id="fcs-edit-form" style="display:none;">
        <label class="fc-label">表面</label>
        <div class="fc-editor" id="fcs-edit-front" contenteditable="true"></div>
        <label class="fc-label">裏面</label>
        <div class="fc-editor" id="fcs-edit-back" contenteditable="true"></div>
        <div class="fc-form-btns">
          <button class="btn btn-primary btn-sm" id="fcs-save-edit">保存</button>
          <button class="btn btn-outline btn-sm" id="fcs-cancel-edit">キャンセル</button>
        </div>
      </div>

    </div>`;

  attachStudyEvents();
}

function attachStudyEvents() {
  const main = document.querySelector("main");
  const cardEl = document.getElementById("fcs-card");

  // 一覧に戻る
  document.getElementById("fcs-back").addEventListener("click", () => {
    window.location.hash = "/flashcards";
  });

  // 前のカードに戻る
  document.getElementById("fcs-prev").addEventListener("click", () => {
    if (isEditing) return;
    if (currentIndex === 0) return;
    currentIndex--;
    isFlipped = false;
    renderStudyUI(document.querySelector("main"));
  });

  // タップ: 表面→裏返し、裏面→「まだ」で次へ
  cardEl.addEventListener("click", (e) => {
    if (isEditing) return;
    if (!isFlipped) {
      isFlipped = true;
      cardEl.classList.add("flipped");
      document.getElementById("fcs-actions").style.visibility = "";
    } else {
      markAndNext(false);
    }
  });

  // 「表面を見る」ボタン: 表裏トグル
  const showFrontBtn = document.getElementById("fcs-show-front");
  showFrontBtn.addEventListener("click", () => {
    if (isFlipped) {
      cardEl.classList.remove("flipped");
      isFlipped = false;
      showFrontBtn.textContent = "裏面を見る";
    } else {
      cardEl.classList.add("flipped");
      isFlipped = true;
      showFrontBtn.textContent = "表面を見る";
    }
  });

  // ボタン
  document.getElementById("fcs-remembered").addEventListener("click", () => markAndNext(true));
  document.getElementById("fcs-forgot").addEventListener("click", () => markAndNext(false));

  // 編集
  const editBar = document.querySelector(".fcs-edit-bar");
  const deleteBar = document.getElementById("fcs-delete-bar");
  document.getElementById("fcs-edit").addEventListener("click", () => {
    isEditing = true;
    document.getElementById("fcs-edit-form").style.display = "block";
    document.getElementById("fcs-card-wrapper").style.display = "none";
    document.getElementById("fcs-actions").style.display = "none";
    editBar.style.display = "none";
    deleteBar.style.display = "none";
    const card = deck[currentIndex];
    const editFront = document.getElementById("fcs-edit-front");
    const editBack = document.getElementById("fcs-edit-back");
    setupStudyEditor(editFront, card.front);
    setupStudyEditor(editBack, card.back);
    editFront.focus();
  });

  document.getElementById("fcs-cancel-edit").addEventListener("click", () => {
    isEditing = false;
    document.getElementById("fcs-edit-form").style.display = "none";
    document.getElementById("fcs-card-wrapper").style.display = "";
    document.getElementById("fcs-actions").style.display = "";
    editBar.style.display = "";
    deleteBar.style.display = "";
  });

  // 削除
  document.getElementById("fcs-delete").addEventListener("click", async () => {
    if (isEditing) return;
    const card = deck[currentIndex];
    if (!confirm("このカードを削除しますか？")) return;
    try {
      await flashcardsApi.delete(card.id);
      deck.splice(currentIndex, 1);
      const origIdx = allCards.findIndex((c) => c.id === card.id);
      if (origIdx !== -1) allCards.splice(origIdx, 1);

      showToast("カードを削除しました", "success");

      if (deck.length === 0) {
        showComplete();
        return;
      }
      if (currentIndex >= deck.length) currentIndex = deck.length - 1;
      isFlipped = false;
      renderStudyUI(document.querySelector("main"));
    } catch (e) {
      showToast(`削除に失敗: ${e.message}`, "error");
    }
  });

  document.getElementById("fcs-save-edit").addEventListener("click", async () => {
    const front = editorToMarkdown(document.getElementById("fcs-edit-front"));
    const back = editorToMarkdown(document.getElementById("fcs-edit-back"));
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
      document.getElementById("fcs-front-content").innerHTML = renderFaceContent(front);
      document.getElementById("fcs-back-content").innerHTML = renderFaceContent(back);
      document.getElementById("fcs-edit-form").style.display = "none";
      document.getElementById("fcs-card-wrapper").style.display = "";
      document.getElementById("fcs-actions").style.display = "";
      editBar.style.display = "";
      deleteBar.style.display = "";
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
        ${total - remembered > 0 ? `<button class="btn btn-primary" id="fcs-retry-notyet">まだのカードだけ再学習（${total - remembered} 枚）</button>` : ""}
        <button class="btn btn-outline" id="fcs-retry">全カードでもう一度</button>
        <button class="btn btn-outline" id="fcs-to-list">一覧に戻る</button>
      </div>
    </div>`;

  const savedOrder = getSavedOrder();

  const retryNotYet = document.getElementById("fcs-retry-notyet");
  if (retryNotYet) {
    retryNotYet.addEventListener("click", () => {
      startStudy(main, allCards.filter((c) => !c.remembered), savedOrder);
    });
  }
  document.getElementById("fcs-retry").addEventListener("click", () => {
    startStudy(main, allCards, savedOrder);
  });
  document.getElementById("fcs-to-list").addEventListener("click", () => {
    window.location.hash = "/flashcards";
  });
}
