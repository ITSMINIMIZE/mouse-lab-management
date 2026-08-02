/* ============================================================
 * iLAMP — Intelligent Laboratory Animal Management Platform (Prototype)
 * Mock data layer (in-memory only, no real database)
 * ============================================================ */

/* ------------------------------------------------------------------
 * PERMISSION MODEL — two tiers, additive
 *
 *  1) POSITION (ตำแหน่งระดับระบบ) — EXACTLY ONE per account, in
 *     `user.position`. This is the person's job in the facility; nobody holds
 *     two system positions. Service positions (AV/VET/SCI/ACT) work across
 *     EVERY project because they physically handle the animals; oversight
 *     positions (AEC/IACUC/QA/AUDIT/EX) see every project read-only. GM never
 *     touches projects at all, and EXTERNAL only sees projects it was appointed to.
 *
 *  2) PROJECT ROLE (บทบาทในโครงการ) — per project, in
 *     `project.members[] = { userId, roles[] }`. PI/COPI/AHS are the research
 *     team. SCI/VET/ACT may also be appointed to a single project and then
 *     carry the SAME caps as the system position of that name — but only inside
 *     that project. That is how an EXTERNAL vet can work on project A without
 *     seeing project B. A person's "second role" ONLY ever comes from a project
 *     role — e.g. an internal Sci who wants to run a study becomes PI of that
 *     project (keeping their Sci powers). An outsider is only ever EXTERNAL: a
 *     real-life vet with no system VET position gets no vet powers, just PI/CoPI
 *     of the project they were appointed to.
 *
 *  Effective capability = the ONE position's caps ∪ every project role's caps.
 *  Nothing is ever subtracted: if the position or any project role grants it,
 *  the user has it. Always gate through App.can(cap, project) — never a key.
 *
 *  IMPORTANT: project roles only take effect once the project is APPROVED.
 *  While it is waiting/rejected the project "does not exist yet": only
 *  `project.createdBy` may edit and resubmit it (plus AV, to review).
 * ------------------------------------------------------------------ */

