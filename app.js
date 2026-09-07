// Maps numeric CISSP domains to the labels shown in the analytics view.
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

// Reads a JSON value from localStorage and safely falls back to an empty list.
const G = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Persists application state as JSON in the browser.
const S = (key, value) => localStorage.setItem(key, JSON.stringify(value));

// Restores the last selected study day, defaulting to day one for new users.
function getSavedDay() {
  const raw = localStorage.getItem('c_day');
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Runtime state for the selected day, daily quiz, and exam session.
let day = getSavedDay();
let qstate = {};
let exam = null;
let questionsReady = false;
let questionLoadError = '';

// Retrieves the user-provided Gemini key from this browser only.
function getGeminiKey() {
  return localStorage.getItem('gemini_api_key') || '';
}

// Saves or removes the Gemini key entered in the header form.
function saveGeminiKey() {
  const key = document.getElementById('geminiKey').value.trim();
  if (!key) {
    localStorage.removeItem('gemini_api_key');
    alert('Đã xóa Gemini API key khỏi trình duyệt.');
    return;
  }
  localStorage.setItem('gemini_api_key', key);
  alert('Đã lưu Gemini API key trên trình duyệt này.');
}

// Calls Gemini directly from the GitHub Pages client and normalizes its response.
async function fetchGeminiQuestions({ count, domain = 0, dayNumber = 0 }) {
  const key = getGeminiKey();
  if (!key) throw new Error('Hãy nhập và lưu Gemini API key trước.');

  // Restrict the generated questions to the selected study scope.
  const scope = dayNumber
    ? `Focus on CISSP study day ${dayNumber}.`
    : domain
      ? `Focus on CISSP domain ${domain}.`
      : 'Cover CISSP domains broadly.';
  // Request JSON so the client can render questions without extra parsing rules.
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Generate exactly ${count} high-difficulty, original CISSP practice questions. ${scope}
Use complex workplace scenarios requiring risk prioritization, governance, architecture trade-offs, business context, and the CISSP "BEST/MOST appropriate" mindset.
Make the distractors technically plausible and close to the correct answer, but ensure only one option is clearly best for the stated context.
Avoid recall-only questions, obvious options, duplicate wording, and repeated scenarios. Each question must have exactly four plausible options and one best answer.
Return only valid JSON with this shape:
{"questions":[{"q":"...","options":["...","...","...","..."],"correct":0,"explanation":"...","topic":"...","domain":${domain || 0},"day":${dayNumber || 0}}]}
The correct field is a zero-based option index.`
          }]
        }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 }
      })
    }
  );

  // Convert Gemini HTTP failures into a readable message for the user.
  if (!response.ok) {
    let message = `Gemini request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the HTTP status when Gemini does not return JSON.
    }
    throw new Error(message);
  }

  // Extract the model's structured response from the Gemini envelope.
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no questions.');
  }

  // Parse the model output and reject malformed responses explicitly.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned invalid JSON. Please try again.');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error('Gemini returned no questions.');
  }
  return uniqueQuestions(parsed.questions);
}

// Renders a consistent error panel when Gemini cannot provide a question set.
function showQuestionError(container, error) {
  questionLoadError = error instanceof Error ? error.message : String(error);
  container.innerHTML = `
    <div class="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-rose-200">
      <b>Không tải được câu hỏi từ Gemini.</b>
      <div class="mt-2 text-sm">${questionLoadError}</div>
      <div class="mt-2 text-xs text-slate-300">Hãy nhập Gemini API key ở phía trên rồi thử lại.</div>
    </div>
  `;
}

// Returns the metadata for the currently selected day.
function cur() {
  return DAYS.find(x => x.day === day) || DAYS[0];
}

// Fisher-Yates shuffle used to make answer positions unpredictable.
function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Creates a shuffled display copy while preserving the original correct index.
function buildDisplayQuestion(question) {
  const originalIndices = question.options.map((_, idx) => idx);
  const order = shuffle(originalIndices);
  return {
    order,
    options: order.map(idx => question.options[idx]),
    correctIndex: order.indexOf(question.correct)
  };
}

