/**
 * ナレッジグラフ可視化画面 (/knowledge)
 * エンティティ・リレーションの一覧とグラフ表示
 */

import { knowledgeApi } from "../api.js?v=20260424f";
import { showToast } from "../app.js?v=20260424f";

/** D3.js を必要時に一度だけロード（グローバル window.d3 を設定） */
let _d3LoadPromise = null;
function loadD3() {
  if (window.d3) return Promise.resolve(window.d3);
  if (_d3LoadPromise) return _d3LoadPromise;
  _d3LoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://d3js.org/d3.v7.min.js";
    s.async = true;
    s.onload = () => resolve(window.d3);
    s.onerror = () => { _d3LoadPromise = null; reject(new Error("D3.js の読込に失敗")); };
    document.head.appendChild(s);
  });
  return _d3LoadPromise;
}

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

/** エンティティタイプのラベルマップ */
const TYPE_LABELS = {
  goal: "目標",
  behavior_pattern: "行動パターン",
  trigger: "トリガー",
  strength: "強み",
  weakness: "弱み",
  habit: "習慣",
  value: "価値観",
  emotion_pattern: "感情パターン",
  life_context: "生活文脈",
};

/** エンティティタイプの色マップ */
const TYPE_COLORS = {
  goal: "#00d4ff",
  behavior_pattern: "#a855f7",
  trigger: "#ff3366",
  strength: "#00ff94",
  weakness: "#ffaa00",
  habit: "#3b82f6",
  value: "#f472b6",
  emotion_pattern: "#fbbf24",
  life_context: "#6b7280",
};

/** リレーションタイプのラベルマップ */
const RELATION_LABELS = {
  triggers: "引き起こす",
  prevents: "防ぐ",
  supports: "助ける",
  conflicts_with: "対立",
  correlates_with: "相関",
  part_of: "の一部",
  leads_to: "に発展",
};

/**
 * ナレッジグラフ画面をレンダリング
 */
export async function renderKnowledgeGraph() {
  const main = getMain();
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>ナレッジグラフを読み込み中...</p>
    </div>`;

  try {
    const [entities, relations, summary] = await Promise.all([
      knowledgeApi.listEntities(null, null, 100),
      knowledgeApi.listRelations(null, 100),
      knowledgeApi.summary(),
    ]);

    if (entities.length === 0) {
      main.innerHTML = `
        <div class="empty-state">
          <div class="icon">🧠</div>
          <h2>ナレッジグラフはまだ空です</h2>
          <p>日次分析を実行すると、行動パターンやトリガーが自動的に抽出されます。</p>
          <button class="btn btn-primary" onclick="window.location.hash='/input'">行動を記録する</button>
        </div>`;
      return;
    }

    main.innerHTML = `
      <div class="kg-container">
        <div class="kg-header">
          <h2 class="kg-title">ナレッジグラフ</h2>
          <div class="kg-stats">
            <span class="kg-stat"><strong>${summary.total_entities}</strong> エンティティ</span>
            <span class="kg-stat"><strong>${summary.total_relations}</strong> リレーション</span>
          </div>
        </div>

        <!-- グラフ可視化エリア -->
        <div class="card kg-graph-card">
          <div class="card-title">関係性マップ</div>
          <div class="kg-graph" id="kg-graph"></div>
          <div class="kg-legend">
            ${Object.entries(TYPE_LABELS).map(([type, label]) => `
              <span class="kg-legend-item">
                <span class="kg-legend-dot" style="background:${TYPE_COLORS[type]}"></span>
                ${label}
              </span>
            `).join("")}
          </div>
        </div>

        <!-- フィルタ -->
        <div class="kg-filter">
          <select id="kg-type-filter" class="kg-select">
            <option value="">全タイプ</option>
            ${Object.entries(TYPE_LABELS).map(([type, label]) =>
              `<option value="${type}">${label}</option>`
            ).join("")}
          </select>
          <select id="kg-status-filter" class="kg-select">
            <option value="">全ステータス</option>
            <option value="active">アクティブ</option>
            <option value="monitoring">モニタリング</option>
            <option value="resolved">解決済み</option>
          </select>
        </div>

        <!-- エンティティ一覧 -->
        <div class="card">
          <div class="card-title">エンティティ一覧</div>
          <div class="kg-entities" id="kg-entities">
            ${_renderEntitiesList(entities)}
          </div>
        </div>

        <!-- リレーション一覧 -->
        <div class="card">
          <div class="card-title">関係性一覧</div>
          <div class="kg-relations" id="kg-relations">
            ${_renderRelationsList(relations)}
          </div>
        </div>
      </div>
    `;

    _setupFilters(entities);
    // D3.js をこのタイミングで初めて読み込む（ホーム等での初期ロードを回避）
    loadD3().then(() => _renderGraph(entities, relations)).catch((e) => {
      showToast(`グラフ描画に失敗: ${e.message}`, "error");
    });

  } catch (err) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">❌</div>
        <p>ナレッジグラフの読み込みに失敗しました: ${err.message}</p>
      </div>`;
  }
}

