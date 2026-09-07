// Minimal Node server retained for local/private deployments that need a proxy.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

// Load local configuration before reading server settings.
loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Reads a simple .env file without adding an external dependency.
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

// Sends a JSON response with the correct content type.
function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

// Defines the structured output expected from Gemini.
function questionSchema() {
  return {
    type: 'OBJECT',
    properties: {
      questions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            q: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' } },
            correct: { type: 'INTEGER' },
            explanation: { type: 'STRING' },
            topic: { type: 'STRING' },
            domain: { type: 'INTEGER' },
            day: { type: 'INTEGER' }
          },
          required: ['q', 'options', 'correct', 'explanation', 'topic', 'domain', 'day']
        }
      }
    },
    required: ['questions']
  };
}

// Builds the prompt used by the server-side Gemini proxy.
function buildPrompt(count, domain, day) {
  const scope = day
    ? `Focus on CISSP study day ${day}.`
    : domain
      ? `Focus on CISSP domain ${domain}.`
      : 'Cover the CISSP domains broadly.';

  return `Generate exactly ${count} original, difficult CISSP practice questions. ${scope}
Avoid repeated wording, memorization-only questions, and duplicate scenarios.
Use four plausible options with exactly one best answer.
The correct field is a zero-based option index. Explanations must explain the CISSP reasoning.
Return only JSON matching the supplied schema.`;
}

// Rejects malformed questions and removes duplicate question text.
function validateQuestions(payload, requestedCount) {
  if (!payload || !Array.isArray(payload.questions)) {
    throw new Error('Gemini response did not contain a questions array.');
  }

  const questions = payload.questions.filter((question) => (
    question &&
    typeof question.q === 'string' &&
    typeof question.topic === 'string' &&
    Number.isInteger(question.domain) &&
    Number.isInteger(question.day) &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every(option => typeof option === 'string' && option.trim()) &&
    Number.isInteger(question.correct) &&
    question.correct >= 0 &&
    question.correct < 4 &&
    typeof question.explanation === 'string'
  ));

  const seen = new Set();
  const unique = questions.filter((question) => {
    const key = question.q.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length < Math.min(requestedCount, 1)) {
    throw new Error('Gemini returned invalid or duplicate questions.');
  }

  return { questions: unique.slice(0, requestedCount) };
}

// Calls Gemini using the server-only GEMINI_API_KEY.
async function generateQuestions(url) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured on the server.');

  const count = Math.min(Math.max(Number(url.searchParams.get('count') || 5), 1), 100);
  const domain = Number(url.searchParams.get('domain') || 0);
  const day = Number(url.searchParams.get('day') || 0);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(count, domain, day) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: questionSchema(),
        temperature: 0.8
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini request failed (${response.status}).`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return validateQuestions(JSON.parse(text), count);
}

// Serves the static GitHub Pages files during local Node development.
function serveStatic(request, response) {
  const requested = new URL(request.url, `http://${request.headers.host}`).pathname;
  const file = requested === '/' ? '/index.html' : requested;
  const filePath = path.resolve(ROOT, `.${file}`);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  response.writeHead(200, { 'content-type': types[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

// Routes API requests separately from static assets.
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/api/questions') {
    try {
      json(response, 200, await generateQuestions(url));
    } catch (error) {
      json(response, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (request.method === 'GET') return serveStatic(request, response);
  json(response, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => {
  console.log(`CISSP Daily Coach running at http://localhost:${PORT}`);
});
