/* ============================================================
 *  courses.js — the "courses" group kind
 *  A course is reading material followed by a quiz. Each question
 *  carries its expected answer (same idea as checklist items).
 *
 *  This file is self-contained: it imports only shared helpers
 *  from config.js and receives the host's navigation via a small
 *  ctx object ({ go, back, state }).
 *
 *  ── WIRING (the only edits outside this file) ───────────────
 *
 *  admin.html
 *    1. Add an import near the top of the module:
 *         import { coursesGroupView, courseBuild, courseResults } from './courses.js';
 *    2. In groupView(g), add the courses branch:
 *         if (g.kind === 'courses') return coursesGroupView(g, { go, back, state });
 *    3. In the "Add group" kind <select> (the opt(...) list), add:
 *         opt('courses', t('courses')),
 *    4. In kindLabel and groupName maps, add:  courses: t('courses')
 *
 *  user.html  (mirror its existing group dispatch)
 *    1. import { courseListView } from './courses.js';
 *    2. Where it opens a group by kind, add:
 *         if (g.kind === 'courses') return courseListView(g, { go, back, state });
 *
 *  config.js  (inside the en TEXT block — optional but tidy)
 *    courses: 'Courses',
 * ============================================================ */

import { db, el, opt, labeled, t, toast } from './config.js';

