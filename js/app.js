/* ============================================================
   NOVA AI — app logic
   Groq chat (streaming + non-streaming), markdown rendering,
   vision (images), theme palettes, settings, persistence.
   ============================================================ */

(() => {
  'use strict';

  // ---- Built-in demo key (users can override with their own) ----
  const DEMO_KEY = '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';
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

  // ---- Available models ----
  const MODELS = [
    { id: 'llama-3.3-70b-versatile',          label: 'llama-3.3-70b',  note: 'Smartest, similar to gpt 4o.' },
    { id: 'llama-3.1-8b-instant',             label: 'llama-3.1-8b',   note: 'Fastest, self-explanatory' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'llama-4-scout', note: 'Undestands images, analyzes massive amounts of data better' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'llama-4-maverick', note: 'Undestands images, analyzes complex data better.' },
    { id: 'openai/gpt-oss-120b',              label: 'gpt-oss-120b (Chatgpt)',   note: 'Reasoning engine built for speed, code, and agentic workflows.' },
    { id: 'qwen/qwen3-32b',                   label: 'qwen3-32b',      note: 'Balanced, Deep logical reasoning, so creative writing.' },
    { id: 'gemma2-9b-it',                     label: 'gemma2-9b',      note: 'Light, means fast. Good for math.' },
  ];

  const VISION_MODELS = new Set([
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
  ]);

  // ---- Defaults ----
  const DEFAULTS = {
    theme: 'violet',
    model: 'llama-3.3-70b-versatile',
    apiKey: '',
    system: 'You are Nova, a friendly and highly capable AI assistant. Format your answers nicely using Markdown: use headings, bold, lists, tables, and fenced code blocks with language hints when helpful.',
    temperature: 0.7,
    stream: true,
  };

  // ---- State ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nova.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('nova.' + k, JSON.stringify(v)); } catch {} },
  };

  const settings = {
    theme: store.get('theme', DEFAULTS.theme),
    model: store.get('model', DEFAULTS.model),
    apiKey: store.get('apiKey', DEFAULTS.apiKey),
    system: store.get('system', DEFAULTS.system),
    temperature: store.get('temperature', DEFAULTS.temperature),
    stream: store.get('stream', DEFAULTS.stream),
  };

  let messages = [];          // [{role, content}]
  let pendingImages = [];     // [dataURL]
  let isGenerating = false;

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const html = document.documentElement;
  const hero = $('hero');
  const chat = $('chat');
  const input = $('prompt-input');
  const form = $('composer');
  const sendBtn = $('send-btn');
  const attachments = $('attachments');
  const fileInput = $('file-input');

  // ---- Markdown setup ----
  marked.setOptions({ breaks: true, gfm: true });

  function renderMarkdown(text) {
    const raw = marked.parse(text || '');
    const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
    const wrap = document.createElement('div');
    wrap.innerHTML = clean;
    // Highlight + add code headers
    wrap.querySelectorAll('pre code').forEach((code) => {
      try { hljs.highlightElement(code); } catch {}
      const pre = code.parentElement;
      if (pre.querySelector('.code-head')) return;
      const lang = (code.className.match(/language-(\w+)/) || [, 'text'])[1];
      const head = document.createElement('div');
      head.className = 'code-head';
      head.innerHTML = `<span class="code-lang">${lang}</span><button class="code-copy" type="button"><i class="fa-regular fa-copy"></i> copy</button>`;
      head.querySelector('.code-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(code.innerText);
        toast('Copied to clipboard');
      });
      pre.prepend(head);
    });
    wrap.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
    return wrap.innerHTML;
  }

  // ---- Toast ----
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 300); }, 2400);
  }

  /* ============ THEME ============ */
  function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    settings.theme = theme; store.set('theme', theme);
    document.querySelectorAll('.dot').forEach((d) => d.classList.toggle('active', d.dataset.theme === theme));
  }
  document.querySelectorAll('.dot').forEach((dot) => {
    dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
  });

  /* ============ MODEL MENU ============ */
  const modelSelect = $('model-select');
  const modelMenu = $('model-menu');
  const modelLabel = $('model-label');

  function buildModelMenu() {
    modelMenu.innerHTML = '';
    MODELS.forEach((m) => {
      const li = document.createElement('li');
      li.dataset.id = m.id;
      li.className = m.id === settings.model ? 'sel' : '';
      li.innerHTML = `<span>${m.label}</span><small>${m.note}</small>`;
      li.addEventListener('click', () => {
        settings.model = m.id; store.set('model', m.id);
        modelLabel.textContent = m.label;
        modelSelect.classList.remove('open');
        modelMenu.querySelectorAll('li').forEach((x) => x.classList.toggle('sel', x.dataset.id === m.id));
      });
      modelMenu.appendChild(li);
    });
    const cur = MODELS.find((m) => m.id === settings.model);
    modelLabel.textContent = cur ? cur.label : settings.model;
  }
  $('model-pill').addEventListener('click', (e) => {
    e.stopPropagation();
    modelSelect.classList.toggle('open');
    $('model-pill').setAttribute('aria-expanded', modelSelect.classList.contains('open'));
  });
  document.addEventListener('click', () => modelSelect.classList.remove('open'));

  /* ============ CHIPS ============ */
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.prompt;
      autoGrow();
      sendMessage();
    });
  });

  /* ============ INPUT BEHAVIOR ============ */
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  }
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Paste images
  input.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) { addImageFile(item.getAsFile()); }
    }
  });

  /* ============ ATTACHMENTS ============ */
  $('attach-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    [...e.target.files].forEach(addImageFile);
    fileInput.value = '';
  });

  function addImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = reader.result;
      pendingImages.push(dataURL);
      renderAttachments();
      if (!VISION_MODELS.has(settings.model)) {
        toast('Tip: switch to a Vision model (llama-4) to read images.');
      }
    };
    reader.readAsDataURL(file);
  }
  function renderAttachments() {
    attachments.innerHTML = '';
    pendingImages.forEach((url, i) => {
      const div = document.createElement('div');
      div.className = 'attach-thumb';
      div.innerHTML = `<img src="${url}" alt="attachment"><button type="button" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button>`;
      div.querySelector('button').addEventListener('click', () => { pendingImages.splice(i, 1); renderAttachments(); });
      attachments.appendChild(div);
    });
  }

  /* ============ CHAT RENDERING ============ */
  function showChat() {
    hero.classList.add('hidden');
    chat.classList.add('active');
  }

  function addMessageEl(role, contentHTML, images) {
    const msg = document.createElement('div');
    msg.className = 'msg ' + role;
    const avatar = role === 'ai'
      ? '<i class="fa-solid fa-star"></i>'
      : '<i class="fa-solid fa-user"></i>';
    let imgHTML = '';
    if (images && images.length) {
      imgHTML = '<div class="msg-images">' + images.map((u) => `<img src="${u}" alt="user image">`).join('') + '</div>';
    }
    msg.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="msg-name">${role === 'ai' ? 'Nova' : 'You'}</div>
        <div class="msg-content">${contentHTML}</div>
        ${imgHTML}
      </div>`;
    chat.appendChild(msg);
    scrollToBottom();
    return msg.querySelector('.msg-content');
  }

  function scrollToBottom() {
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  }

  /* ============ SEND ============ */
  async function sendMessage() {
    if (isGenerating) return;
    const text = input.value.trim();
    if (!text && pendingImages.length === 0) return;

    showChat();

    const imgs = [...pendingImages];
    // Render user message
    addMessageEl('user', renderMarkdown(text || '*[image]*'), imgs);

    // Build API content (vision uses array format)
    let apiContent;
    if (imgs.length && VISION_MODELS.has(settings.model)) {
      apiContent = [
        ...(text ? [{ type: 'text', text }] : []),
        ...imgs.map((url) => ({ type: 'image_url', image_url: { url } })),
      ];
    } else {
      apiContent = text || '[Image attached — current model cannot read images]';
    }
    messages.push({ role: 'user', content: apiContent });

    // Reset input
    input.value = ''; autoGrow();
    pendingImages = []; renderAttachments();

    // AI placeholder
    const aiEl = addMessageEl('ai', '<div class="typing"><span></span><span></span><span></span></div>');
    isGenerating = true; sendBtn.disabled = true;

    try {
      const key = (settings.apiKey || DEMO_KEY).trim();
      const apiMessages = [{ role: 'system', content: settings.system }, ...messages];
      const body = {
        model: settings.model,
        messages: apiMessages,
        temperature: Number(settings.temperature),
        stream: settings.stream,
      };

      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Request failed (${res.status})`);
      }

      let full = '';
      if (settings.stream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) { full += delta; aiEl.innerHTML = renderMarkdown(full); scrollToBottom(); }
            } catch {}
          }
        }
      } else {
        const json = await res.json();
        full = json.choices?.[0]?.message?.content || '';
        aiEl.innerHTML = renderMarkdown(full);
      }

      if (!full) full = '*(no response)*';
      aiEl.innerHTML = renderMarkdown(full);
      messages.push({ role: 'assistant', content: full });
      scrollToBottom();
    } catch (e) {
      aiEl.innerHTML = `<div style="color:#e25563"><i class="fa-solid fa-triangle-exclamation"></i> ${e.message}</div>`;
      messages.pop(); // remove the failed user turn so retry is clean
      toast('Error: ' + e.message);
    } finally {
      isGenerating = false; sendBtn.disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });

  /* ============ CLEAR CHAT ============ */
  $('clear-chat').addEventListener('click', () => {
    if (isGenerating) return;
    messages = [];
    chat.innerHTML = '';
    chat.classList.remove('active');
    hero.classList.remove('hidden');
    toast('Conversation cleared');
  });

  /* ============ SETTINGS MODAL ============ */
  const modal = $('settings-modal');
  function openSettings() {
    $('api-key-input').value = settings.apiKey;
    $('system-prompt').value = settings.system;
    $('temperature').value = settings.temperature;
    $('temp-value').textContent = settings.temperature;
    $('stream-toggle').checked = settings.stream;
    modal.hidden = false;
  }
  function closeSettings() { modal.hidden = true; }

  $('settings-btn').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

  $('temperature').addEventListener('input', (e) => { $('temp-value').textContent = e.target.value; });
  $('toggle-key').addEventListener('click', () => {
    const inp = $('api-key-input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('toggle-key').innerHTML = show ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  });

  $('save-settings').addEventListener('click', () => {
    settings.apiKey = $('api-key-input').value.trim();
    settings.system = $('system-prompt').value.trim() || DEFAULTS.system;
    settings.temperature = parseFloat($('temperature').value);
    settings.stream = $('stream-toggle').checked;
    store.set('apiKey', settings.apiKey);
    store.set('system', settings.system);
    store.set('temperature', settings.temperature);
    store.set('stream', settings.stream);
    closeSettings();
    toast('Settings saved');
  });

  $('reset-settings').addEventListener('click', () => {
    Object.assign(settings, { apiKey: '', system: DEFAULTS.system, temperature: DEFAULTS.temperature, stream: DEFAULTS.stream });
    ['apiKey', 'system', 'temperature', 'stream'].forEach((k) => store.set(k, settings[k]));
    openSettings();
    toast('Settings reset');
  });

  /* ============ INIT ============ */
  applyTheme(settings.theme);
  buildModelMenu();
  autoGrow();
  input.focus();
})();
