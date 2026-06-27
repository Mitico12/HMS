// config.js — shared Supabase client + helpers for both admin.html and user.html.
// Imported as an ES module: <script type="module"> import { db, ... } from './config.js'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── FILL THESE IN ───────────────────────────────────────────
// Project settings → API. The anon key is safe to ship client-side;
// Row Level Security in schema.sql is what actually protects the data.
const SUPABASE_URL = 'https://vtiobzmsalsvwocvlotm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BfCizLoxWkUk2L9sUXzv9w_M5TdA3uD';
// ─────────────────────────────────────────────────────────────

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A throwaway auth client used by admins when creating accounts.
// It prevents the admin's own browser session from being replaced by the new user session.
export function newAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

// Return the signed-in user's profile (with role), or null.
export async function currentProfile() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

// Guard a page: ensure someone is signed in, optionally that they're admin.
// Redirects to the login screen handled inside each page if not.
export async function requireSession({ admin = false } = {}) {
  const profile = await currentProfile();
  if (!profile) return { ok: false, reason: 'no-session' };
  if (admin && !['admin', 'super_admin'].includes(profile.role)) return { ok: false, reason: 'not-admin', profile };
  return { ok: true, profile };
}

// Tiny DOM helper: el('div', { class: 'x' }, [children]) or el('div', 'text').
export function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  if (typeof props === 'string') { node.textContent = props; return node; }
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid == null) continue;
    node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');
}

export function themeToggleButton() {
  initTheme();
  const btn = el('button', { class: 'iconbtn theme-toggle', title: t('toggleDarkMode'), onclick: toggleTheme }, themeIcon());
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    btn.textContent = themeIcon();
  }
  return btn;
}

function themeIcon() {
  return document.documentElement.dataset.theme === 'dark' ? '☀' : '◐';
}

const LANG_KEY = 'language';
const DEFAULT_LANG = 'en';

