// ── App Shell Hook ──
// Locate showApp() in admin.html and add the following call at the bottom:
// initAIAssistant();

// ── core widget code ──
// Append this function at the bottom of the script block in admin.html:

export function initAIAssistant(ctx = {}) {
  const {
    db, el, toast, t, labeled,
    openKind, logsView, go, usersView, departmentsView, communicationsView,
    homeView, state, groupView, checklistEdit,
  } = ctx;
  if (!db || !el || !toast || !t || !labeled || !go || !state || !checklistEdit) {
    console.warn('HMS AI Assistant skipped: missing integration context.');
    return;
  }
  if (document.getElementById('ai-assistant-root')) return;

  const root = el('div', { id: 'ai-assistant-root' });
  const fab = el('button', { class: 'ai-assistant-fab', title: 'HMS AI Assistant', onclick: togglePanel }, '✦');
  
  const panel = el('div', { class: 'ai-assistant-panel hidden' });
  
  const settingsBtn = el('button', { class: 'iconbtn', title: 'Settings', onclick: toggleSettings }, '⚙');
  const closeBtn = el('button', { class: 'iconbtn', title: 'Close', onclick: togglePanel }, '×');
  const header = el('div', { class: 'ai-assistant-header' }, [
    el('h3', {}, [el('span', {}, '✦'), document.createTextNode(' HMS AI Assistant')]),
    el('div', { class: 'actions' }, [settingsBtn, closeBtn])
  ]);
  
  const msgArea = el('div', { class: 'ai-assistant-messages' });
  
  const suggestions = el('div', { class: 'ai-assistant-suggest' });
  const chips = [
    { label: 'Kitchen sanitation checklist', prompt: 'Create checklist for kitchen cleaning' },
    { label: 'Fire safety checklist', prompt: 'Create checklist for fire safety' },
    { label: 'Go to Incident Reports', prompt: 'go to incident reports' },
    { label: 'Go to Accounts', prompt: 'go to accounts' }
  ];
  chips.forEach(c => {
    suggestions.append(el('button', { class: 'ai-suggest-chip', onclick: () => {
      inp.value = c.prompt;
      inp.focus();
    } }, c.label));
  });
  
  const inp = el('input', { type: 'text', placeholder: 'Ask AI or navigate...' });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });
  const sendBtn = el('button', { class: 'btn btn-primary', onclick: sendMessage }, 'Send');
  const inputRow = el('div', { class: 'ai-assistant-input-row' }, [inp, sendBtn]);
  
  panel.append(header, msgArea, suggestions, inputRow);
  
  const settingsOverlay = el('div', { class: 'ai-settings-overlay hidden' });
  const keyInput = el('input', { type: 'password', placeholder: 'Enter Gemini API Key...', value: localStorage.getItem('hms_gemini_key') || '' });
  const useEdgeCheck = el('input', { type: 'checkbox' });
  useEdgeCheck.checked = localStorage.getItem('hms_use_edge_function') !== 'false';
  
  const settingsCard = el('div', { class: 'ai-settings-card' }, [
    el('h4', {}, 'AI Assistant Settings'),
    labeled('Gemini API Key (Local fallback)', keyInput),
    el('label', { style: 'display:flex;flex-direction:row;align-items:center;gap:8px;font-size:0.84rem;margin:4px 0' }, [
      useEdgeCheck,
      el('span', {}, 'Use secure Supabase Edge Function')
    ]),
    el('div', { class: 'ai-settings-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: toggleSettings }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: saveSettings }, 'Save')
    ])
  ]);
  settingsOverlay.append(settingsCard);
  panel.append(settingsOverlay);
  
  root.append(fab, panel);
  document.body.append(root);
  
  appendMessage('assistant', 'Hello! I am your HMS Assistant. Ask me to generate a checklist (e.g. "Create checklist for fire drill") or navigate around (e.g. "go to reports").');
  
  function togglePanel() {
    panel.classList.toggle('hidden');
    const isOpen = !panel.classList.contains('hidden');
    root.classList.toggle('ai-panel-open', isOpen);
    if (isOpen) {
      inp.focus();
    }
  }
  
  function toggleSettings() {
    settingsOverlay.classList.toggle('hidden');
  }
  
  function saveSettings() {
    localStorage.setItem('hms_gemini_key', keyInput.value.trim());
    localStorage.setItem('hms_use_edge_function', useEdgeCheck.checked ? 'true' : 'false');
    toast(t('saved'));
    toggleSettings();
  }
  
  function appendMessage(sender, text, extraEl = null) {
    const bubble = el('div', { class: `ai-msg ${sender}` }, text);
    if (extraEl) bubble.append(extraEl);
    msgArea.append(bubble);
    msgArea.scrollTop = msgArea.scrollHeight;
  }
  
  async function sendMessage() {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    
    appendMessage('user', text);
    
    if (tryNavigation(text)) {
      return;
    }
    
    appendMessage('system', 'Thinking...');
    
    try {
      const data = await generateChecklist(text);
      const systemMsgs = msgArea.querySelectorAll('.ai-msg.system');
      if (systemMsgs.length) systemMsgs[systemMsgs.length - 1].remove();
      
      if (data.response) {
        appendMessage('assistant', data.response);
      }
      
      if (data.checklist) {
        const card = createChecklistCard(data.checklist);
        appendMessage('assistant', '', card);
      }
    } catch (err) {
      const systemMsgs = msgArea.querySelectorAll('.ai-msg.system');
      if (systemMsgs.length) systemMsgs[systemMsgs.length - 1].remove();
      
      appendMessage('assistant', `Sorry, I encountered an error. Details: ${err.message}`);
    }
  }
  
  function tryNavigation(text) {
    const lower = text.toLowerCase();
    const isNav = lower.includes('go') || lower.includes('show') || lower.includes('open') || lower.includes('take me') || lower.includes('navigate');
    
    if (!isNav) return false;
    
    if (lower.includes('report') || lower.includes('incident')) {
      appendMessage('assistant', 'Redirecting to Incident Reports...');
      setTimeout(() => { togglePanel(); openKind('reports'); }, 800);
      return true;
    }
    if (lower.includes('log') || lower.includes('runs') || lower.includes('checklist log')) {
      appendMessage('assistant', 'Redirecting to Checklist Logs...');
      setTimeout(() => { togglePanel(); go(logsView()); }, 800);
      return true;
    }
    if (lower.includes('procedure')) {
      appendMessage('assistant', 'Redirecting to Procedure Submissions...');
      setTimeout(() => { togglePanel(); openKind('procedures'); }, 800);
      return true;
    }
    if (lower.includes('course') || lower.includes('manage course')) {
      appendMessage('assistant', 'Redirecting to Course Management...');
      setTimeout(() => { togglePanel(); openKind('courses'); }, 800);
      return true;
    }
    if (lower.includes('user') || lower.includes('account') || lower.includes('access')) {
      appendMessage('assistant', 'Redirecting to Accounts & Access...');
      setTimeout(() => { togglePanel(); go(usersView()); }, 800);
      return true;
    }
    if (lower.includes('department')) {
      appendMessage('assistant', 'Redirecting to Departments...');
      setTimeout(() => { togglePanel(); go(departmentsView()); }, 800);
      return true;
    }
    if (lower.includes('communication') || lower.includes('news') || lower.includes('message')) {
      appendMessage('assistant', 'Redirecting to Communications...');
      setTimeout(() => { togglePanel(); go(communicationsView()); }, 800);
      return true;
    }
    if (lower.includes('dashboard') || lower.includes('analytics') || lower.includes('home')) {
      appendMessage('assistant', 'Redirecting to Executive Analytics...');
      setTimeout(() => { togglePanel(); go(homeView(), { reset: true }); }, 800);
      return true;
    }
    
    for (const g of state.groups) {
      if (lower.includes(g.name.toLowerCase())) {
        appendMessage('assistant', `Redirecting to group: ${g.name}...`);
        setTimeout(() => { togglePanel(); go(groupView(g)); }, 800);
        return true;
      }
    }
    
    return false;
  }
  
  async function generateChecklist(prompt) {
    const useEdge = localStorage.getItem('hms_use_edge_function') !== 'false';
    const localKey = localStorage.getItem('hms_gemini_key');
    
    if (useEdge) {
      try {
        const { data, error } = await db.functions.invoke('generate-checklist', { body: { prompt } });
        if (error) throw error;
        return typeof data === 'string' ? JSON.parse(data) : data;
      } catch (e) {
        console.error("Failed to invoke Edge Function:", e);
        const status = e?.context?.status || e?.status;
        if (status && status !== 404 && !localKey) throw e;
      }
    }
    
    if (localKey) {
      const systemInstruction = "You are the HMS Assistant, an AI helper for the Nicosoft HMS Admin Console. Users can chat with you, ask questions, or ask you to create checklists. You must always respond in valid JSON matching this schema: { response: 'Your markdown response message', checklist: null | { title: 'Checklist Title', items: [{ label: 'Item text', type: 'check'|'choice'|'number'|'text', options: [], expectedValues: [], expectedMin, expectedMax, fixOnNo: true }] } }";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${localKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API Error: ${errText}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return JSON.parse(text);
    }
    
    return offlineChecklistGenerator(prompt);
  }
  
  function offlineChecklistGenerator(prompt) {
    const lower = prompt.toLowerCase();
    const isChecklistRequest = lower.includes('checklist') || lower.includes('create') || lower.includes('generate') || lower.includes('make') || lower.includes('kitchen') || lower.includes('clean') || lower.includes('fire') || lower.includes('safe') || lower.includes('audit');
    
    if (!isChecklistRequest) {
      return {
        response: `I'm your HMS Assistant. I can help you generate checklists (e.g. "Create checklist for kitchen cleaning") or navigate the admin console (e.g. "go to accounts"). Since you are currently running in offline / local fallback mode without a configured Gemini key, I'm happy to chat or answer questions. If you want to see a checklist demo, try typing "Create a kitchen sanitation checklist"!`
      };
    }

    if (lower.includes('kitchen') || lower.includes('clean') || lower.includes('mat') || lower.includes('food')) {
      return {
        response: "Here is the Kitchen Sanitation Checklist draft I generated for you:",
        checklist: {
          title: "Kitchen Sanitation Checklist",
          items: [
            { label: "Verify refrigerator temperatures are below 4°C", type: "number", expectedMin: 0, expectedMax: 4 },
            { label: "Sanitize all food preparation surfaces", type: "check" },
            { label: "Check grease traps and clean if full", type: "choice", options: ["Clean", "Needs Action"], expectedValues: ["Clean"], fixOnNo: true },
            { label: "Log the staff hygiene sign-in sheet completion", type: "choice", options: ["Completed", "Pending"], expectedValues: ["Completed"], fixOnNo: true },
            { label: "Empty waste bins and sanitize containers", type: "check" },
            { label: "Write down food disposal notes if any", type: "text" }
          ]
        }
      };
    }
    if (lower.includes('fire') || lower.includes('safe') || lower.includes('nød') || lower.includes('hms')) {
      return {
        response: "Here is the Fire Safety Inspection Checklist draft I generated for you:",
        checklist: {
          title: "Fire Safety Inspection",
          items: [
            { label: "Verify all fire exits are completely clear of obstructions", type: "check" },
            { label: "Inspect fire extinguishers pressure gauge levels", type: "choice", options: ["Green Zone", "Recharge Needed"], expectedValues: ["Green Zone"], fixOnNo: true },
            { label: "Confirm emergency exit signs are fully illuminated", type: "check" },
            { label: "Test smoke detector battery alarm sound", type: "choice", options: ["Passed", "Failed"], expectedValues: ["Passed"], fixOnNo: true },
            { label: "Log pressure reading of fire main valve (PSI)", type: "number", expectedMin: 50, expectedMax: 120 }
          ]
        }
      };
    }
    return {
      response: "Here is the Daily Operational Audit Checklist draft I generated for you:",
      checklist: {
        title: "Daily Operational Audit",
        items: [
          { label: "Check entry doors locks and alarm system arming", type: "choice", options: ["OK", "Faulty"], expectedValues: ["OK"], fixOnNo: true },
          { label: "Verify all public area lights are functional", type: "check" },
          { label: "Check heating / air conditioning ambient temperature (°C)", type: "number", expectedMin: 18, expectedMax: 24 },
          { label: "Confirm first aid kit is fully stocked", type: "choice", options: ["Yes", "No"], expectedValues: ["Yes"], fixOnNo: true }
        ]
      }
    };
  }
  
  function createChecklistCard(data) {
    const card = el('div', { class: 'ai-checklist-card' });
    card.append(el('div', { class: 'ai-checklist-title' }, data.title || 'Generated Checklist'));
    
    const list = el('div', { class: 'ai-checklist-items-list' });
    const items = data.items || [];
    items.forEach(it => {
      list.append(el('div', { class: 'ai-checklist-item' }, [
        el('span', {}, it.label),
        el('span', { class: 'ai-checklist-item-type' }, it.type)
      ]));
    });
    card.append(list);
    
    const applyBtn = el('button', { class: 'btn btn-primary btn-block', onclick: () => applyChecklist(data) }, 'Create Checklist');
    card.append(applyBtn);
    return card;
  }
  
  function applyChecklist(data) {
    const targetGroup = state.groups.find(g => g.kind === 'checklist') || state.groups[0];
    if (!targetGroup) {
      toast("No groups found to put the checklist in.", "err");
      return;
    }
    
    const formattedItems = (data.items || []).map(it => {
      const id = crypto.randomUUID();
      const type = it.type || 'check';
      const options = it.options || [];
      const fixOnNo = it.fixOnNo ?? (options.some(o => ['no', 'nei'].includes(String(o).toLowerCase().trim())));
      
      let expected = null;
      if (type === 'number' && (it.expectedMin != null || it.expectedMax != null)) {
        expected = { min: it.expectedMin, max: it.expectedMax };
      } else if ((type === 'choice' || type === 'text') && it.expectedValues?.length) {
        expected = { values: it.expectedValues };
      }
      
      return {
        id,
        label: it.label,
        type,
        options,
        expected,
        fixOnNo,
        image: null
      };
    });
    
    togglePanel();
    go(checklistEdit(targetGroup, { title: data.title || "AI Generated Checklist", items: formattedItems }));
    toast("Checklist draft pre-populated!", "ok");
  }
}