function _renderEntitiesList(entities) {
  if (!entities.length) return "<p class='kg-empty'>エンティティがありません</p>";
  return entities.map(e => {
    const color = TYPE_COLORS[e.entityType] || "#6b7280";
    const label = TYPE_LABELS[e.entityType] || e.entityType;
    const obs = e.observations || [];
    const latestObs = obs.length > 0 ? obs[obs.length - 1].content : "";
    return `
      <div class="kg-entity-item" data-type="${e.entityType}" data-status="${e.status}">
        <div class="kg-entity-header">
          <span class="kg-entity-name" style="color:${color}">${_esc(e.name)}</span>
          <span class="kg-tag" style="border-color:${color};color:${color}">${label}</span>
          <span class="kg-tag kg-status-${e.status}">${e.status}</span>
        </div>
        <div class="kg-entity-meta">
          観測 ${e.observation_count || 0}回 | 初回: ${e.first_observed || '-'} | 最終: ${e.last_observed || '-'}
        </div>
        ${latestObs ? `<div class="kg-entity-obs">${_esc(latestObs)}</div>` : ""}
        ${obs.length > 1 ? `
          <details class="kg-obs-details">
            <summary>全観測記録 (${obs.length}件)</summary>
            <ul class="kg-obs-list">
              ${obs.map(o => `<li><span class="kg-obs-date">${o.source_date}</span> ${_esc(o.content)} <span class="kg-obs-conf">(${(o.confidence * 100).toFixed(0)}%)</span></li>`).join("")}
            </ul>
          </details>
        ` : ""}
      </div>
    `;
  }).join("");
}

