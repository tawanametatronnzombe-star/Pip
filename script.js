(() => {
  'use strict';

  // Public, keyless, OpenAI-compatible streaming endpoint.
  const ENDPOINT = 'https://text.pollinations.ai/openai';
  const MODEL = 'openai';
  const SYSTEM = 'You are Pip, a warm, gentle and playful chat friend. Use simple, clear words and short paragraphs. Be kind and encouraging. Never use emojis or emoticons. Be accurate when giving facts or instructions.';
  const MAX_HISTORY = 16;
  const IDLE_TIMEOUT = 30000;

  const $ = (s) => document.querySelector(s);
  const feed = $('#feed'), form = $('#composer'), input = $('#input');
  const sendBtn = $('#send'), stopBtn = $('#stop'), newBtn = $('#new');
  const welcome = $('#welcome'), status = $('#status');
  const logos = [$('#logo')];

  const big = $('#bigLogo');
  const bigLogo = $('#logo').cloneNode(true);
  bigLogo.removeAttribute('id');
  big.appendChild(bigLogo);
  logos.push(bigLogo);

  let history = [], controller = null, busy = false, userStopped = false, stick = true, moodTimer = null;

  const EMOJI = /[\p{Extended_Pictographic}\u200d\ufe0f\u20e3]/gu;
  const ADS = /\n*(?:-{3,}\s*\n)?\**\s*(?:Powered by|Support) Pollinations[\s\S]*$/i;
  const clean = (t) => t.replace(ADS, '').replace(EMOJI, '');

  const MESSAGES = {
    offline: 'It looks like your connection is taking a break. Check your internet, and we will try again together.',
    busy: 'Pip has been chatting a lot and needs a short rest. Please wait a moment, then try again.',
    server: 'Pip is tidying up some pages behind the scenes. Give it a moment, then try again.',
    silent: 'Pip got a little shy and did not say anything. Let us try that message once more.',
    generic: 'Oops! The internet took a little nap. Let us try sending that message again.'
  };

  function setMood(mood, label) {
    clearTimeout(moodTimer);
    logos.forEach((l) => (l.dataset.mood = mood));
    status.textContent = label;
    if (mood === 'error') moodTimer = setTimeout(() => setMood('idle', 'Ready to chat'), 5000);
  }

  function scrollDown(force) {
    if (force || stick) feed.scrollTop = feed.scrollHeight;
  }
  feed.addEventListener('scroll', () => {
    stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90;
  }, { passive: true });

  function addRow(role, text) {
    const row = document.createElement('div');
    row.className = 'row ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    feed.appendChild(row);
    return { row, bubble };
  }

  function addDots(bubble) {
    bubble.innerHTML = '<span class="dots" aria-label="Pip is thinking"><i></i><i></i><i></i></span>';
  }

  function showNote(message) {
    const note = document.createElement('div');
    note.className = 'note';
    note.setAttribute('role', 'alert');
    const p = document.createElement('span');
    p.textContent = message;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Try again';
    b.addEventListener('click', () => { note.remove(); ask(); });
    note.append(p, b);
    feed.appendChild(note);
    scrollDown(true);
  }

  function setBusy(on) {
    busy = on;
    sendBtn.hidden = on;
    stopBtn.hidden = !on;
    input.disabled = false;
  }

  function errorFor(err) {
    if (!navigator.onLine) return MESSAGES.offline;
    if (err && err.silent) return MESSAGES.silent;
    const s = err && err.status;
    if (s === 429 || s === 402) return MESSAGES.busy;
    if (s >= 500) return MESSAGES.server;
    return MESSAGES.generic;
  }

  async function ask() {
    setBusy(true);
    userStopped = false;
    setMood('thinking', 'Pip is thinking');
    const { row, bubble } = addRow('bot', '');
    addDots(bubble);
    scrollDown(true);

    controller = new AbortController();
    let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT); };
    let full = '';
    let started = false;

    try {
      arm();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          messages: [{ role: 'system', content: SYSTEM }, ...history.slice(-MAX_HISTORY)]
        }),
        signal: controller.signal
      });
      if (!res.ok || !res.body) throw { status: res.status };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch (e) { continue; }
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && delta.content) {
            full += delta.content;
            const shown = clean(full);
            if (shown.trim()) {
              if (!started) { started = true; setMood('idle', 'Pip is writing'); }
              bubble.textContent = shown;
              scrollDown();
            }
          }
        }
      }

      const finalText = clean(full).trim();
      if (!finalText) throw { silent: true };
      bubble.textContent = finalText;
      history.push({ role: 'assistant', content: finalText });
      setMood('idle', 'Ready to chat');
    } catch (err) {
      const partial = clean(full).trim();
      if (userStopped) {
        if (partial) {
          bubble.textContent = partial;
          history.push({ role: 'assistant', content: partial });
        } else {
          row.remove();
        }
        setMood('idle', 'Ready to chat');
      } else {
        row.remove();
        setMood('error', 'Pip needs a moment');
        showNote(errorFor(err));
      }
    } finally {
      clearTimeout(timer);
      controller = null;
      setBusy(false);
      scrollDown();
    }
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    welcome.hidden = true;
    feed.querySelectorAll('.note').forEach((n) => n.remove());
    history.push({ role: 'user', content: text });
    addRow('user', text);
    input.value = '';
    resize();
    stick = true;
    ask();
  }

  function resize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches) {
      e.preventDefault();
      send(input.value);
    }
  });
  [sendBtn, stopBtn].forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  stopBtn.addEventListener('click', () => { userStopped = true; if (controller) controller.abort(); });

  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => send(c.dataset.text)));

  newBtn.addEventListener('click', () => {
    if (controller) { userStopped = true; controller.abort(); }
    history = [];
    feed.querySelectorAll('.row, .note').forEach((n) => n.remove());
    welcome.hidden = false;
    setMood('idle', 'Ready to chat');
    input.focus({ preventScroll: true });
  });

  // Keep the composer visible when the phone keyboard opens.
  const app = $('#app');
  function fit() {
    const vv = window.visualViewport;
    if (!vv) return;
    app.style.setProperty('--app-h', vv.height + 'px');
    window.scrollTo(0, 0);
    scrollDown();
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fit);
    visualViewport.addEventListener('scroll', fit);
    fit();
  }
})();
