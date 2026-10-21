/**
 * 🔒 非公開トグル（Claude（MCP）に渡さない記録の切り替え）
 *
 * 日記・やりたいこと・ありがたいノート・単語帳・道しるべ・行動ログの各エントリに置く
 * 共通ボタン。状態は各記録の `is_private` フィールド（サーバー側で MCP から除外される）。
 * 自由帳系（自由帳・トレードメモ・Udemy Tips）はラベル「非公開」で管理するのでこのボタンは使わない。
 *
 * 使い方:
 *   html += lockButtonHTML(entry.is_private, entry.id, { action: "toggle-private" });
 *   bindLockToggles(root, async (id, next) => { await api.setPrivate(id, next); });
 */

export const PRIVATE_TITLE = "Claude に渡しません（クリックで公開に戻す）";
export const PUBLIC_TITLE = "Claude に渡します（クリックで非公開にする）";

/**
 * @param {boolean} isPrivate
 * @param {string} id
 * @param {{cls?: string, action?: string, labeled?: boolean}} [opts]
 *   action: data-action を付ける（既存の委任ハンドラで拾いたい画面用）
 *   labeled: 文言付きの横長ボタン
 */
export function lockButtonHTML(isPrivate, id, opts = {}) {
  const priv = !!isPrivate;
  const cls = ["lock-toggle", priv ? "is-private" : "", opts.labeled ? "lock-toggle-labeled" : "", opts.cls || ""]
    .filter(Boolean).join(" ");
  const action = opts.action ? ` data-action="${opts.action}"` : "";
  const safeId = String(id).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<button type="button" class="${cls}" data-id="${safeId}" data-private="${priv ? 1 : 0}"${action}
    title="${priv ? PRIVATE_TITLE : PUBLIC_TITLE}" aria-pressed="${priv}">${lockLabel(priv, !!opts.labeled)}</button>`;
}

export function lockLabel(isPrivate, labeled) {
  if (!labeled) return isPrivate ? "🔒" : "🔓";
  return isPrivate ? "🔒 Claude に渡さない" : "🔓 Claude に渡す";
}

/** ボタンの見た目と data-private を新しい状態に揃える */
export function setLockState(btn, isPrivate) {
  const priv = !!isPrivate;
  btn.classList.toggle("is-private", priv);
  btn.dataset.private = priv ? "1" : "0";
  btn.title = priv ? PRIVATE_TITLE : PUBLIC_TITLE;
  btn.setAttribute("aria-pressed", String(priv));
  btn.textContent = lockLabel(priv, btn.classList.contains("lock-toggle-labeled"));
}

/**
 * root 内の .lock-toggle にクリックを束ねる（描画のたびに呼ぶ。要素が作り直されるので二重登録にならない）
 * onToggle(id, next) が解決したら表示を更新する。失敗したら元のまま。
 */
export function bindLockToggles(root, onToggle) {
  (root || document).querySelectorAll(".lock-toggle").forEach((btn) => {
    if (btn.dataset.lockBound) return;
    btn.dataset.lockBound = "1";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = btn.dataset.private !== "1";
      btn.disabled = true;
      try {
        await onToggle(btn.dataset.id, next);
        setLockState(btn, next);
      } finally {
        btn.disabled = false;
      }
    });
  });
}
