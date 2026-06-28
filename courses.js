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
    .c-badge.draft { background: color-mix(in srgb, #BA7517 16%, transparent); color: #BA7517; }`;
  document.head.append(el('style', {}, css));
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

/* ============================================================
 *  ADMIN — list courses in a group
 * ============================================================ */
export function coursesGroupView(g, ctx) {
  ensureStyles();
  return {
    title: g.name || 'Courses', tab: 'groups',
    action: el('button', { class: 'iconbtn', title: 'New course', onclick: () => ctx.go(courseBuild(g, null, ctx)) }, '+'),
    async render(app) {
      const { data: rows = [], error } = await db.from('courses')
        .select('*').eq('group_id', g.id).order('sort_order').order('created_at');
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!rows.length) {
        app.append(el('p', { class: 'c-meta' }, 'No courses yet. Use + to add one.'));
        return;
      }
      rows.forEach(c => {
        const qn = (c.questions || []).length;
        app.append(el('div', { class: 'course-row' }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'c-title' }, c.title),
            el('div', { class: 'c-meta' }, `${qn} question${qn === 1 ? '' : 's'} · pass ${c.pass_threshold}%`),
          ]),
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            c.is_draft ? el('span', { class: 'c-badge draft' }, 'Draft') : null,
            el('button', { class: 'btn btn-ghost', onclick: () => ctx.go(courseResults(c, ctx)) }, 'Results'),
            el('button', { class: 'btn btn-ghost', onclick: () => ctx.go(courseBuild(g, c, ctx)) }, 'Edit'),
          ]),
        ]));
      });
    },
  };
}

/* ============================================================
 *  ADMIN — build / edit a course
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
        labeled('Reading material', content),
        labeled('Pass threshold (%)', pass),
        el('h3', { style: 'margin:18px 0 8px' }, 'Quiz'),
        list,
        el('button', { class: 'btn btn-ghost btn-block', style: 'margin-bottom:16px',
          onclick: () => { questions.push({ id: crypto.randomUUID(), type: 'confirm', prompt: '', options: [], points: 1, required: true }); draw(); } },
          '+ Add question'),
        el('div', { style: 'display:flex;gap:10px' }, [
          el('button', { class: 'btn btn-ghost btn-block', onclick: () => save(true) }, 'Save draft'),
          el('button', { class: 'btn btn-primary btn-block', onclick: () => save(false) }, 'Publish'),
        ]),
        existing ? el('button', { class: 'btn btn-danger btn-block', style: 'margin-top:10px', onclick: del }, 'Delete course') : null,
      );

      async function save(is_draft) {
        const clean = questions
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
        .select('user_id,score,passed,created_at').eq('course_id', course.id).order('created_at', { ascending: false });
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!subs.length) return app.append(el('p', { class: 'c-meta' }, 'No attempts yet.'));
      const nameOf = id => {
        const p = (ctx.state.profiles || []).find(x => x.id === id);
        return p?.full_name || p?.email || 'Unknown';
      };
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
      const { data: rows = [], error } = await db.from('courses')
        .select('*').eq('group_id', g.id).eq('is_draft', false).order('sort_order').order('created_at');
      if (error) return app.append(el('p', { class: 'c-meta' }, error.message));
      if (!rows.length) return app.append(el('p', { class: 'c-meta' }, 'No courses available.'));

      const ids = rows.map(c => c.id);
      const { data: subs = [] } = await db.from('course_submissions')
        .select('course_id,passed').eq('user_id', ctx.state.profile.id).in('course_id', ids);
      const passedIds = new Set(subs.filter(s => s.passed).map(s => s.course_id));

      rows.forEach(c => {
        const done = passedIds.has(c.id);
        const qn = (c.questions || []).length;
        app.append(el('div', { class: 'course-row', style: 'cursor:pointer', onclick: () => ctx.go(courseTake(c, ctx)) }, [
          el('div', { style: 'min-width:0' }, [
            el('div', { class: 'c-title' }, c.title),
            el('div', { class: 'c-meta' }, `${qn} question${qn === 1 ? '' : 's'}`),
          ]),
          el('span', { class: 'c-badge ' + (done ? 'pass' : 'todo') }, done ? 'Passed ✓' : 'Start'),
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

        const { score, passed } = gradeCourse(course, answers);
        const { error } = await db.from('course_submissions').insert({
          course_id: course.id, user_id: ctx.state.profile.id, answers, score, passed,
        });
        if (error) return toast(error.message, 'err');

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
