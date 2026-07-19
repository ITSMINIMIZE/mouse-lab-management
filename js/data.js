/* ============================================================
 * iLAMP — Intelligent Laboratory Animal Management Platform (Prototype)
 * Mock data layer (in-memory only, no real database)
 * ============================================================ */

/* ------------------------------------------------------------------
 * PERMISSION MODEL — two tiers, additive
 *
 *  1) POSITION (ตำแหน่งระดับระบบ) — a user may hold SEVERAL, in
 *     `user.positions[]`. This is the person's job in the facility. Service
 *     positions (AV/VET/SCI/ACT) work across EVERY project because they
 *     physically handle the animals; oversight positions (IACUC/QA/AUDIT/EX)
 *     see every project read-only. GM never touches projects at all, and
 *     EXTERNAL only sees the projects they were appointed to.
 *
 *  2) PROJECT ROLE (บทบาทในโครงการ) — per project, in
 *     `project.members[] = { userId, roles[] }`. PI/COPI/AHS are the research
 *     team. SCI/VET/ACT may also be appointed to a single project and then
 *     carry the SAME caps as the system position of that name — but only
 *     inside that project. That is how an EXTERNAL vet can work on project A
 *     without seeing project B. For someone who already holds the system
 *     position, the appointment adds nothing (they could do it anyway), so it
 *     reads as a paper appointment — no separate "nominal" flag needed.
 *
 *  Effective capability = every POSITION's caps ∪ every PROJECT ROLE's caps.
 *  Nothing is ever subtracted: if any role grants it, the user has it.
 *  Always gate through App.can(cap, project) — never test a key directly.
 *
 *  IMPORTANT: project roles only take effect once the project is APPROVED.
 *  While it is waiting/rejected the project "does not exist yet": only
 *  `project.createdBy` may edit and resubmit it (plus AV, to review).
 * ------------------------------------------------------------------ */