// scope: 'all'    = sees every project without being appointed to it
//        'member' = only projects they are appointed to
const POSITIONS = {
  ADMIN:    { key: 'ADMIN',    label: 'ผู้ดูแลระบบ',                  scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'editProject', 'manageMembers', 'weigh', 'dosing', 'cageCare', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'stop', 'viewReports', 'approve', 'manageUsers', 'ochReport', 'viewSupply', 'viewFinance'] },
  AV:       { key: 'AV',       label: 'หัวหน้าสัตวแพทย์',              scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports', 'approve', 'manageUsers', 'manageMembers'] },
  VET:      { key: 'VET',      label: 'สัตวแพทย์',                    scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  SCI:      { key: 'SCI',      label: 'นักวิทยาศาสตร์',                scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:      { key: 'ACT',      label: 'เจ้าหน้าที่ดูแลสัตว์ทดลอง',      scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'flag', 'reportDeath', 'cageCare', 'viewSupply'] },
  // AEC = สำนักเลขานุการคณะกรรมการจริยธรรมการใช้สัตว์ทดลอง — like IACUC (read-only
  // across projects) but can approve/reject a PI's project REQUEST at stage 1.
  // AEC reviews the paperwork only: it reads a project's DETAILS (the info popup)
  // but never steps inside — no enterProject, so the dashboard is closed to it.
  AEC:      { key: 'AEC',      label: 'สำนักเลขาฯ คกก.จริยธรรมการใช้สัตว์ทดลอง', scope: 'all', caps: ['view', 'createProject', 'reviewAEC'] },
  // IACUC/AUDIT walk the dashboard to see the layout, but no `viewCage`: the cage
  // cards are not clickable for them, so no per-animal record opens.
  IACUC:    { key: 'IACUC',    label: 'คณะกรรมการกำกับดูแล',          scope: 'all',    caps: ['view', 'enterProject', 'createProject'] },
  QA:       { key: 'QA',       label: 'หน่วยประกันคุณภาพ',             scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject'] },
  AUDIT:    { key: 'AUDIT',    label: 'ผู้ตรวจสอบ',                    scope: 'all',    caps: ['view', 'enterProject', 'createProject'] },
  // EX reads details like AEC (no enterProject) but keeps งานคลัง / การเงิน
  EX:       { key: 'EX',       label: 'ผู้บริหารหน่วยสัตว์ทดลอง',       scope: 'all',    caps: ['view', 'createProject', 'viewSupply', 'viewFinance'] },
  // OCH inspects on site like a site-safety officer: sees the project cards but
  // deliberately has NO enterProject — clicking a card opens a safety report form.
  OCH:      { key: 'OCH',      label: 'เจ้าหน้าที่ชีวอนามัย',           scope: 'all',    caps: ['view', 'createProject', 'ochReport'] },
  // GM works the stockroom/finance side only — no `view` at all, so hasAccess()
  // keeps them out of every project and the โครงการ tab stays hidden.
  GM:       { key: 'GM',       label: 'เจ้าหน้าที่บริหารงานทั่วไป',      scope: 'all',    caps: ['viewSupply', 'viewFinance'] },
  EXTERNAL: { key: 'EXTERNAL', label: 'บุคคลภายนอก',                  scope: 'member', caps: ['view', 'enterProject', 'viewCage', 'createProject'] },
};
const POSITION_ORDER = ['ADMIN', 'AV', 'VET', 'SCI', 'ACT', 'AEC', 'IACUC', 'QA', 'AUDIT', 'EX', 'OCH', 'GM', 'EXTERNAL'];

// Project-level roles. PI/COPI/AHS are the research team; SCI/VET/ACT mirror the
// system position of the same name but are confined to the one project.
const ROLES = {
  PI:   { key: 'PI',   label: 'PI (นักวิจัย)',            caps: ['view', 'enterProject', 'viewCage', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports'] },
  COPI: { key: 'COPI', label: 'CoPI (นักวิจัยร่วม)',       caps: ['view', 'enterProject', 'viewCage', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports'] },
  AHS:  { key: 'AHS',  label: 'AHS (นักวิจัยปฏิบัติการ)',  caps: ['view', 'enterProject', 'viewCage', 'flag', 'reportDeath', 'dosing', 'viewReports'] },
  SCI:  { key: 'SCI',  label: 'Sci ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  VET:  { key: 'VET',  label: 'VET ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:  { key: 'ACT',  label: 'ACT ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'flag', 'reportDeath', 'cageCare'] },
};
const ROLE_ORDER = ['PI', 'COPI', 'AHS', 'SCI', 'VET', 'ACT'];

// capability catalogue (drives gating + the two permission matrices)
const CAPABILITIES = [
  { key: 'view',          label: 'เห็นโครงการในรายการ' },
  { key: 'enterProject',  label: 'เข้าหน้าโครงการ (ผังกรง)' },
  { key: 'viewCage',      label: 'กดดูการ์ดรายกรง / ประวัติหนูรายตัว' },
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
  { key: 'reviewAEC',     label: 'ตรวจ/อนุมัติคำขอสร้างโครงการ (จริยธรรม)' },
  { key: 'approve',       label: 'สร้างโครงการจริง / ตีกลับ (สัตวแพทย์)' },
  { key: 'manageUsers',   label: 'จัดการบัญชีผู้ใช้ระบบ' },
  { key: 'ochReport',     label: 'รายงานความปลอดภัย / ชีวอนามัย' },
  { key: 'viewSupply',    label: 'เข้าถึงงานคลัง' },
  { key: 'viewFinance',   label: 'เข้าถึงการเงิน' },
];

// mock user accounts. `position` = the ONE system-level job (a POSITIONS key).
// `name` is the display name kept in sync with firstName + lastName.
// `projectRole` (optional) marks a DEMO persona for a PROJECT role: that identity
// holds the role in EVERY approved project (see App.myProjectRoles override) so a
// client can switch and compare views without hunting for a project they belong to.
// In a real deployment nobody has `projectRole` — project.members drives it.
function makeUser(id, firstName, lastName, email, password, position, projectRole, phone) {
  return {
    id, firstName, lastName, email, password,
    position: Array.isArray(position) ? position[0] : position,
    projectRole: projectRole || null,
    // เบอร์ติดต่อ — ใช้เติมอัตโนมัติตอนผู้ตรวจตีกลับคำขอ (AEC/AV)
    phone: phone || '053-935-000',
    name: `${firstName} ${lastName}`.trim(),
  };
}
const USERS = [
  // --- one persona per system position -------------------------------------
  makeUser('u_admin', 'Admin — ผู้ดูแลระบบ', '',            'admin@lab.test', 'admin1234', 'ADMIN'),
  makeUser('u_av',    'AV — หัวหน้าสัตวแพทย์', '',           'av@lab.test',    'demo1234',  'AV'),
  makeUser('u_vet',   'VET — สัตวแพทย์', '',                'vet@lab.test',   'demo1234',  'VET'),
  makeUser('u_scisys','Sci — นักวิทยาศาสตร์', '',            'sci@lab.test',   'demo1234',  'SCI'),
  makeUser('u_act',   'ACT — จนท.ดูแลสัตว์ทดลอง', '',        'act@lab.test',   'demo1234',  'ACT'),
  makeUser('u_aec',   'AEC — สำนักเลขาฯ จริยธรรม', '',        'aec@lab.test',   'demo1234',  'AEC'),
  makeUser('u_iacuc', 'IACUC — คณะกรรมการกำกับดูแล', '',     'iacuc@lab.test', 'demo1234',  'IACUC'),
  makeUser('u_qa',    'QA — หน่วยประกันคุณภาพ', '',           'qa@lab.test',    'demo1234',  'QA'),
  makeUser('u_audit', 'Audit — ผู้ตรวจสอบ', '',              'audit@lab.test', 'demo1234',  'AUDIT'),
  makeUser('u_ex',    'Ex — ผู้บริหารหน่วยสัตว์ทดลอง', '',    'ex@lab.test',    'demo1234',  'EX'),
  makeUser('u_och',   'OCH — จนท.ชีวอนามัย', '',             'och@lab.test',   'demo1234',  'OCH'),
  makeUser('u_gm',    'GM — จนท.บริหารงานทั่วไป', '',         'gm@lab.test',    'demo1234',  'GM'),
  makeUser('u_ext',   'External — บุคคลภายนอก', '',          'ext@lab.test',   'demo1234',  'EXTERNAL'),
  // --- personas for the project-level roles (research team) ----------------
  // These deliberately hold only EXTERNAL as their position, so switching to them
  // shows the PROJECT ROLE's capabilities and nothing else. Give them SCI as well
  // and they would inherit `weigh` from the position, which would hide the rule
  // that a PI/AHS cannot weigh unless separately appointed Sci of the project.
  makeUser('u_pi',    'PI — นักวิจัย', '',                   'pi@lab.test',    'demo1234',  'EXTERNAL', 'PI'),
  makeUser('u_copi',  'CoPI — นักวิจัยร่วม', '',              'copi@lab.test',  'demo1234',  'EXTERNAL', 'COPI'),
  makeUser('u_ahs',   'AHS — นักวิจัยปฏิบัติการ', '',         'ahs@lab.test',   'demo1234',  'EXTERNAL', 'AHS'),
  // an internal Sci who is ALSO PI of a project — the intended "two roles" case:
  // system position (Sci, can weigh) + project role (PI, can stop/edit).
  makeUser('u_pisci', 'Sci + PI — นักวิทย์ที่เป็นหัวหน้าโครงการ', '', 'pisci@lab.test', 'demo1234', 'SCI', 'PI'),
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

// The mouse IDENTITY code = โครงการ-กลุ่มทดลอง-ลำดับในกลุ่ม-ลำดับในกรง.
// It is PERMANENT and travels with the animal. Physical location (room / rack /
// shelf / cage) is the mouse's CURRENT status — derived from whichever cage
// currently holds it, NOT baked into the code — so a future "move cage" just
// re-parents the mouse object (its sex / weights / treatments come along for free).
// IDENTITY (permanent, set when Sci first weighs the mouse into a cage):
//     <projectId>-<cageCode>-<cageNo>      e.g. P1-A01-3
// The experiment grouping is NOT part of it — mice enter the project before any
// group exists. Once the PI assigns the cage a diet and a treatment group, a TAG
// is appended for display:  P1-A01-3 (ไขมันสูง-DrugA-7)   ← อาหาร-กลุ่ม-ลำดับในกลุ่ม
function mouseCode(projId, cageCode, cageNo) {
  return `${projId}-${cageCode}-${cageNo}`;
}

function makeMouse(code, sex, baseline, trend, groupNo = null, cageNo = null) {
  _mouseSeq++;
  return {
    id: 'M' + _mouseSeq,
    code,
    sex,                       // 'M' | 'F' — bound to the animal (follows it across cages)
    groupNo,                   // ลำดับในกลุ่มทดสอบ — null until the PI assigns the cage a group (part of the TAG, not the code)
    cageNo,                    // ลำดับในกรง 1…5 (part of the permanent code)
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

// Generate a cage with N mice.
// A cage carries the experiment grouping in TWO independent layers, both assigned
// by the PI *after* the mice are already in the cage, and never at the same time:
//   dietId  — ชนิดอาหาร (layer 1). null ⇒ อาหารทั่วไป (the project's default diet)
//   groupId — กลุ่มทดสอบ (layer 2). null ⇒ ยังไม่ถูกจัดเข้ากลุ่มการทดลอง
function makeCage(id, code, groupId, shelf, position, mice, opts = {}) {
  return {
    id,
    code,
    groupId,
    dietId: opts.dietId ?? null,
    shelf,
    rackNo: opts.rackNo ?? null,   // แร็คที่ชั้นนี้อยู่ (โครงการหนึ่งมีได้หลายแร็ค)
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
// LAYER 1 — ชนิดอาหาร. `isDefault` is the diet a cage falls back to while the PI
// has not assigned one (อาหารทั่วไป). Exactly one diet per project carries it.
const dietsP1 = [
  { id: 'D1', name: 'อาหารทั่วไป',  isDefault: true,  color: '#94a3b8', capacity: 24 },
  { id: 'D2', name: 'ไขมันสูง',     isDefault: false, color: '#d97706', capacity: 24 },
];

// LAYER 2 — กลุ่มทดสอบ. `capacity` = จำนวนหนูสูงสุดต่อกลุ่มที่สัตวแพทย์อนุมัติ.
// แต่ละกลุ่มมี 6 กรง × 2 ตัว = 12 ตัว — ตั้ง 14 ไว้ให้เหลือโควตา
const groupsP1 = [
  { id: 'G1', name: 'Control',      isControl: true,  color: '#64748b', capacity: 14 },
  { id: 'G2', name: 'Treatment-1',  isControl: false, color: '#2563eb', capacity: 14 },
  { id: 'G3', name: 'Treatment-2',  isControl: false, color: '#7c3aed', capacity: 14 },
  { id: 'G4', name: 'Treatment-3',  isControl: false, color: '#dc2626', capacity: 14 },
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

// Layout: 4 shelves × 6 cages, 2 mice per cage (♂ + ♀). One treatment group per
// shelf. Shelf A stays on the default diet; the other three are on the high-fat
// diet — i.e. the PI has already assigned both layers on this (running) project.
const shelfLetters = ['A', 'B', 'C', 'D'];
const cagesP1 = [];
for (let si = 0; si < 4; si++) {
  const group = groupsP1[si];
  const groupId = group.id;
  const prof = groupProfile[groupId];
  const letter = shelfLetters[si];
  const dietId = si === 0 ? 'D1' : 'D2';
  let gno = 0;                                   // running number within this treatment group
  for (let pos = 1; pos <= 6; pos++) {
    const code = `${letter}-${String(pos).padStart(2, '0')}`;   // CAGE code (location)
    const mice = [];
    for (let k = 1; k <= 2; k++) {
      gno++;
      mice.push(makeMouse(mouseCode('P1', code, k), k === 1 ? 'M' : 'F',
        prof.baseline + rand(-1.2, 1.2),
        prof.trend + rand(-0.05, 0.05), gno, k));
    }
    cagesP1.push(makeCage(nextCageId(), code, groupId, si + 1, pos, mice, {
      dietId, lastRecordDate: isoDaysAgo(1),
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
// โครงการปิดแล้ว — โควตาเท่ากับจำนวนที่ใช้จริง (3 กรง × 2 ตัว) ตามแผนที่ดำเนินการจบ
const dietsDone = [
  { id: 'DD1', name: 'อาหารทั่วไป', isDefault: true,  color: '#94a3b8', capacity: 12 },
];
const groupsDone = [
  { id: 'GD1', name: 'Control',   isControl: true,  color: '#64748b', capacity: 6 },
  { id: 'GD2', name: 'Treatment', isControl: false, color: '#2563eb', capacity: 6 },
];
const cagesDone = [];
for (let si = 0; si < 2; si++) {
  const group = groupsDone[si];
  const groupId = group.id;
  const letter = shelfLetters[si];
  let gno = 0;
  for (let pos = 1; pos <= 3; pos++) {
    const code = `${letter}-${String(pos).padStart(2, '0')}`;
    const g1 = ++gno, g2 = ++gno;
    cagesDone.push(makeCage(nextCageId(), code, groupId, si + 1, pos, [
      makeMouse(mouseCode('P3', code, 1), 'M', 26.5 + rand(-1, 1), si === 0 ? 0.28 : 0.16, g1, 1),
      makeMouse(mouseCode('P3', code, 2), 'F', 25.5 + rand(-1, 1), si === 0 ? 0.26 : 0.15, g2, 2),
    ], { dietId: 'DD1', lastRecordDate: isoDaysAgo(96) }));
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
      // ตำแหน่งที่สัตวแพทย์จัดสรร — เป็น "สถานะปัจจุบัน" ของหนูในโครงการนี้
      facility: { roomNo: 'AR02', rackNo: 'R3 · R4', racks: ['R3', 'R4'], quarantineDate: '2026-05-05', moveInDate: '2026-05-12' },
      shelves: 4,
      cagesPerShelf: 6,
      shelfNames: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' },
      // โครงการนี้กินพื้นที่ 2 แร็ค — ชั้น A/B อยู่แร็ค R3, ชั้น C/D อยู่แร็ค R4
      shelfRacks: { 1: 'R3', 2: 'R3', 3: 'R4', 4: 'R4' },
      diets: dietsP1,
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
      facility: { roomNo: 'AR01', rackNo: 'R1', racks: ['R1'], quarantineDate: '2026-01-02', moveInDate: '2026-01-08' },
      shelves: 2,
      cagesPerShelf: 3,
      shelfNames: { 1: 'A', 2: 'B' },
      shelfRacks: { 1: 'R1', 2: 'R1' },
      diets: dietsDone,
      groups: groupsDone,
      cages: cagesDone,
      members: [{ userId: 'u_pi', roles: ['PI'] }],
    },
  ],
  // append-only activity log (visible to everyone for transparency)
  auditLog: [],
  // ---- การแจ้งเตือน ----------------------------------------------------
  // หนึ่งเหตุการณ์ = หนึ่งแถว มีรายชื่อผู้รับ (`to`) และคนที่อ่านแล้ว (`readBy`)
  // ไม่ทำเป็นแถวต่อคน เพราะเหตุการณ์เดียวกันควรแก้/ลบทีเดียวได้
  // { id, ts, kind, title, detail, projectId, projectName, to:[userId], readBy:[userId], link:{...} }
  notifications: [],
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
//   'rejected'  → sent back with a reason (shown red; only the creator fixes it)
//
// Project creation is a THREE-stage pipeline — it ENDS at AV:
//   PI submits a request  → 'requested'  (waiting for AEC ethics review)
//   AEC approves          → 'aec_ok'     (waiting for AV to lay out the facility)
//   AV builds facility    → 'approved'   (LIVE — rooms/racks/shelves/EMPTY cages and
//                                         both group layers exist). AV or AEC can
//                                         'rejected' instead.
// A project before 'approved' has NO cages — it only carries a `request` blob.
//
// Mice arrive AFTER the project is live: Sci weighs each mouse and places it into a
// cage (first weighing). At that moment a cage has no treatment group and falls back
// to the default diet; the PI assigns ชนิดอาหาร and กลุ่มทดสอบ later, as two separate
// actions, from the จัดการกรง page.
(function seedApproval() {
  DB.projects.forEach(p => { if (!p.approval) p.approval = 'approved'; });

  // a project still in the request pipeline (no cages, no facility yet)
  function requestProject(id, name, creatorId, approval, req, extra = {}) {
    return {
      id, name, description: req.objective || '—', startDate: todayISO(),
      status: 'active', createdBy: creatorId, approval,
      requestDate: req.requestDate || todayISO(),
      request: {
        // ---- protocol header (ใบอนุญาต / โปรโตคอล) ----
        lotNo: req.lotNo || '',                // เลขล็อตของโครงการ (ต่อท้ายชื่อโครงการ)
        protocolNo: req.protocolNo || '',
        pi: req.pi || '',
        approvedDate: req.approvedDate || '',  // ช่วงที่ใบอนุญาตครอบคลุม
        untilDate: req.untilDate || '',
        species: req.species || '',
        strain: req.strain || '',
        sexes: req.sexes || ['M'],             // ['M'] | ['F'] | ['M','F']
        ageMin: req.ageMin ?? '',            // อายุเป็นช่วง เช่น 6–8 สัปดาห์
        ageMax: req.ageMax ?? '',
        weightMin: req.weightMin || '',        // ช่วงน้ำหนักเฉลี่ย (กรัม)
        weightMax: req.weightMax || '',
        maleCount: req.maleCount || 0,         // จำนวนสัตว์แยกตามเพศ …
        femaleCount: req.femaleCount || 0,
        totalMice: req.totalMice,              // … และผลรวมของทั้งสอง (derived)
        // การทดลองมี 2 ชั้น — PI เสนอรายการมาในคำขอ แล้ว AV ยืนยันตอนสร้าง
        diets: req.diets || [],                // ชั้น 1: ชนิดอาหาร [{name,isDefault,plannedMice}]
        groups: req.groups,                    // ชั้น 2: กลุ่มทดสอบ [{name,isControl,plannedMice}]
        objective: req.objective || '',        // = Protocol description
        protocolEndpoint: req.protocolEndpoint || '',
        humaneEndpoint: req.humaneEndpoint || '',
        plan: req.plan || [],                  // แผนการใช้สัตว์ทดลอง [{date:'YYYY-MM-DD', detail}] — sorted by date
        diagram: req.diagram || null,          // experiment diagram (image)
        aup: req.aup || null,                  // Animal Use Protocol (pdf)
        approvalDoc: req.approvalDoc || null,  // ethics approval (pdf)
        appointments: req.appointments || [],  // [{role:'COPI'|'AHS', userId, name}]
      },
      facility: null,                          // filled by AV at build time
      shelves: 0, cagesPerShelf: 0, diets: [], groups: [], cages: [], documents: [],
      members: [{ userId: creatorId, roles: ['PI'] }],
      ...extra,
    };
  }

  const demoReq = {
    lotNo: '1',
    protocolNo: 'MU-AEC-2569-014',
    pi: 'PI — นักวิจัย',
    // อนุมัติ 2 วันก่อน · สิ้นสุด 1 ปีถัดมา (ครบปีพอดีแบบนับรวมวันแรก)
    approvedDate: isoDaysAgo(2), untilDate: isoDaysAgo(-362),
    species: 'Mus musculus (หนูเมาส์)', strain: 'C57BL/6',
    sexes: ['M', 'F'], ageMin: 6, ageMax: 8, weightMin: 20, weightMax: 25,
    maleCount: 12, femaleCount: 12,
    protocolEndpoint: 'สิ้นสุดเมื่อครบ 12 สัปดาห์ของการให้สารทดสอบ หรือเมื่อเก็บตัวอย่างครบตามแผน',
    humaneEndpoint: 'น้ำหนักลดเกิน 20% ของน้ำหนักเริ่มต้น · ไม่กินอาหาร/น้ำเกิน 24 ชม. · ขนหยองซึม ไม่ตอบสนองต่อสิ่งเร้า · หายใจลำบาก · มีแผลติดเชื้อลุกลาม — ให้ทำการุณยฆาตทันที',
    totalMice: 24, objective: 'ประเมินความปลอดภัยต่อระบบหัวใจของสารทดสอบในหนูทดลอง',
    diets: [
      { name: 'อาหารทั่วไป', isDefault: true, plannedMice: 12 },
      { name: 'ไขมันสูง', isDefault: false, plannedMice: 12 },
    ],
    groups: [
      { name: 'Control', isControl: true, plannedMice: 8 },
      { name: 'Low dose', isControl: false, plannedMice: 8 },
      { name: 'High dose', isControl: false, plannedMice: 8 },
    ],
    plan: [
      { date: isoDaysAgo(-7),  detail: 'รับสัตว์ทดลองเข้าห้องเลี้ยง · ปรับสภาพ (acclimatization) 7 วัน' },
      { date: isoDaysAgo(-14), detail: 'ชั่งน้ำหนักครั้งแรก แบ่งกลุ่ม และเริ่มให้อาหารตามชนิดที่กำหนด' },
      { date: isoDaysAgo(-21), detail: 'เริ่มให้สารทดสอบตามขนาดที่กำหนด · ติดตามอาการรายวัน' },
      { date: isoDaysAgo(-49), detail: 'เก็บตัวอย่างเลือดกลางการทดลอง และประเมินค่าทางชีวเคมี' },
      { date: isoDaysAgo(-77), detail: 'สิ้นสุดการทดลอง · การุณยฆาตตามหลักมนุษยธรรม และผ่าซากเก็บอวัยวะ' },
    ],
    diagram: { name: 'experimental-design.png', url: null },
    aup: { name: 'AUP_Cardio_2026.pdf', url: null },
    approvalDoc: { name: 'AEC-Approval_2026-014.pdf', url: null },
    appointments: [
      { role: 'COPI', userId: 'u_copi', name: 'CoPI — นักวิจัยร่วม' },
      { role: 'AHS', userId: 'u_ahs', name: 'AHS — นักวิจัยปฏิบัติการ' },
    ],
    requestDate: isoDaysAgo(3),
  };

  DB.projects.push(
    // stage 1 — PI submitted, waiting for AEC
    requestProject('P5', 'Cardio Safety Study', 'u_pi', 'requested', demoReq),
    // stage 2 — AEC approved, waiting for AV to build
    requestProject('P7', 'Hepatic Clearance Assay', 'u_pi', 'aec_ok',
      { ...demoReq, objective: 'ศึกษาการกำจัดสารผ่านตับในหนูทดลอง', totalMice: 16,
        groups: [ { name: 'Control', isControl: true, plannedMice: 8 }, { name: 'Treatment', isControl: false, plannedMice: 8 } ] },
      { aecReview: { by: 'AEC — สำนักเลขาฯ จริยธรรม', at: isoDaysAgo(1) } }),
    // rejected at the AEC stage
    requestProject('P6', 'Metabolic Screen', 'u_pi', 'rejected', demoReq,
      { rejectStage: 'aec', rejectReason: 'จำนวนสัตว์ต่อกลุ่มยังไม่สอดคล้องกับการคำนวณทางสถิติ และแผนภาพการทดลองไม่ครบถ้วน', reviewedBy: 'AEC — สำนักเลขาฯ จริยธรรม', reviewedAt: isoDaysAgo(1) }),
  );

  // AV has finished — the project EXISTS and is live, with empty cages waiting for
  // Sci to weigh the mice in. No group is assigned to any cage yet.
  DB.projects.push(builtProject());

  // an AV-built project that is already live but still empty: shelves may hold
  // UNEQUAL numbers of cages, every cage has no mice, no diet and no treatment group.
  function builtProject() {
    const id = 'P8';
    const diets = [
      { id: `${id}-D1`, name: 'อาหารทั่วไป', isDefault: true,  color: '#94a3b8', desc: 'อาหารมาตรฐาน', capacity: 10 },
      { id: `${id}-D2`, name: 'ไขมันสูง',    isDefault: false, color: '#d97706', desc: 'อาหารไขมันสูง', capacity: 6 },
    ];
    const groups = [
      { id: `${id}-G1`, name: 'Control',   isControl: true,  color: '#64748b', desc: 'กลุ่มควบคุม', capacity: 4 },
      { id: `${id}-G2`, name: 'Treatment', isControl: false, color: '#2563eb', desc: 'กลุ่มได้รับสารทดสอบ', capacity: 6 },
    ];
    // shelf 1 has 3 cages, shelf 2 has 2 cages (deliberately unequal)
    const layout = [
      { shelf: 1, no: 'A', cages: ['A-01', 'A-02', 'A-03'] },
      { shelf: 2, no: 'B', cages: ['B-01', 'B-02'] },
    ];
    const shelfNames = {};
    const cages = [];
    let seq = 0;
    layout.forEach(row => {
      shelfNames[row.shelf] = row.no;
      row.cages.forEach((code, i) => {
        cages.push({
          id: `${id}-C${++seq}`, code, shelfLabel: row.no, groupId: null, dietId: null,
          shelf: row.shelf, position: i + 1, mice: [],
          water: { remaining: 300, added: null, consumed: 0 },
          food:  { remaining: 100, added: null, consumed: 0 },
          status: 'pending', lastRecordDate: todayISO(),
        });
      });
    });
    return {
      id, name: 'Renal Function Study',
      description: 'ประเมินการทำงานของไตหลังได้รับสารทดสอบในหนูทดลอง',
      startDate: todayISO(), status: 'active', createdBy: 'u_pi', approval: 'approved',
      requestDate: isoDaysAgo(6),
      request: {
        totalMice: 10, objective: 'ประเมินการทำงานของไตหลังได้รับสารทดสอบในหนูทดลอง',
        diets: [ { name: 'อาหารทั่วไป', isDefault: true, plannedMice: 10 }, { name: 'ไขมันสูง', isDefault: false, plannedMice: 6 } ],
        groups: [ { name: 'Control', isControl: true, plannedMice: 4 }, { name: 'Treatment', isControl: false, plannedMice: 6 } ],
        diagram: null, aup: null, approvalDoc: null,
        appointments: [ { role: 'COPI', userId: 'u_copi', name: 'CoPI — นักวิจัยร่วม' } ],
      },
      aecReview: { by: 'AEC — สำนักเลขาฯ จริยธรรม', at: isoDaysAgo(4) },
      builtBy: { by: 'AV — สัตวแพทย์ประจำหน่วย', at: isoDaysAgo(1) },
      facility: { roomNo: 'AR01', rackNo: 'R1', quarantineDate: isoDaysAgo(5), moveInDate: isoDaysAgo(1) },
      shelves: layout.length, cagesPerShelf: 3, shelfNames,
      diets, groups, cages, documents: [],
      members: [
        { userId: 'u_pi',     roles: ['PI'] },
        { userId: 'u_copi',   roles: ['COPI'] },
        { userId: 'u_scisys', roles: ['SCI'] },
        { userId: 'u_vet',    roles: ['VET'] },
        { userId: 'u_act',    roles: ['ACT'] },
      ],
    };
  }
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
  // only APPROVED projects have a real team; pipeline projects keep just their
  // creator (nobody is appointed until AV builds the project).
  DB.projects.forEach(p => {
    if ((p.approval || 'approved') === 'approved') p.members = TEAM.map(m => ({ userId: m.userId, roles: [...m.roles] }));
  });
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
