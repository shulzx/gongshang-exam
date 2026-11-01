const KEY = "gongshang-exam-v1";
const SIG_KEY = "gongshang-exam-last-sigs";
const bank = window.BANK;
const questions = bank.questions;
const byId = Object.fromEntries(questions.map((q) => [q.id, q]));

let state = null;
let modal = null;
let filter = "all";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function readLastSigs() {
  try { return JSON.parse(localStorage.getItem(SIG_KEY) || "{}"); }
  catch { return {}; }
}

function writeLastSigs(paper) {
  const sigs = {};
  paper.forEach((item) => { sigs[item.id] = item.sig; });
  try { localStorage.setItem(SIG_KEY, JSON.stringify(sigs)); }
  catch { /* 忽略无法写入的本地存储 */ }
}

function permute(options, forbidden) {
  const original = options.map((o) => o.key).join("");
  let fallback = options.slice();
  for (let i = 0; i < 16; i += 1) {
    const arr = shuffle(options);
    const sig = arr.map((o) => o.key).join("");
    if (sig !== original && sig !== forbidden) return arr;
    fallback = arr;
  }
  return fallback;
}

function buildPaper() {
  const prev = readLastSigs();
  return questions.map((q) => {
    const ordered = permute(q.options, prev[q.id]);
    const labels = "ABCDE".slice(0, ordered.length).split("");
    const options = ordered.map((o, i) => ({
      label: labels[i],
      origin: o.key,
      text: o.text,
    }));
    const correctLabels = options
      .filter((o) => q.answer.includes(o.origin))
      .map((o) => o.label);
    return {
      id: q.id,
      sig: ordered.map((o) => o.key).join(""),
      options,
      correctLabels,
    };
  });
}

function paperOf(id) {
  return state.paper.find((item) => item.id === id);
}

function responseOf(id) {
  if (!state.responses[id]) state.responses[id] = { picked: [], submitted: false };
  return state.responses[id];
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { /* 手机用文件打开时，个别系统会禁止本地存储 */ }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.paper || !data.phase) return null;
    return data;
  } catch {
    return null;
  }
}

function format(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function remain() {
  if (!state || state.phase !== "exam") return 0;
  return Math.max(0, state.deadline - Date.now());
}

function submittedCount() {
  return questions.filter((q) => state.responses[q.id]?.submitted).length;
}

function grade(q, paper, picked) {
  const chosen = new Set(picked || []);
  const correct = new Set(paper.correctLabels);
  if (q.type === "single") {
    return chosen.size === 1 && correct.has([...chosen][0]) ? q.score : 0;
  }
  for (const label of chosen) {
    if (!correct.has(label)) return 0;
  }
  if (chosen.size === 0) return 0;
  if (chosen.size === correct.size) return q.score;
  return Math.min(q.score, chosen.size * 0.5);
}

function resultOf(q) {
  const paper = paperOf(q.id);
  const resp = state.responses[q.id];
  const submitted = !!resp?.submitted;
  const picked = submitted ? resp.picked : [];
  const points = submitted ? grade(q, paper, picked) : 0;
  const correct = new Set(paper.correctLabels);
  const same = submitted && picked.length === correct.size && picked.every((label) => correct.has(label));
  return { paper, picked, submitted, points, same, correct };
}

function totals() {
  let score = 0;
  let full = 0;
  let blank = 0;
  questions.forEach((q) => {
    const row = resultOf(q);
    score += row.points;
    if (!row.submitted) blank += 1;
    else if (row.same) full += 1;
  });
  return { score, full, blank, max: questions.reduce((sum, q) => sum + q.score, 0) };
}

function startExam() {
  modal = null;
  const paper = buildPaper();
  state = {
    phase: "exam",
    startedAt: Date.now(),
    deadline: Date.now() + bank.minutes * 60 * 1000,
    submittedAt: null,
    auto: false,
    current: questions[0].id,
    paper,
    responses: {},
  };
  filter = "all";
  save();
  render();
}

function commitOpenPicks() {
  Object.values(state.responses).forEach((resp) => {
    if (!resp.submitted && resp.picked.length) resp.submitted = true;
  });
}

function finishExam(auto) {
  if (!state || state.phase !== "exam") return;
  if (auto) commitOpenPicks();
  state.phase = "review";
  state.submittedAt = Date.now();
  state.auto = !!auto;
  writeLastSigs(state.paper);
  save();
  modal = null;
  filter = "all";
  render();
}

function abandon() {
  localStorage.removeItem(KEY);
  state = null;
  modal = null;
  render();
}

function go(id) {
  state.current = id;
  save();
  render();
}

function neighbors(id) {
  const list = visibleQuestions();
  const index = list.findIndex((q) => q.id === id);
  return {
    prev: index > 0 ? list[index - 1].id : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1].id : null,
  };
}