const QUESTION_TYPES = [
  ['confirm', 'Acknowledgement'],
  ['choice', 'Single choice'],
  ['multi', 'Multiple choice'],
  ['text', 'Text answer'],
  ['number', 'Number answer'],
];

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
    .course-content { white-space: normal; line-height: 1.6; }
    .course-content p { margin: 0 0 12px; }
    .quiz-q { padding: 16px; border: 1px solid var(--line, rgba(26,47,54,.12)); border-radius: 14px; margin-bottom: 12px; background: var(--paper, #fffaf0); }
    .quiz-q .q-prompt { font-weight: 650; margin-bottom: 10px; }
    .quiz-opt { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .course-result { padding: 18px; border-radius: 14px; text-align: center; margin: 8px 0 16px; }
    .course-result .score { font-size: 2rem; font-weight: 800; }
    .result-pass { background: color-mix(in srgb, #2f9e5b 14%, transparent); color: #2f9e5b; }
    .result-fail { background: color-mix(in srgb, #d43c32 14%, transparent); color: #d43c32; }
    .course-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border: 1px solid var(--line, rgba(26,47,54,.12)); border-radius: 14px; margin-bottom: 10px; background: var(--paper, #fffaf0); }
    .course-row .c-title { font-weight: 650; }
    .course-row .c-meta { color: var(--steel, #6b7780); font-size: .84rem; margin-top: 2px; }
    .c-badge { font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
    .c-badge.pass { background: color-mix(in srgb, #2f9e5b 16%, transparent); color: #2f9e5b; }
    .c-badge.todo { background: var(--line, #eee); color: var(--steel, #6b7780); }
    .c-badge.draft { background: color-mix(in srgb, #BA7517 16%, transparent); color: #BA7517; }
    .c-badge.assigned { background: color-mix(in srgb, #f2c94c 26%, transparent); color: #8a6d10; }
    .course-row.assigned-todo { border-color: #f2c94c; background: color-mix(in srgb, #f2c94c 14%, var(--paper, #fffaf0)); }
    .course-row .assigned-msg { color: #8a6d10; font-size: .8rem; font-weight: 650; margin-top: 3px; }
    .course-select { width: 20px; height: 20px; accent-color: var(--primary, #6c7cff); flex: 0 0 auto; }
    .course-select-row { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .course-row-selectable { cursor: pointer; }
    .course-row-selectable .course-select { pointer-events: none; }
    .course-bulk-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .course-insights { display: grid; gap: 10px; margin-bottom: 14px; }
    .wrong-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .wrong-tag { font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; background: color-mix(in srgb, #d43c32 12%, transparent); color: #d43c32; }
    .course-stat { padding: 12px; border: 1px solid var(--line, rgba(26,47,54,.12)); border-radius: 14px; background: var(--paper, #fffaf0); }`;
  const listCss = `
    .course-library { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 16px; }
    .course-library .course-row { min-height: 230px; padding: 14px; border-radius: 8px; display: flex; flex-direction: column; text-align: center; }
    .course-library .course-row::before { content: "🎓"; order: 2; aspect-ratio: 1.55; border-radius: 7px; border: 1px solid var(--line, rgba(26,47,54,.12)); background: radial-gradient(circle at 74% 22%, color-mix(in srgb, var(--primary, #6c7cff) 18%, transparent), transparent 34%), linear-gradient(135deg, color-mix(in srgb, var(--paper-2, #f7f7fb) 86%, #fff 14%), color-mix(in srgb, var(--paper, #fffaf0) 72%, var(--primary, #6c7cff) 8%)); display: grid; place-items: center; font-size: clamp(3.2rem, 9vw, 5rem); line-height: 1; margin: 8px 0 10px; }
    .course-library .course-row.course-row-has-art::before { content: none; }
    .course-library .course-row .course-art { order: 2; aspect-ratio: 1.55; border-radius: 7px; overflow: hidden; border: 1px solid var(--line, rgba(26,47,54,.12)); background: radial-gradient(circle at 74% 22%, color-mix(in srgb, var(--primary, #6c7cff) 18%, transparent), transparent 34%), linear-gradient(135deg, color-mix(in srgb, var(--paper-2, #f7f7fb) 86%, #fff 14%), color-mix(in srgb, var(--paper, #fffaf0) 72%, var(--primary, #6c7cff) 8%)); display: grid; place-items: center; margin: 8px 0 10px; }
    .course-library .course-row .course-art img { width: 100%; height: 100%; object-fit: cover; }
    .course-library .course-row .course-art-icon { font-size: clamp(3.2rem, 9vw, 5rem); line-height: 1; }
    .course-library .course-row > div:first-child { order: 1; }
    .course-library .course-row > div:last-child { order: 3; }
    .course-library .course-row .c-title { min-height: 2.5em; display: grid; place-items: center; font-size: 1rem; }
    .course-library .course-row .c-meta { font-size: .95rem; font-weight: 650; color: var(--ink, #1a2f36); }
    .course-library .course-row > div:last-child { margin-top: auto; justify-content: center; flex-wrap: wrap; }`;
  document.head.append(el('style', {}, css + listCss));
}

/* ── grading ──────────────────────────────────────────────── */
function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function sameSet(a, b) {
  const A = [...new Set((a || []).map(norm))].sort();
  const B = [...new Set((b || []).map(norm))].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}
function isCorrect(q, ans) {
  switch (q.type) {
    case 'confirm': return ans === true;
    case 'choice': return norm(ans) === norm(q.expected);
    case 'multi': return sameSet(ans, q.expected);
    case 'text': return (q.expected?.values || []).some(v => norm(v) === norm(ans));
    case 'number': {
      const n = Number(ans);
      if (Number.isNaN(n)) return false;
      const min = q.expected?.min, max = q.expected?.max;
      return (min == null || n >= Number(min)) && (max == null || n <= Number(max));
    }
    default: return false;
  }
}
function gradeCourse(course, answers) {
  const qs = course.questions || [];
  let total = 0, earned = 0;
  const perQuestion = qs.map(q => {
    const pts = Number(q.points) || 1;
    total += pts;
    const ok = isCorrect(q, answers[q.id]);
    if (ok) earned += pts;
    return { id: q.id, correct: ok };
  });
  const score = total ? Math.round(earned / total * 100) : 100;
  return { score, passed: score >= (course.pass_threshold ?? 100), perQuestion };
}

function renderContent(text) {
  const blocks = String(text || '').split(/\n{2,}|\r\n{2,}/).map(s => s.trim()).filter(Boolean);
  if (!blocks.length) return el('p', { class: 'c-meta' }, 'No reading material.');
  return el('div', { class: 'course-content' }, blocks.map(b => el('p', {}, b)));
}

function openPreviewModal(title, build) {
  const bg = el('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(); } });
  const body = el('div', {});
  const modal = el('div', { class: 'modal' }, [
    el('div', { class: 'section-head' }, [
      el('h2', {}, title),
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Close'),
    ]),
    body,
  ]);
  const close = () => bg.remove();
  bg.append(modal);
  document.body.append(bg);
  build(body, close);
}

function showCoursePreview(course) {
  openPreviewModal('Preview', (body) => {
    const shell = el('div', { class: 'preview-shell' }, [
      el('h2', { class: 'display preview-title' }, course.title || 'Course'),
      renderContent(course.content),
      el('h3', { class: 'preview-section-title' }, 'Quiz'),
    ]);
    const qs = course.questions || [];
    if (!qs.length) {
      shell.append(el('p', { class: 'c-meta' }, 'No questions yet.'));
    } else {
      qs.forEach((q, idx) => shell.append(courseQuestionPreview(q, idx)));
      shell.append(el('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Submit answers'));
    }
    body.append(shell);
  });
}

function courseQuestionPreview(q, idx) {
  const box = el('div', { class: 'quiz-q preview-card' }, [
    el('div', { class: 'q-prompt' }, `${idx + 1}. ${q.prompt}`),
  ]);
  if (q.type === 'confirm') {
    box.append(el('label', { class: 'quiz-opt' }, [el('input', { type: 'checkbox' }), document.createTextNode('I confirm')]));
  } else if (q.type === 'choice') {
    (q.options || []).forEach(o => box.append(el('label', { class: 'quiz-opt' }, [
      el('input', { type: 'radio', name: 'preview_q_' + q.id, value: o }),
      document.createTextNode(o),
    ])));
  } else if (q.type === 'multi') {
    (q.options || []).forEach(o => box.append(el('label', { class: 'quiz-opt' }, [
      el('input', { type: 'checkbox', value: o }),
      document.createTextNode(o),
    ])));
  } else if (q.type === 'number') {
    box.append(el('input', { type: 'number', placeholder: 'Your answer' }));
  } else {
    box.append(el('input', { type: 'text', placeholder: 'Your answer' }));
  }
  return box;
}

function answerLabel(ans) {
  if (ans === true) return 'Checked';
  if (ans === false) return 'Unchecked';
  if (Array.isArray(ans)) return ans.length ? ans.join(', ') : 'Blank';
  if (ans == null || ans === '') return 'Blank';
  return String(ans);
}

function libraryIcon(kind, text = '') {
  const s = String(text || '').toLowerCase();
  if (kind === 'course') return s.includes('first aid') ? '🩹' : s.includes('safety') ? '🦺' : '🎓';
  return '📁';
}
function libraryCard({ kind, title, meta, sub, icon, onclick, actions = [], className = '' }) {
  return el('div', { class: `library-card ${className}`.trim(), onclick, style: onclick ? 'cursor:pointer' : '' }, [
    el('div', { class: 'library-title' }, title),
    el('div', { class: 'library-art' }, el('span', { class: 'library-icon' }, icon || libraryIcon(kind, title))),
    el('div', {}, [
      meta ? el('div', { class: 'library-meta' }, meta) : null,
      sub ? el('div', { class: 'library-sub' }, sub) : null,
    ]),
    actions.length ? el('div', { class: 'library-actions' }, actions) : null,
  ]);
}

const PRESET_LOGOS = ['✅','📋','🌅','🌙','🔒','🧹','🩹','🦺','🎓','🧭','🏭','🧑‍🏫','📄','📊','🧪','⚠️','🧯','🚧','🔧','🧰','🍽️','❄️','🔥','🚿'];

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Reusable "profile image" picker, mirroring admin.html. `target` is a mutable
// { image, icon } object: uploading sets `image` (data URL), a logo sets `icon`.
function logoPicker(target) {
  const wrap = el('div', { class: 'logo-picker' });
  const draw = () => {
    wrap.innerHTML = '';
    const preview = el('div', { class: 'logo-preview' },
      target.image ? el('img', { src: target.image, alt: '' })
                   : el('span', { class: 'logo-preview-icon' }, target.icon || '📁'));
    const file = el('input', { type: 'file', accept: 'image/*', onchange: async e => {
      const f = e.target.files?.[0]; if (!f) return;
      target.image = await fileToDataUrl(f); draw();
    } });
    const clearBtn = (target.image || target.icon)
      ? el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { target.image = null; target.icon = null; draw(); } }, t('removeImage'))
      : null;
    const presets = el('div', { class: 'logo-presets' }, PRESET_LOGOS.map(emoji =>
      el('button', { type: 'button',
        class: 'logo-chip' + (!target.image && target.icon === emoji ? ' on' : ''),
        onclick: () => { target.icon = emoji; target.image = null; draw(); } }, emoji)));
    wrap.append(
      el('div', { class: 'logo-picker-top' }, [
        preview,
        el('div', { class: 'logo-picker-controls' }, [labeled(t('uploadImage'), file), clearBtn].filter(Boolean)),
      ]),
      el('div', { class: 'sub', style: 'margin:4px 0' }, t('orChooseLogo')),
      presets,
    );
  };
  draw();
  return wrap;
}

/* ============================================================
 *  ADMIN — list courses in a group
 * ============================================================ */
export function coursesGroupView(g, ctx) {
  ensureStyles();
  return {
    title: g.name || 'Courses', tab: 'groups',
    action: el('button', { class: 'iconbtn', title: 'New course', onclick: () => ctx.go(courseBuild(g, null, ctx)) }, '+'),
    async render(app) {
      app.classList.add('course-library');
      const { data: rows = [], error } = await db.from('courses')
        .select('*').eq('group_id', g.id).order('sort_order').order('created_at');
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!rows.length) {
        app.append(el('p', { class: 'c-meta' }, 'No courses yet. Use + to add one.'));
        return;
      }
      rows.forEach(c => {
        const qn = (c.questions || []).length;
        const art = el('div', { class: 'course-art' }, c.image
          ? el('img', { src: c.image, alt: c.title })
          : el('span', { class: 'course-art-icon' }, c.icon || '🎓'));
        app.append(el('div', { class: 'course-row course-row-has-art' }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'c-title' }, c.title),
            el('div', { class: 'c-meta' }, `${qn} question${qn === 1 ? '' : 's'} · pass ${c.pass_threshold}%`),
          ]),
          art,
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            c.is_draft ? el('span', { class: 'c-badge draft' }, 'Draft') : null,
            el('button', { class: 'btn btn-ghost', onclick: () => ctx.go(courseResults(c, ctx)) }, 'Results'),
            el('button', { class: 'btn btn-ghost', onclick: () => ctx.go(courseAssign(c, ctx)) }, 'Assign'),
            el('button', { class: 'btn btn-ghost', onclick: () => ctx.go(courseBuild(g, c, ctx)) }, 'Edit'),
          ]),
        ]));
      });
    },
  };
}

/* ============================================================
 *  ADMIN - assign a course to users
 * ============================================================ */
function courseAssign(course, ctx) {
  ensureStyles();
  const labelOf = p => p?.full_name || p?.email || p?.username || 'Unknown user';
  return {
    title: 'Assign course', tab: 'groups',
    async render(app) {
      const profiles = (ctx.state.profiles || [])
        .filter(p => p && p.id && p.role !== 'sysadmin' && p.role !== 'super_admin')
        .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
      const [{ data: assignments = [], error: assignError }, { data: submissions = [] }] = await Promise.all([
        db.from('course_assignments').select('*').eq('course_id', course.id).order('assigned_at', { ascending: false }),
        db.from('course_submissions').select('user_id,score,passed,created_at').eq('course_id', course.id).order('created_at', { ascending: false }),
      ]);
      if (assignError) return app.append(el('p', { class: 'c-meta' }, assignError.message + ' - run migration_course_assignments.sql first.'));

      const assignedByUser = new Map(assignments.map(a => [a.user_id, a]));
      const latestByUser = new Map();
      submissions.forEach(s => { if (!latestByUser.has(s.user_id)) latestByUser.set(s.user_id, s); });
      const selectableName = `course-user-${course.id}`;

      const selectedIds = () => [...app.querySelectorAll(`input[name="${selectableName}"]:checked`)].map(input => input.value);
      const setAllSelected = (checked) => {
        app.querySelectorAll(`input[name="${selectableName}"]`).forEach(input => { input.checked = checked; });
      };
      app.append(
        el('div', { class: 'course-row' }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'c-title' }, course.title),
            el('div', { class: 'c-meta' }, `${assignments.length} assigned`),
          ]),
          el('div', { class: 'course-bulk-actions' }, [
            el('span', { class: 'c-badge assigned' }, 'Assignments'),
            el('button', { class: 'btn btn-ghost', onclick: () => setAllSelected(true) }, 'Select all'),
            el('button', { class: 'btn btn-ghost', onclick: () => setAllSelected(false) }, 'Clear'),
            el('button', { class: 'btn btn-primary', onclick: assignSelected }, 'Assign selected'),
            el('button', { class: 'btn btn-ghost', onclick: unassignSelected }, 'Unassign selected'),
          ]),
        ]),
      );

      if (!profiles.length) {
        app.append(el('p', { class: 'c-meta' }, 'No visible users found.'));
        return;
      }

      profiles.forEach(p => {
        const assignment = assignedByUser.get(p.id);
        const latest = latestByUser.get(p.id);
        const checkbox = el('input', { class: 'course-select', type: 'checkbox', name: selectableName, value: p.id });
        const row = el('div', { class: 'course-row course-row-selectable' }, [
          el('div', { class: 'course-select-row' }, [
            checkbox,
            el('div', { style: 'min-width:0' }, [
              el('div', { class: 'c-title' }, labelOf(p)),
              el('div', { class: 'c-meta' }, [
                assignment ? `Assigned ${new Date(assignment.assigned_at).toLocaleString()}` : 'Not assigned',
                latest ? `Latest: ${latest.score}% ${latest.passed ? 'passed' : 'failed'} - ${new Date(latest.created_at).toLocaleString()}` : 'No attempts',
              ].join(' - ')),
            ]),
          ]),
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            latest?.passed ? el('span', { class: 'c-badge pass' }, 'Completed') : null,
            assignment ? el('span', { class: 'c-badge assigned' }, 'Assigned')
                       : el('span', { class: 'c-badge todo' }, 'Not assigned'),
          ]),
        ]);
        row.addEventListener('click', e => {
          if (e.target === checkbox) return; // let the native checkbox toggle itself
          checkbox.checked = !checkbox.checked;
        });
        app.append(row);
      });

      async function assignSelected() {
        const ids = selectedIds().filter(id => !assignedByUser.has(id));
        if (!ids.length) return toast('Select at least one unassigned user.', 'err');
        const rows = ids.map(id => ({
          user_id: id,
          course_id: course.id,
          assigned_by: ctx.state.profile.id,
        }));
        const { error } = await db.from('course_assignments').insert(rows);
        if (error) return toast(error.message + ' - run migration_course_assignments.sql first.', 'err');
        toast(`${rows.length} course assignment${rows.length === 1 ? '' : 's'} created.`);
        ctx.go(courseAssign(course, ctx));
      }

      async function unassignSelected() {
        const assignmentIds = selectedIds()
          .map(id => assignedByUser.get(id)?.id)
          .filter(Boolean);
        if (!assignmentIds.length) return toast('Select at least one assigned user.', 'err');
        if (!confirm(`Remove ${assignmentIds.length} course assignment${assignmentIds.length === 1 ? '' : 's'}?`)) return;
        const { error } = await db.from('course_assignments').delete().in('id', assignmentIds);
        if (error) return toast(error.message, 'err');
        toast(`${assignmentIds.length} assignment${assignmentIds.length === 1 ? '' : 's'} removed.`);
        ctx.go(courseAssign(course, ctx));
      }

    },
  };
}

/* ============================================================
 *  ADMIN - build / edit a course
 * ============================================================ */
export function courseBuild(g, existing, ctx) {
  ensureStyles();
  return {
    title: existing ? 'Edit course' : 'New course', tab: 'groups',
    render(app) {
      const title = el('input', { type: 'text', value: existing?.title || '', placeholder: 'Course title' });
      const content = el('textarea', { placeholder: 'Reading material. Separate paragraphs with a blank line.', rows: 10 });
      content.value = existing?.content || '';
      const pass = el('input', { type: 'number', min: '0', max: '100', step: '5', value: existing?.pass_threshold ?? 100 });
      const logo = { image: existing?.image || null, icon: existing?.icon || null };

      let questions = (existing?.questions || []).map(q => ({ ...q }));
      const list = el('div', {});

      const draw = () => {
        list.innerHTML = '';
        questions.forEach((q, idx) => {
          if (!q.type) q.type = 'confirm';
          if (!q.options) q.options = [];
          const promptInp = el('input', { type: 'text', value: q.prompt || '',
            placeholder: q.type === 'confirm' ? 'I confirm I read the whole thing' : `Question ${idx + 1}`,
            oninput: e => q.prompt = e.target.value });
          const typeSel = el('select', { onchange: e => { q.type = e.target.value; draw(); } },
            QUESTION_TYPES.map(([v, lbl]) => opt(v, lbl)));
          typeSel.value = q.type;
          const points = el('input', { type: 'number', min: '1', step: '1', value: q.points ?? 1,
            style: 'max-width:90px', oninput: e => q.points = Number(e.target.value) || 1 });

          const card = el('div', { class: 'card' }, [
            el('div', { class: 'section-head' }, [
              el('strong', {}, `Question ${idx + 1}`),
              el('button', { class: 'btn btn-danger', onclick: () => { questions.splice(idx, 1); draw(); } }, '✕'),
            ]),
            labeled('Prompt', promptInp),
            el('div', { style: 'display:flex;gap:10px' }, [
              el('div', { style: 'flex:1' }, labeled('Type', typeSel)),
              el('div', {}, labeled('Points', points)),
            ]),
          ]);

          // ── per-type expected-answer editor ──
          if (q.type === 'confirm') {
            card.append(el('p', { class: 'c-meta' }, 'The learner must tick this to earn the points.'));
          } else if (q.type === 'choice' || q.type === 'multi') {
            const optsInp = el('input', { type: 'text', value: (q.options || []).join(', '),
              placeholder: 'Option A, Option B, Option C',
              oninput: e => { q.options = e.target.value.split(',').map(s => s.trim()).filter(Boolean); drawExpected(); } });
            card.append(labeled('Options', optsInp));
            const expectedHost = el('div', {});
            card.append(expectedHost);
            const drawExpected = () => {
              expectedHost.innerHTML = '';
              if (q.type === 'choice') {
                const sel = el('select', { onchange: e => q.expected = e.target.value },
                  [opt('', '— correct option —'), ...(q.options || []).map(o => opt(o, o))]);
                sel.value = q.expected || '';
                expectedHost.append(labeled('Correct answer', sel));
              } else {
                if (!Array.isArray(q.expected)) q.expected = [];
                expectedHost.append(el('div', { class: 'c-meta', style: 'margin:4px 0' }, 'Tick every correct option:'));
                (q.options || []).forEach(o => {
                  const box = el('input', { type: 'checkbox', onchange: e => {
                    const set = new Set(q.expected);
                    e.target.checked ? set.add(o) : set.delete(o);
                    q.expected = [...set];
                  } });
                  box.checked = (q.expected || []).includes(o);
                  expectedHost.append(el('label', { class: 'quiz-opt' }, [box, document.createTextNode(o)]));
                });
              }
            };
            drawExpected();
          } else if (q.type === 'text') {
            if (!q.expected || !Array.isArray(q.expected.values)) q.expected = { values: q.expected?.values || [] };
            const accepted = el('input', { type: 'text', value: (q.expected.values || []).join(', '),
              placeholder: 'yes, correct, complete',
              oninput: e => q.expected = { values: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } });
            card.append(labeled('Accepted answers (case-insensitive)', accepted));
          } else if (q.type === 'number') {
            if (!q.expected) q.expected = {};
            const minInp = el('input', { type: 'number', value: q.expected.min ?? '',
              placeholder: 'min', oninput: e => q.expected.min = e.target.value === '' ? null : Number(e.target.value) });
            const maxInp = el('input', { type: 'number', value: q.expected.max ?? '',
              placeholder: 'max', oninput: e => q.expected.max = e.target.value === '' ? null : Number(e.target.value) });
            card.append(el('div', { style: 'display:flex;gap:10px' }, [
              el('div', { style: 'flex:1' }, labeled('Accepted min', minInp)),
              el('div', { style: 'flex:1' }, labeled('Accepted max', maxInp)),
            ]));
            card.append(el('p', { class: 'c-meta' }, 'For an exact answer, set min and max to the same value.'));
          }

          list.append(card);
        });
      };
      draw();

      app.append(
        labeled('Title', title, true),
        labeled(t('profileImage'), logoPicker(logo)),
        labeled('Reading material', content),
        labeled('Pass threshold (%)', pass),
        el('h3', { style: 'margin:18px 0 8px' }, 'Quiz'),
        list,
        el('button', { class: 'btn btn-ghost btn-block', style: 'margin-bottom:16px',
          onclick: () => { questions.push({ id: crypto.randomUUID(), type: 'confirm', prompt: '', options: [], points: 1, required: true }); draw(); } },
          '+ Add question'),
        el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
          el('button', { class: 'btn btn-ghost btn-block', onclick: previewCourse }, 'Preview'),
          el('button', { class: 'btn btn-ghost btn-block', onclick: () => save(true) }, 'Save draft'),
          el('button', { class: 'btn btn-primary btn-block', onclick: () => save(false) }, 'Publish'),
        ]),
        existing ? el('button', { class: 'btn btn-danger btn-block', style: 'margin-top:10px', onclick: del }, 'Delete course') : null,
      );

      function cleanQuestions() {
        return questions
          .filter(q => (q.prompt || '').trim())
          .map(q => ({
            id: q.id || crypto.randomUUID(),
            type: q.type || 'confirm',
            prompt: q.prompt.trim(),
            options: (q.type === 'choice' || q.type === 'multi') ? (q.options || []).filter(Boolean) : [],
            expected: expectedFor(q),
            points: Number(q.points) || 1,
            required: true,
          }));
      }
      function previewCourse() {
        showCoursePreview({
          title: title.value.trim() || 'New course',
          content: content.value,
          pass_threshold: Math.max(0, Math.min(100, parseInt(pass.value, 10) || 100)),
          questions: cleanQuestions(),
        });
      }
      async function save(is_draft) {
        const clean = cleanQuestions();
        if (!title.value.trim()) return toast('Add a title.', 'err');
        if (!clean.length) return toast('Add at least one question.', 'err');
        const bad = clean.find(q => !validExpected(q));
        if (bad) return toast(`Set the correct answer for: "${bad.prompt}"`, 'err');

        const payload = {
          group_id: g.id,
          title: title.value.trim(),
          content: content.value,
          pass_threshold: Math.max(0, Math.min(100, parseInt(pass.value, 10) || 100)),
          questions: clean,
          is_draft,
          image: logo.image || null,
          icon: logo.icon || null,
          created_by: ctx.state.profile.id,
        };
        const qy = existing ? db.from('courses').update(payload).eq('id', existing.id)
                            : db.from('courses').insert(payload);
        const { error } = await qy;
        if (error) return toast(error.message, 'err');
        toast(is_draft ? 'Draft saved.' : 'Published.');
        ctx.back();
      }
      async function del() {
        if (!confirm('Delete this course?')) return;
        await db.from('courses').delete().eq('id', existing.id);
        toast('Deleted.'); ctx.back();
      }
    },
  };
}

function expectedFor(q) {
  if (q.type === 'confirm') return true;
  if (q.type === 'choice') return q.expected || '';
  if (q.type === 'multi') return Array.isArray(q.expected) ? q.expected : [];
  if (q.type === 'text') return { values: q.expected?.values || [] };
  if (q.type === 'number') return { min: q.expected?.min ?? null, max: q.expected?.max ?? null };
  return null;
}
function validExpected(q) {
  if (q.type === 'confirm') return true;
  if (q.type === 'choice') return !!q.expected;
  if (q.type === 'multi') return Array.isArray(q.expected) && q.expected.length > 0;
  if (q.type === 'text') return (q.expected?.values || []).length > 0;
  if (q.type === 'number') return q.expected?.min != null || q.expected?.max != null;
  return false;
}

/* ============================================================
 *  ADMIN — submission results for one course
 * ============================================================ */
export function courseResults(course, ctx) {
  ensureStyles();
  return {
    title: course.title, tab: 'groups',
    async render(app) {
      const { data: subs = [], error } = await db.from('course_submissions')
        .select('user_id,score,passed,answers,created_at').eq('course_id', course.id).order('created_at', { ascending: false });
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!subs.length) return app.append(el('p', { class: 'c-meta' }, 'No attempts yet.'));
      const nameOf = id => {
        const p = (ctx.state.profiles || []).find(x => x.id === id);
        return p?.full_name || p?.email || 'Unknown';
      };
      const qs = course.questions || [];
      const passCount = subs.filter(s => s.passed).length;
      const avgScore = Math.round(subs.reduce((sum, s) => sum + (Number(s.score) || 0), 0) / subs.length);
      const stats = qs.map(q => {
        const wrong = subs.filter(s => !isCorrect(q, (s.answers || {})[q.id]));
        const tags = new Map();
        wrong.forEach(s => {
          const label = answerLabel((s.answers || {})[q.id]);
          tags.set(label, (tags.get(label) || 0) + 1);
        });
        return { q, wrong, tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
      }).sort((a, b) => b.wrong.length - a.wrong.length);
      app.append(el('div', { class: 'course-insights' }, [
        el('div', { class: 'course-row' }, [
          el('div', {}, [
            el('div', { class: 'c-title' }, 'Course summary'),
            el('div', { class: 'c-meta' }, `${subs.length} attempt${subs.length === 1 ? '' : 's'} · ${passCount} passed · average ${avgScore}%`),
          ]),
          el('span', { class: 'c-badge ' + (passCount ? 'pass' : 'todo') }, `${Math.round(passCount / subs.length * 100)}% pass`),
        ]),
        ...stats.filter(s => s.wrong.length).slice(0, 5).map(s => el('div', { class: 'course-stat' }, [
          el('div', { class: 'c-title' }, s.q.prompt),
          el('div', { class: 'c-meta' }, `${s.wrong.length} wrong of ${subs.length} attempts`),
          el('div', { class: 'wrong-tags' }, s.tags.map(([label, count]) =>
            el('span', { class: 'wrong-tag' }, `${label}: ${count}`))),
        ])),
      ]));
      subs.forEach(s => {
        app.append(el('div', { class: 'course-row' }, [
          el('div', {}, [
            el('div', { class: 'c-title' }, nameOf(s.user_id)),
            el('div', { class: 'c-meta' }, new Date(s.created_at).toLocaleString()),
          ]),
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            el('span', { class: 'c-badge ' + (s.passed ? 'pass' : 'todo') }, `${s.score}%`),
            el('span', { class: 'c-badge ' + (s.passed ? 'pass' : 'draft') }, s.passed ? 'Passed' : 'Failed'),
          ]),
        ]));
      });
    },
  };
}

/* ============================================================
 *  USER — list courses in a group, with status
 * ============================================================ */
export function courseListView(g, ctx) {
  ensureStyles();
  return {
    title: g.name || 'Courses', tab: 'home',
    async render(app) {
      app.classList.add('course-library');
      const { data: rows = [], error } = await db.from('courses')
        .select('*').eq('group_id', g.id).eq('is_draft', false).order('sort_order').order('created_at');
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!rows.length) return app.append(el('p', { class: 'c-meta' }, 'No courses available.'));

      const ids = rows.map(c => c.id);
      const { data: subs = [] } = await db.from('course_submissions')
        .select('course_id,passed').eq('user_id', ctx.state.profile.id).in('course_id', ids);
      const passedIds = new Set(subs.filter(s => s.passed).map(s => s.course_id));
      let assignedIds = new Set();
      if (ids.length) {
        const assignQ = await db.from('course_assignments')
          .select('course_id').eq('user_id', ctx.state.profile.id).in('course_id', ids);
        if (!assignQ.error) assignedIds = new Set((assignQ.data || []).map(a => a.course_id));
      }

      rows.forEach(c => {
        const done = passedIds.has(c.id);
        const assigned = assignedIds.has(c.id);
        const qn = (c.questions || []).length;
        const assignedTodo = assigned && !done;
        const art = el('div', { class: 'course-art' }, c.image
          ? el('img', { src: c.image, alt: c.title })
          : el('span', { class: 'course-art-icon' }, c.icon || '🎓'));
        app.append(el('div', { class: 'course-row course-row-has-art' + (assignedTodo ? ' assigned-todo' : ''), style: 'cursor:pointer', onclick: () => ctx.go(courseTake(c, ctx)) }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'c-title' }, c.title),
            el('div', { class: 'c-meta' }, `${qn} question${qn === 1 ? '' : 's'}`),
            assignedTodo ? el('div', { class: 'assigned-msg' }, '⚑ ' + t('assignedToComplete')) : null,
          ]),
          art,
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            assignedTodo ? el('span', { class: 'c-badge assigned' }, t('assigned')) : null,
            el('span', { class: 'c-badge ' + (done ? 'pass' : 'todo') }, done ? 'Passed ✓' : 'Start'),
          ]),
        ]));
      });
    },
  };
}

