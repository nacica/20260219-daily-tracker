/**
 * コーチングチャット画面 (/coach)
 * パーソナルコーチとの対話インターフェース
 */

import { coachApi } from "../api.js?v=20260424e";
import { showToast } from "../app.js?v=20260424e";

/** 会話履歴をメモリに保持 */
let conversationHistory = [];

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

/**
 * コーチングチャット画面をレンダリング
 */
export async function renderCoachingChat() {
  const main = getMain();
  main.innerHTML = `
    <div class="coach-container">
      <div class="coach-header">
        <h2 class="coach-title">パーソナルコーチ</h2>
        <p class="coach-subtitle">ナレッジグラフを活用したAIコーチング</p>
        <div class="coach-actions">
          <button class="btn btn-outline btn-sm" id="btn-clear-chat">会話をリセット</button>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash='/knowledge'">
            ナレッジグラフを見る
          </button>
        </div>
      </div>

      <div class="chat-messages" id="chat-messages">
        <div class="chat-welcome">
          <div class="chat-welcome-icon">🧠</div>
          <p>こんにちは！あなたの行動パターンを分析し、パーソナライズされたアドバイスを提供します。</p>
          <p class="chat-welcome-hint">何でも相談してください。例：</p>
          <div class="chat-suggestions">
            <button class="chat-suggestion" data-msg="最近の生産性を改善したい">生産性を改善したい</button>
            <button class="chat-suggestion" data-msg="ストレス管理について相談">ストレス管理</button>
            <button class="chat-suggestion" data-msg="今週の振り返りをしたい">今週の振り返り</button>
            <button class="chat-suggestion" data-msg="習慣を変えたいけど続かない">習慣づくり</button>
          </div>
        </div>
      </div>

      <div class="chat-input-area">
        <textarea class="chat-input" id="coach-input"
          placeholder=""
          rows="1"></textarea>
        <button class="btn btn-primary chat-send" id="btn-send-coach" disabled>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  _setupEventListeners();
}

function _setupEventListeners() {
  const input = document.getElementById("coach-input");
  const sendBtn = document.getElementById("btn-send-coach");
  const clearBtn = document.getElementById("btn-clear-chat");

  // 入力で送信ボタンの有効/無効を切り替え
  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim();
    // テキストエリアの高さを自動調整
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // Enter で送信（Shift+Enter は改行）
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.value.trim()) _sendMessage(input.value.trim());
    }
  });

  // 送信ボタン
  sendBtn.addEventListener("click", () => {
    if (input.value.trim()) _sendMessage(input.value.trim());
  });

  // 会話リセット
  clearBtn.addEventListener("click", () => {
    conversationHistory = [];
    const messages = document.getElementById("chat-messages");
    messages.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🧠</div>
        <p>会話をリセットしました。新しい相談をどうぞ。</p>
      </div>
    `;
  });

  // サジェストボタン
  document.querySelectorAll(".chat-suggestion").forEach((btn) => {
    btn.addEventListener("click", () => {
      _sendMessage(btn.dataset.msg);
    });
  });
}

async function _sendMessage(text) {
  const input = document.getElementById("coach-input");
  const sendBtn = document.getElementById("btn-send-coach");
  const messages = document.getElementById("chat-messages");

  // ウェルカムメッセージを消す
  const welcome = messages.querySelector(".chat-welcome");
  if (welcome) welcome.remove();

  // ユーザーメッセージ表示
  messages.innerHTML += `
    <div class="chat-msg chat-msg-user">
      <div class="chat-msg-content">${_escapeHtml(text)}</div>
    </div>
  `;

  // 入力をクリア
  input.value = "";
  input.style.height = "auto";
  sendBtn.disabled = true;

  // ローディング表示
  const loadingId = "coach-loading-" + Date.now();
  messages.innerHTML += `
    <div class="chat-msg chat-msg-ai" id="${loadingId}">
      <div class="chat-msg-content">
        <div class="chat-typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>
  `;
  messages.scrollTop = messages.scrollHeight;

  try {
    const result = await coachApi.chat(text, conversationHistory);

    // 履歴に追加
    conversationHistory.push({ role: "user", content: text });
    conversationHistory.push({ role: "assistant", content: result.reply });

    // 最大10ターン保持
    if (conversationHistory.length > 20) {
      conversationHistory = conversationHistory.slice(-20);
    }

    // ローディングをコーチ返答に置換
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="chat-msg-label">コーチ</div>
        <div class="chat-msg-content">${_formatReply(result.reply)}</div>
        ${result.referenced_patterns.length > 0 ? `
          <div class="chat-patterns">
            ${result.referenced_patterns.map(p => `<span class="chat-pattern-tag">${_escapeHtml(p)}</span>`).join("")}
          </div>
        ` : ""}
        ${result.suggested_action ? `
          <div class="chat-action">
            <strong>次のアクション:</strong> ${_escapeHtml(result.suggested_action)}
          </div>
        ` : ""}
      `;
    }
  } catch (err) {
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div class="chat-msg-content chat-msg-error">
          エラーが発生しました: ${_escapeHtml(err.message)}
        </div>
      `;
    }
    showToast(`コーチングエラー: ${err.message}`, "error");
  }

  messages.scrollTop = messages.scrollHeight;
}

function _escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function _formatReply(text) {
  // 改行を <br> に変換
  return _escapeHtml(text).replace(/\n/g, "<br>");
}