function visibleQuestions() {
  if (state.phase !== "review" || filter === "all") return questions;
  return questions.filter((q) => {
    const row = resultOf(q);
    if (filter === "wrong") return row.submitted && !row.same;
    if (filter === "blank") return !row.submitted;
    return true;
  });
}

function choose(id, label) {
  const resp = responseOf(id);
  if (resp.submitted || state.phase !== "exam") return;
  const q = byId[id];
  if (q.type === "single") resp.picked = [label];
  else if (resp.picked.includes(label)) resp.picked = resp.picked.filter((item) => item !== label);
  else resp.picked = resp.picked.concat(label).sort();
  save();
  render();
}

function submitOne(id) {
  const resp = responseOf(id);
  if (resp.submitted || resp.picked.length === 0) return;
  resp.submitted = true;
  const next = questions.find((q) => q.id > id && !state.responses[q.id]?.submitted)
    || questions.find((q) => !state.responses[q.id]?.submitted);
  if (next) state.current = next.id;
  save();
  render();
}

function tick() {
  const node = document.getElementById("timer");
  if (!state || state.phase !== "exam") {
    if (document.title !== "工商管理押题卷") document.title = "工商管理押题卷";
    return;
  }
  const ms = remain();
  if (node) {
    node.textContent = format(ms);
    node.className = ms < 60 * 1000 ? "timer danger" : ms < 5 * 60 * 1000 ? "timer warn" : "timer";
  }
  document.title = `${format(ms)} · 工商管理押题卷`;
  if (ms <= 0) finishExam(true);
}

function renderHome() {
  const saved = load();
  const canResume = saved && saved.phase === "exam" && saved.deadline > Date.now();
  return `
    <article class="card home">
      <div class="seal">考试</div>
      <h1>工商管理押题卷 1</h1>
      <p class="lead">中级经济师。考点保留在每道题上方。交卷之后才能看答案和原卷解析。</p>
      <div class="facts">
        <div class="fact"><b>105</b><span>题，单选 70 + 多选 35</span></div>
        <div class="fact"><b>90:00</b><span>开始后倒计时，到时自动交卷</span></div>
        <div class="fact"><b>140</b><span>满分。单选 1 分，多选 2 分</span></div>
      </div>
      <ol class="rules">
        <li>每题先勾选，再点「提交本题」。提交后这一题不能再改。</li>
        <li>105 题都提交后，才能点「交卷」。</li>
        <li>交卷后可以逐题查看原卷答案、解析和知识点。</li>
        <li>再考一次时，选项内容会换位置。比如原来的 A 可能变成 B，字母按新顺序重排。</li>
        <li>多选错选不得分；少选时，每个选对的选项 0.5 分；全部选对得 2 分。</li>
      </ol>
      <div class="actions">
        ${canResume ? '<button class="btn" data-action="resume">继续未交卷的考试</button>' : ""}
        <button class="btn ${canResume ? "ghost" : ""}" data-action="start">${canResume ? "放弃并重新开始" : "开始考试"}</button>
      </div>
      <p class="note">题目来自扫描卷识别。个别字如果和纸质卷不一致，以纸质卷为准。刷新页面不会暂停倒计时。</p>
      <div class="phone-help">
        <b>在 iPhone 上打开</b>
        <ol>
          <li>把「工商管理押题卷.html」放进「文件」App，留在我的 iPhone 里。</li>
          <li>点这个文件，再点分享，选「在 Safari 中打开」。不要在微信里直接点开。</li>
          <li>以后都用 Safari 打开这同一个文件，做题进度才会留在手机上。</li>
        </ol>
      </div>
    </article>`;
}