/* ============================================================
 *  USER — read a course and take its quiz
 * ============================================================ */
export function courseTake(course, ctx) {
  ensureStyles();
  return {
    title: course.title, tab: 'home',
    render(app) {
      app.append(renderContent(course.content));
      app.append(el('h3', { style: 'margin:18px 0 8px' }, 'Quiz'));

      const answers = {};
      const inputs = {};
      const qs = course.questions || [];

      qs.forEach((q, idx) => {
        const box = el('div', { class: 'quiz-q' }, [el('div', { class: 'q-prompt' }, `${idx + 1}. ${q.prompt}`)]);
        if (q.type === 'confirm') {
          const cb = el('input', { type: 'checkbox', onchange: e => answers[q.id] = e.target.checked });
          box.append(el('label', { class: 'quiz-opt' }, [cb, document.createTextNode('I confirm')]));
          inputs[q.id] = () => answers[q.id] = cb.checked;
        } else if (q.type === 'choice') {
          (q.options || []).forEach(o => {
            const r = el('input', { type: 'radio', name: 'q_' + q.id, value: o, onchange: () => answers[q.id] = o });
            box.append(el('label', { class: 'quiz-opt' }, [r, document.createTextNode(o)]));
          });
        } else if (q.type === 'multi') {
          answers[q.id] = [];
          (q.options || []).forEach(o => {
            const cb = el('input', { type: 'checkbox', value: o, onchange: e => {
              const set = new Set(answers[q.id]); e.target.checked ? set.add(o) : set.delete(o); answers[q.id] = [...set];
            } });
            box.append(el('label', { class: 'quiz-opt' }, [cb, document.createTextNode(o)]));
          });
        } else if (q.type === 'text') {
          const inp = el('input', { type: 'text', placeholder: 'Your answer', oninput: e => answers[q.id] = e.target.value });
          box.append(inp);
        } else if (q.type === 'number') {
          const inp = el('input', { type: 'number', placeholder: 'Your answer', oninput: e => answers[q.id] = e.target.value });
          box.append(inp);
        }
        app.append(box);
      });

      const resultHost = el('div', {});
      app.append(resultHost,
        el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:6px', onclick: submit }, 'Submit answers'));

      async function submit() {
        const unanswered = qs.filter(q => {
          const a = answers[q.id];
          if (q.type === 'confirm') return a !== true;
          if (q.type === 'multi') return !(a && a.length);
          return a == null || a === '';
        });
        if (unanswered.length) return toast(`Answer all questions (${unanswered.length} left).`, 'err');

        // Grading happens server-side: the client only submits raw answers.
        // submit_course() grades against the stored key and writes the verified
        // row, so a forged score/passed can't be posted from the browser.
        const { data: result, error } = await db.rpc('submit_course', {
          p_course_id: course.id, p_answers: answers,
        });
        if (error) return toast(error.message, 'err');
        const score = result?.score ?? 0;
        const passed = !!result?.passed;

        resultHost.innerHTML = '';
        resultHost.append(el('div', { class: 'course-result ' + (passed ? 'result-pass' : 'result-fail') }, [
          el('div', { class: 'score' }, `${score}%`),
          el('div', {}, passed ? 'Passed' : `Not passed — ${course.pass_threshold}% needed`),
        ]));
        if (passed) {
          resultHost.append(el('button', { class: 'btn btn-ghost btn-block', onclick: () => ctx.back() }, 'Done'));
        } else {
          resultHost.append(el('p', { class: 'c-meta', style: 'text-align:center' }, 'Review the material and try again.'));
        }
      }
    },
  };
}