// scope: 'all'    = sees every project without being appointed to it
//        'member' = only projects they are appointed to
const POSITIONS = {
  ADMIN:    { key: 'ADMIN',    label: 'ผู้ดูแลระบบ',                  scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'editProject', 'manageMembers', 'weigh', 'dosing', 'cageCare', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'stop', 'viewReports', 'approve', 'manageUsers', 'ochReport', 'viewSupply', 'viewFinance'] },
  AV:       { key: 'AV',       label: 'หัวหน้าสัตวแพทย์',              scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports', 'approve', 'manageUsers', 'manageMembers'] },
  VET:      { key: 'VET',      label: 'สัตวแพทย์',                    scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  SCI:      { key: 'SCI',      label: 'นักวิทยาศาสตร์',                scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:      { key: 'ACT',      label: 'เจ้าหน้าที่ดูแลสัตว์ทดลอง',      scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'flag', 'reportDeath', 'cageCare', 'viewSupply'] },
  IACUC:    { key: 'IACUC',    label: 'คณะกรรมการกำกับดูแล',          scope: 'all',    caps: ['view', 'enterProject', 'createProject'] },
  QA:       { key: 'QA',       label: 'หน่วยประกันคุณภาพ',             scope: 'all',    caps: ['view', 'enterProject', 'createProject'] },
  AUDIT:    { key: 'AUDIT',    label: 'ผู้ตรวจสอบ',                    scope: 'all',    caps: ['view', 'enterProject', 'createProject'] },
  // EX = QA + GM
  EX:       { key: 'EX',       label: 'ผู้บริหารหน่วยสัตว์ทดลอง',       scope: 'all',    caps: ['view', 'enterProject', 'createProject', 'viewSupply', 'viewFinance'] },
  // OCH inspects on site like a site-safety officer: sees the project cards but
  // deliberately has NO enterProject — clicking a card opens a safety report form.
  OCH:      { key: 'OCH',      label: 'เจ้าหน้าที่ชีวอนามัย',           scope: 'all',    caps: ['view', 'createProject', 'ochReport'] },
  // GM works the stockroom/finance side only — no `view` at all, so hasAccess()
  // keeps them out of every project and the โครงการ tab stays hidden.
  GM:       { key: 'GM',       label: 'เจ้าหน้าที่บริหารงานทั่วไป',      scope: 'all',    caps: ['viewSupply', 'viewFinance'] },
  EXTERNAL: { key: 'EXTERNAL', label: 'บุคคลภายนอก',                  scope: 'member', caps: ['view', 'enterProject', 'createProject'] },
};
const POSITION_ORDER = ['ADMIN', 'AV', 'VET', 'SCI', 'ACT', 'IACUC', 'QA', 'AUDIT', 'EX', 'OCH', 'GM', 'EXTERNAL'];

// Project-level roles. PI/COPI/AHS are the research team; SCI/VET/ACT mirror the
// system position of the same name but are confined to the one project.
const ROLES = {
  PI:   { key: 'PI',   label: 'PI (นักวิจัย)',            caps: ['view', 'enterProject', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports'] },
  COPI: { key: 'COPI', label: 'CoPI (นักวิจัยร่วม)',       caps: ['view', 'enterProject', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports'] },
  AHS:  { key: 'AHS',  label: 'AHS (นักวิจัยปฏิบัติการ)',  caps: ['view', 'enterProject', 'flag', 'reportDeath', 'dosing', 'viewReports'] },
  SCI:  { key: 'SCI',  label: 'Sci ประจำโครงการ',          caps: ['view', 'enterProject', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  VET:  { key: 'VET',  label: 'VET ประจำโครงการ',          caps: ['view', 'enterProject', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:  { key: 'ACT',  label: 'ACT ประจำโครงการ',          caps: ['view', 'enterProject', 'flag', 'reportDeath', 'cageCare'] },
};
const ROLE_ORDER = ['PI', 'COPI', 'AHS', 'SCI', 'VET', 'ACT'];

// capability catalogue (drives gating + the two permission matrices)
const CAPABILITIES = [
  { key: 'view',          label: 'เห็นโครงการในรายการ' },
  { key: 'enterProject',  label: 'เข้าไปดูกรง / หนู / ประวัติ' },
  { key: 'createProject', label: 'ยื่นขอสร้างโครงการ' },
  { key: 'editProject',   label: 'จัดการกรง / แก้ไขผังโครงการ' },
  { key: 'manageMembers', label: 'แต่งตั้ง / ถอดถอนสมาชิกโครงการ' },
  { key: 'weigh',         label: 'ชั่งน้ำหนัก + น้ำ/อาหาร + ตรวจสุขภาพเบื้องต้น' },
  { key: 'dosing',        label: 'ให้สารทดสอบ / หัตถการตามโปรโตคอล' },
  { key: 'cageCare',      label: 'ดูแลกรง (เปลี่ยน/เติมวัสดุรองนอน)' },
  { key: 'flag',          label: 'แจ้งหนูผิดปกติ (รอสัตวแพทย์ตรวจ)' },
  { key: 'treat',         label: 'ตรวจรักษา / ปิดเคส / Humane endpoint' },
  { key: 'reportDeath',   label: 'แจ้งหนูตาย (นำไปแช่แข็ง)' },
  { key: 'handleCarcass', label: 'จัดการซาก — ทำลาย / ชันสูตร' },
  { key: 'stop',          label: 'สั่ง Stop (ไม่คิดเฉลี่ย)' },
  { key: 'viewReports',   label: 'ดูหน้ากราฟ / ผลวิเคราะห์' },
  { key: 'approve',       label: 'อนุมัติ / ไม่อนุมัติโครงการ' },
  { key: 'manageUsers',   label: 'จัดการบัญชีผู้ใช้ระบบ' },
  { key: 'ochReport',     label: 'รายงานความปลอดภัย / ชีวอนามัย' },
  { key: 'viewSupply',    label: 'เข้าถึงงานคลัง' },
  { key: 'viewFinance',   label: 'เข้าถึงการเงิน' },
];

// mock user accounts. `positions` = the system-level jobs held (POSITIONS keys);
// a person may hold several and their caps add up.
// `name` is the display name kept in sync with firstName + lastName.
// `projectRole` (optional) marks a DEMO persona for a PROJECT role: that identity
// holds the role in EVERY approved project (see App.myProjectRoles override) so a
// client can switch and compare views without hunting for a project they belong to.
// In a real deployment nobody has `projectRole` — project.members drives it.
function makeUser(id, firstName, lastName, email, password, positions, projectRole) {
  return {
    id, firstName, lastName, email, password,
    positions: Array.isArray(positions) ? positions : [positions],
    projectRole: projectRole || null,
    name: `${firstName} ${lastName}`.trim(),
  };
}
const USERS = [
  // --- one persona per system position -------------------------------------
  makeUser('u_admin', 'Admin — ผู้ดูแลระบบ', '',            'admin@lab.test', 'admin1234', ['ADMIN']),
  makeUser('u_av',    'AV — หัวหน้าสัตวแพทย์', '',           'av@lab.test',    'demo1234',  ['AV']),
  makeUser('u_vet',   'VET — สัตวแพทย์', '',                'vet@lab.test',   'demo1234',  ['VET']),
  makeUser('u_scisys','Sci — นักวิทยาศาสตร์', '',            'sci@lab.test',   'demo1234',  ['SCI']),
  makeUser('u_act',   'ACT — จนท.ดูแลสัตว์ทดลอง', '',        'act@lab.test',   'demo1234',  ['ACT']),
  makeUser('u_iacuc', 'IACUC — คณะกรรมการกำกับดูแล', '',     'iacuc@lab.test', 'demo1234',  ['IACUC']),
  makeUser('u_qa',    'QA — หน่วยประกันคุณภาพ', '',           'qa@lab.test',    'demo1234',  ['QA']),
  makeUser('u_audit', 'Audit — ผู้ตรวจสอบ', '',              'audit@lab.test', 'demo1234',  ['AUDIT']),
  makeUser('u_ex',    'Ex — ผู้บริหารหน่วยสัตว์ทดลอง', '',    'ex@lab.test',    'demo1234',  ['EX']),
  makeUser('u_och',   'OCH — จนท.ชีวอนามัย', '',             'och@lab.test',   'demo1234',  ['OCH']),
  makeUser('u_gm',    'GM — จนท.บริหารงานทั่วไป', '',         'gm@lab.test',    'demo1234',  ['GM']),
  makeUser('u_ext',   'External — บุคคลภายนอก', '',          'ext@lab.test',   'demo1234',  ['EXTERNAL']),
  // --- personas for the project-level roles (research team) ----------------
  // These deliberately hold only EXTERNAL as their position, so switching to them
  // shows the PROJECT ROLE's capabilities and nothing else. Give them SCI as well
  // and they would inherit `weigh` from the position, which would hide the rule
  // that a PI/AHS cannot weigh unless separately appointed Sci of the project.
  makeUser('u_pi',    'PI — นักวิจัย', '',                   'pi@lab.test',    'demo1234',  ['EXTERNAL'], 'PI'),
  makeUser('u_copi',  'CoPI — นักวิจัยร่วม', '',              'copi@lab.test',  'demo1234',  ['EXTERNAL'], 'COPI'),
  makeUser('u_ahs',   'AHS — นักวิจัยปฏิบัติการ', '',         'ahs@lab.test',   'demo1234',  ['EXTERNAL'], 'AHS'),
  // a researcher who is ALSO appointed Sci of the project — the only way to weigh
  makeUser('u_pisci', 'PI + Sci — นักวิจัยที่ชั่งเองได้', '',  'pisci@lab.test', 'demo1234',  ['SCI'],      'PI'),
  // --- a persona holding TWO positions, to demo additive permissions -------
  makeUser('u_vetiacuc', 'VET + IACUC — ถือ 2 ตำแหน่ง', '',  'vet.iacuc@lab.test', 'demo1234', ['VET', 'IACUC']),
];

// ---- helpers for generating believable weight histories -----
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function rand(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// Build a 14-day weight series that drifts around a baseline.
function buildWeightSeries(baseline, trendPerDay, days = 14) {
  const series = [];
  let w = baseline - trendPerDay * days;
  for (let i = days; i >= 0; i--) {
    w += trendPerDay + rand(-0.4, 0.4);
    series.push({ date: isoDaysAgo(i), weight: Math.round(w * 10) / 10 });
  }
  return series;
}

// ------------------------------------------------------------
// Groups: one control group + treatment groups per project
// ------------------------------------------------------------
let _mouseSeq = 0;

function makeMouse(code, sex, baseline, trend) {
  _mouseSeq++;
  return {
    id: 'M' + _mouseSeq,
    code,
    sex,                       // 'M' | 'F'
    weights: buildWeightSeries(baseline, trend),
    remark: '',
    treatments: [],            // Sick Case Report entries: { date, time, vet, signs[], support[], diagnosis, treatment, recommend, note }
    excluded: false,           // "stopped": kept out of group-average stats (still eats/drinks)
    alive: true,
    // Death is recorded in TWO stages (see App.openDeathForm / openCarcassForm):
    //   stage 1 `reportDeath` — anyone who can see the mouse reports it dead; the
    //     carcass goes to the freezer:  carcass:'frozen', disposition:null
    //   stage 2 `handleCarcass` — SCI/VET decide per protocol:
    //     carcass:'done', disposition:'dispose' | 'necropsy' (+ necropsy record)
    death: null,               // { type:'natural'|'humane', carcass:'frozen'|'done', disposition:null|'dispose'|'necropsy', note, date, time, reporter, handledBy, handledAt }
    careOpen: false,           // vet case currently open (drives the cage "care" colour)
    flagOpen: false,           // "looks abnormal" flag raised by any member → orange !, awaits VET review
    flag: null,                // { by, note, date } — who reported and how it looks abnormal
    humaneOrder: null,         // vet order to euthanise: { reason, vet, date }
    necropsy: null,            // Necropsy Record (only when death.disposition==='necropsy'):
                               //   { date, time, examiner, results:{ [organ]:{v:'N'|'A'|'X', note} }, abnormal, avComment }
  };
}

// Generate a cage with N mice
function makeCage(id, code, groupId, shelf, position, mice, opts = {}) {
  return {
    id,
    code,
    groupId,
    shelf,
    position,
    mice,
    water: {
      remaining: opts.water ?? rand(180, 350),   // grams remaining
      added: null,
      // total grams consumed since last record (previous provided − current remaining)
      consumed: opts.waterConsumed ?? rand(5, 9) * (mice.length || 1),
    },
    food: {
      remaining: opts.food ?? rand(40, 120),      // grams remaining
      added: null,
      consumed: opts.foodConsumed ?? rand(3.5, 5.5) * (mice.length || 1),
    },
    status: opts.status ?? 'pending',             // 'done' | 'pending' | 'alert'
    lastRecordDate: opts.lastRecordDate ?? isoDaysAgo(1),
  };
}

// ------------------------------------------------------------
// Project 1 : NAFLD Diet Study — the main demo project.
// Layout: 4 shelves × 6 cages × 2 mice = 48 mice, 4 groups (control + 3 doses),
// one group per shelf. Every clinical case the app supports is seeded here.
// ------------------------------------------------------------
const groupsP1 = [
  { id: 'G1', name: 'Control',      isControl: true,  color: '#64748b' },
  { id: 'G2', name: 'Treatment-1',  isControl: false, color: '#2563eb' },
  { id: 'G3', name: 'Treatment-2',  isControl: false, color: '#7c3aed' },
  { id: 'G4', name: 'Treatment-3',  isControl: false, color: '#dc2626' },
];

// per-group weight profile (baseline weight + average daily gain)
const groupProfile = {
  G1: { baseline: 27.5, trend: 0.30 },   // control — normal healthy gain
  G2: { baseline: 28.0, trend: 0.22 },   // treatment-1 — slightly reduced gain
  G3: { baseline: 28.5, trend: 0.14 },   // treatment-2 — reduced gain
  G4: { baseline: 29.0, trend: 0.06 },   // treatment-3 — poorest gain
};

let _cageSeq = 0;
function nextCageId() { _cageSeq++; return 'C' + _cageSeq; }

// Layout: 4 shelves × 6 cages, 2 mice per cage (♂ + ♀). One group per shelf.
const shelfLetters = ['A', 'B', 'C', 'D'];
const cagesP1 = [];
for (let si = 0; si < 4; si++) {
  const groupId = groupsP1[si].id;
  const prof = groupProfile[groupId];
  const letter = shelfLetters[si];
  for (let pos = 1; pos <= 6; pos++) {
    const code = `${letter}-${String(pos).padStart(2, '0')}`;
    const mice = [];
    for (let k = 1; k <= 2; k++) {
      mice.push(makeMouse(`${code}-${k}`, k === 1 ? 'M' : 'F',
        prof.baseline + rand(-1.2, 1.2),
        prof.trend + rand(-0.05, 0.05)));
    }
    cagesP1.push(makeCage(nextCageId(), code, groupId, si + 1, pos, mice, {
      lastRecordDate: isoDaysAgo(1),
    }));
  }
}

// Seed one example of EVERY clinical case the app supports, so a demo can walk
// through the whole workflow without creating anything:
//   A-04-1  แจ้งผิดปกติ (flag, awaiting VET)      → cage orange
//   B-03-1  กำลังรักษา (open sick case)            → cage yellow
//   B-01-1  สั่งการุณยฆาต (humane order, pending)  → cage red
//   C-02-1  รักษาหายแล้ว (closed 3-visit timeline) → cage normal
//   C-02-2  Stop (ตัดออกจากค่าเฉลี่ย แต่ยังมีชีวิต)
//   D-01-2  ตาย · humane · ส่งชันสูตร (+ necropsy record)
//   C-04-2  ตาย · natural · ทำลายซาก (ไม่ชันสูตร)
(function seedTreatments() {
  // --- เคสรักษา: sick mouse in cage B-03, case still open → cage "care" ---
  const b03 = cagesP1.find(c => c.code === 'B-03');
  const sick = b03.mice[0];
  sick.remark = 'ซึม กินอาหารน้อยลง';
  const w = sick.weights;
  w[w.length - 1].weight = Math.round((w[w.length - 2].weight - 1.8) * 10) / 10;
  sick.treatments.push({
    date: isoDaysAgo(1),
    time: '09:30',
    vet: 'สพ.ญ. กมล',
    signs: ['Lethargic', 'Rough hair', 'Diarrhea'],
    support: ['Hydration gel', 'Soft food'],
    diagnosis: 'สงสัยติดเชื้อทางเดินอาหาร',
    treatment: 'ให้สารน้ำใต้ผิวหนัง + ติดตามอาการ 48 ชม.',
    recommend: 'Continue monitoring',
    note: '',
  });
  sick.careOpen = true;   // case still open → cage shows "care"

  // --- เคสรักษาที่หายแล้ว: multi-day treatment timeline, case closed ---
  const c02 = cagesP1.find(c => c.code === 'C-02');
  c02.mice[0].remark = 'เคยมีบาดแผลที่หาง · รักษาหายแล้ว';
  c02.mice[0].treatments.push(
    {
      date: isoDaysAgo(6), time: '10:15', vet: 'สพ. อนันต์',
      signs: ['Wound/Ulcer'], support: ['Topical wound care', 'Separate'],
      diagnosis: 'บาดแผลถลอกที่หาง', treatment: 'ทำความสะอาดแผล + ยาปฏิชีวนะเฉพาะที่',
      recommend: 'Continue Tx.', note: '',
    },
    {
      date: isoDaysAgo(4), time: '09:40', vet: 'สพ. อนันต์',
      signs: ['Wound/Ulcer'], support: ['Topical wound care'],
      diagnosis: 'แผลเริ่มแห้ง ไม่มีการติดเชื้อ', treatment: 'ทำแผลต่อ + ติดตามอาการ',
      recommend: 'Continue monitoring', note: '',
    },
    {
      date: isoDaysAgo(2), time: '11:00', vet: 'สพ. อนันต์',
      signs: [], support: [],
      diagnosis: 'แผลหายดี ขนขึ้นปกติ', treatment: 'ปิดเคส',
      recommend: '', note: 'หายเป็นปกติ',
    },
  );

  // --- เคสสั่งตาย: vet ordered humane endpoint, awaiting the experimenter ---
  const b01 = cagesP1.find(c => c.code === 'B-01');
  b01.mice[0].remark = 'น้ำหนักลดต่อเนื่อง เข้าเกณฑ์ endpoint';
  const bw = b01.mice[0].weights;
  bw[bw.length - 1].weight = Math.round((bw[bw.length - 2].weight - 2.4) * 10) / 10;
  b01.mice[0].humaneOrder = {
    reason: 'น้ำหนักลด >20% จากค่าเริ่มต้น และไม่ตอบสนองต่อการรักษา',
    vet: 'สพ.ญ. กมล',
    date: isoDaysAgo(1),
  };

  // --- เคสแจ้งป่วย: a member flagged a mouse as "looks abnormal" (orange !) ---
  const a04 = cagesP1.find(c => c.code === 'A-04');
  a04.mice[0].flagOpen = true;
  a04.mice[0].flag = { by: 'ก้อง วัฒนา (AHS)', note: 'ขนยุ่ง นั่งซึมมุมกรง ไม่ค่อยขยับ', date: isoDaysAgo(0) };

  // --- Stop: out of the group average but still alive and eating ---
  c02.mice[1].excluded = true;
  c02.mice[1].remark = 'ถูก Stop — ไม่นำไปคิดค่าเฉลี่ยกลุ่ม';

  // --- เคสตาย (1/2): humane endpoint → ส่งชันสูตร (มี Necropsy Record) ---
  const d01 = cagesP1.find(c => c.code === 'D-01');
  d01.mice[1].alive = false;
  d01.mice[1].excluded = true;
  d01.mice[1].death = {
    type: 'humane', carcass: 'done', disposition: 'necropsy',
    note: 'น้ำหนักลดต่อเนื่องเกินเกณฑ์ · เก็บตับและไตส่งตรวจ',
    date: isoDaysAgo(2), time: '13:30', reporter: 'สพ.ญ. กมล',
    handledBy: 'สพ.ญ. กมล', handledAt: isoDaysAgo(2),
  };
  d01.mice[1].necropsy = {
    date: isoDaysAgo(2),
    time: '14:00',
    examiner: 'สพ.ญ. กมล',
    results: {
      'Liver + Gall bladder':        { v: 'X', note: 'ตับซีด มีจุดขาวกระจาย สงสัยไขมันพอกตับ' },
      'Kidney and Urinary apparatus':{ v: 'X', note: 'ไตบวมโต ผิวขรุขระเล็กน้อย' },
      'Spleen':                      { v: 'N', note: '' },
      'Heart and blood vessels':     { v: 'N', note: '' },
      'Lung and Respiratory organ':  { v: 'A', note: '' },
    },
    abnormal: 'พบความผิดปกติที่ตับและไต สอดคล้องกับภาวะ NAFLD · เก็บชิ้นเนื้อตับ+ไตส่งพยาธิวิทยา',
    avComment: '',
  };

  // --- เคสตาย (2/2): found dead → ทำลายซาก (ไม่ชันสูตร) ---
  const c04 = cagesP1.find(c => c.code === 'C-04');
  c04.mice[1].alive = false;
  c04.mice[1].excluded = true;
  c04.mice[1].death = {
    type: 'natural', carcass: 'done', disposition: 'dispose',
    note: 'พบตายในกรงตอนเช้า ไม่มีอาการนำมาก่อน',
    date: isoDaysAgo(5), time: '08:15', reporter: 'นายสมชาย (AHS)',
    handledBy: 'Sci — นักวิทยาศาสตร์', handledAt: isoDaysAgo(5),
  };

  // --- เคสตาย (3/3): เพิ่งแจ้งตาย ยังแช่แข็งรอ SCI/VET ตัดสินใจ ---
  const a02 = cagesP1.find(c => c.code === 'A-02');
  a02.mice[1].alive = false;
  a02.mice[1].excluded = true;
  a02.mice[1].death = {
    type: 'natural', carcass: 'frozen', disposition: null,
    note: 'พบตายในกรงระหว่างเปลี่ยนวัสดุรองนอน',
    date: isoDaysAgo(0), time: '07:50', reporter: 'ก้อง วัฒนา (AHS)',
    handledBy: '', handledAt: '',
  };
})();

// ------------------------------------------------------------
// Project 4 : the finished (closed) demo project — small, view-only.
// ------------------------------------------------------------
const groupsDone = [
  { id: 'GD1', name: 'Control',   isControl: true,  color: '#64748b' },
  { id: 'GD2', name: 'Treatment', isControl: false, color: '#2563eb' },
];
const cagesDone = [];
for (let si = 0; si < 2; si++) {
  const groupId = groupsDone[si].id;
  const letter = shelfLetters[si];
  for (let pos = 1; pos <= 3; pos++) {
    const code = `${letter}-${String(pos).padStart(2, '0')}`;
    cagesDone.push(makeCage(nextCageId(), code, groupId, si + 1, pos, [
      makeMouse(`${code}-1`, 'M', 26.5 + rand(-1, 1), si === 0 ? 0.28 : 0.16),
      makeMouse(`${code}-2`, 'F', 25.5 + rand(-1, 1), si === 0 ? 0.26 : 0.15),
    ], { lastRecordDate: isoDaysAgo(96) }));
  }
}

// ------------------------------------------------------------
// Root DB object
// ------------------------------------------------------------
const DB = {
  users: USERS,
  currentUserId: 'u_pi',      // active identity (switchable for testing)
  projects: [
    {
      id: 'P1',
      createdBy: 'u_pi',
      name: 'NAFLD Diet Study',
      description: 'ศึกษาผลของอาหารไขมันสูงและยาต่อภาวะไขมันพอกตับในหนู C57BL/6',
      startDate: '2026-05-12',
      status: 'active',
      shelves: 4,
      cagesPerShelf: 6,
      groups: groupsP1,
      cages: cagesP1,
      // (seedTeam below replaces these with the standard demo team)
      members: [
        { userId: 'u_pi', roles: ['PI'] },
        { userId: 'u_copi', roles: ['COPI'] },
        { userId: 'u_ahs', roles: ['AHS'] },
        { userId: 'u_vet', roles: ['VET'] },
      ],
    },
    {
      id: 'P3',
      createdBy: 'u_pi',
      name: 'Behavioral Pilot',
      description: 'โครงการนำร่องพฤติกรรม — ดำเนินการครบตามแผนและปิดโครงการแล้ว',
      startDate: '2026-01-08',
      status: 'closed',
      shelves: 2,
      cagesPerShelf: 3,
      groups: groupsDone,
      cages: cagesDone,
      members: [{ userId: 'u_pi', roles: ['PI'] }],
    },
  ],
  // append-only activity log (visible to everyone for transparency)
  auditLog: [],
};

// seed a few historical log entries that match the demo state
(function seedAudit() {
  const DAY = 86400000;
  const now = Date.now();
  DB.auditLog.push(
    { ts: now - 5 * DAY, user: 'ดร. นภา ศรีสุข', role: 'PI', action: 'สร้างโครงการ', detail: 'NAFLD Diet Study · 4 ชั้น × 6 กรง กรงละ 2 ตัว', project: 'NAFLD Diet Study' },
    { ts: now - 5 * DAY + 7200000, user: 'สพ.ญ. อรุณ ทองดี', role: 'AV', action: 'อนุมัติโครงการ', detail: 'NAFLD Diet Study · เอกสารครบถ้วน', project: 'NAFLD Diet Study' },
    { ts: now - 6 * DAY, user: 'สพ. อนันต์', role: 'VET', action: 'บันทึกการรักษา', detail: 'C-02-1 · บาดแผลถลอกที่หาง', project: 'NAFLD Diet Study' },
    { ts: now - 5 * DAY, user: 'นายสมชาย (AHS)', role: 'ACT', action: 'บันทึกการตาย', detail: 'C-04-2 · พบตายในกรง · ทำลายซาก', project: 'NAFLD Diet Study' },
    { ts: now - 2 * DAY, user: 'สพ. อนันต์', role: 'VET', action: 'ปิดเคส', detail: 'C-02-1 · แผลหายดี ขนขึ้นปกติ', project: 'NAFLD Diet Study' },
    { ts: now - 2 * DAY + 3600000, user: 'สพ.ญ. กมล', role: 'VET', action: 'บันทึกการตาย', detail: 'D-01-2 · Humane endpoint · ส่งชันสูตร', project: 'NAFLD Diet Study' },
    { ts: now - 1 * DAY, user: 'สพ.ญ. กมล', role: 'VET', action: 'สั่ง Humane endpoint', detail: 'B-01-1 · น้ำหนักลด >20% ไม่ตอบสนองการรักษา', project: 'NAFLD Diet Study' },
    { ts: now - 1 * DAY + 900000, user: 'สพ.ญ. กมล', role: 'VET', action: 'บันทึกการรักษา', detail: 'B-03-1 · สงสัยติดเชื้อทางเดินอาหาร', project: 'NAFLD Diet Study' },
    { ts: now - 1 * DAY + 1800000, user: 'ปิยะ ใจดี (ACT)', role: 'ACT', action: 'ชั่งน้ำหนัก', detail: 'บันทึกกรง A-01', project: 'NAFLD Diet Study' },
    { ts: now - 6 * 3600000, user: 'ดร. นภา ศรีสุข', role: 'PI', action: 'Stop (ไม่คิดเฉลี่ย)', detail: 'C-02-2 · หยุดนำไปคิดค่าเฉลี่ยกลุ่ม', project: 'NAFLD Diet Study' },
    { ts: now - 3 * 3600000, user: 'ก้อง วัฒนา (AHS)', role: 'AHS', action: 'แจ้งผิดปกติ', detail: 'A-04-1 · ขนยุ่ง นั่งซึมมุมกรง', project: 'NAFLD Diet Study' },
  );
})();

// project documents (attached PDFs). In this prototype files live only in
// memory (object URLs / metadata) — a real backend would use object storage.
(function seedDocuments() {
  DB.projects.forEach(p => { if (!p.documents) p.documents = []; });
  const p1 = DB.projects.find(p => p.id === 'P1');
  p1.documents.push(
    { id: 'doc1', name: 'AR-Protocol_NAFLD_2026.pdf', size: 248000, category: 'โปรโตคอล (Protocol)', uploadedBy: 'ดร. นภา ศรีสุข', date: isoDaysAgo(40), url: null },
    { id: 'doc2', name: 'EC-Approval_2026-051.pdf', size: 132000, category: 'ใบอนุมัติ EC', uploadedBy: 'ดร. นภา ศรีสุข', date: isoDaysAgo(38), url: null },
    { id: 'doc3', name: 'SOP_Weighing-Procedure.pdf', size: 96000, category: 'SOP', uploadedBy: 'ปิยะ (นักวิทย์)', date: isoDaysAgo(20), url: null },
  );
})();

// project approval workflow: every project has an `approval` state
//   'waiting'  → newly created, awaiting AV (Attending Veterinarian) review
//   'approved' → AV approved → project is live
//   'rejected' → AV sent back with a reason (shown red; creator edits/deletes)
(function seedApproval() {
  DB.projects.forEach(p => { if (!p.approval) p.approval = 'approved'; });

  // a small helper to build a tiny demo project
  function tinyProject(id, name, description, creatorId, approval, extra = {}) {
    const groups = [
      { id: id + 'G1', name: 'Control', isControl: true, color: '#64748b' },
      { id: id + 'G2', name: 'Treatment', isControl: false, color: '#2563eb' },
    ];
    const cages = [];
    let seq = 0;
    for (let pos = 1; pos <= 2; pos++) {
      const code = `A-${String(pos).padStart(2, '0')}`;
      const mice = [makeMouse(`${id}-${code}-1`, 'M', 27 + rand(-1, 1), 0.2),
                    makeMouse(`${id}-${code}-2`, 'F', 26 + rand(-1, 1), 0.2)];
      cages.push(makeCage(`${id}-C${++seq}`, code, groups[pos - 1].id, 1, pos, mice));
    }
    return {
      id, name, description, startDate: todayISO(), status: 'active',
      createdBy: creatorId,
      approval, shelves: 1, cagesPerShelf: 2, groups, cages, documents: [],
      members: [{ userId: creatorId, roles: ['PI'] }],
      ...extra,
    };
  }

  // the two remaining demo states — status is shown by the card badge, so the
  // project names stay clean (no "(รออนุมัติ)" suffix)
  DB.projects.push(
    tinyProject('P5', 'Cardio Safety Study',
      'ประเมินความปลอดภัยต่อระบบหัวใจของสารทดสอบ', 'u_pi', 'waiting'),
    tinyProject('P6', 'Metabolic Screen',
      'คัดกรองผลต่อเมแทบอลิซึมในหนูทดลอง', 'u_pi', 'rejected',
      { rejectReason: 'ยังไม่แนบใบอนุมัติ EC และจำนวนสัตว์ต่อกลุ่มไม่สอดคล้องกับการคำนวณทางสถิติ', reviewedBy: 'สพ.ญ. อรุณ ทองดี (AV)', reviewedAt: isoDaysAgo(1) }),
  );
})();

// demo: give every project the same team so the members list is consistent when
// switching personas. PI/CoPI/AHS are the working research team; Sci/VET/ACT are
// the per-project appointments of the service positions.
(function seedTeam() {
  const TEAM = [
    { userId: 'u_pi',     roles: ['PI'] },
    { userId: 'u_copi',   roles: ['COPI'] },
    { userId: 'u_ahs',    roles: ['AHS'] },
    { userId: 'u_scisys', roles: ['SCI'] },
    { userId: 'u_vet',    roles: ['VET'] },
    { userId: 'u_act',    roles: ['ACT'] },
  ];
  DB.projects.forEach(p => { p.members = TEAM.map(m => ({ userId: m.userId, roles: [...m.roles] })); });
})();

// ---- derived helpers used across the app --------------------
const Data = {
  getProject(id) {
    return DB.projects.find(p => p.id === id);
  },
  getCage(project, cageId) {
    return project.cages.find(c => c.id === cageId);
  },
  getGroup(project, groupId) {
    return project.groups.find(g => g.id === groupId);
  },
  controlGroup(project) {
    return project.groups.find(g => g.isControl);
  },
  // mice counted in group-average statistics (alive and not stopped/excluded)
  inStats(m) {
    return m.alive && !m.excluded;
  },
  latestWeight(mouse) {
    return mouse.weights[mouse.weights.length - 1]?.weight ?? null;
  },
  prevWeight(mouse) {
    return mouse.weights[mouse.weights.length - 2]?.weight ?? null;
  },
  weightChange(mouse) {
    const a = this.latestWeight(mouse);
    const b = this.prevWeight(mouse);
    if (a == null || b == null) return null;
    return Math.round((a - b) * 10) / 10;
  },
  cageAvgWeight(cage) {
    if (!cage.mice.length) return null;
    const sum = cage.mice.reduce((s, m) => s + (this.latestWeight(m) ?? 0), 0);
    return Math.round((sum / cage.mice.length) * 10) / 10;
  },
  cageAvgChange(cage) {
    if (!cage.mice.length) return null;
    const sum = cage.mice.reduce((s, m) => s + (this.weightChange(m) ?? 0), 0);
    return Math.round((sum / cage.mice.length) * 10) / 10;
  },
  // control-group average weight-change on the latest day
  controlAvgChange(project) {
    const cg = this.controlGroup(project);
    if (!cg) return null;
    const mice = project.cages
      .filter(c => c.groupId === cg.id)
      .flatMap(c => c.mice)
      .filter(m => this.inStats(m));
    if (!mice.length) return null;
    const sum = mice.reduce((s, m) => s + (this.weightChange(m) ?? 0), 0);
    return Math.round((sum / mice.length) * 10) / 10;
  },
};