function renderExam() {
  const q = byId[state.current];
  const paper = paperOf(q.id);
  const resp = responseOf(q.id);
  const done = submittedCount();
  const nav = neighbors(q.id);
  const ready = done === questions.length;
  return `
    <div class="wrap">
      ${topbar(format(remain()))}
      <div class="layout">
        <section class="card paper">
          <div class="q-meta">
            <span class="tag">${q.type === "single" ? "单项选择" : "多项选择"}</span>
            <span class="tag quiet">第 ${q.id} 题 · ${q.score} 分</span>
            <span>${done}/${questions.length} 已提交</span>
          </div>
          <p class="topic">考点：${esc(q.topic)}</p>
          <p class="stem">${esc(q.stem)}</p>
          <div class="options">
            ${paper.options.map((o) => `
              <button class="option ${resp.picked.includes(o.label) ? "selected" : ""}" type="button"
                data-action="pick" data-id="${q.id}" data-label="${o.label}" ${resp.submitted ? "disabled" : ""}>
                <span class="letter">${o.label}</span>
                <span>${esc(o.text)}</span>
              </button>`).join("")}
          </div>
          <div class="actions">
            <button class="btn ghost" type="button" data-action="goto" data-id="${nav.prev || ""}" ${nav.prev ? "" : "disabled"}>上一题</button>
            ${resp.submitted
              ? '<button class="btn" type="button" disabled>本题已提交</button>'
              : `<button class="btn" type="button" data-action="submit-one" data-id="${q.id}" ${resp.picked.length ? "" : "disabled"}>提交本题</button>`}
            <button class="btn ghost" type="button" data-action="goto" data-id="${nav.next || ""}" ${nav.next ? "" : "disabled"}>下一题</button>
          </div>
        </section>
        ${sideNav(done, ready)}
      </div>
    </div>`;
}

function topbar(timeText) {
  const warn = remain() < 5 * 60 * 1000;
  const danger = remain() < 60 * 1000;
  return `
    <header class="topbar">
      <div class="brand">
        <b>工商管理押题卷 1</b>
        <span>交卷前不显示答案</span>
      </div>
      <div id="timer" class="timer ${danger ? "danger" : warn ? "warn" : ""}">${timeText}</div>
    </header>`;
}

function sideNav(done, ready) {
  return `
    <aside class="card side">
      <h2>答题卡</h2>
      <div class="progress-line"><span style="width:${(done / questions.length) * 100}%"></span></div>
      <div class="grid">
        ${questions.map((q) => {
          const submitted = !!state.responses[q.id]?.submitted;
          return `<button class="cell ${q.id === state.current ? "current" : ""} ${submitted ? "done" : ""}" type="button" data-action="goto" data-id="${q.id}">${q.id}</button>`;
        }).join("")}
      </div>
      <div class="actions">
        <button class="btn" type="button" data-action="ask-finish" ${ready ? "" : "disabled"}>交卷</button>
        <button class="btn ghost small" type="button" data-action="ask-abandon">放弃</button>
      </div>
      <p class="note">${ready ? "可以交卷了。" : `还有 ${questions.length - done} 题没提交。`}</p>
    </aside>`;
}

function renderReview() {
  const shown = visibleQuestions();
  const q = byId[state.current] && shown.some((item) => item.id === state.current)
    ? byId[state.current]
    : shown[0] || questions[0];
  if (q.id !== state.current) state.current = q.id;
  const row = resultOf(q);
  const sum = totals();
  const used = Math.max(0, (state.submittedAt || Date.now()) - state.startedAt);
  const nav = neighbors(q.id);
  return `
    <div class="wrap">
      <header class="topbar">
        <div class="brand">
          <b>交卷结果</b>
          <span>${state.auto ? "时间到，已自动交卷" : "已交卷"} · 用时 ${format(used)}</span>
        </div>
        <button class="btn" type="button" data-action="ask-retry">再考一次</button>
      </header>
      <div class="layout">
        <section class="card paper">
          <div class="score-hero">
            <div>
              <strong>${trimScore(sum.score)}<small>/ ${sum.max}</small></strong>
              <p class="stats">全对 ${sum.full} 题 · 未作答 ${sum.blank} 题</p>
            </div>
          </div>
          <div class="q-meta" style="margin-top:18px">
            <span class="tag">${q.type === "single" ? "单项选择" : "多项选择"}</span>
            <span class="tag quiet">第 ${q.id} 题 · 得分 ${trimScore(row.points)}</span>
          </div>
          <p class="topic">考点：${esc(q.topic)}</p>
          <p class="stem">${esc(q.stem)}</p>
          <div class="options">
            ${row.paper.options.map((o) => {
              const picked = row.picked.includes(o.label);
              const right = row.correct.has(o.label);
              const cls = picked && right ? "good" : picked ? "bad" : right ? "miss" : "";
              return `<div class="option ${cls}"><span class="letter">${o.label}</span><span>${esc(o.text)}</span></div>`;
            }).join("")}
          </div>
          <div class="review-block">
            <h3>这次的答案</h3>
            <p>你的选择：${row.submitted ? labelsText(row.paper, row.picked) : "未提交"}</p>
            <p>正确答案：${labelsText(row.paper, row.paper.correctLabels)}</p>
            <p class="note">原卷答案是 ${esc(q.answer)}。解析里的 A、B、C、D、E 按原卷顺序，不是这次打乱后的顺序。</p>
          </div>
          <div class="review-block">
            <h3>原卷解析</h3>
            <p>${esc(q.explain || "原卷这一题没有识别到解析。")}</p>
            ${q.knowledge ? `<h3>知识点</h3><p>${esc(q.knowledge)}</p>` : ""}
            <div class="origin">
              <b>原卷选项</b>
              ${q.options.map((o) => `<div>${o.key}. ${esc(o.text)}</div>`).join("")}
            </div>
          </div>
          <div class="actions">
            <button class="btn ghost" type="button" data-action="goto" data-id="${nav.prev || ""}" ${nav.prev ? "" : "disabled"}>上一题</button>
            <button class="btn ghost" type="button" data-action="goto" data-id="${nav.next || ""}" ${nav.next ? "" : "disabled"}>下一题</button>
          </div>
        </section>
        <aside class="card side">
          <div class="filters">
            ${[["all", "全部"], ["wrong", "错题"], ["blank", "未答"]].map(([id, name]) =>
              `<button class="btn ghost small" type="button" data-action="filter" data-filter="${id}" aria-pressed="${filter === id}">${name}</button>`
            ).join("")}
          </div>
          <div class="grid">
            ${shown.map((item) => {
              const itemRow = resultOf(item);
              const cls = !itemRow.submitted ? "blank" : itemRow.same ? "right" : "wrong";
              return `<button class="cell ${cls} ${item.id === q.id ? "current" : ""}" type="button" data-action="goto" data-id="${item.id}">${item.id}</button>`;
            }).join("")}
          </div>
        </aside>
      </div>
    </div>`;
}