const TEXT = {
  en: {
    access: 'Access',
    accountsAccess: 'Accounts & access',
    actionLog: 'Action log',
    add: 'Add',
    addActionNote: 'Add action / note',
    addField: '+ Add field',
    addGroup: 'Add group',
    addItem: '+ Add item',
    addToLog: 'Add to log',
    addUser: '+ Add user',
    adminConsole: 'Admin console',
    adminConsoleMeta: 'Manage groups, incidents, and access',
    all: 'All',
    allChecklists: 'All checklists',
    allTypes: 'All types',
    anonymous: 'Anonymous',
    archive: 'Archive',
    archived: 'Archived',
    archivedReports: 'Archived reports',
    checklistLogs: 'Checklist logs',
    dateFrom: 'From',
    dateUntil: 'Until',
    dashboardPeriod: 'Dashboard period',
    periodPrompt: 'Use YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.',
    invalidPeriod: 'Use YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.',
    exportExcel: 'Export to Excel',
    filterByType: 'Report type',
    filterByUser: 'User',
    hazard: 'Hazard',
    hazardConsequences: 'What could it lead to?',
    notifications: 'Notifications',
    notifyAll: 'Every report',
    notifyOff: 'Off',
    notifyRed: 'Emergencies only',
    reportHazard: 'Report hazard',
    roundNearest: 'Nearest',
    roundUp: 'Round up',
    sliderRound: 'Display',
    unarchive: 'Unarchive',
    whatHazard: 'What is the hazard?',
    whenSpotted: 'When did you notice it?',
    anyAssignee: 'Any assignee',
    anyReporter: 'Anyone',
    filterByAssignee: 'Assigned admin',
    filterByReporter: 'Reported by',
    inProgressAssignedToYou: 'In progress assigned to you',
    unassigned: 'Unassigned',
    assignedTo: 'Assigned to',
    attachments: 'Pictures',
    changeRequests: 'Change requests',
    checklist: 'Checklist',
    checklistComplete: 'Checklist submitted.',
    checklistTypeCheck: 'Check',
    checklistTypeChoice: 'Multiple choice',
    checklistTypeText: 'Text',
    checklistsCompletedInPeriod: 'Completed checklists',
    checklistsCompletedToday: 'Completed checklists today',
    checklistLogNeedsAttention: 'Needs review',
    checklistLogsMeta: 'Completed checklist history',
    checklistNotesPlaceholder: 'Write any notes before submitting.',
    checklistProgress: '{done} of {total} complete',
    checklists: 'Checklists',
    choose: 'Choose',
    closeCase: 'Close case',
    completeChecklist: 'Complete checklist',
    completed: 'Completed',
    consequence: 'Consequence',
    createAccount: 'Create account',
    createOne: 'Create one',
    deleteChecklist: 'Delete checklist',
    deleteLog: 'Delete log',
    deleteProcedure: 'Delete procedure',
    description: 'Description',
    documents: 'Documents',
    dragReorder: 'Drag to reorder',
    draft: 'draft',
    draftSaved: 'Draft saved.',
    edit: 'Edit',
    editChecklist: 'Edit checklist',
    editProcedure: 'Edit procedure',
    email: 'Email',
    enterLogin: 'Enter your username or email and password.',
    entries: 'Entries',
    field: 'Field {n}',
    fields: 'fields',
    finalReport: 'Final report',
    groups: 'Groups',
    haveAccount: 'Have an account? Sign in',
    incident: 'Incident',
    incidentCategories: 'Incident categories',
    incidentReports: 'Incident reports',
    inProgress: 'In progress',
    items: '{count} items',
    language: 'Language',
    languageSaved: 'Language updated.',
    label: 'Label',
    itemImage: 'Image',
    locationOptional: 'Location (optional)',
    logs: 'Logs',
    missingItems: '{count} missing',
    myReports: 'My reports',
    name: 'Name',
    needAccount: 'Need an account? ',
    newChecklist: 'New checklist',
    newGroup: 'New group',
    newProcedure: 'New procedure',
    noChecklistLogs: 'No checklist logs yet.',
    noChecklists: 'No checklists yet',
    noChecklistsHint: 'Tap + to build one.',
    noDocuments: 'No documents',
    noDocumentsHint: 'Nothing shared here yet.',
    noEntries: 'No entries yet',
    noEntriesHint: 'Submissions from users appear here.',
    noIncidents: 'No incidents reported',
    noIncidentsHint: 'Reports submitted by users land here.',
    noProcedures: 'No procedures yet',
    noProceduresHint: 'Build a form users can fill in.',
    noReports: 'No reports',
    noReportsHint: 'Incidents you report will appear here.',
    notes: 'Notes',
    open: 'Open',
    openWithConsequences: 'Open with consequences',
    optionsComma: 'Options (comma-separated)',
    other: 'Other',
    removeImage: 'Remove image',
    password: 'Password',
    photosOptional: 'Pictures (optional)',
    processing: 'Processing',
    procedures: 'Procedures',
    published: 'published',
    publish: 'Publish',
    reportAnonymously: 'Report anonymously',
    reportIncident: 'Report incident',
    reports: 'Reports',
    reportsClosedInPeriod: 'Reports closed',
    reportsClosedToday: 'Reports closed today',
    reportsInPeriod: 'Reported incidents',
    reportsToday: 'Reports today',
    requestChange: 'Request change',
    required: 'Required',
    resolved: 'Resolved',
    returnStart: 'Return to start',
    rootCause: 'Root cause',
    saveAssignment: 'Save assignment',
    saveChecklist: 'Save checklist',
    saveDraft: 'Save draft',
    saveFinalReport: 'Save final report',
    selectTypeCheckbox: 'Checkbox',
    selectTypeCheckboxes: 'Checkboxes (multiple)',
    selectTypeDropdown: 'Dropdown',
    selectTypeLong: 'Long text',
    selectTypeNumber: 'Number',
    selectTypeShort: 'Short text',
    selectTypeSlider: 'Slider',
    sliderLeft: 'Left label',
    sliderMax: 'Max',
    sliderMin: 'Min',
    sliderRight: 'Right label',
    settings: 'Settings',
    signIn: 'Sign in',
    signInContinue: 'Sign in to continue.',
    signInTools: 'Sign in to your workplace tools.',
    signOut: 'Sign out',
    signedInAs: 'Signed in as {name}.',
    submit: 'Submit',
    submitReport: 'Submit report',
    submitted: 'Submitted',
    submittedAnswers: 'Submitted answers',
    submittedPhoto: 'Submitted picture',
    title: 'Title',
    toggleDarkMode: 'Toggle dark mode',
    type: 'Type',
    upload: 'Upload',
    uploadDocument: 'Upload a document',
    users: 'Users',
    usernameOrEmail: 'Username or email',
    userEmailNotFound: 'No account found for that username.',
    waitingApproval: 'Waiting for approval',
    whatHappened: 'What happened?',
    whatHappenedTitle: 'What happened',
    whatNeedsFixing: 'What needs fixing?',
    whenHappened: 'When did it happen?',
    workerApp: 'Worker app',
    workerAppMeta: 'Checklists, reports, and documents',
    questionImage: 'Checklist picture',
    yourRecentReports: 'Your recent reports',
    yourReport: 'Your report',
    yourDetails: 'Your details',
  },
  no: {
    access: 'Tilgang',
    accountsAccess: 'Kontoer og tilgang',
    actionLog: 'Handlingslogg',
    add: 'Legg til',
    addActionNote: 'Legg til handling / notat',
    addField: '+ Legg til felt',
    addGroup: 'Legg til gruppe',
    addItem: '+ Legg til punkt',
    addToLog: 'Legg til i logg',
    addUser: '+ Legg til bruker',
    adminConsole: 'Administrasjon',
    adminConsoleMeta: 'Administrer grupper, hendelser og tilgang',
    all: 'Alle',
    allChecklists: 'Alle sjekklister',
    allTypes: 'Alle typer',
    anonymous: 'Anonym',
    archive: 'Arkiver',
    archived: 'Arkivert',
    archivedReports: 'Arkiverte rapporter',
    checklistLogs: 'Sjekklistelogger',
    dateFrom: 'Fra',
    dateUntil: 'Til',
    dashboardPeriod: 'Dashboardperiode',
    periodPrompt: 'Bruk YYYY-MM-DD eller YYYY-MM-DD..YYYY-MM-DD.',
    invalidPeriod: 'Bruk YYYY-MM-DD eller YYYY-MM-DD..YYYY-MM-DD.',
    exportExcel: 'Eksporter til Excel',
    filterByType: 'Rapporttype',
    filterByUser: 'Bruker',
    hazard: 'Fare',
    hazardConsequences: 'Hva kan det føre til?',
    notifications: 'Varslinger',
    notifyAll: 'Alle rapporter',
    notifyOff: 'Av',
    notifyRed: 'Kun nødstilfeller',
    reportHazard: 'Rapporter fare',
    roundNearest: 'Nærmeste',
    roundUp: 'Rund opp',
    sliderRound: 'Visning',
    unarchive: 'Gjenopprett',
    whatHazard: 'Hva er faren?',
    whenSpotted: 'Når oppdaget du den?',
    anyAssignee: 'Alle tildelte',
    anyReporter: 'Alle',
    filterByAssignee: 'Tildelt admin',
    filterByReporter: 'Rapportert av',
    unassigned: 'Ikke tildelt',
    assignedTo: 'Tildelt til',
    inProgressAssignedToYou: 'Pagar og tildelt deg',
    attachments: 'Bilder',
    changeRequests: 'Endringsforesporsler',
    checklist: 'Sjekkliste',
    checklistComplete: 'Sjekkliste sendt inn.',
    checklistTypeCheck: 'Avkryssing',
    checklistTypeChoice: 'Flervalg',
    checklistTypeText: 'Tekst',
    checklistsCompletedInPeriod: 'Fullforte sjekklister',
    checklistsCompletedToday: 'Fullforte sjekklister i dag',
    checklistLogNeedsAttention: 'Ma ses gjennom',
    checklistLogsMeta: 'Historikk for innsendte sjekklister',
    checklistNotesPlaceholder: 'Skriv eventuelle notater for innsending.',
    checklistProgress: '{done} av {total} fullfort',
    checklists: 'Sjekklister',
    choose: 'Velg',
    closeCase: 'Lukk sak',
    completeChecklist: 'Fullfor sjekkliste',
    completed: 'Fullfort',
    consequence: 'Konsekvens',
    createAccount: 'Opprett konto',
    createOne: 'Opprett en',
    deleteChecklist: 'Slett sjekkliste',
    deleteLog: 'Slett logg',
    deleteProcedure: 'Slett prosedyre',
    description: 'Beskrivelse',
    documents: 'Dokumenter',
    dragReorder: 'Dra for å endre rekkefølge',
    draft: 'utkast',
    draftSaved: 'Utkast lagret.',
    edit: 'Rediger',
    editChecklist: 'Rediger sjekkliste',
    editProcedure: 'Rediger prosedyre',
    email: 'E-post',
    enterLogin: 'Skriv inn brukernavn eller e-post og passord.',
    entries: 'Innsendinger',
    field: 'Felt {n}',
    fields: 'felt',
    finalReport: 'Sluttrapport',
    groups: 'Grupper',
    haveAccount: 'Har du konto? Logg inn',
    incident: 'Hendelse',
    incidentCategories: 'Hendelseskategorier',
    incidentReports: 'Hendelsesrapporter',
    inProgress: 'Pagar',
    items: '{count} punkter',
    language: 'Språk',
    languageSaved: 'Språk oppdatert.',
    label: 'Etikett',
    itemImage: 'Bilde',
    locationOptional: 'Sted (valgfritt)',
    logs: 'Logger',
    missingItems: '{count} mangler',
    myReports: 'Mine rapporter',
    name: 'Navn',
    needAccount: 'Trenger du konto? ',
    newChecklist: 'Ny sjekkliste',
    newGroup: 'Ny gruppe',
    newProcedure: 'Ny prosedyre',
    noChecklistLogs: 'Ingen sjekklistelogger enna.',
    noChecklists: 'Ingen sjekklister enna',
    noChecklistsHint: 'Trykk + for a lage en.',
    noDocuments: 'Ingen dokumenter',
    noDocumentsHint: 'Ingenting er delt her enna.',
    noEntries: 'Ingen innsendinger enna',
    noEntriesHint: 'Innsendinger fra brukere vises her.',
    noIncidents: 'Ingen hendelser rapportert',
    noIncidentsHint: 'Rapporter fra brukere vises her.',
    noProcedures: 'Ingen prosedyrer enna',
    noProceduresHint: 'Lag et skjema brukere kan fylle ut.',
    noReports: 'Ingen rapporter',
    noReportsHint: 'Hendelser du rapporterer vises her.',
    notes: 'Notater',
    open: 'Apen',
    openWithConsequences: 'Apen med konsekvenser',
    optionsComma: 'Valg (kommaseparert)',
    other: 'Annet',
    removeImage: 'Fjern bilde',
    password: 'Passord',
    photosOptional: 'Bilder (valgfritt)',
    processing: 'Behandling',
    procedures: 'Prosedyrer',
    published: 'publisert',
    publish: 'Publiser',
    reportAnonymously: 'Rapporter anonymt',
    reportIncident: 'Rapporter hendelse',
    reports: 'Rapporter',
    reportsClosedInPeriod: 'Rapporter lukket',
    reportsClosedToday: 'Rapporter lukket i dag',
    reportsInPeriod: 'Rapporterte hendelser',
    reportsToday: 'Rapporter i dag',
    requestChange: 'Be om endring',
    required: 'Pakrevd',
    resolved: 'Lost',
    returnStart: 'Tilbake til start',
    rootCause: 'Rotarsak',
    saveAssignment: 'Lagre tildeling',
    saveChecklist: 'Lagre sjekkliste',
    saveDraft: 'Lagre utkast',
    saveFinalReport: 'Lagre sluttrapport',
    selectTypeCheckbox: 'Avkryssing',
    selectTypeCheckboxes: 'Avkryssing (flere)',
    selectTypeDropdown: 'Nedtrekk',
    selectTypeLong: 'Lang tekst',
    selectTypeNumber: 'Tall',
    selectTypeShort: 'Kort tekst',
    selectTypeSlider: 'Skala',
    sliderLeft: 'Venstre etikett',
    sliderMax: 'Maks',
    sliderMin: 'Min',
    sliderRight: 'Høyre etikett',
    settings: 'Innstillinger',
    signIn: 'Logg inn',
    signInContinue: 'Logg inn for å fortsette.',
    signInTools: 'Logg inn for å bruke verktøyene.',
    signOut: 'Logg ut',
    signedInAs: 'Logget inn som {name}.',
    submit: 'Send inn',
    submitReport: 'Send rapport',
    submitted: 'Sendt inn',
    submittedAnswers: 'Innsendte svar',
    submittedPhoto: 'Innsendt bilde',
    title: 'Tittel',
    toggleDarkMode: 'Bytt mørk modus',
    type: 'Type',
    upload: 'Last opp',
    uploadDocument: 'Last opp dokument',
    users: 'Brukere',
    usernameOrEmail: 'Brukernavn eller e-post',
    userEmailNotFound: 'Fant ingen konto med det brukernavnet.',
    waitingApproval: 'Venter pa godkjenning',
    whatHappened: 'Hva skjedde?',
    whatHappenedTitle: 'Hva skjedde',
    whatNeedsFixing: 'Hva ma rettes?',
    whenHappened: 'Nar skjedde det?',
    workerApp: 'Arbeiderapp',
    workerAppMeta: 'Sjekklister, rapporter og dokumenter',
    questionImage: 'Sjekklistebilde',
    yourRecentReports: 'Dine siste rapporter',
    yourReport: 'Din rapport',
    yourDetails: 'Dine detaljer',
  },
};

