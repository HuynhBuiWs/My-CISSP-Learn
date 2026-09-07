const DOM = {
  1: 'D1 — Security and Risk Management',
  2: 'D2 — Asset Security',
  3: 'D3 — Security Architecture and Engineering',
  4: 'D4 — Communications and Network Security',
  5: 'D5 — Identity and Access Management',
  6: 'D6 — Security Assessment and Testing',
  7: 'D7 — Security Operations',
  8: 'D8 — Software Development Security'
};

const G = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const S = (key, value) => localStorage.setItem(key, JSON.stringify(value));

function getSavedDay() {
  const raw = localStorage.getItem('c_day');
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

let day = getSavedDay();
let qstate = {};
let exam = null;

function cur() {
  return DAYS.find(x => x.day === day) || DAYS[0];
}

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDisplayQuestion(question) {
  const originalIndices = question.options.map((_, idx) => idx);
  const order = shuffle(originalIndices);
  return {
    order,
    options: order.map(idx => question.options[idx]),
    correctIndex: order.indexOf(question.correct)
  };
}

function renderDays() {
  const q = search.value.toLowerCase();
  const f = +df.value;

  days.innerHTML = DAYS.filter(x => (!f || x.domain === f) && (!q || x.topic.toLowerCase().includes(q)))
    .map(x => `
      <button onclick="sel(${x.day})" class="w-full text-left p-3 rounded-lg border ${x.day === day ? 'border-cyan-500 bg-cyan-950/40' : 'border-slate-800 bg-slate-950/40'}">
        <div class="text-[10px] text-cyan-400">DAY ${x.day} • D${x.domain}</div>
        <div class="text-sm">${G('c_done').includes(x.day) ? '✅ ' : ''}${x.topic}</div>
      </button>
    `)
    .join('');
}

function sel(n) {
  day = n;
  S('c_day', n);
  renderDays();
  renderStudy();
  renderQuiz();
}

function renderStudy() {
  const x = cur();
  document.getElementById('day').textContent = `DAY ${x.day} / 84 • DOMAIN ${x.domain}`;
  title.textContent = x.title;
  domain.textContent = DOM[x.domain];
  intro.textContent = x.intro;
  bullets.innerHTML = x.bullets.map(z => `<li>${z}</li>`).join('');
  mindset.textContent = x.mindset;
  traps.innerHTML = x.traps.map(z => `<li>${z}</li>`).join('');
  scenario.textContent = x.scenario;
}

function show(n) {
  ['study', 'quiz', 'exam', 'review', 'stats'].forEach(x => {
    document.getElementById(x).classList.toggle('hidden', x !== n);
  });

  if (n === 'quiz') renderQuiz();
  if (n === 'review') renderReview();
  if (n === 'stats') renderStats();
}

function complete() {
  const done = G('c_done');
  if (!done.includes(day)) done.push(day);
  S('c_done', done);
  stats();
  renderDays();
  alert('Đã hoàn thành Day ' + day);
}

function renderQuiz() {
  qstate = { i: 0, score: 0, answered: null, shown: null };
  renderQ();
}

function renderQ() {
  const qs = cur().questions;

  if (qstate.i >= qs.length) {
    qbox.innerHTML = `
      <div class="text-center p-8">
        <h2 class="text-2xl font-bold">🎉 Completed</h2>
        <p class="mt-2">${qstate.score}/${qs.length} — ${Math.round(qstate.score / qs.length * 100)}%</p>
        <button onclick="renderQuiz()" class="mt-4 px-4 py-2 bg-cyan-700 rounded">Retry</button>
      </div>
    `;
    return;
  }

  const q = qs[qstate.i];
  const shown = buildDisplayQuestion(q);
  qstate.shown = shown;
  qmeta.textContent = `Q ${qstate.i + 1}/5 • Score ${qstate.score}`;

  qbox.innerHTML = `
    <div class="text-lg font-bold">${q.q}</div>
    <div class="grid gap-2 mt-4">
      ${shown.options.map((o, i) => `
        <button class="choice text-left p-3 rounded-lg border border-slate-800 bg-slate-950" onclick="ans(${i})">
          ${String.fromCharCode(65 + i)}. ${o}
        </button>
      `).join('')}
    </div>
    <div id="exp" class="hidden mt-4 p-4 bg-slate-900 rounded-lg"></div>
    <button id="nq" onclick="nextQ()" disabled class="mt-4 px-4 py-2 bg-cyan-700 rounded">Next →</button>
  `;
}

function ans(i) {
  if (qstate.answered !== null) return;

  qstate.answered = i;
  const q = cur().questions[qstate.i];
  const selectedOriginalIndex = qstate.shown.order[i];
  const isCorrect = selectedOriginalIndex === q.correct;

  if (isCorrect) {
    qstate.score++;
  } else {
    const wrong = G('c_wrong');
    wrong.push({
      day,
      topic: cur().topic,
      q: q.q,
      selected: q.options[selectedOriginalIndex],
      correct: q.options[q.correct],
      explanation: q.explanation
    });
    S('c_wrong', wrong);
  }

  const history = G('c_ans');
  history.push({ day, correct: isCorrect, domain: cur().domain });
  S('c_ans', history);

  document.querySelectorAll('.choice').forEach((b, n) => {
    b.disabled = true;
    if (qstate.shown.correctIndex === n) b.classList.add('correct');
    if (n === i && i !== qstate.shown.correctIndex) b.classList.add('wrong');
  });

  const exp = document.getElementById('exp');
  exp.classList.remove('hidden');
  exp.innerHTML = `<b>${isCorrect ? '✅ Correct' : '❌ Incorrect'}</b><br>${q.explanation}`;

  document.getElementById('nq').disabled = false;
  stats();
}

function nextQ() {
  qstate.i += 1;
  qstate.answered = null;
  renderQ();
}

function startExam() {
  const n = +ec.value;
  const mins = +em.value;
  const d = +ed.value;

  const pool = DAYS.flatMap(x => x.questions.map(q => ({ ...q, day: x.day, domain: x.domain, topic: x.topic })))
    .filter(x => !d || x.domain === d)
    .sort(() => Math.random() - 0.5)
    .slice(0, n);

  exam = {
    qs: pool,
    i: 0,
    score: 0,
    ans: null,
    end: Date.now() + mins * 60000,
    done: false,
    shown: null,
    timer: null
  };

  ebox.classList.remove('hidden');
  exam.timer = setInterval(timer, 500);
  renderExam();
}

function timer() {
  if (!exam) return;

  const left = Math.max(0, exam.end - Date.now());
  const sec = Math.ceil(left / 1000);
  const timerNode = document.getElementById('tm');

  if (timerNode) timerNode.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (sec <= 0) finishExam();
}

function renderExam() {
  if (!exam) return;
  if (exam.i >= exam.qs.length) return finishExam();

  const q = exam.qs[exam.i];
  const shown = buildDisplayQuestion(q);
  exam.shown = shown;

  ebox.innerHTML = `
    <div class="flex justify-between">
      <b>Q${exam.i + 1}/${exam.qs.length}</b>
      <b id="tm" class="text-amber-400"></b>
    </div>
    <div class="text-xs text-cyan-400 mt-3">D${q.domain} • ${q.topic}</div>
    <div class="text-lg font-bold mt-2">${q.q}</div>
    <div class="grid gap-2 mt-4">
      ${shown.options.map((o, i) => `
        <button class="choice text-left p-3 rounded-lg border border-slate-800 bg-slate-950" onclick="ea(${i})">
          ${String.fromCharCode(65 + i)}. ${o}
        </button>
      `).join('')}
    </div>
    <button id="en" onclick="nextExam()" disabled class="mt-4 px-4 py-2 bg-violet-700 rounded">Next →</button>
  `;

  timer();
}

function ea(i) {
  if (exam.ans !== null) return;

  exam.ans = i;
  const q = exam.qs[exam.i];
  const selectedOriginalIndex = exam.shown.order[i];
  const isCorrect = selectedOriginalIndex === q.correct;

  if (isCorrect) exam.score++;

  document.querySelectorAll('#ebox .choice').forEach((b, n) => {
    b.disabled = true;
    if (exam.shown.correctIndex === n) b.classList.add('correct');
    if (n === i && i !== exam.shown.correctIndex) b.classList.add('wrong');
  });

  document.getElementById('en').disabled = false;
}

function nextExam() {
  exam.i += 1;
  exam.ans = null;
  renderExam();
}

function finishExam() {
  if (!exam || exam.done) return;
  exam.done = true;
  clearInterval(exam.timer);

  ebox.innerHTML = `
    <div class="text-center p-8">
      <div class="text-4xl">🏁</div>
      <h2 class="text-2xl font-bold">Exam Finished</h2>
      <p class="mt-2">${exam.score}/${exam.qs.length} — ${Math.round(exam.score / exam.qs.length * 100)}%</p>
      <button onclick="startExam()" class="mt-4 px-4 py-2 bg-violet-700 rounded">Retake</button>
    </div>
  `;
}

function renderReview() {
  const x = G('c_wrong');

  rbox.innerHTML = x.length
    ? x.slice().reverse().map(z => `
        <div class="p-4 border border-slate-800 rounded-lg mb-2">
          <div class="text-xs text-cyan-400">DAY ${z.day} • ${z.topic}</div>
          <b>${z.q}</b>
          <div class="text-rose-300 text-sm mt-2">Bạn chọn: ${z.selected}</div>
          <div class="text-emerald-300 text-sm">Đúng: ${z.correct}</div>
          <div class="text-slate-400 text-sm mt-2">${z.explanation}</div>
        </div>
      `).join('')
    : '<div class="text-slate-400">Chưa có câu sai.</div>';
}

function clearWrong() {
  localStorage.removeItem('c_wrong');
  renderReview();
  stats();
}

function streak() {
  const x = [...new Set(G('c_done'))].sort((a, b) => a - b);
  let s = 0;

  for (let i = x.length - 1; i >= 0; i--) {
    if (x[i] === x[x.length - 1] - s) s++;
    else break;
  }

  return s;
}

function stats() {
  const done = G('c_done');
  const aa = G('c_ans');
  const ww = G('c_wrong');

  p.textContent = Math.round(done.length / 84 * 100) + '%';
  a.textContent = (aa.length ? Math.round(aa.filter(x => x.correct).length / aa.length * 100) : 0) + '%';
  s.textContent = streak();
  w.textContent = ww.length;
}

function renderStats() {
  const aa = G('c_ans');
  const done = G('c_done');

  stbox.innerHTML = Object.entries(DOM).map(([id, n]) => {
    const ds = DAYS.filter(x => x.domain == id).map(x => x.day);
    const an = aa.filter(x => ds.includes(x.day));
    const dn = done.filter(x => ds.includes(x)).length;
    const ac = an.length ? Math.round(an.filter(x => x.correct).length / an.length * 100) : 0;

    return `
      <div class="mb-5">
        <div class="flex justify-between text-sm">
          <span>D${id} — ${n}</span>
          <span>${dn} days • ${ac}%</span>
        </div>
        <div class="h-2 bg-slate-800 rounded mt-1">
          <div class="h-2 bg-cyan-500 rounded" style="width:${dn / ds.length * 100}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function exportData() {
  const blob = new Blob([
    JSON.stringify({ done: G('c_done'), ans: G('c_ans'), wrong: G('c_wrong') }, null, 2)
  ], { type: 'application/json' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cissp-progress.json';
  a.click();
}

function resetData() {
  if (confirm('Xóa toàn bộ dữ liệu học?')) {
    ['c_done', 'c_ans', 'c_wrong', 'c_day'].forEach(k => localStorage.removeItem(k));
    location.reload();
  }
}

window.renderDays = renderDays;
window.sel = sel;
window.show = show;
window.complete = complete;
window.renderQuiz = renderQuiz;
window.renderQ = renderQ;
window.ans = ans;
window.nextQ = nextQ;
window.startExam = startExam;
window.timer = timer;
window.renderExam = renderExam;
window.ea = ea;
window.nextExam = nextExam;
window.finishExam = finishExam;
window.renderReview = renderReview;
window.clearWrong = clearWrong;
window.streak = streak;
window.stats = stats;
window.renderStats = renderStats;
window.exportData = exportData;
window.resetData = resetData;

renderDays();
renderStudy();
renderQuiz();
stats();
show('study');