function labelsText(paper, labels) {
  if (!labels.length) return "无";
  return labels.map((label) => {
    const option = paper.options.find((o) => o.label === label);
    return `${label}. ${option ? option.text : ""}（原卷 ${option ? option.origin : ""}）`;
  }).join("；");
}

function trimScore(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function renderModal() {
  if (!modal) return "";
  return `
    <div class="modal-back">
      <div class="modal" role="dialog">
        <h2>${esc(modal.title)}</h2>
        <p>${esc(modal.body)}</p>
        <div class="actions">
          <button class="btn" type="button" data-action="${modal.confirmAction}">${esc(modal.confirm)}</button>
          <button class="btn ghost" type="button" data-action="close-modal">${esc(modal.cancel)}</button>
        </div>
      </div>
    </div>`;
}

function render() {
  const app = document.getElementById("app");
  let html = "";
  if (!state) html = renderHome();
  else if (state.phase === "exam") html = renderExam();
  else html = renderReview();
  app.innerHTML = html + renderModal();
}

document.getElementById("app").addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "start") {
    if (load()) {
      modal = {
        title: "重新开始？",
        body: "未交卷的进度会清掉，并重新抽一版选项顺序。",
        confirm: "重新开始",
        cancel: "取消",
        confirmAction: "confirm-start",
      };
      render();
      return;
    }
    startExam();
  }
  if (action === "confirm-start") startExam();
  if (action === "resume") {
    state = load();
    render();
  }
  if (action === "pick") choose(Number(target.dataset.id), target.dataset.label);
  if (action === "submit-one") submitOne(Number(target.dataset.id));
  if (action === "goto" && target.dataset.id) go(Number(target.dataset.id));
  if (action === "ask-finish") {
    modal = {
      title: "确认交卷？",
      body: "交卷后可以查看每题的答案和原卷解析。这次的选项顺序会记下来，下次考试会换。",
      confirm: "交卷",
      cancel: "再检查一下",
      confirmAction: "confirm-finish",
    };
    render();
  }
  if (action === "confirm-finish") finishExam(false);
  if (action === "ask-abandon") {
    modal = {
      title: "放弃这次考试？",
      body: "当前作答不会记分，倒计时也会停掉。",
      confirm: "放弃",
      cancel: "继续做",
      confirmAction: "confirm-abandon",
    };
    render();
  }
  if (action === "confirm-abandon") abandon();
  if (action === "ask-retry") {
    modal = {
      title: "再考一次？",
      body: "会开始新的 90 分钟，选项内容会重新换位。",
      confirm: "开始",
      cancel: "留下看解析",
      confirmAction: "confirm-retry",
    };
    render();
  }
  if (action === "confirm-retry") startExam();
  if (action === "filter") {
    filter = target.dataset.filter;
    const shown = visibleQuestions();
    if (shown.length && !shown.some((q) => q.id === state.current)) state.current = shown[0].id;
    render();
  }
  if (action === "close-modal") {
    modal = null;
    render();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (state && state.phase === "exam") {
    event.preventDefault();
    event.returnValue = "";
  }
});

state = load();
if (state && state.phase === "exam" && Date.now() >= state.deadline) finishExam(true);
render();
setInterval(tick, 250);
