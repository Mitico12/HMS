#!/usr/bin/env node
const fs = require('node:fs');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const url = readFlag('--url') || 'http://localhost:8080/admin.html';
const loginPath = readFlag('--login') || 'Credentials.txt';
const loginIndex = Number(readFlag('--login-index') || 2);
const seedTag = readFlag('--tag') || 'hms-demo-real-v1';

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function readCredentials(filePath, index = 1) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const emailIndexes = lines.map((line, i) => /@/.test(line) ? i : -1).filter(i => i >= 0);
  const userIndex = emailIndexes[Math.max(0, index - 1)] ?? emailIndexes[0] ?? 0;
  const username = lines[userIndex];
  const password = lines[userIndex + 1] || lines.find((line, idx) => idx !== userIndex && !/@/.test(line));
  if (!username || !password) throw new Error(`Could not parse username/password from ${filePath}`);
  return { username, password };
}

async function main() {
  const creds = readCredentials(loginPath, loginIndex);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const issues = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())
      && !/^Failed to load resource:/i.test(msg.text())
      && !/Multiple GoTrueClient instances detected/i.test(msg.text())) {
      issues.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', err => issues.push({ type: 'pageerror', text: err.message }));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.fill('#lid', creds.username);
    await page.fill('#pw', creds.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForTimeout(7000);

    const result = await page.evaluate(async ({ seedTag }) => {
      const { db } = await import(`./config.js?seed=${Date.now()}`);

      const fail = (step, error) => {
        throw new Error(`${step}: ${error?.message || error || 'unknown error'}`);
      };
      const maybe = async (step, promise) => {
        const res = await promise;
        if (res.error) return { error: res.error.message };
        return { data: res.data || [] };
      };
      const run = async (step, promise) => {
        const res = await promise;
        if (res.error) fail(step, res.error);
        return res.data || [];
      };
      const now = new Date();
      const atDaysAgo = (days, hour = 9, minute = 0) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        d.setHours(hour, minute, 0, 0);
        return d.toISOString();
      };
      const shortDate = iso => iso.slice(0, 10);
      const pick = (arr, index) => arr[index % arr.length];
      const labelOf = p => p.full_name || p.username || p.email || p.id;

      const { data: authData, error: userErr } = await db.auth.getUser();
      if (userErr || !authData?.user) fail('auth.getUser', userErr || 'not logged in');
      const currentUserId = authData.user.id;

      const profiles = await run('load profiles', db.from('profiles')
        .select('id,email,full_name,username,role,is_verified,is_suspended,created_at')
        .order('created_at', { ascending: true }));
      const usableProfiles = profiles.filter(p => p.is_verified !== false && !p.is_suspended);
      const workers = usableProfiles.filter(p => !['admin', 'super_admin', 'sysadmin', 'superuser'].includes(String(p.role || '').toLowerCase()));
      const everyone = usableProfiles.length ? usableProfiles : profiles;
      const demoWorkers = (workers.length >= 3 ? workers : everyone).slice(0, 6);
      const admins = everyone.filter(p => ['admin', 'super_admin', 'sysadmin', 'superuser'].includes(String(p.role || '').toLowerCase()));
      const assignees = admins.length ? admins : [everyone.find(p => p.id === currentUserId)].filter(Boolean);
      if (!everyone.length) fail('profiles', 'no profiles available');

      const groups = await run('load groups', db.from('groups').select('*').order('sort_order'));
      let checklistGroup = groups.find(g => g.kind === 'checklist') || groups.find(g => /checklist/i.test(g.name || ''));
      if (!checklistGroup) {
        const inserted = await run('create checklist group', db.from('groups').insert({
          name: 'Checklists',
          icon: '✅',
          kind: 'checklist',
          sort_order: 1,
          department_ids: [],
        }).select('*').single());
        checklistGroup = inserted;
      }

      const categories = await run('load incident categories', db.from('incident_categories').select('*').order('sort_order'));
      const rootCauses = categories.filter(c => c.kind === 'root_cause');
      const consequences = categories.filter(c => c.kind === 'consequence');

      const existingIncidents = await run('check existing incidents', db.from('incidents')
        .select('id')
        .eq('custom_fields->>demo_seed', seedTag)
        .limit(1));

      const incidentTemplates = [
        [
          'incident',
          'A slip-and-trip incident occurred at the main dishwashing station. Wet flooring was present due to a clogged floor drain which backflowed water during peak service hours. No warning signage had been deployed at the time.',
          'The floor drain needs deep mechanical cleaning by plumbing services to restore correct flow. Non-slip floor mats must be repositioned and additional cautionary wet floor signs kept at the station.',
          'Main Kitchen - Dishwashing Area'
        ],
        [
          'hazard',
          'During routine walk-through, an exposed 230V extension cord was found running across the walkway of the main food prep line. This temporary power feed was placed to run a countertop blender and presents an immediate tripping and electrocution hazard.',
          'Relocate blender closer to permanent wall outlets, or run the power cord overhead using insulated cable hanger hooks to maintain clear pedestrian paths.',
          'Food Preparation Area - Line A'
        ],
        [
          'suggestion',
          'Propose placing a designated, wall-mounted sharps container at the vegetable prep station. Cooks currently walk across the busy hot line to dispose of dull or broken utility blades at the single central disposal unit, causing unnecessary traffic and handling risks.',
          'Install a secondary sharps/blade-disposal container directly above the main vegetable prep bench to streamline safe disposal.',
          'Vegetable Prep Bench'
        ],
        [
          'incident',
          'Staff member received a second-degree steam burn on their right forearm while removing a gastrongorm pan of cooked potatoes from the combi steam oven. They were using dry kitchen towels instead of thermal heat-resistant gloves.',
          'Thermal protective oven gloves must be placed in a wall hanger directly adjacent to the combi ovens. Team leads will run a 5-minute refresher on proper steam release door-opening techniques.',
          'Hot Kitchen - Oven Station'
        ],
        [
          'hazard',
          'Double fire doors leading to the rear loading bay were blocked by stacked cardboard storage boxes and flatpack delivery pallets waiting for disposal. This compromises the primary emergency egress path.',
          'Clear boxes immediately. Implement a strict "keep clear" zone marking on the floor around emergency exits, and coordinate hourly rubbish clearances during delivery windows.',
          'Rear Corridor - Emergency Exit'
        ],
        [
          'incident',
          'Minor laceration to index finger occurred during prep. A prep cook was dicing raw carrots using a chef knife that was dull, causing the blade to slip off the vegetable. First aid kit used to clean and bandage the cut.',
          'Implement a weekly knife-sharpening rotation schedule and conduct a training session on correct finger placement (claw grip) during heavy prep tasks.',
          'Cold Kitchen - Prep Bench 2'
        ],
        [
          'suggestion',
          'Introduce a standard pre-shift safety huddle checklist for kitchen managers to review before the lunch and dinner rushes. The checklist should cover exit egress check, chemical safety labels, and correct placement of non-slip mats.',
          'Create a 5-point checklist template that can be quickly executed in 2 minutes at daily briefings.',
          'Staff Briefing Room'
        ],
        [
          'hazard',
          'The walk-in freezer doorway has accumulated significant condensation and ice build-up along the top door frame and threshold plate, leading to a slippery entry zone.',
          'Inspect the magnetic door seal gaskets for leaks, clear the ice from the floor threshold, and place a heavy-duty moisture-absorbing floor mat in front of the door.',
          'Walk-in Freezer Doorway'
        ],
        [
          'incident',
          'A back strain incident occurred when a kitchen hand attempted to single-handedly lift a 25kg sack of flour from the lower shelf of the dry storage rack up to the counter level.',
          'Remind all staff during daily huddles that any load over 20kg requires a team lift or the use of a heavy-duty trolley. Relocate heavy sacks to chest-height shelves.',
          'Dry Goods Storage Room'
        ],
        [
          'hazard',
          'An unlabelled cleaning bottle containing a blue chemical solution was found resting on the dishwashing prep counter. It was later identified as concentrated glass cleaner.',
          'All spray bottles must be labeled with their corresponding SDS product name and dilution level. Retrain staff on chemical safety controls and discard unlabelled bottles.',
          'Chemical Storage Cabinet'
        ],
        [
          'incident',
          'A staff member bumped their forehead on the corner of an overhead metal shelf in the pastry prep area. The shelf is mounted at 1.75m and is not clearly visible in low-light spots.',
          'Apply high-visibility safety tape along the lower edge and corners of the overhead shelves, and replace the overhead fluorescent light bulb to improve visibility.',
          'Pastry Kitchen'
        ],
        [
          'hazard',
          'The CO2 cylinder connection for the post-mix soda machine in the bar cellar is showing signs of slow gas leaking around the primary regulator seal ring.',
          'Shut off cylinder valve, replace regulator O-ring gasket, and verify tightness with soap water bubble test before reopening.',
          'Cellar - Beverage Storage'
        ],
        [
          'suggestion',
          'Implement color-coded allergen chopping boards (purple for allergen-free) and store them in separate slots to completely prevent cross-contamination during rush periods.',
          'Order a standard set of allergen chopping boards and coordinate a briefing on cross-contact prevention.',
          'Cold Kitchen - Prep Bench 1'
        ],
        [
          'incident',
          'A serving staff member slipped on grease accumulation near the entrance door from the kitchen to the dining hall. Floor mat was out of position.',
          'Reposition floor grip mat to cover transition threshold, and mopping routine must use grease-cutting detergent twice daily.',
          'Dining Hall Threshold'
        ]
      ];

      let insertedIncidents = [];
      if (!existingIncidents.length) {
        const incidentRows = [];
        for (let i = 0; i < 150; i++) {
          const tpl = incidentTemplates[i % incidentTemplates.length];
          const daysAgo = 1 + ((i * 2) % 85);
          const status = i % 5 === 0 ? 'open' : (i % 4 === 0 ? 'in_progress' : 'resolved');
          const created = atDaysAgo(daysAgo, 7 + (i % 9), (i * 11) % 60);
          const resolved = status === 'resolved' ? atDaysAgo(Math.max(daysAgo - (1 + (i % 3)), 0), 10 + (i % 6), 15) : null;
          const root = rootCauses.length ? [pick(rootCauses, i).id] : [];
          const cons = consequences.length && i % 3 === 0 ? [pick(consequences, i).id] : [];
          
          incidentRows.push({
            reporter_id: pick(demoWorkers.length ? demoWorkers : everyone, i).id,
            report_type: tpl[0],
            what_happened: `[Stress ID: ${i + 1}] ${tpl[1]}`,
            what_wrong: tpl[2],
            root_cause_ids: root,
            consequence_ids: cons,
            root_cause_other: root.length ? null : ['Training gap', 'Housekeeping', 'Equipment wear'][i % 3],
            consequence_other: cons.length ? null : (i % 4 === 0 ? 'Minor first-aid potential' : null),
            photo_paths: [],
            status,
            assigned_to: status === 'open' && i % 2 === 0 ? null : pick(assignees, i).id,
            final_report: status === 'resolved' ? `Corrective action completed: ${['Briefed team at huddle', 'Cleaned and cleared area', 'Replaced seal and gaskets', 'Installed safety signage'][i % 4]}.` : null,
            is_anonymous: i % 9 === 0,
            location: `${tpl[3]} (Stall ${i % 3 + 1})`,
            occurred_at: atDaysAgo(daysAgo, 6 + (i % 8), 20),
            created_at: created,
            resolved_at: resolved,
            archived: false,
            custom_fields: { demo_seed: seedTag, demo_index: i + 1 },
          });
        }
        
        const insertChunks = async (rows) => {
          let results = [];
          for (let startIdx = 0; startIdx < rows.length; startIdx += 50) {
            const chunk = rows.slice(startIdx, startIdx + 50);
            const res = await db.from('incidents').insert(chunk).select('id,status,created_at');
            if (res.error) throw new Error(res.error.message);
            results = results.concat(res.data || []);
          }
          return results;
        };
        insertedIncidents = await insertChunks(incidentRows);

        const actionRows = insertedIncidents
          .filter((inc, i) => inc.status !== 'open' || i % 2 === 0)
          .flatMap((inc, i) => {
            const baseDay = Math.max(0, Math.round((now - new Date(inc.created_at)) / 86400000) - 1);
            const rows = [{
              incident_id: inc.id,
              author_id: currentUserId,
              note: `Incident review initiated. Checked station setup and requested safety log review.`,
              created_at: atDaysAgo(baseDay, 11, 10),
            }];
            if (inc.status === 'resolved') rows.push({
              incident_id: inc.id,
              author_id: currentUserId,
              note: `Verification completed. Hazard mitigated successfully.`,
              created_at: atDaysAgo(Math.max(baseDay - 1, 0), 15, 20),
            });
            return rows;
          });
        if (actionRows.length) await run('insert incident actions', db.from('incident_actions').insert(actionRows));
      }

      const checklistDefs = [
        {
          title: `Daily Kitchen Food Safety & HACCP Walk`,
          quota: 2,
          weekdays: [1, 2, 3, 4, 5],
          items: [
            'All cold-line refrigeration units verified between 1°C and 4°C.',
            'Handwashing stations equipped with warm water, anti-bacterial soap, and paper towels.',
            'Critical emergency exits and fire extinguisher paths verified clear of obstacles.',
            'Dry storage products dated, rotated (FIFO), and elevated 15cm off the floor.'
          ],
        },
        {
          title: `Cold Chain & Walk-in Storage Temp Log`,
          quota: 1,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          items: [
            'Walk-in Cooler 1 (Meat/Prep) temperature recorded (target <4.0°C).',
            'Walk-in Cooler 2 (Dairy/Produce) temperature recorded (target <4.0°C).',
            'Walk-in Freezer temperature recorded (target < -18.0°C).',
            'Evaporator fans and door gaskets inspected for condensation or ice accumulation.'
          ],
        },
        {
          title: `End-of-Shift Kitchen Closing Checklist`,
          quota: 1,
          weekdays: [1, 2, 3, 4, 5, 6],
          items: [
            'All gas lines, hot plates, fryers, and oven hoods switched off and secured.',
            'Food contact surfaces cleaned, sanitized, and chemical spray bottles stored away.',
            'Ventilation hoods cleared of heavy grease build-up; filters inspected.',
            'Waste bins emptied, liners replaced, and floors swept and mopped.'
          ],
        },
        {
          title: `Weekly Safety & PPE Compliance Inspection`,
          quota: 1,
          weekdays: [1],
          items: [
            'Personal Protective Equipment (heat gloves, aprons, chemical goggles) stock verified.',
            'First-aid cabinets inspected; expired products replaced and log sheet signed.',
            'A-frame step ladders and step stools inspected for structural integrity and stable feet.',
            'Eye wash station tested for 30 seconds to flush plumbing lines.'
          ],
        }
      ];

      const checklistTitles = checklistDefs.map(d => d.title);
      const existingLists = await run('load demo checklists', db.from('checklists')
        .select('*')
        .in('title', checklistTitles));

      let checklists = existingLists;
      if (!checklists.length) {
        const rows = checklistDefs.map((def, i) => ({
          group_id: checklistGroup.id,
          title: def.title,
          items: def.items.map((label, j) => ({
            id: crypto.randomUUID(),
            label,
            kind: 'check',
            required: true,
          })),
          sort_order: 200 + i,
          icon: ['🧭', '🌡️', '🧽', '🧤'][i],
          daily_quota: def.quota,
          quota_weekdays: def.weekdays,
          department_ids: [],
          group_ids: [],
        }));
        checklists = await run('insert checklists', db.from('checklists').insert(rows).select('*'));
      }

      const assignmentRows = [];
      for (const c of checklists) {
        for (const p of demoWorkers.slice(0, 5)) {
          assignmentRows.push({ checklist_id: c.id, user_id: p.id, assigned_by: currentUserId });
        }
      }
      let assignments = { inserted: 0, skipped: false, error: null };
      if (assignmentRows.length) {
        const res = await db.from('checklist_assignments')
          .upsert(assignmentRows, { onConflict: 'checklist_id,user_id', ignoreDuplicates: true })
          .select('id');
        if (res.error) assignments = { inserted: 0, skipped: true, error: res.error.message };
        else assignments.inserted = (res.data || []).length;
      }

      const scopeIds = checklists.map(c => c.id);
      const existingRuns = await run('check existing runs', db.from('checklist_runs')
        .select('id')
        .in('checklist_id', scopeIds)
        .limit(1));

      let checklistRuns = { inserted: 0, mode: 'not-needed', error: null };
      if (!existingRuns.length && checklists.length) {
        const buildChecked = (c, complete, needsFix) => Object.fromEntries((c.items || []).map((item, idx) => [
          item.id,
          {
            done: complete || idx !== 1,
            at: new Date().toISOString(),
            needs_fix: needsFix && idx === 1,
            corrective_action: needsFix && idx === 1 ? 'Corrected immediately during check.' : '',
          },
        ]));
        const candidateWorkers = demoWorkers.length ? demoWorkers : [everyone.find(p => p.id === currentUserId)].filter(Boolean);
        const runRows = [];
        for (let day = 0; day <= 160; day += 1) {
          const dow = new Date(atDaysAgo(day)).getDay();
          checklists.forEach((c, cIdx) => {
            const days = Array.isArray(c.quota_weekdays) && c.quota_weekdays.length ? c.quota_weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6];
            if (!days.includes(dow)) return;
            const quota = Math.max(1, Number(c.daily_quota || 1));
            const completionsToday = Math.max(0, quota - ((day + cIdx) % 7 === 0 ? 1 : 0));
            for (let n = 0; n < completionsToday; n += 1) {
              const worker = pick(candidateWorkers, day + cIdx + n);
              const complete = (day + cIdx + n) % 11 !== 0;
              const needsFix = !complete || (day + cIdx + n) % 13 === 0;
              runRows.push({
                checklist_id: c.id,
                user_id: worker.id,
                checked: buildChecked(c, complete, needsFix),
                completed: complete,
                notes: complete ? 'Routine compliance check verified' : 'Check completed with minor corrections',
                submitted_at: atDaysAgo(day, 8 + ((day + n) % 8), (cIdx * 13 + n * 7) % 60),
                updated_at: atDaysAgo(day, 8 + ((day + n) % 8), (cIdx * 13 + n * 7) % 60),
              });
            }
          });
        }

        const insertChunks = async rows => {
          let count = 0;
          for (let i = 0; i < rows.length; i += 75) {
            const chunk = rows.slice(i, i + 75);
            const res = await db.from('checklist_runs').insert(chunk).select('id');
            if (res.error) throw new Error(res.error.message);
            count += (res.data || []).length;
          }
          return count;
        };

        try {
          checklistRuns.inserted = await insertChunks(runRows);
          checklistRuns.mode = 'multi-worker';
        } catch (err) {
          const ownRows = runRows.map(r => ({ ...r, user_id: currentUserId }));
          try {
            checklistRuns.inserted = await insertChunks(ownRows);
            checklistRuns.mode = 'current-user-only';
            checklistRuns.error = err.message;
          } catch (err2) {
            checklistRuns = { inserted: 0, mode: 'failed', error: `${err.message}; fallback: ${err2.message}` };
          }
        }
      }

      const totals = {
        profiles: profiles.length,
        demoWorkers: demoWorkers.map(labelOf),
        incidentsInserted: insertedIncidents.length,
        incidentsAlreadySeeded: existingIncidents.length > 0,
        checklists: checklists.length,
        assignments,
        checklistRuns,
      };
      return totals;
    }, { seedTag });

    console.log(JSON.stringify({ ok: issues.length === 0, seedTag, url: page.url(), result, issues }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
