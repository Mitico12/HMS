// HMS AI Assistant widget.
// Mounted from admin.html via mountAIAssistant(); styles live in styles.css.

export function initAIAssistant(ctx = {}) {
  const {
    db, el, toast, t, labeled,
    openKind, logsView, go, usersView, departmentsView, communicationsView,
    homeView, state, groupView, checklistEdit, procedureBuild,
  } = ctx;
  if (!db || !el || !toast || !t || !labeled || !go || !state || !checklistEdit || !procedureBuild) {
    console.warn('HMS AI Assistant skipped: missing integration context.');
    return;
  }
  if (document.getElementById('ai-assistant-root')) return;

  const root = el('div', { id: 'ai-assistant-root' });
  const fab = el('button', { class: 'ai-assistant-fab', title: 'HMS AI Assistant', onclick: togglePanel }, '✦');

  const panel = el('div', { class: 'ai-assistant-panel hidden' });
  const closeBtn = el('button', { class: 'iconbtn', title: 'Close', onclick: togglePanel }, 'x');
  const header = el('div', { class: 'ai-assistant-header' }, [
    el('h3', {}, [el('span', {}, '✦'), document.createTextNode(' HMS Assistant')]),
    el('div', { class: 'actions' }, [closeBtn])
  ]);

  const msgArea = el('div', { class: 'ai-assistant-messages' });

  const suggestions = el('div', { class: 'ai-assistant-suggest' });
  const chips = [
    { label: 'Kitchen sanitation checklist', prompt: 'Create checklist for kitchen cleaning' },
    { label: 'Chemical spill procedure', prompt: 'Create a chemical spill response procedure' },
    { label: 'Incident form procedure', prompt: 'Create an incident investigation form' },
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

  root.append(fab, panel);
  document.body.append(root);

  appendMessage('assistant', 'Hello! I can generate checklists or procedure forms, and I can help you navigate the admin console.');

  function togglePanel() {
    panel.classList.toggle('hidden');
    const isOpen = !panel.classList.contains('hidden');
    root.classList.toggle('ai-panel-open', isOpen);
    if (isOpen) inp.focus();
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

    if (tryNavigation(text)) return;

    appendMessage('system', 'Thinking...');

    try {
      const data = await generateHmsDraft(text);
      const systemMsgs = msgArea.querySelectorAll('.ai-msg.system');
      if (systemMsgs.length) systemMsgs[systemMsgs.length - 1].remove();

      if (data.response) appendMessage('assistant', data.response);

      if (data.checklist) {
        appendMessage('assistant', '', createChecklistCard(data.checklist));
      }
      if (data.procedure) {
        appendMessage('assistant', '', createProcedureCard(data.procedure));
      }
      if (!data.response && !data.checklist && !data.procedure) {
        appendMessage('assistant', 'I could not build a draft from that prompt. Try asking for a checklist or procedure form.');
      }
    } catch (err) {
      const systemMsgs = msgArea.querySelectorAll('.ai-msg.system');
      if (systemMsgs.length) systemMsgs[systemMsgs.length - 1].remove();

      appendMessage('assistant', `Sorry, I encountered an error. Details: ${err.message}`);
    }
  }

  function tryNavigation(text) {
    const lower = text.toLowerCase();
    const isNav = /\b(go|show|open|navigate)\b/.test(lower) || lower.includes('take me');

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
      appendMessage('assistant', 'Redirecting to Procedures...');
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

  async function generateHmsDraft(prompt) {
    try {
      const { data, error } = await db.functions.invoke('generate-hms-draft', { body: { prompt } });
      if (error) throw error;
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch (e) {
      console.error('Failed to invoke Edge Function:', e);
      const status = e?.context?.status || e?.status;
      if (status && status !== 404 && status !== 500) throw e;
    }

    return offlineDraftGenerator(prompt);
  }

  function offlineDraftGenerator(prompt) {
    const lower = prompt.toLowerCase();
    const isProcedureRequest = lower.includes('procedure') || lower.includes('form') || lower.includes('skjema') || lower.includes('rutine');
    const isChecklistRequest = lower.includes('checklist') || lower.includes('create') || lower.includes('generate') || lower.includes('make') || lower.includes('kitchen') || lower.includes('clean') || lower.includes('fire') || lower.includes('safe') || lower.includes('audit');

    if (isProcedureRequest) {
      if (lower.includes('chemical') || lower.includes('kjemisk') || lower.includes('hazard') || lower.includes('spill')) {
        return {
          response: 'Here is a Chemical Spill Response procedure draft:',
          procedure: {
            title: 'Chemical Spill Response',
            description: 'Procedure to follow in case of chemical spills or hazardous leaks.',
            fields: [
              { label: 'Chemical name / class', type: 'short', required: true },
              { label: 'Approximate volume spilled in liters', type: 'number', expectedMin: 0, expectedMax: 5, required: true },
              { label: 'Spill severity level', type: 'slider', min: 1, max: 5, leftLabel: 'Minor containable spill', rightLabel: 'Evacuation required', expectedMin: 1, expectedMax: 3, required: true },
              { label: 'Immediate actions taken', type: 'checkboxes', options: ['Area cordoned off', 'Ventilation active', 'Spill kit applied', 'Emergency service called'], expectedValues: ['Area cordoned off', 'Spill kit applied'], required: true },
              { label: 'Were there any injuries?', type: 'checkbox', expectedChecked: false, required: true },
              { label: 'Detailed spill and cleanup notes', type: 'long', required: false }
            ]
          }
        };
      }
      return {
        response: 'Here is an Incident Investigation procedure draft:',
        procedure: {
          title: 'Incident Investigation Procedure',
          description: 'Required fields to document workplace safety incidents.',
          fields: [
            { label: 'Type of incident', type: 'dropdown', options: ['Injury', 'Near miss', 'Property damage', 'Environmental'], expectedValues: ['Near miss'], required: true },
            { label: 'Incident date and time', type: 'short', required: true },
            { label: 'Brief description of the event', type: 'long', required: true },
            { label: 'Number of affected individuals', type: 'number', expectedMin: 0, expectedMax: 0, required: false },
            { label: 'Consequence rating', type: 'slider', min: 1, max: 5, leftLabel: 'Insignificant', rightLabel: 'Catastrophic', expectedMin: 1, expectedMax: 2, required: true }
          ]
        }
      };
    }

    if (!isChecklistRequest) {
      return {
        response: 'I can generate checklists or procedure forms, or navigate the admin console. The secure AI service is currently unavailable, so I am using offline demo mode.'
      };
    }

    if (lower.includes('kitchen') || lower.includes('clean') || lower.includes('mat') || lower.includes('food')) {
      return {
        response: 'Here is the Kitchen Sanitation Checklist draft:',
        checklist: {
          title: 'Kitchen Sanitation Checklist',
          items: [
            { label: 'Verify refrigerator temperatures are below 4 C', type: 'number', expectedMin: 0, expectedMax: 4 },
            { label: 'Sanitize all food preparation surfaces', type: 'check' },
            { label: 'Check grease traps and clean if full', type: 'choice', options: ['Clean', 'Needs action'], expectedValues: ['Clean'], fixOnNo: true },
            { label: 'Log the staff hygiene sign-in sheet completion', type: 'choice', options: ['Completed', 'Pending'], expectedValues: ['Completed'], fixOnNo: true },
            { label: 'Empty waste bins and sanitize containers', type: 'check' },
            { label: 'Write down food disposal notes if any', type: 'text' }
          ]
        }
      };
    }
    if (lower.includes('fire') || lower.includes('safe') || lower.includes('nod') || lower.includes('hms')) {
      return {
        response: 'Here is the Fire Safety Inspection Checklist draft:',
        checklist: {
          title: 'Fire Safety Inspection',
          items: [
            { label: 'Verify all fire exits are completely clear of obstructions', type: 'check' },
            { label: 'Inspect fire extinguisher pressure gauge levels', type: 'choice', options: ['Green zone', 'Recharge needed'], expectedValues: ['Green zone'], fixOnNo: true },
            { label: 'Confirm emergency exit signs are fully illuminated', type: 'check' },
            { label: 'Test smoke detector battery alarm sound', type: 'choice', options: ['Passed', 'Failed'], expectedValues: ['Passed'], fixOnNo: true },
            { label: 'Log pressure reading of fire main valve in PSI', type: 'number', expectedMin: 50, expectedMax: 120 }
          ]
        }
      };
    }
    return {
      response: 'Here is the Daily Operational Audit Checklist draft:',
      checklist: {
        title: 'Daily Operational Audit',
        items: [
          { label: 'Check entry door locks and alarm system arming', type: 'choice', options: ['OK', 'Faulty'], expectedValues: ['OK'], fixOnNo: true },
          { label: 'Verify all public area lights are functional', type: 'check' },
          { label: 'Check heating / air conditioning ambient temperature in C', type: 'number', expectedMin: 18, expectedMax: 24 },
          { label: 'Confirm first aid kit is fully stocked', type: 'choice', options: ['Yes', 'No'], expectedValues: ['Yes'], fixOnNo: true }
        ]
      }
    };
  }

  function createChecklistCard(data) {
    const card = el('div', { class: 'ai-checklist-card' });
    card.append(el('div', { class: 'ai-checklist-title' }, data.title || 'Generated Checklist'));

    const list = el('div', { class: 'ai-checklist-items-list' });
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach(it => {
      list.append(el('div', { class: 'ai-checklist-item' }, [
        el('span', {}, it.label || 'Untitled item'),
        el('span', { class: 'ai-checklist-item-type' }, it.type || 'check')
      ]));
    });
    card.append(list);

    card.append(el('button', { class: 'btn btn-primary btn-block', onclick: () => applyChecklist(data) }, 'Create Checklist'));
    return card;
  }

  function createProcedureCard(data) {
    const card = el('div', { class: 'ai-checklist-card' });
    card.append(el('div', { class: 'ai-checklist-title' }, data.title || 'Generated Procedure'));

    if (data.description) {
      card.append(el('p', { class: 'muted', style: 'margin:6px 0 10px' }, data.description));
    }

    const list = el('div', { class: 'ai-checklist-items-list' });
    const fields = Array.isArray(data.fields) ? data.fields : [];
    fields.forEach(f => {
      list.append(el('div', { class: 'ai-checklist-item' }, [
        el('span', {}, (f.label || 'Untitled field') + (f.required ? ' *' : '')),
        el('span', { class: 'ai-checklist-item-type' }, procedureTypeLabel(f))
      ]));
    });
    card.append(list);

    card.append(el('button', { class: 'btn btn-primary btn-block', onclick: () => applyProcedure(data) }, 'Create Procedure'));
    return card;
  }

  function applyChecklist(data) {
    const targetGroup = state.groups.find(g => g.kind === 'checklist' && g.id);
    if (!targetGroup?.id) {
      toast('No checklist group found. Create a checklist group first.', 'err');
      return;
    }

    const formattedItems = sanitizeChecklistItems(data.items);
    if (!formattedItems.length) {
      toast('The generated checklist had no usable items.', 'err');
      return;
    }

    togglePanel();
    go(checklistEdit(targetGroup, null, { title: data.title || 'AI Generated Checklist', items: formattedItems }));
    toast('Checklist draft pre-populated!', 'ok');
  }

  function applyProcedure(data) {
    const targetGroup = state.groups.find(g => g.kind === 'procedures' && g.id);
    if (!targetGroup?.id) {
      toast('No procedure group found. Create a procedure group first.', 'err');
      return;
    }

    const formattedFields = sanitizeProcedureFields(data.fields);
    if (!formattedFields.length) {
      toast('The generated procedure had no usable fields.', 'err');
      return;
    }

    togglePanel();
    go(procedureBuild(targetGroup, null, {
      title: data.title || 'AI Generated Procedure',
      description: data.description || '',
      fields: formattedFields
    }));
    toast('Procedure draft pre-populated!', 'ok');
  }

  function sanitizeChecklistItems(items = []) {
    const allowedTypes = new Set(['check', 'choice', 'number', 'text']);
    return (Array.isArray(items) ? items : [])
      .map(it => {
        const label = String(it?.label || '').trim();
        if (!label) return null;
        const type = allowedTypes.has(it.type) ? it.type : 'check';
        const options = Array.isArray(it.options) ? it.options.map(o => String(o).trim()).filter(Boolean) : [];
        const fixOnNo = it.fixOnNo ?? options.some(o => ['no', 'nei'].includes(o.toLowerCase()));
        let expected = null;
        if (type === 'number' && (it.expectedMin != null || it.expectedMax != null)) {
          expected = {};
          if (it.expectedMin != null && !Number.isNaN(Number(it.expectedMin))) expected.min = Number(it.expectedMin);
          if (it.expectedMax != null && !Number.isNaN(Number(it.expectedMax))) expected.max = Number(it.expectedMax);
        } else if ((type === 'choice' || type === 'text') && Array.isArray(it.expectedValues) && it.expectedValues.length) {
          expected = { values: it.expectedValues.map(v => String(v).trim()).filter(Boolean) };
        }
        return { id: crypto.randomUUID(), label, type, options, expected, fixOnNo, image: null };
      })
      .filter(Boolean);
  }

  function sanitizeProcedureFields(fields = []) {
    const allowedTypes = new Set(['short', 'long', 'number', 'dropdown', 'checkbox', 'checkboxes', 'slider']);
    return (Array.isArray(fields) ? fields : [])
      .map(f => {
        const label = String(f?.label || '').trim();
        if (!label) return null;
        const type = allowedTypes.has(f.type) ? f.type : 'short';
        const field = {
          key: f.key || crypto.randomUUID(),
          type,
          label,
          required: !!f.required,
          options: [],
        };
        if (type === 'dropdown' || type === 'checkboxes') {
          field.options = Array.isArray(f.options) ? f.options.map(o => String(o).trim()).filter(Boolean) : [];
          if (!field.options.length) field.options = ['Yes', 'No'];
        }
        if (type === 'slider') {
          const min = Number(f.min ?? 1);
          const max = Number(f.max ?? 5);
          field.min = Number.isFinite(min) ? min : 1;
          field.max = Number.isFinite(max) && max > field.min ? max : field.min + 4;
          field.leftLabel = String(f.leftLabel || '').trim();
          field.rightLabel = String(f.rightLabel || '').trim();
          field.round = f.round === 'up' ? 'up' : 'nearest';
        }
        const expected = sanitizeProcedureExpected(f, type);
        if (expected) field.expected = expected;
        return field;
      })
      .filter(Boolean);
  }

  function sanitizeProcedureExpected(field, type) {
    if (['short', 'long', 'dropdown', 'checkboxes'].includes(type)) {
      const values = field.expectedValues || field.expected?.values || [];
      const clean = Array.isArray(values) ? values.map(v => String(v).trim()).filter(Boolean) : [];
      return clean.length ? { values: clean } : null;
    }
    if (type === 'number' || type === 'slider') {
      const min = field.expectedMin ?? field.expected?.min;
      const max = field.expectedMax ?? field.expected?.max;
      const expected = {};
      if (min !== '' && min != null && !Number.isNaN(Number(min))) expected.min = Number(min);
      if (max !== '' && max != null && !Number.isNaN(Number(max))) expected.max = Number(max);
      return Object.keys(expected).length ? expected : null;
    }
    if (type === 'checkbox') {
      const checked = field.expectedChecked ?? field.expected?.checked;
      return checked === true || checked === false ? { checked } : null;
    }
    return null;
  }

  function procedureTypeLabel(field) {
    if (field.type === 'slider' && field.min != null && field.max != null) {
      return `slider (${field.min}-${field.max})`;
    }
    if ((field.type === 'dropdown' || field.type === 'checkboxes') && Array.isArray(field.options) && field.options.length) {
      return `${field.type} (${field.options.length})`;
    }
    return field.type || 'short';
  }
}
