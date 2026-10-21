// 수집 결과(data/*.json)를 읽어 해시태그별 대시보드를 그린다.
const $ = (sel, root = document) => root.querySelector(sel);
const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);
const fmt = (n) => (n == null ? "–" : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("ko-KR"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

const state = { data: null, tab: 0, platform: "all", term: "", query: "", matchedOnly: true, author: "" };

// 해시태그 탭들 + (있으면) 계정 모니터링 탭
const groups = () => [...state.data.hashtags, ...(state.data.accounts ? [state.data.accounts] : [])];
const isAccounts = (g) => g?.kind === "accounts";

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
  state.tab = Math.max(0, Math.min(state.tab, groups().length - 1));
  state.term = "";
  state.author = "";
  render();
}

function currentPosts() {
  const h = groups()[state.tab];
  const q = state.query.toLowerCase();
  const acc = isAccounts(h);
  return h.posts.filter((p) =>
    (state.platform === "all" || p.platform === state.platform) &&
    (!acc || !state.matchedOnly || p.matched?.length) &&
    (!acc || !state.author || `${p.platform}:${p.author.toLowerCase()}` === state.author) &&
    (!state.term || p.hashtags.includes(state.term) || p.caption.toLowerCase().includes(state.term)) &&
    (!q || `${p.caption} ${p.author} ${p.hashtags.join(" ")}`.toLowerCase().includes(q)),
  );
}

function render() {
  const d = state.data;
  const c = d.criteria;
  const likes = typeof c.minLikes === "number"
    ? `좋아요 ${fmt(c.minLikes)} 이상`
    : "좋아요 " + Object.entries(c.minLikes).map(([pf, n]) => `${pf === "instagram" ? "Instagram" : "TikTok"} ${fmt(n)}`).join(" · ") + " 이상";
  $("#meta").textContent = `${new Date(d.generatedAt).toLocaleString("ko-KR")} 수집 · 최근 ${c.days}일 신규 게시글 · ${likes}`;

  const banner = $("#banner");
  const notes = [];
  if (d.sample) notes.push("샘플 데이터입니다. 실제 수집은 README의 설정 방법을 참고하세요.");
  for (const e of d.errors || []) notes.push(`${e.hashtag === "계정" ? "계정" : "#" + e.hashtag} ${e.platform}: ${e.message}`);
  banner.hidden = notes.length === 0;
  banner.innerHTML = notes.map(esc).join("<br>");

  $("#tabs").innerHTML = groups()
    .map((h, i) => `<button role="tab" aria-selected="${i === state.tab}" data-i="${i}">${isAccounts(h) ? "" : "#"}${esc(h.hashtag)} <span>${h.postCount}</span></button>`)
    .join("");
  $("#tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.tab = Number(b.dataset.i);
    state.term = "";
    state.query = "";
    state.author = "";
    render();
  };

  const h = groups()[state.tab];
  if (!h) { $("#content").innerHTML = `<p class="empty">설정된 해시태그가 없습니다.</p>`; return; }

  const view = $("#tpl").content.cloneNode(true);

  const acc = isAccounts(h);
  slot(view, "stats").innerHTML = [
    [acc ? "키워드 매칭 게시글" : "필터 통과 게시글", h.postCount],
    ["Instagram", h.byPlatform.instagram ?? 0],
    ["TikTok", h.byPlatform.tiktok ?? 0],
    [acc ? `최근 ${d.criteria.days}일 전체 게시글` : "전체 수집", h.collectedCount],
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

  if (acc) {
    slot(view, "accounts-card").hidden = false;
    slot(view, "matched-wrap").hidden = false;
    slot(view, "matched-only").checked = state.matchedOnly;
    slot(view, "accounts-note").textContent =
      `키워드: ${h.keywordsUsed.join(", ")} · 계정 게시글은 좋아요 기준 없이 키워드 매칭으로 고릅니다. 키워드·해시태그·링크 집계는 매칭된 게시글 기준입니다. 행을 누르면 해당 계정만 봅니다.`;
    slot(view, "accounts").innerHTML = h.accounts.map((a) => {
      const key = `${a.platform}:${a.username}`;
      const profile = a.platform === "instagram" ? `https://www.instagram.com/${a.username}/` : `https://www.tiktok.com/@${a.username}`;
      return `<tr class="clickable${state.author === key ? " selected" : ""}" data-author="${esc(key)}">
        <td><span class="pf ${a.platform}">${a.platform === "instagram" ? "Instagram" : "TikTok"}</span></td>
        <td><a href="${esc(profile)}" target="_blank" rel="noopener">@${esc(a.username)}</a>${a.error ? `<div class="err">${esc(a.error)}</div>` : ""}</td>
        <td class="num">${fmt(a.followers)}</td>
        <td class="num">${fmt(a.postCount)}</td>
        <td class="num">${fmt(a.matchedCount)}</td>
        <td></td>
      </tr>`;
    }).join("");
  }

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
  $('[data-slot="matched-only"]').onchange = (e) => { state.matchedOnly = e.target.checked; renderPosts(); };
  $("#content").querySelectorAll("tr[data-author]").forEach((tr) => {
    tr.onclick = (e) => {
      if (e.target.closest("a")) return;
      state.author = state.author === tr.dataset.author ? "" : tr.dataset.author;
      $("#content").querySelectorAll("tr[data-author]").forEach((r) => r.classList.toggle("selected", r.dataset.author === state.author));
      renderPosts();
    };
  });
}

function renderPosts() {
  const posts = currentPosts();
  const filters = [state.term && `"${state.term}"`, state.author && `@${state.author.split(":")[1]}`].filter(Boolean);
  $('[data-slot="post-count"]').textContent = `${posts.length}건${filters.length ? ` · ${filters.join(", ")} 필터` : ""}`;
  $('[data-slot="posts"]').innerHTML = posts.length
    ? posts.map((p) => `
      <tr>
        <td><span class="pf ${p.platform}">${p.platform === "instagram" ? "Instagram" : "TikTok"}</span></td>
        <td class="date">${p.postedAt ? new Date(p.postedAt).toLocaleDateString("ko-KR") : "–"}</td>
        <td class="num">${fmt(p.likes)}</td>
        <td class="num">${fmt(p.comments)}</td>
        <td class="num">${fmt(p.views)}</td>
        <td>${esc(p.author)}</td>
        <td class="caption"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener" title="${esc(p.caption)}">${esc(p.caption || p.url)}</a>${p.matched?.length ? `<div class="tags-inline">${p.matched.map((m) => `<span class="tag-match">${esc(m)}</span>`).join("")}</div>` : ""}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">조건에 맞는 게시글이 없습니다.</td></tr>`;
}

function exportCsv() {
  if (!state.data) return;
  const h = groups()[state.tab];
  const rows = [["platform", "postedAt", "likes", "comments", "views", "author", "url", "hashtags", "matched", "caption"]];
  for (const p of currentPosts()) {
    rows.push([p.platform, p.postedAt, p.likes, p.comments, p.views, p.author, p.url, p.hashtags.join(" "), (p.matched || []).join(" "), p.caption]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${h.hashtag}_${state.data.generatedAt.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

init();