function _renderRelationsList(relations) {
  if (!relations.length) return "<p class='kg-empty'>リレーションがありません</p>";

  // 強度でソート
  const sorted = [...relations].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  return sorted.map(r => {
    const label = RELATION_LABELS[r.relation_type] || r.relation_type;
    const strengthPercent = ((r.strength || 0) * 100).toFixed(0);
    return `
      <div class="kg-relation-item">
        <div class="kg-relation-flow">
          <span class="kg-rel-from">${_esc(r.from_entity)}</span>
          <span class="kg-rel-arrow">→ ${label} →</span>
          <span class="kg-rel-to">${_esc(r.to_entity)}</span>
        </div>
        <div class="kg-relation-meta">
          <div class="kg-strength-bar">
            <div class="kg-strength-fill" style="width:${strengthPercent}%"></div>
          </div>
          <span class="kg-strength-label">強度 ${strengthPercent}%</span>
          <span>証拠 ${r.evidence_count || 0}回</span>
        </div>
        ${r.description ? `<div class="kg-relation-desc">${_esc(r.description)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function _setupFilters(allEntities) {
  const typeFilter = document.getElementById("kg-type-filter");
  const statusFilter = document.getElementById("kg-status-filter");

  const applyFilter = () => {
    const type = typeFilter.value;
    const status = statusFilter.value;

    document.querySelectorAll(".kg-entity-item").forEach(el => {
      const matchType = !type || el.dataset.type === type;
      const matchStatus = !status || el.dataset.status === status;
      el.style.display = matchType && matchStatus ? "" : "none";
    });
  };

  typeFilter.addEventListener("change", applyFilter);
  statusFilter.addEventListener("change", applyFilter);
}

/** D3.js 力指向グラフ可視化 */
function _renderGraph(entities, relations) {
  const container = document.getElementById("kg-graph");
  if (!container) return;
  if (typeof d3 === "undefined") return;

  container.innerHTML = "";
  const width = container.clientWidth || 600;
  const height = 500;
  container.style.height = height + "px";

  // SVG 作成
  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height);

  // 矢印マーカー定義
  svg.append("defs").append("marker")
    .attr("id", "kg-arrow")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 20)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "rgba(0,212,255,0.5)");

  // ズーム用グループ
  const g = svg.append("g");
  svg.call(d3.zoom()
    .scaleExtent([0.3, 4])
    .on("zoom", (event) => g.attr("transform", event.transform)));

  // ノードデータ（観測情報も保持）
  const nodes = entities.map(e => {
    const obs = e.observations || [];
    const latestObs = obs.length > 0 ? obs[obs.length - 1].content : "";
    return {
      id: e.name,
      entityId: e.id,
      type: e.entityType,
      color: TYPE_COLORS[e.entityType] || "#6b7280",
      obsCount: e.observation_count || 0,
      latestObs,
      lastObserved: e.last_observed || "",
    };
  });

  const nodeSet = new Set(nodes.map(n => n.id));

  // リンクデータ（両端が存在するもののみ）
  const links = relations
    .filter(r => nodeSet.has(r.from_entity) && nodeSet.has(r.to_entity))
    .map(r => ({
      source: r.from_entity,
      target: r.to_entity,
      strength: r.strength || 0.3,
      type: r.relation_type,
      desc: r.description || "",
    }));

  // 力指向シミュレーション
  const simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(120))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collision", d3.forceCollide().radius(40))
    .force("x", d3.forceX(width / 2).strength(0.05))
    .force("y", d3.forceY(height / 2).strength(0.05));

  // エッジ描画
  const link = g.append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("stroke", d => `rgba(0,212,255,${d.strength * 0.6})`)
    .attr("stroke-width", d => 1 + d.strength * 2)
    .attr("marker-end", "url(#kg-arrow)");

  // ノードグループ
  const node = g.append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

  // ノード円（グロー）
  node.append("circle")
    .attr("r", d => 6 + Math.min(d.obsCount, 10))
    .attr("fill", d => d.color)
    .attr("stroke", d => d.color)
    .attr("stroke-width", 2)
    .attr("stroke-opacity", 0.4)
    .style("filter", "url(#kg-glow)");

  // グローフィルター
  const defs = svg.select("defs");
  const filter = defs.append("filter").attr("id", "kg-glow");
  filter.append("feGaussianBlur").attr("stdDeviation", 3).attr("result", "blur");
  const merge = filter.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  // ラベル（通常時は非表示、ホバーで表示）
  const label = node.append("text")
    .text(d => d.id)
    .attr("dy", d => -(10 + Math.min(d.obsCount, 10)))
    .attr("text-anchor", "middle")
    .attr("class", "kg-node-label")
    .style("opacity", 0)
    .style("pointer-events", "none");

  // ツールチップ（bodyに追加して切れを防止）
  // 既存のツールチップがあれば削除
  d3.select("body").selectAll(".kg-tooltip").remove();
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "kg-tooltip")
    .style("opacity", 0);

  // ホバーインタラクション
  node.on("mouseenter", (event, d) => {
    // 接続されたノードを取得
    const connected = new Set();
    links.forEach(l => {
      const src = typeof l.source === "object" ? l.source.id : l.source;
      const tgt = typeof l.target === "object" ? l.target.id : l.target;
      if (src === d.id) connected.add(tgt);
      if (tgt === d.id) connected.add(src);
    });
    connected.add(d.id);

    // 非接続ノードを薄くする
    node.style("opacity", n => connected.has(n.id) ? 1 : 0.15);
    link.style("opacity", l => {
      const src = typeof l.source === "object" ? l.source.id : l.source;
      const tgt = typeof l.target === "object" ? l.target.id : l.target;
      return (src === d.id || tgt === d.id) ? 1 : 0.05;
    });

    // 接続ノードのラベルも表示
    label.style("opacity", n => connected.has(n.id) ? 1 : 0);

    // ツールチップ（理解→行動につなげる記述）
    const typeLabel = TYPE_LABELS[d.type] || d.type;

    // 関係性を自然文に変換
    const relLines = links
      .filter(l => {
        const src = typeof l.source === "object" ? l.source.id : l.source;
        const tgt = typeof l.target === "object" ? l.target.id : l.target;
        return src === d.id || tgt === d.id;
      })
      .map(l => {
        const src = typeof l.source === "object" ? l.source.id : l.source;
        const tgt = typeof l.target === "object" ? l.target.id : l.target;
        const relLabel = RELATION_LABELS[l.type] || l.type;
        const desc = l.desc ? `<span class="kg-tooltip-desc">${l.desc}</span>` : "";
        if (src === d.id) {
          return `<span class="kg-tooltip-rel-item">
            <strong>${d.id}</strong> が <strong>${tgt}</strong> を${relLabel}
            ${desc}</span>`;
        } else {
          return `<span class="kg-tooltip-rel-item">
            <strong>${src}</strong> が <strong>${d.id}</strong> を${relLabel}
            ${desc}</span>`;
        }
      })
      .slice(0, 4);

    // 観測回数に応じた頻度テキスト
    const freqText = d.obsCount >= 5 ? "頻繁に観測" : d.obsCount >= 3 ? "複数回観測" : "観測あり";

    let html = `<div class="kg-tooltip-header" style="border-left: 3px solid ${d.color}; padding-left: 8px;">
      <strong style="color:${d.color}; font-size: 0.95rem;">${d.id}</strong>
      <span class="kg-tooltip-type">${typeLabel} / ${freqText}（${d.obsCount}回）</span>
    </div>`;

    if (d.latestObs) {
      html += `<div class="kg-tooltip-obs">${d.latestObs}</div>`;
    }

    if (relLines.length > 0) {
      html += `<div class="kg-tooltip-rels">
        <span class="kg-tooltip-rels-title">つながり</span>
        ${relLines.join("")}
      </div>`;
    }

    tooltip.html(html).style("opacity", 0).style("left", "-9999px").style("top", "-9999px");

    // ツールチップサイズ取得後にビューポート内に収まるよう位置調整
    const tipEl = tooltip.node();
    const tipW = tipEl.offsetWidth;
    const tipH = tipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let tx = event.clientX + 15;
    let ty = event.clientY + 10;

    // 右にはみ出す場合は左に表示
    if (tx + tipW > vw - 8) tx = event.clientX - tipW - 15;
    // 下にはみ出す場合は上に表示
    if (ty + tipH > vh - 8) ty = event.clientY - tipH - 10;
    // 上にはみ出す場合
    if (ty < 8) ty = 8;
    // 左にはみ出す場合
    if (tx < 8) tx = 8;

    tooltip
      .style("left", tx + "px")
      .style("top", ty + "px")
      .style("opacity", 1);
  })
  .on("mouseleave", () => {
    node.style("opacity", 1);
    link.style("opacity", 1);
    label.style("opacity", 0);
    tooltip.style("opacity", 0);
  });

  // タッチデバイス: タップでトグル
  let activeNode = null;
  node.on("touchstart", (event, d) => {
    event.preventDefault();
    if (activeNode === d.id) {
      activeNode = null;
      node.style("opacity", 1);
      link.style("opacity", 1);
      label.style("opacity", 0);
      tooltip.style("opacity", 0);
    } else {
      activeNode = d.id;
      node.dispatch("mouseenter", { detail: d });
    }
  });

  // tick 更新
  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

function _esc(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