export const languages = [
  ['en', 'English'],
  ['no', 'Norsk'],
];

export function initLanguage() {
  const saved = localStorage.getItem(LANG_KEY);
  const lang = TEXT[saved] ? saved : DEFAULT_LANG;
  document.documentElement.lang = lang;
  localStorage.setItem(LANG_KEY, lang);
  return lang;
}

export function currentLanguage() {
  return initLanguage();
}

export function setLanguage(lang) {
  const next = TEXT[lang] ? lang : DEFAULT_LANG;
  localStorage.setItem(LANG_KEY, next);
  document.documentElement.lang = next;
  return next;
}

export function t(key, vars = {}) {
  const lang = currentLanguage();
  const template = TEXT[lang]?.[key] || TEXT[DEFAULT_LANG][key] || key;
  return Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value ?? ''), template);
}

export function languageSelect(onChange = null) {
  const select = el('select', { class: 'language-select', title: t('language') },
    languages.map(([code, label]) => el('option', { value: code }, label)));
  select.value = currentLanguage();
  select.addEventListener('change', () => {
    setLanguage(select.value);
    if (onChange) onChange(select.value);
  });
  return labeledSelect(t('language'), select);
}

function labeledSelect(label, select) {
  return el('label', { class: 'field language-field' }, [el('span', {}, label), select]);
}

// Format an ISO timestamp as a short local string.
export function fmt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Lightweight toast.
export function toast(msg, kind = 'ok') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.appendChild(host);
  }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}
