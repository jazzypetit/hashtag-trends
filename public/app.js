// 수집 결과(data/*.json)를 읽어 해시태그별 대시보드를 그린다.
const $ = (sel, root = document) => root.querySelector(sel);
const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);
const fmt = (n) => (n == null ? "–" : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("ko-KR"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

const state = { data: null, tab: 0, platform: "all", term: "", query: "" };

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

async function init() {
  let days = [];
  try { days = (await loadJson("data/index.json")).days; } catch {}
  const daySel = $("#day");
  daySel.innerHTML = `<option value="latest">최신</option>` + days.map((d) => `<option value="${d}">${d}</option>`).join("");
  daySel.onchange = () => load(daySel.value);
  $("#platform").onchange = (e) => { state.platform = e.target.value; render(); };
  $("#csv").onclick = exportCsv;
  await load("latest");
}

async function load(day) {
  try {
    state.data = await loadJson(day === "latest" ? "data/latest.json" : `data/history/${day}.json`);
  } catch {
    $("#meta").textContent = "아직 수집된 데이터가 없습니다. npm run collect 를 먼저 실행하세요.";
    $("#content").innerHTML = "";
    return;
  }
  state.tab = Math.min(state.tab, state.data.hashtags.length - 1);
  state.term = "";
  render();
}

function currentPosts() {
  const h = state.data.hashtags[state.tab];
  const q = state.query.toLowerCase();
  return h.posts.filter((p) =>
    (state.platform === "all" || p.platform === state.platform) &&
    (!state.term || p.hashtags.includes(state.term) || p.caption.toLowerCase().includes(state.term)) &&
    (!q || `${p.caption} ${p.author} ${p.hashtags.join(" ")}`.toLowerCase().includes(q)),
  );
}

function render() {
  const d = state.data;
  const c = d.criteria;
  $("#meta").textContent =
    `${new Date(d.generatedAt).toLocaleString("ko-KR")} 수집 · 최근 ${c.days}일 신규 게시글 · 좋아요 ${fmt(c.minLikes)} 이상`;

  const banner = $("#banner");
  const notes = [];
  if (d.sample) notes.push("샘플 데이터입니다. 실제 수집은 README의 설정 방법을 참고하세요.");
  for (const e of d.errors || []) notes.push(`#${e.hashtag} ${e.platform}: ${e.message}`);
  banner.hidden = notes.length === 0;
  banner.innerHTML = notes.map(esc).join("<br>");

  $("#tabs").innerHTML = d.hashtags
    .map((h, i) => `<button role="tab" aria-selected="${i === state.tab}" data-i="${i}">#${esc(h.hashtag)} <span>${h.postCount}</span></button>`)
    .join("");
  $("#tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.tab = Number(b.dataset.i);
    state.term = "";
    state.query = "";
    render();
  };

  const h = d.hashtags[state.tab];
  if (!h) { $("#content").innerHTML = `<p class="empty">설정된 해시태그가 없습니다.</p>`; return; }

  const view = $("#tpl").content.cloneNode(true);

  slot(view, "stats").innerHTML = [
    ["필터 통과 게시글", h.postCount],
    ["Instagram", h.byPlatform.instagram ?? 0],
    ["TikTok", h.byPlatform.tiktok ?? 0],
    ["전체 수집", h.collectedCount],
    ["외부 링크", h.keywords.externalUrls.length],
  ].map(([k, v]) => `<div class="stat"><b>${fmt(v)}</b><span>${k}</span></div>`).join("");

  if (h.ai) {
    slot(view, "summary").textContent = h.ai.summary;
    slot(view, "themes").innerHTML = (h.ai.themes || []).map((t) => `<span>${esc(t)}</span>`).join("");
    slot(view, "ai-keywords").innerHTML = (h.ai.keywords || []).map((k) => `
      <li><b>${esc(k.keyword)}</b>${esc(k.reason)}
        <div class="ex">${(k.examplePostUrls || []).map((u, i) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">예시 ${i + 1}</a>`).join("")}</div>
      </li>`).join("");
  } else {
    slot(view, "ai-card").hidden = true;
  }

  const chips = (list, prefix) => list.length
    ? list.map((t) => `<button class="chip${state.term === t.term ? " active" : ""}" data-term="${esc(t.term)}">${prefix}${esc(t.term)}<small>${t.count}</small></button>`).join("")
    : `<span class="muted">없음</span>`;
  slot(view, "tags").innerHTML = chips(h.keywords.hashtags, "#");
  slot(view, "words").innerHTML = chips(h.keywords.words, "");

  slot(view, "links").innerHTML = h.keywords.externalUrls.length
    ? h.keywords.externalUrls.map((l) => `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.url)}</a> <span class="muted">· ${l.count}회</span></li>`).join("")
    : `<li class="muted">캡션에 포함된 링크가 없습니다.</li>`;

  const search = slot(view, "search");
  search.value = state.query;

  $("#content").replaceChildren(view);
  renderPosts();

  $("#content").querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      state.term = state.term === el.dataset.term ? "" : el.dataset.term;
      $("#content").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.term === state.term));
      renderPosts();
    };
  });
  $('[data-slot="search"]').oninput = (e) => { state.query = e.target.value; renderPosts(); };
}

function renderPosts() {
  const posts = currentPosts();
  $('[data-slot="post-count"]').textContent = `${posts.length}건${state.term ? ` · "${state.term}" 필터` : ""}`;
  $('[data-slot="posts"]').innerHTML = posts.length
    ? posts.map((p) => `
      <tr>
        <td><span class="pf ${p.platform}">${p.platform === "instagram" ? "Instagram" : "TikTok"}</span></td>
        <td class="date">${p.postedAt ? new Date(p.postedAt).toLocaleDateString("ko-KR") : "–"}</td>
        <td class="num">${fmt(p.likes)}</td>
        <td class="num">${fmt(p.comments)}</td>
        <td class="num">${fmt(p.views)}</td>
        <td>${esc(p.author)}</td>
        <td class="caption"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" title="${esc(p.caption)}">${esc(p.caption || p.url)}</a></td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">조건에 맞는 게시글이 없습니다.</td></tr>`;
}

function exportCsv() {
  if (!state.data) return;
  const h = state.data.hashtags[state.tab];
  const rows = [["platform", "postedAt", "likes", "comments", "views", "author", "url", "hashtags", "caption"]];
  for (const p of currentPosts()) {
    rows.push([p.platform, p.postedAt, p.likes, p.comments, p.views, p.author, p.url, p.hashtags.join(" "), p.caption]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${h.hashtag}_${state.data.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