// Creates a stable, case-insensitive key for duplicate-question detection.
function normalizeQuestionKey(question) {
  return (question && question.q ? question.q : '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Removes duplicate or empty generated questions before they enter a quiz.
function uniqueQuestions(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = normalizeQuestionKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

// Renders the searchable day list and highlights the active day.
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

// Changes the active study day and refreshes dependent views.
function sel(n) {
  day = n;
  S('c_day', n);
  renderDays();
  renderStudy();
  renderQuiz();
}

// Populates the study panel using static metadata from data.js.
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

// Switches between the five main application views.
function show(n) {
  ['study', 'quiz', 'exam', 'review', 'stats'].forEach(x => {
    document.getElementById(x).classList.toggle('hidden', x !== n);
  });

  if (n === 'quiz') renderQuiz();
  if (n === 'review') renderReview();
  if (n === 'stats') renderStats();
}

// Marks the active study day complete and updates progress metrics.
function complete() {
  const done = G('c_done');
  if (!done.includes(day)) done.push(day);
  S('c_done', done);
  stats();
  renderDays();
  alert('Đã hoàn thành Day ' + day);
}

// Starts a new Gemini-generated five-question daily quiz.
async function renderQuiz() {
  qstate = { i: 0, score: 0, answered: null, shown: null };
  qbox.innerHTML = '<div class="text-slate-400">Đang tạo câu hỏi bằng Gemini...</div>';
  try {
    qstate.questions = await fetchGeminiQuestions({ count: 10, domain: cur().domain, dayNumber: day });
    questionsReady = true;
    renderQ();
  } catch (error) {
    questionsReady = false;
    showQuestionError(qbox, error);
  }
}

// Draws the current daily quiz question and its answer choices.
function renderQ() {
  const qs = qstate.questions || [];

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
  qmeta.textContent = `Q ${qstate.i + 1}/${qs.length} • Score ${qstate.score}`;

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

// Scores a daily answer, stores mistakes, and reveals the explanation.
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

// Advances the daily quiz to the next question.
function nextQ() {
  qstate.i += 1;
  qstate.answered = null;
  renderQ();
}

// Requests a unique Gemini-generated exam and starts its timer.
async function startExam() {
  const n = +ec.value;
  const mins = +em.value;
  const d = +ed.value;
  ebox.classList.remove('hidden');
  ebox.innerHTML = '<div class="text-slate-400">Đang tạo đề thi bằng Gemini...</div>';

  let pool;
  try {
    pool = await fetchGeminiQuestions({ count: n, domain: d });
  } catch (error) {
    showQuestionError(ebox, error);
    return;
  }

  exam = {
    qs: pool.slice(0, Math.min(n, pool.length)),
    i: 0,
    score: 0,
    ans: null,
    end: Date.now() + mins * 60000,
    done: false,
    shown: null,
    timer: null
  };

  exam.timer = setInterval(timer, 500);
  renderExam();
}

// Updates the visible exam countdown and ends an expired exam.
function timer() {
  if (!exam) return;

  const left = Math.max(0, exam.end - Date.now());
  const sec = Math.ceil(left / 1000);
  const timerNode = document.getElementById('tm');

  if (timerNode) timerNode.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (sec <= 0) finishExam();
}

// Draws the current timed-exam question.
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

// Scores an exam answer and highlights the correct choice.
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

// Advances the timed exam to its next question.
function nextExam() {
  exam.i += 1;
  exam.ans = null;
  renderExam();
}

// Stops the exam timer and displays the final score.
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

// Displays the user's stored incorrect answers for review.
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

// Clears all stored incorrect answers.
function clearWrong() {
  localStorage.removeItem('c_wrong');
  renderReview();
  stats();
}

// Calculates the consecutive completed-day streak.
function streak() {
  const x = [...new Set(G('c_done'))].sort((a, b) => a - b);
  let s = 0;

  for (let i = x.length - 1; i >= 0; i--) {
    if (x[i] === x[x.length - 1] - s) s++;
    else break;
  }

  return s;
}

// Refreshes the summary cards at the top of the dashboard.
function stats() {
  const done = G('c_done');
  const aa = G('c_ans');
  const ww = G('c_wrong');

  p.textContent = Math.round(done.length / 84 * 100) + '%';
  a.textContent = (aa.length ? Math.round(aa.filter(x => x.correct).length / aa.length * 100) : 0) + '%';
  s.textContent = streak();
  w.textContent = ww.length;
}

// Builds per-domain completion and accuracy progress bars.
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

// Downloads progress and review data as a local JSON backup.
function exportData() {
  const blob = new Blob([
    JSON.stringify({ done: G('c_done'), ans: G('c_ans'), wrong: G('c_wrong') }, null, 2)
  ], { type: 'application/json' });

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cissp-progress.json';
  a.click();
}

// Removes all local progress and reloads the application.
function resetData() {
  if (confirm('Xóa toàn bộ dữ liệu học?')) {
    ['c_done', 'c_ans', 'c_wrong', 'c_day'].forEach(k => localStorage.removeItem(k));
    location.reload();
  }
}

// Exposes handlers required by the inline HTML onclick attributes.
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
window.saveGeminiKey = saveGeminiKey;

renderDays();
renderStudy();
renderQuiz();
stats();
show('study');
document.getElementById('geminiKey').value = getGeminiKey();
