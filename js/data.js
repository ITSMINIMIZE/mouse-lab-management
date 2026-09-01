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
  ADMIN:    { key: 'ADMIN',    label: 'ผู้ดูแลระบบ',                  scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'editProject', 'manageMembers', 'weigh', 'dosing', 'cageCare', 'quarantine', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'stop', 'viewReports', 'approve', 'manageUsers', 'ochReport', 'viewAssets', 'manageAssets', 'viewFinance', 'manageFinance', 'manageRates', 'manageSop', 'cageCard'] },
  AV:       { key: 'AV',       label: 'หัวหน้าสัตวแพทย์',              scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'quarantine', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports', 'approve', 'manageUsers', 'manageMembers'] },
  VET:      { key: 'VET',      label: 'สัตวแพทย์',                    scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'quarantine', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  SCI:      { key: 'SCI',      label: 'นักวิทยาศาสตร์',                scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'quarantine', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:      { key: 'ACT',      label: 'เจ้าหน้าที่ดูแลสัตว์ทดลอง',      scope: 'all',    caps: ['view', 'enterProject', 'viewCage', 'createProject', 'quarantine', 'flag', 'reportDeath', 'cageCare', 'viewAssets'] },
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
  // EX reads details like AEC (no enterProject) but keeps พัสดุ — and reads the
  // money too: an executive needs the monthly balance without being able to book
  // an expense into it (no manageFinance).
  EX:       { key: 'EX',       label: 'ผู้บริหารหน่วยสัตว์ทดลอง',       scope: 'all',    caps: ['view', 'createProject', 'viewAssets', 'viewFinance'] },
  // OCH inspects on site like a site-safety officer: sees the project cards but
  // deliberately has NO enterProject — clicking a card opens a safety report form.
  OCH:      { key: 'OCH',      label: 'เจ้าหน้าที่ชีวอนามัย',           scope: 'all',    caps: ['view', 'createProject', 'ochReport'] },
  // GM works the พัสดุ + การเงิน side only — no `view` at all, so hasAccess()
  // keeps them out of every project and the โครงการ tab stays hidden.
  GM:       { key: 'GM',       label: 'เจ้าหน้าที่บริหารงานทั่วไป',      scope: 'all',    caps: ['viewAssets', 'manageAssets', 'viewFinance', 'manageFinance'] },
  EXTERNAL: { key: 'EXTERNAL', label: 'บุคคลภายนอก',                  scope: 'member', caps: ['view', 'enterProject', 'viewCage', 'createProject'] },
};
const POSITION_ORDER = ['ADMIN', 'AV', 'VET', 'SCI', 'ACT', 'AEC', 'IACUC', 'QA', 'AUDIT', 'EX', 'OCH', 'GM', 'EXTERNAL'];

// Project-level roles. PI/COPI/AHS are the research team; SCI/VET/ACT mirror the
// system position of the same name but are confined to the one project.
const ROLES = {
  PI:   { key: 'PI',   label: 'PI (นักวิจัย)',            caps: ['view', 'enterProject', 'viewCage', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports', 'cageCard'] },
  COPI: { key: 'COPI', label: 'CoPI (นักวิจัยร่วม)',       caps: ['view', 'enterProject', 'viewCage', 'editProject', 'flag', 'reportDeath', 'stop', 'viewReports', 'cageCard'] },
  AHS:  { key: 'AHS',  label: 'AHS (นักวิจัยปฏิบัติการ)',  caps: ['view', 'enterProject', 'viewCage', 'flag', 'reportDeath', 'dosing', 'viewReports', 'cageCard'] },
  SCI:  { key: 'SCI',  label: 'Sci ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'quarantine', 'flag', 'weigh', 'reportDeath', 'handleCarcass', 'viewReports'] },
  VET:  { key: 'VET',  label: 'VET ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'quarantine', 'flag', 'treat', 'reportDeath', 'handleCarcass', 'viewReports'] },
  ACT:  { key: 'ACT',  label: 'ACT ประจำโครงการ',          caps: ['view', 'enterProject', 'viewCage', 'quarantine', 'flag', 'reportDeath', 'cageCare'] },
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
  { key: 'quarantine',    label: 'ตรวจรับสัตว์ / บันทึกการกักกันโรค' },
  { key: 'flag',          label: 'แจ้งหนูผิดปกติ (รอสัตวแพทย์ตรวจ)' },
  { key: 'treat',         label: 'ตรวจรักษา / ปิดเคส / Humane endpoint' },
  { key: 'reportDeath',   label: 'แจ้งหนูตาย (นำไปแช่แข็ง)' },
  { key: 'handleCarcass', label: 'จัดการซาก — ทำลาย / ชันสูตร' },
  { key: 'stop',          label: 'สั่ง Stop (ไม่คิดเฉลี่ย)' },
  { key: 'viewReports',   label: 'ดูหน้ากราฟ / ผลวิเคราะห์' },
  { key: 'cageCard',      label: 'พิมพ์ใบติดหน้ากรง' },
  { key: 'reviewAEC',     label: 'ตรวจ/อนุมัติคำขอสร้างโครงการ (จริยธรรม)' },
  { key: 'approve',       label: 'สร้างโครงการจริง / ตีกลับ (สัตวแพทย์)' },
  { key: 'manageUsers',   label: 'จัดการบัญชีผู้ใช้ระบบ' },
  { key: 'ochReport',     label: 'รายงานความปลอดภัย / ชีวอนามัย' },
  { key: 'viewAssets',    label: 'เข้าถึงงานพัสดุ (วัสดุ + ครุภัณฑ์)' },
  { key: 'manageAssets',  label: 'เพิ่ม / แก้ทะเบียนพัสดุ · รับเข้า-เบิกออก' },
  { key: 'viewFinance',   label: 'ดูสรุปการเงินรายเดือน' },
  { key: 'manageFinance', label: 'บันทึกค่าใช้จ่ายอื่น / ตั้งอัตราค่าฝากเลี้ยง' },
  { key: 'manageRates',   label: 'จัดการรายการหัตถการและราคา' },
  { key: 'manageSop',     label: 'จัดการคลัง SOP ของหน่วยงาน' },
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
// เลื่อนวันจากวันที่ ISO — ใช้ผูกวันในข้อมูลตัวอย่างให้สัมพันธ์กันเอง
// (แทนที่จะนับ isoDaysAgo แยกกันคนละที่แล้วหลุดจากกัน)
function isoPlus(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetweenISO(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function rand(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

// Build a 14-day weight series that drifts around a baseline.
// ประวัติน้ำ/อาหารของกรง — หนึ่งรายการต่อหนึ่งรอบที่มีการชั่งจริง
// remaining = ปริมาณที่พร้อมใช้หลังจบรอบ (ที่วัดได้ + ที่เติม) · consumed = กินไประหว่างรอบ
// เก็บ `mice` ไว้ด้วย เพราะจำนวนหนูเปลี่ยนได้ (ตาย/ย้าย) — ถ้าไม่เก็บ ค่า g/ตัว
// ย้อนหลังจะคำนวณผิดทันทีที่มีตัวใดตาย
function buildSupplyLog(nMice, waterBase, foodBase, days = 14) {
  const log = [];
  let water = waterBase, food = foodBase;
  for (let i = days; i >= 0; i--) {
    const wUse = Math.round(rand(5, 9) * nMice * 10) / 10;
    const fUse = Math.round(rand(3.5, 5.5) * nMice * 10) / 10;
    const wLeft = Math.max(0, Math.round((water - wUse) * 10) / 10);
    const fLeft = Math.max(0, Math.round((food - fUse) * 10) / 10);
    // เติมเมื่อเหลือน้อย — เหมือนที่เจ้าหน้าที่ทำจริง ไม่ใช่เติมทุกวัน
    const wAdd = wLeft < waterBase * 0.4 ? Math.round((waterBase - wLeft) * 10) / 10 : 0;
    const fAdd = fLeft < foodBase * 0.4 ? Math.round((foodBase - fLeft) * 10) / 10 : 0;
    water = Math.round((wLeft + wAdd) * 10) / 10;
    food = Math.round((fLeft + fAdd) * 10) / 10;
    log.push({
      date: isoDaysAgo(i), time: '09:30', by: 'Sci — นักวิทยาศาสตร์', source: 'weigh',
      water: { remaining: water, added: wAdd, consumed: wUse },
      food:  { remaining: food,  added: fAdd, consumed: fUse },
      mice: nMice,
    });
  }
  return log;
}

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
    // การให้สารทดสอบ/หัตถการของ AHS — หนึ่งรายการต่อการบันทึกหนึ่งครั้ง
    // { date, time, by, items:[{text, kind:'routine'|'once'}], paused, pauseReason }
    doses: [],
    // ไทม์ไลน์สุขภาพ — เขียนต่อท้ายอย่างเดียว ไม่มีการลบ ทุกคนที่สังเกตเห็นอะไรลงที่นี่
    // { date, time, by, source, status, note, scores?, total?, max? } — ดู App.HEALTH_SOURCE
    health: [],
    necropsy: null,            // Necropsy Record (only when death.disposition==='necropsy'):
                               //   { date, time, examiner, results:{ [organ]:{v:'N'|'A'|'X', note} }, abnormal, avComment }
  };
}

// Generate a cage with N mice.
// A cage carries the experiment grouping in TWO independent layers, both assigned
// by the PI *after* the mice are already in the cage, and never at the same time:
//   dietId  — ชนิดอาหาร (layer 1). null ⇒ อาหารทั่วไป (the project's default diet)
//   groupId — กลุ่มทดสอบ (layer 2). null ⇒ ยังไม่ถูกจัดเข้ากลุ่มการทดลอง
function _lastSupply(log, key) {
  const e = log && log.length ? log[log.length - 1] : null;
  return e ? { ...e[key] } : null;
}

function makeCage(id, code, groupId, shelf, position, mice, opts = {}) {
  return {
    id,
    code,
    groupId,
    dietId: opts.dietId ?? null,
    shelf,
    // ชื่อชั้นที่แสดง — สำเนาไว้เหมือนที่ submitBuildProject ทำ (ตัวจริงคือ p.shelfNames)
    shelfLabel: opts.shelfLabel ?? null,
    rackNo: opts.rackNo ?? null,   // แร็คที่ชั้นนี้อยู่ (โครงการหนึ่งมีได้หลายแร็ค)
    position,
    mice,
    // water/food = สรุปของรอบล่าสุด · ตัวจริงคือ supplyLog ข้างล่าง
    // อ่านจากท้าย log เสมอเมื่อมี log เพื่อไม่ให้ "ค่าล่าสุด" กับ "ประวัติ" ขัดกันเอง
    water: _lastSupply(opts.supplyLog, 'water')
      ?? { remaining: opts.water ?? rand(180, 350), added: null,
           consumed: opts.waterConsumed ?? rand(5, 9) * (mice.length || 1) },
    food: _lastSupply(opts.supplyLog, 'food')
      ?? { remaining: opts.food ?? rand(40, 120), added: null,
           consumed: opts.foodConsumed ?? rand(3.5, 5.5) * (mice.length || 1) },
    // บันทึกการตรวจดูแลกรงของ ACT — หนึ่งรายการต่อการตรวจหนึ่งรอบ
    // { date, time, by, items: { animals, feed, water, cage } } — ดู App.CARE_ITEMS
    careLog: opts.careLog ?? [],
    // ประวัติน้ำ/อาหารทุกรอบ — water/food ข้างบนคือรายการล่าสุดของ log นี้
    // (เดิมเก็บแค่ค่าล่าสุด ทับทุกรอบ ประวัติจึงหายหมดและกราฟต้องสุ่มเส้นขึ้นมาเอง)
    supplyLog: opts.supplyLog ?? [],
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
  { id: 'D1', name: 'อาหารทั่วไป',  isDefault: true,  color: '#A8A79C', capacity: 24 },
  { id: 'D2', name: 'ไขมันสูง',     isDefault: false, color: '#B08B2E', capacity: 24 },
];

// LAYER 2 — กลุ่มทดสอบ. `capacity` = จำนวนหนูสูงสุดต่อกลุ่มที่สัตวแพทย์อนุมัติ.
// แต่ละกลุ่มมี 6 กรง × 2 ตัว = 12 ตัว — ตั้ง 14 ไว้ให้เหลือโควตา
const groupsP1 = [
  { id: 'G1', name: 'Control',      isControl: true,  color: '#6B6F6A', capacity: 14 },
  { id: 'G2', name: 'Treatment-1',  isControl: false, color: '#5F7355', capacity: 14 },
  { id: 'G3', name: 'Treatment-2',  isControl: false, color: '#7B6A8D', capacity: 14 },
  { id: 'G4', name: 'Treatment-3',  isControl: false, color: '#A85A3E', capacity: 14 },
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
    // เพศเป็นข้อมูลของ "กรง" ไม่ใช่ของโครงการ — Sci เลือกเพศตอนรับหนูเข้ากรง
    // และทั้งกรงต้องเพศเดียวกัน (ห้ามผสม) · สลับผู้/เมียทีละกรง
    const cageSex = pos % 2 === 1 ? 'M' : 'F';
    const mice = [];
    for (let k = 1; k <= 2; k++) {
      gno++;
      mice.push(makeMouse(mouseCode('P1', code, k), cageSex,
        prof.baseline + rand(-1.2, 1.2),
        prof.trend + rand(-0.05, 0.05), gno, k));
    }
    cagesP1.push(makeCage(nextCageId(), code, groupId, si + 1, pos, mice, {
      dietId, shelfLabel: letter, rackNo: si < 2 ? 'R3' : 'R4', lastRecordDate: isoDaysAgo(1),
      supplyLog: buildSupplyLog(mice.length, rand(280, 340), rand(90, 120)),
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
  { id: 'DD1', name: 'อาหารทั่วไป', isDefault: true,  color: '#A8A79C', capacity: 12 },
];
const groupsDone = [
  { id: 'GD1', name: 'Control',   isControl: true,  color: '#6B6F6A', capacity: 6 },
  { id: 'GD2', name: 'Treatment', isControl: false, color: '#5F7355', capacity: 6 },
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
    const cageSex = pos % 2 === 1 ? 'M' : 'F';   // ทั้งกรงเพศเดียวกันเสมอ
    cagesDone.push(makeCage(nextCageId(), code, groupId, si + 1, pos, [
      makeMouse(mouseCode('P3', code, 1), cageSex, 26.5 + rand(-1, 1), si === 0 ? 0.28 : 0.16, g1, 1),
      makeMouse(mouseCode('P3', code, 2), cageSex, 25.5 + rand(-1, 1), si === 0 ? 0.26 : 0.15, g2, 2),
    ], { dietId: 'DD1', shelfLabel: letter, rackNo: 'R1', lastRecordDate: isoDaysAgo(96),
         supplyLog: buildSupplyLog(2, rand(280, 340), rand(90, 120)) }));
  }
}

// ------------------------------------------------------------
// Root DB object
// ------------------------------------------------------------
// ============================================================
// ครุภัณฑ์ และ วัสดุ  (facility-wide — ไม่ผูกกับโครงการใดโครงการหนึ่ง)
// ============================================================
// สองชนิดในทะเบียนเดียวกัน เพราะทั้งคู่คือ "ของที่ซื้อด้วยเงินหน่วยงาน" และต้อง
// สรุปยอดรวมกันในหน้าเดียว แต่คิดมูลค่าคนละแบบ:
//   kind:'asset'      ครุภัณฑ์ — ของคงทน มีเลขครุภัณฑ์รายชิ้น มูลค่าทยอยตัดเป็น
//                     ค่าเสื่อมตามอายุการใช้งานที่กรอกไว้ตอนเพิ่มรายการ
//   kind:'consumable' วัสดุ — ใช้แล้วหมดไป ไม่มีเลขรายชิ้น นับเป็นจำนวนคงเหลือ
//                     มูลค่าตัดเป็นค่าใช้จ่ายตอน "เบิกออก" ไม่ใช่ตอนซื้อ
const ASSET_CATEGORIES = [
  { key: 'housing',  label: 'กรง / ระบบเลี้ยง',  icon: '🏠' },
  { key: 'lab',      label: 'เครื่องมือห้องปฏิบัติการ', icon: '🔬' },
  { key: 'clean',    label: 'ทำความสะอาด / ปลอดเชื้อ', icon: '🧼' },
  { key: 'feed',     label: 'อาหารสัตว์',        icon: '🍚' },
  { key: 'bedding',  label: 'วัสดุรองนอน',       icon: '🪵' },
  { key: 'medical',  label: 'เวชภัณฑ์ / ของใช้สิ้นเปลือง', icon: '💊' },
  { key: 'office',   label: 'สำนักงาน / อื่น ๆ',  icon: '🗄️' },
];
const ASSET_STATUS = {
  active:   { label: 'ใช้งานปกติ',   tone: 'ok' },
  repair:   { label: 'ส่งซ่อม',      tone: 'warn' },
  broken:   { label: 'ชำรุด รอจำหน่าย', tone: 'bad' },
  disposed: { label: 'จำหน่ายแล้ว',  tone: 'muted' },
};
const FUND_SOURCES = ['เงินรายได้คณะ', 'เงินงบประมาณแผ่นดิน', 'เงินบริจาค', 'ทุนวิจัย'];

// ============================================================
// กักกันโรค (Quarantine)
// ============================================================
// สัตว์ที่มาถึงยังไม่ใช่ "หนูในโครงการ" — ต้องผ่านการตรวจรับรายตัวและกักโรคก่อน
// รอบนี้ยัง **ไม่มีการกำหนดรหัสหนู** (รหัสออกตอนชั่งน้ำหนักแรกเข้าเข้ากรงโครงการ)
// แถวตรวจรับจึงอ้างถึงกันด้วย "ลำดับ" กับ "กรงกักโรค" เท่านั้น ตรงตามใบจริง
//
// เอกสารสองใบของศูนย์ฯ ที่หน้านี้ต้องออกให้ได้:
//   LA Guide-AF 9.1-03  บันทึกการตรวจรับสัตว์ทดลองรายตัว (ตอนรับเข้าส่วนกักโรค)
//   LA Guide-AF 9.1-01  แบบฟอร์มการกักโรคสัตว์ทดลอง (Quarantine Record)
// ระยะกักโรคมาตรฐานของศูนย์ฯ — ระบบเติมวันสิ้นสุดให้เองจากวันเริ่ม แก้ได้
const QUARANTINE_DAYS = 7;

const QUARANTINE_VENDORS = [
  'Nomura Siam NLAC [Mahidol University]',
  'ศูนย์สัตว์ทดลองแห่งชาติ มหาวิทยาลัยมหิดล',
  'สถานสัตว์ทดลองเพื่อการวิจัย มหาวิทยาลัยนเรศวร',
];
const QUARANTINE_TRANSPORT = [
  'Transportation truck',
  'BKK to CNX by Airplane',
];

// ชุดเอกสารกักโรคตัวอย่าง — ผูกกับ "วันเริ่มกักจริง" ของโครงการนั้น ไม่ใช่นับ
// ถอยหลังจากวันนี้แยกกันคนละที่ วันบนใบฟอร์ม แผนการใช้สัตว์ และสถานะจึงตรงกันเสมอ
//   o.start      วันเริ่มกัก (ISO) · สิ้นสุดคิดจากระยะมาตรฐาน 7 วัน
//   o.count      จำนวนสัตว์ที่รับเข้า · o.failAt = ลำดับตัวที่ตรวจไม่ผ่าน (null = ผ่านหมด)
//   o.released   ปล่อยออกแล้วหรือยัง
function quarantineDemo(o) {
  const until = isoPlus(o.start, QUARANTINE_DAYS - 1);
  // บันทึกดูแลมีได้ถึงวันนี้เท่านั้น — ของที่ยังกักอยู่จึงมีไม่ครบ 7 แถวโดยธรรมชาติ
  const lastLog = (todayISO() < until) ? todayISO() : until;
  const logDays = Math.max(0, daysBetweenISO(o.start, lastLog) + 1);
  const perCage = 2;
  const cageCount = Math.ceil(o.count / perCage);
  const failAt = o.failAt ?? null;
  return {
    intake: {
      date: o.start, time: '09:20', code: o.protocolNo,
      ageWeeks: o.ageWeeks, weightMin: o.weightMin, weightMax: o.weightMax,
      by: 'Sci — นักวิทยาศาสตร์',
      rows: Array.from({ length: o.count }, (_, i) => ({
        cage: `Q-${String(Math.floor(i / perCage) + 1).padStart(2, '0')}`,
        tag: `${o.tagPrefix}-${String(i + 1).padStart(2, '0')}`,
        weight: rand(o.weightMin, o.weightMax),
        appearance: i === failAt ? 'abnormal' : 'normal',
        result: i === failAt ? 'fail' : 'pass',
        note: i === failAt ? 'ขนหยอง ซึม ตาแฉะ — แยกออกจากกลุ่ม' : '',
      })),
    },
    program: {
      vendor: 'Nomura Siam NLAC [Mahidol University]', transport: 'BKK to CNX by Airplane',
      strain: o.strain, sex: o.sex, vet: 'สพ.ญ. กมล ศรีวิไล',
      cages: cageCount, perCage,
      startDate: o.start, untilDate: until,
      countComplete: true, appearanceOk: failAt == null, appearanceNote: '',
      healthCert: true, healthCertNote: 'HC-2569/0142 ออกโดย NLAC',
      preventive: false, preventiveNote: '',
      remark: 'สัตว์ถึงหน่วยเวลา 08:50 น. สภาพกล่องปกติ',
    },
    daily: Array.from({ length: logDays }, (_, i) => ({
      date: isoPlus(o.start, i), time: ['08:40', '08:35', '09:05', '08:50', '08:45', '08:30', '09:10'][i % 7],
      by: 'ACT — จนท.ดูแลสัตว์ทดลอง',
      items: {
        animals: (failAt != null && i === 1) ? 'abnormal' : 'normal',
        feed: 'normal', water: 'normal', cage: 'normal',
      },
      jobs: i % 2 === 0 ? ['Feed: Add', 'Water: Change'] : ['Feed: Add', 'Water: Add', 'Cage: Change Bottom/Pan'],
      note: (failAt != null && i === 1)
        ? `${o.tagPrefix}-${String(failAt + 1).padStart(2, '0')} ขนหยอง ซึม แยกกรงและแจ้งสัตวแพทย์แล้ว` : '',
    })),
    release: o.released
      ? { date: until, vet: 'สพ.ญ. กมล ศรีวิไล', healthy: true, note: '',
          remark: `ครบกำหนดกัก ${QUARANTINE_DAYS} วัน สัตว์ทุกตัวสุขภาพปกติ พร้อมเข้าโครงการ` }
      : null,
  };
}

let _assetSeq = 0;
// งานที่ "เรียกใช้ครุภัณฑ์" ได้ — ครุภัณฑ์แต่ละชิ้นเลือกได้ว่าจะโผล่ในงานไหนบ้าง
// (ตั้งที่ พัสดุ → ตั้งค่าการเรียกใช้ครุภัณฑ์) · วัสดุไม่อยู่ในระบบนี้ เพราะเบิกเป็นก้อน
//
// timed = งานที่มีจังหวะ "เริ่ม → เสร็จสิ้น" ชัดเจน จับเวลาได้จริง
// ส่วนงานที่ไม่ timed เป็นการบันทึกครั้งเดียวจบ เก็บเป็นจำนวนครั้ง เวลาเป็น 0
const ASSET_ACTIONS = [
  { key: 'weigh',    label: 'ชั่งน้ำหนัก',            icon: '⚖️', timed: true },
  { key: 'dose',     label: 'ให้สารทดสอบ',           icon: '💉', timed: true },
  { key: 'care',     label: 'ตรวจดูแลกรง',           icon: '🧹', timed: true },
  { key: 'intake',   label: 'รับหนูเข้าโครงการ',      icon: '🐭', timed: true },
  { key: 'treat',    label: 'รักษา / ดูแลสัตว์ป่วย',  icon: '🩺', timed: false },
  { key: 'necropsy', label: 'ผ่าซาก / ชันสูตร',      icon: '🔬', timed: false },
  { key: 'qzIntake', label: 'ตรวจรับเข้ากักโรค',      icon: '📋', timed: false },
  { key: 'qzDaily',  label: 'ดูแลประจำวัน (กักโรค)',  icon: '🦠', timed: false },
];

function makeAsset(o) {
  _assetSeq++;
  return {
    id: 'AS' + _assetSeq,
    kind: o.kind,                       // 'asset' | 'consumable'
    code: o.code || '',                 // เลขครุภัณฑ์ / รหัสวัสดุ
    name: o.name,
    category: o.category,
    brand: o.brand || '', model: o.model || '', serial: o.serial || '',
    acquiredDate: o.acquiredDate,
    price: o.price,                     // ครุภัณฑ์ = ราคาต่อชิ้น · วัสดุ = ราคาต่อหน่วย
    fundSource: o.fundSource || FUND_SOURCES[0],
    lifeYears: o.lifeYears ?? null,     // ครุภัณฑ์เท่านั้น — ตัวหารของค่าเสื่อมรายปี
    room: o.room || '', rack: o.rack || '',
    owner: o.owner || '',
    status: o.status || 'active',
    note: o.note || '',
    // ---- วัสดุ ----
    unit: o.unit || '',                 // หน่วยนับ (ถุง / กล่อง / กก.)
    qty: o.qty ?? null,                 // คงเหลือ
    minQty: o.minQty ?? null,           // จุดสั่งซื้อ — ต่ำกว่านี้ขึ้นเตือน
    moves: o.moves || [],               // { date, type:'in'|'out', qty, by, note, price? }
    // ---- ครุภัณฑ์ ----
    repairs: o.repairs || [],           // { date, by, symptom, status, fixedDate, cost, vendor, note }
    // งานที่ชิ้นนี้จะขึ้นให้เลือก — ว่าง = ไม่ถูกเรียกใช้ในงานประจำวันเลย
    usageActions: o.usageActions || [],
    // ประวัติการถูกเรียกใช้ { id, action, projectId, projectName, by, date, start, end, minutes, note }
    usage: o.usage || [],
  };
}

const ASSETS = [
  makeAsset({ kind: 'asset', code: 'มช.7440-001-0001', name: 'ตู้เลี้ยงสัตว์ระบบระบายอากาศ (IVC) 70 กรง',
    category: 'housing', brand: 'Tecniplast', model: 'GM500', serial: 'TP-2565-118',
    acquiredDate: isoDaysAgo(1120), price: 1850000, lifeYears: 10, room: 'AR01', rack: 'R1',
    owner: 'ACT — จนท.ดูแลสัตว์ทดลอง', fundSource: 'เงินงบประมาณแผ่นดิน',
    repairs: [{ date: isoDaysAgo(240), by: 'ACT — จนท.ดูแลสัตว์ทดลอง', symptom: 'พัดลมชั้น 3 มีเสียงดังผิดปกติ',
      status: 'fixed', fixedDate: isoDaysAgo(228), cost: 12500, vendor: 'บ.เทคนิคอลไซแอนซ์', note: 'เปลี่ยนมอเตอร์พัดลม' }] }),
  makeAsset({ kind: 'asset', code: 'มช.7440-001-0002', name: 'ตู้เลี้ยงสัตว์ระบบระบายอากาศ (IVC) 70 กรง',
    category: 'housing', brand: 'Tecniplast', model: 'GM500', serial: 'TP-2565-119',
    acquiredDate: isoDaysAgo(1120), price: 1850000, lifeYears: 10, room: 'AR02', rack: 'R3',
    owner: 'ACT — จนท.ดูแลสัตว์ทดลอง', fundSource: 'เงินงบประมาณแผ่นดิน' }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0007',
    usageActions: ['weigh', 'intake', 'qzIntake'], name: 'เครื่องชั่งดิจิทัลทศนิยม 2 ตำแหน่ง',
    category: 'lab', brand: 'Sartorius', model: 'Entris II', serial: 'SA-88421',
    acquiredDate: isoDaysAgo(700), price: 68000, lifeYears: 5, room: 'AR02', rack: '—',
    owner: 'Sci — นักวิทยาศาสตร์', fundSource: 'เงินรายได้คณะ' }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0011',
    usageActions: ['dose', 'treat', 'necropsy'], name: 'ตู้ปลอดเชื้อ Biosafety Cabinet Class II',
    category: 'clean', brand: 'ESCO', model: 'AC2-4S', serial: 'ES-77120',
    acquiredDate: isoDaysAgo(430), price: 320000, lifeYears: 10, room: 'AR01', rack: '—',
    owner: 'AV — สัตวแพทย์ประจำหน่วย', fundSource: 'ทุนวิจัย', status: 'repair',
    repairs: [{ date: isoDaysAgo(9), by: 'AV — สัตวแพทย์ประจำหน่วย', symptom: 'ค่าความเร็วลมต่ำกว่าเกณฑ์ แจ้งเตือนขึ้นตลอด',
      status: 'open', fixedDate: '', cost: 0, vendor: 'บ.เอสโก้ ประเทศไทย', note: 'แจ้งบริษัทแล้ว รออะไหล่' }] }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0015', name: 'หม้อนึ่งฆ่าเชื้อ (Autoclave) 100 ลิตร',
    category: 'clean', brand: 'Hirayama', model: 'HVE-50', serial: 'HR-40233',
    acquiredDate: isoDaysAgo(2200), price: 450000, lifeYears: 10, room: 'AR03', rack: '—',
    owner: 'ACT — จนท.ดูแลสัตว์ทดลอง', fundSource: 'เงินงบประมาณแผ่นดิน',
    repairs: [
      { date: isoDaysAgo(400), by: 'ACT — จนท.ดูแลสัตว์ทดลอง', symptom: 'ประตูรั่ว ไอน้ำออกด้านข้าง',
        status: 'fixed', fixedDate: isoDaysAgo(385), cost: 8200, vendor: 'บ.ฮิรายาม่า เซอร์วิส', note: 'เปลี่ยนซีลยางประตู' },
      { date: isoDaysAgo(60), by: 'ACT — จนท.ดูแลสัตว์ทดลอง', symptom: 'อุณหภูมิไม่ถึง 121°C ในรอบที่ 2',
        status: 'fixed', fixedDate: isoDaysAgo(45), cost: 15400, vendor: 'บ.ฮิรายาม่า เซอร์วิส', note: 'เปลี่ยนฮีตเตอร์' }] }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0023', name: 'ตู้ปลอดเชื้อ Biosafety Cabinet Class II (สำรอง)',
    category: 'clean', brand: 'ESCO', model: 'AC2-4S', serial: 'ES-77121',
    acquiredDate: isoDaysAgo(300), price: 320000, lifeYears: 10, room: 'AR02', rack: '—',
    owner: 'AV — สัตวแพทย์ประจำหน่วย', fundSource: 'ทุนวิจัย',
    usageActions: ['dose', 'treat', 'necropsy'] }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0031', name: 'รถเข็นเปลี่ยนกรงพร้อมชุดกรอง HEPA',
    category: 'clean', brand: 'Tecniplast', model: 'CS5', serial: 'TP-2566-042',
    acquiredDate: isoDaysAgo(520), price: 185000, lifeYears: 8, room: 'AR01', rack: '—',
    owner: 'ACT — จนท.ดูแลสัตว์ทดลอง', fundSource: 'เงินรายได้คณะ',
    usageActions: ['care', 'qzDaily'] }),
  makeAsset({ kind: 'asset', code: 'มช.6640-002-0019', name: 'ตู้แช่แข็ง -20°C สำหรับเก็บซาก',
    category: 'lab', brand: 'Panasonic', model: 'MDF-U334', serial: 'PN-55901',
    acquiredDate: isoDaysAgo(1500), price: 185000, lifeYears: 8, room: 'AR03', rack: '—',
    owner: 'Sci — นักวิทยาศาสตร์', fundSource: 'เงินรายได้คณะ' }),
  makeAsset({ kind: 'asset', code: 'มช.7440-001-0021', name: 'ชั้นวางกรงสเตนเลส 5 ชั้น',
    category: 'housing', brand: '—', model: '—', serial: '',
    acquiredDate: isoDaysAgo(3000), price: 42000, lifeYears: 10, room: 'AR02', rack: 'R4',
    owner: 'ACT — จนท.ดูแลสัตว์ทดลอง', fundSource: 'เงินบริจาค', status: 'broken',
    note: 'ขาชั้นบิดงอจากการชน ใช้งานไม่ปลอดภัย รอเสนอจำหน่าย' }),

  makeAsset({ kind: 'consumable', code: 'ว-FEED-01', name: 'อาหารเม็ดสำเร็จรูปสำหรับหนูเมาส์ (Rodent Chow)',
    category: 'feed', brand: 'Perfect Companion', model: 'Rat & Mouse', unit: 'ถุง 20 กก.',
    acquiredDate: isoDaysAgo(30), price: 1250, qty: 18, minQty: 6,
    room: 'AR04', owner: 'GM — จนท.บริหารงานทั่วไป', fundSource: 'เงินรายได้คณะ',
    moves: [
      { date: isoDaysAgo(30), type: 'in',  qty: 30, by: 'GM — จนท.บริหารงานทั่วไป', note: 'รับเข้าตามใบสั่งซื้อ PO-2569-0142', price: 1250 },
      { date: isoDaysAgo(21), type: 'out', qty: 5,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เบิกใช้ห้อง AR01' },
      { date: isoDaysAgo(14), type: 'out', qty: 4,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เบิกใช้ห้อง AR02' },
      { date: isoDaysAgo(7),  type: 'out', qty: 3,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เบิกใช้ห้อง AR01' }] }),
  makeAsset({ kind: 'consumable', code: 'ว-BED-01', name: 'ขี้เลื่อยอัดแท่งปลอดเชื้อ (Corn cob bedding)',
    category: 'bedding', brand: 'Bio-Serv', model: '—', unit: 'ถุง 25 กก.',
    acquiredDate: isoDaysAgo(45), price: 980, qty: 4, minQty: 8,
    room: 'AR04', owner: 'GM — จนท.บริหารงานทั่วไป', fundSource: 'เงินรายได้คณะ',
    note: 'ต่ำกว่าจุดสั่งซื้อ — เสนอจัดซื้อรอบถัดไป',
    moves: [
      { date: isoDaysAgo(45), type: 'in',  qty: 20, by: 'GM — จนท.บริหารงานทั่วไป', note: 'รับเข้าตามใบสั่งซื้อ PO-2569-0138', price: 980 },
      { date: isoDaysAgo(20), type: 'out', qty: 9,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เปลี่ยนวัสดุรองนอนทั้งแร็ค R3' },
      { date: isoDaysAgo(6),  type: 'out', qty: 7,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เปลี่ยนวัสดุรองนอนทั้งแร็ค R4' }] }),
  makeAsset({ kind: 'consumable', code: 'ว-MED-03', name: 'ถุงมือไนไตรล์ ไร้แป้ง ขนาด M',
    category: 'medical', brand: 'Ansell', model: 'TouchNTuff', unit: 'กล่อง 100 ชิ้น',
    acquiredDate: isoDaysAgo(60), price: 320, qty: 26, minQty: 10,
    room: 'AR04', owner: 'GM — จนท.บริหารงานทั่วไป', fundSource: 'เงินรายได้คณะ',
    moves: [
      { date: isoDaysAgo(60), type: 'in',  qty: 40, by: 'GM — จนท.บริหารงานทั่วไป', note: 'รับเข้าตามใบสั่งซื้อ PO-2569-0130', price: 320 },
      { date: isoDaysAgo(28), type: 'out', qty: 8,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'เบิกใช้ประจำเดือน' },
      { date: isoDaysAgo(5),  type: 'out', qty: 6,  by: 'Sci — นักวิทยาศาสตร์', note: 'เบิกใช้รอบชั่งน้ำหนัก' }] }),
  makeAsset({ kind: 'consumable', code: 'ว-MED-07', name: 'น้ำยาฆ่าเชื้อพื้นผิว (Surface disinfectant)',
    category: 'clean', brand: 'Virkon', model: 'S', unit: 'ขวด 1 ลิตร',
    acquiredDate: isoDaysAgo(75), price: 750, qty: 11, minQty: 5,
    room: 'AR04', owner: 'GM — จนท.บริหารงานทั่วไป', fundSource: 'ทุนวิจัย',
    moves: [
      { date: isoDaysAgo(75), type: 'in',  qty: 15, by: 'GM — จนท.บริหารงานทั่วไป', note: 'รับเข้าตามใบสั่งซื้อ PO-2569-0125', price: 750 },
      { date: isoDaysAgo(12), type: 'out', qty: 4,  by: 'ACT — จนท.ดูแลสัตว์ทดลอง', note: 'ทำความสะอาดห้อง AR01–AR02' }] }),
];

// ============================================================
// SOP — ระเบียบปฏิบัติระดับหน่วยงาน (ทุกโครงการใช้ชุดเดียวกัน)
// ============================================================
// ผูกกับ "งาน" (actions) และ/หรือ "ครุภัณฑ์" (assetCodes) เพื่อให้ปุ่ม SOP
// มุมล่างซ้ายหยิบเฉพาะฉบับที่เกี่ยวกับสิ่งที่ผู้ใช้กำลังทำอยู่ขึ้นมาแสดง
// ฉบับที่ไม่ผูกกับอะไรเลย = ระเบียบทั่วไป แสดงเสมอ
let _sopSeq = 0;
function makeSop(o) {
  _sopSeq++;
  return {
    id: 'SOP' + _sopSeq,
    no: o.no,                       // เลขที่เอกสาร เช่น SOP-AN-002
    title: o.title,
    version: o.version || '1.0',
    effectiveDate: o.effectiveDate || isoDaysAgo(400),
    owner: o.owner || 'หน่วยสัตว์ทดลอง',
    summary: o.summary || '',       // บรรทัดเดียว สรุปว่าฉบับนี้ว่าด้วยอะไร
    detail: o.detail || '',         // เนื้อหาเต็ม แยกบรรทัดด้วย \n
    actions: o.actions || [],       // งานที่เกี่ยวข้อง (คีย์เดียวกับ ASSET_ACTIONS)
    assetCodes: o.assetCodes || [], // เลขครุภัณฑ์ที่ฉบับนี้กำกับการใช้งาน
    file: o.file || null,           // { name, url } — แนบ PDF ได้
  };
}

const SOPS = [
  makeSop({ no: 'SOP-AN-001', title: 'การรับสัตว์ทดลองและการกักกันโรค', version: '3.1',
    actions: ['qzIntake', 'qzDaily', 'intake'],
    summary: 'ขั้นตอนตรวจรับ นับจำนวน ตรวจสุขภาพแรกเข้า และการกักกันโรค 7 วัน',
    detail: '1. ตรวจสภาพกล่องขนส่งก่อนเปิด บันทึกอุณหภูมิและเวลาที่สัตว์มาถึง\n'
      + '2. นับจำนวนเทียบกับใบส่งของและใบรับรองสุขภาพจากผู้จำหน่าย\n'
      + '3. ตรวจสุขภาพรายตัว ชั่งน้ำหนัก บันทึกลักษณะทั่วไป ผลผ่าน/ไม่ผ่าน\n'
      + '4. ตัวที่ไม่ผ่านให้แยกกรงทันทีและแจ้งสัตวแพทย์ภายในวันเดียวกัน\n'
      + '5. กักกันโรคในห้องแยก 7 วัน บันทึกการดูแลทุกวันตามแบบ AF 9.1-01\n'
      + '6. ครบกำหนดให้สัตวแพทย์ประเมินก่อนปล่อยเข้าโครงการ' }),
  makeSop({ no: 'SOP-AN-002', title: 'การชั่งน้ำหนักสัตว์ทดลอง', version: '2.0',
    actions: ['weigh', 'intake'], assetCodes: ['มช.6640-002-0007'],
    summary: 'วิธีชั่งน้ำหนักรายตัวให้ได้ค่าที่เทียบกันได้ระหว่างรอบ',
    detail: '1. ชั่งในช่วงเวลาเดียวกันของวันทุกรอบ (แนะนำ 08:00–10:00) เพื่อลดความแปรปรวน\n'
      + '2. ปรับศูนย์เครื่องชั่งก่อนเริ่มทุกครั้ง และตรวจสอบด้วยตุ้มน้ำหนักมาตรฐาน\n'
      + '3. ใช้ภาชนะครอบกันสัตว์กระโดด ชั่งภาชนะเปล่าแล้วกด tare\n'
      + '4. บันทึกทันทีหลังชั่งแต่ละตัว ห้ามจดรวมแล้วมากรอกทีหลัง\n'
      + '5. น้ำหนักลดเกิน 20% จากค่าสูงสุด ให้แจ้งสัตวแพทย์ทันทีตาม humane endpoint\n'
      + '6. ทำความสะอาดแท่นชั่งด้วย 70% แอลกอฮอล์ระหว่างกรง' }),
  makeSop({ no: 'SOP-AN-003', title: 'การให้สารทดสอบทางปากและการฉีด', version: '2.2',
    actions: ['dose'], assetCodes: ['มช.6640-002-0011', 'มช.6640-002-0023'],
    summary: 'ขนาดเข็ม ปริมาตรสูงสุด และการจับบังคับสัตว์อย่างปลอดภัย',
    detail: '1. เตรียมสารในตู้ปลอดเชื้อเท่านั้น ตรวจฉลากและวันหมดอายุก่อนใช้\n'
      + '2. ป้อนทางปาก (oral gavage) ไม่เกิน 10 mL/kg ใช้เข็มปลายมนขนาดเหมาะกับน้ำหนัก\n'
      + '3. ฉีดเข้าช่องท้อง (IP) ไม่เกิน 10 mL/kg · ใต้ผิวหนัง (SC) ไม่เกิน 5 mL/kg\n'
      + '4. เปลี่ยนเข็มทุกตัว ห้ามใช้ซ้ำข้ามตัวสัตว์\n'
      + '5. สังเกตอาการ 15 นาทีหลังให้สาร บันทึกความผิดปกติทันทีที่พบ\n'
      + '6. ทิ้งเข็มในภาชนะ sharps เท่านั้น' }),
  makeSop({ no: 'SOP-AN-004', title: 'การดูแลกรงและการเปลี่ยนวัสดุรองนอน', version: '1.4',
    actions: ['care', 'qzDaily'], assetCodes: ['มช.6640-002-0031'],
    summary: 'ความถี่การเปลี่ยนกรง การให้น้ำ-อาหาร และการบันทึกประจำวัน',
    detail: '1. ตรวจกรงทุกวัน ดูน้ำ อาหาร วัสดุรองนอน และสภาพสัตว์\n'
      + '2. เปลี่ยนวัสดุรองนอนอย่างน้อยสัปดาห์ละ 2 ครั้ง หรือเร็วกว่านั้นถ้าเปียกชื้น\n'
      + '3. เปลี่ยนกรงในรถเข็นที่มีชุดกรอง HEPA เท่านั้น\n'
      + '4. เติมน้ำให้เต็มขวดทุกวัน ตรวจจุกไม่ให้อุดตันหรือรั่ว\n'
      + '5. พบสิ่งผิดปกติให้บันทึกในระบบทันทีและแจ้งสัตวแพทย์' }),
  makeSop({ no: 'SOP-VT-001', title: 'การดูแลสัตว์ป่วยและเกณฑ์ humane endpoint', version: '2.0',
    actions: ['treat'], summary: 'การให้คะแนนอาการ การรักษา และจุดที่ต้องยุติการทดลอง',
    detail: '1. ให้คะแนนอาการตามเกณฑ์ของโครงการก่อนชั่งน้ำหนักทุกครั้ง\n'
      + '2. คะแนนรวมถึงเกณฑ์ที่กำหนด หรือน้ำหนักลดเกิน 20% ให้แจ้งสัตวแพทย์ทันที\n'
      + '3. สัตวแพทย์เป็นผู้ตัดสินใจรักษาหรือทำการุณยฆาต ผู้วิจัยตัดสินใจเองไม่ได้\n'
      + '4. บันทึกการรักษาทุกครั้ง ระบุยา ขนาด และวิธีให้\n'
      + '5. ปิดเคสเมื่ออาการหายเป็นปกติและบันทึกผลสรุป' }),
  makeSop({ no: 'SOP-VT-002', title: 'การการุณยฆาตและการจัดการซาก', version: '1.8',
    actions: ['necropsy'], assetCodes: ['มช.6640-002-0019'],
    summary: 'วิธีที่ยอมรับได้ การยืนยันการตาย และการเก็บซากก่อนส่งกำจัด',
    detail: '1. ใช้วิธีที่ AVMA รับรอง — CO₂ แบบค่อย ๆ เพิ่มความเข้มข้น หรือยาสลบเกินขนาด\n'
      + '2. ยืนยันการตายด้วยวิธีที่สอง (cervical dislocation หรือเปิดช่องอก) ทุกตัว\n'
      + '3. บันทึกวันเวลา วิธี และผู้ดำเนินการในระบบทันที\n'
      + '4. เก็บซากในถุงสองชั้นติดฉลากรหัสโครงการ แช่ตู้ -20°C\n'
      + '5. ส่งกำจัดตามรอบของหน่วย ห้ามทิ้งรวมกับขยะทั่วไป' }),
  makeSop({ no: 'SOP-EQ-001', title: 'การใช้และบำรุงรักษาตู้ปลอดเชื้อ (BSC)', version: '1.2',
    assetCodes: ['มช.6640-002-0011', 'มช.6640-002-0023'],
    summary: 'การเปิดใช้ การทำความสะอาด และรอบสอบเทียบประจำปี',
    detail: '1. เปิดพัดลมทิ้งไว้อย่างน้อย 5 นาทีก่อนเริ่มงาน\n'
      + '2. เช็ดพื้นผิวด้วย 70% แอลกอฮอล์ก่อนและหลังใช้ทุกครั้ง\n'
      + '3. ห้ามวางของกีดขวางช่องลมด้านหน้าและด้านหลัง\n'
      + '4. สอบเทียบความเร็วลมปีละครั้ง เก็บใบรับรองไว้กับทะเบียนครุภัณฑ์\n'
      + '5. ค่าความเร็วลมต่ำกว่าเกณฑ์ให้หยุดใช้และแจ้งซ่อมทันที' }),
  makeSop({ no: 'SOP-EQ-002', title: 'การสอบเทียบและดูแลเครื่องชั่งดิจิทัล', version: '1.1',
    assetCodes: ['มช.6640-002-0007'],
    summary: 'การปรับศูนย์ การตรวจด้วยตุ้มมาตรฐาน และรอบสอบเทียบ',
    detail: '1. วางเครื่องบนพื้นราบมั่นคง ห่างจากลมแอร์และประตู\n'
      + '2. ปรับระดับฟองน้ำให้อยู่กึ่งกลางก่อนเปิดเครื่องทุกเช้า\n'
      + '3. ตรวจด้วยตุ้มน้ำหนักมาตรฐาน 50 g และ 200 g ก่อนเริ่มงานประจำวัน\n'
      + '4. ค่าที่อ่านได้คลาดเคลื่อนเกิน ±0.05 g ให้หยุดใช้และแจ้งซ่อม\n'
      + '5. สอบเทียบโดยหน่วยงานภายนอกปีละครั้ง เก็บใบรับรองไว้กับทะเบียนครุภัณฑ์\n'
      + '6. เช็ดแท่นชั่งด้วย 70% แอลกอฮอล์หลังใช้ทุกครั้ง ห้ามฉีดน้ำยาลงบนตัวเครื่องโดยตรง' }),
  makeSop({ no: 'SOP-EQ-003', title: 'การใช้รถเข็นเปลี่ยนกรงระบบกรอง HEPA', version: '1.0',
    assetCodes: ['มช.6640-002-0031'],
    summary: 'การเปิดใช้ การเปลี่ยนแผ่นกรอง และการทำความสะอาดหลังใช้',
    detail: '1. เปิดพัดลมและรอให้ไฟเขียวติดก่อนเปิดกรงทุกครั้ง\n'
      + '2. เปลี่ยนกรงทีละใบ ปิดฝาใบเดิมก่อนเปิดใบถัดไป\n'
      + '3. เช็ดพื้นผิวด้านในด้วยน้ำยาฆ่าเชื้อหลังเปลี่ยนกรงครบทุกครั้ง\n'
      + '4. ตรวจสัญญาณเตือนแผ่นกรองทุกสัปดาห์ เปลี่ยนตามรอบที่ผู้ผลิตกำหนด\n'
      + '5. ห้ามใช้รถเข็นข้ามห้องกักโรคกับห้องสัตว์สะอาดโดยไม่ทำความสะอาดก่อน' }),
  makeSop({ no: 'SOP-GN-001', title: 'การเข้า-ออกพื้นที่เลี้ยงสัตว์ทดลอง', version: '2.1',
    summary: 'ระเบียบทั่วไป — การแต่งกาย การล้างมือ และลำดับการเข้าห้อง',
    detail: '1. เปลี่ยนชุดและสวมอุปกรณ์ป้องกันครบก่อนเข้าพื้นที่ทุกครั้ง\n'
      + '2. ล้างมือและใส่ถุงมือใหม่ก่อนเข้าแต่ละห้อง\n'
      + '3. เข้าห้องสัตว์สะอาดก่อนเสมอ แล้วจึงเข้าห้องกักโรคเป็นลำดับสุดท้าย\n'
      + '4. ห้ามนำอาหารและเครื่องดื่มเข้าพื้นที่เลี้ยงสัตว์\n'
      + '5. บันทึกการเข้า-ออกทุกครั้งในสมุดหน้าห้อง' }),
];

// ============================================================
// การเงิน  (facility-wide)
// ============================================================
// หน่วยสัตว์ทดลองเลี้ยงตัวเองด้วย "ค่าฝากเลี้ยง" ที่เก็บจากโครงการ ส่วนรายจ่าย
// มาจากสี่ทาง — สามทางแรกระบบรู้อยู่แล้วจากทะเบียนพัสดุ จึงไม่ต้องกรอกซ้ำ:
//   1. วัสดุที่ "เบิกออก" ในเดือนนั้น        (มูลค่าเกิดตอนเบิก ไม่ใช่ตอนซื้อ)
//   2. ค่าเสื่อมครุภัณฑ์ของเดือนนั้น          (ค่าเสื่อมรายปี ÷ 12)
//   3. ค่าซ่อมที่แจ้งในเดือนนั้น
//   4. ค่าน้ำ ค่าไฟ ค่าจ้าง ฯลฯ — ไม่มีที่อื่นในระบบบันทึกไว้ จึงกรอกเองในหน้านี้
// ตัวเลขทั้งหมดคิดเป็น "รายเดือน" เพราะหน่วยงานปิดยอดและตั้งเบิกเป็นเดือน

// อัตรากลางค่าฝากเลี้ยง — โครงการหนึ่งตั้งอัตราของตัวเองทับได้ (project.billing.rate)
const BOARDING_RATE = 20;              // บาท / ตัว / วัน

// หัตถการที่โครงการ "ฝากหน่วยทำ" — คิดเป็นครั้ง แยกจากค่าฝากเลี้ยงรายวัน
// แก้ไขได้ในแอปที่ การเงิน → จัดการรายการหัตถการ (ผู้ดูแลระบบเท่านั้น)
//
//   key    รหัสถาวร — รายการที่บันทึกไปแล้วอ้างถึงตัวนี้ ตั้งแล้วห้ามแก้
//   price  ราคาปัจจุบัน ใช้ตอน "เลือก" เท่านั้น — รายการที่บันทึกไปแล้วเก็บราคา
//          ของตัวเองไว้ (services[].price) ปรับราคาที่นี่จึงไม่ทำให้ยอดเดือนเก่าขยับ
//   active false = เลิกให้บริการ ไม่โผล่ในช่องเลือกอีก แต่ประวัติเก่ายังอ่านชื่อได้
//          (ลบทิ้งจริงทำได้เฉพาะรายการที่ไม่เคยมีใครใช้)
//
// ⚠️ ราคาด้านล่างเป็นตัวเลขตัวอย่าง ยังไม่ใช่อัตราจริงของศูนย์ฯ
const PROCEDURES = [
  { key: 'gavage',   label: 'ป้อนสารทางปาก (Oral gavage)',  price: 35,  active: true },
  { key: 'inject',   label: 'ฉีดสารทดสอบ (IP / SC / IV)',   price: 40,  active: true },
  { key: 'blood',    label: 'เจาะเลือดเพื่อส่งตรวจ',          price: 120, active: true },
  { key: 'weigh',    label: 'ชั่งน้ำหนัก + บันทึกข้อมูลให้',   price: 15,  active: true },
  { key: 'euth',     label: 'การุณยฆาตตามหลักมนุษยธรรม',     price: 150, active: true },
  { key: 'necropsy', label: 'ผ่าซาก / เก็บอวัยวะส่งตรวจ',     price: 350, active: true },
];

// หมวดค่าใช้จ่ายอื่น — ที่ไม่ได้มาจากทะเบียนพัสดุ
const EXPENSE_CATEGORIES = [
  { key: 'utility', label: 'ค่าน้ำ / ค่าไฟ',        icon: '\u{1F4A1}' },
  { key: 'wage',    label: 'ค่าจ้าง / ค่าตอบแทน',    icon: '\u{1F477}' },
  { key: 'service', label: 'จ้างเหมาบริการ',         icon: '\u{1F9FE}' },
  { key: 'other',   label: 'อื่น ๆ',                icon: '\u{1F4C4}' },
];

// วันที่ในเดือนที่ผ่านมา n เดือน — ใช้หว่านข้อมูลตัวอย่างให้กระจายหลายเดือน
function isoMonthsAgo(n, day) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(day);
  return d.toISOString().slice(0, 10);
}

let _expSeq = 0;
function makeExpense(monthsAgo, day, category, label, amount, note) {
  _expSeq++;
  return { id: 'EX' + _expSeq, date: isoMonthsAgo(monthsAgo, day), category, label, amount, note: note || '',
           by: 'GM — จนท.บริหารงานทั่วไป' };
}

// ค่าสาธารณูปโภค/ค่าจ้างย้อนหลัง 4 เดือน — ค่าไฟแกว่งตามภาระความเย็นของห้องเลี้ยง
const OTHER_EXPENSES = [];
[[0, 62000], [1, 58500], [2, 64200], [3, 55800]].forEach(([m, power]) => {
  OTHER_EXPENSES.push(
    makeExpense(m, 5,  'utility', 'ค่าไฟฟ้า — ห้องเลี้ยงสัตว์ AR01–AR04', power, 'ตามใบแจ้งหนี้ กฟภ.'),
    makeExpense(m, 5,  'utility', 'ค่าน้ำประปา', 4200 + m * 150, ''),
    makeExpense(m, 25, 'wage',    'ค่าตอบแทนพนักงานดูแลสัตว์ทดลอง (2 อัตรา)', 34000, ''),
    makeExpense(m, 25, 'service', 'จ้างเหมากำจัดซากและขยะติดเชื้อ', 6800, 'เก็บสัปดาห์ละ 2 ครั้ง'),
  );
});

const DB = {
  users: USERS,
  assets: ASSETS,
  sops: SOPS,                          // SOP ระดับหน่วยงาน — ทุกโครงการใช้ชุดเดียวกัน
  // การเงิน — เก็บเฉพาะสิ่งที่ระบบไม่รู้จากที่อื่น: อัตรากลาง และค่าใช้จ่ายที่กรอกเอง
  // ยอดรายเดือนที่เหลือคำนวณสดจากทะเบียนพัสดุและจากโครงการ ไม่เก็บซ้ำ
  finance: { boardingRate: BOARDING_RATE, expenses: OTHER_EXPENSES },
  // ตัวตนที่ใช้งานอยู่ — สลับได้จากแผงสาธิตมุมขวาล่าง
  // ตั้งต้นเป็น ADMIN เพราะเห็นทุกโครงการและทุกฟังก์ชัน จึงเป็นจุดเริ่มที่ดีสำหรับการสาธิต
  // (ของจริงค่านี้มาจากการล็อกอิน ไม่ได้ตั้งไว้ในไฟล์)
  currentUserId: 'u_admin',
  projects: [
    {
      id: 'P1',
      createdBy: 'u_pi',
      name: 'NAFLD Diet Study',
      description: 'ศึกษาผลของอาหารไขมันสูงและยาต่อภาวะไขมันพอกตับในหนู C57BL/6',
      // เดโมสร้างน้ำหนักย้อนหลัง 14 วัน — วันเริ่มโครงการ/วันเข้ากรงจึงต้องเลื่อน
      // ตามไปด้วย ไม่งั้น "Start" บนใบติดหน้ากรง (= วันชั่งครั้งแรก) จะขัดกับ
      // วันที่โครงการประกาศไว้
      startDate: isoDaysAgo(14),
      status: 'active', phase: 'running',
      // หัวโปรโตคอลของใบอนุญาต — โครงการที่ live แล้วก็ผ่านขั้นตอนคำขอมาก่อน
      // จึงต้องมี request ติดตัวไว้เสมอ (ใบติดหน้ากรงดึงข้อมูลจากตรงนี้)
      request: {
        lotNo: '1', protocolNo: 'MU-AEC-2569-007', pi: 'ดร. นภา ศรีสุข',
        approvedDate: '2026-05-01', untilDate: '2027-04-30',
        species: 'Mus musculus', strain: 'C57BL/6',
        sexes: ['M', 'F'], ageMin: 6, ageMax: 8, weightMin: 20, weightMax: 25,
        maleCount: 24, femaleCount: 24, totalMice: 48,
        // เกณฑ์ Humane endpoint — ตั้งค่าตอน PI ยื่นคำขอ แต่ละโครงการต่างกันได้
        humaneScore: {
          criteria: [
            { name: 'Behavior and Physical appearance', auto: null, other: true, levels: [
              'Normal appearance, healthy with normal activity',
              'Lack of grooming, Weakness, loss of appetite, Dehydration',
              'Rough coat, Lethargy, Isolation, Porphyrin staining (Eye, Nose, Mouth)',
              'Do not movement, Moribund, Inactivity, Hunched posture (± Clinical signs)'] },
            // เก็บเป็นจุดตัด % — คำอธิบายระบบสร้างให้เอง ขัดกับการคำนวณไม่ได้
            { name: 'Body weight change', auto: 'weight', other: false, cuts: [10, 20] },
            { name: 'Grimace scale', auto: null, other: false, levels: [
              'Grimace score = 0', 'Grimace score = 0.1 – 0.9',
              'Grimace score = 1.0 – 1.9', 'Grimace score ≥ 2.0'] },
            { name: 'Protocol-related parameter', auto: null, other: true, levels: [
              'Normal urination, Normal activity', 'Polydipsia, Polyuria',
              'Paw edema, Loss of appetite', 'Foot ulcer, Blindness'] },
          ],
          totalThreshold: 8, weightLossPct: 20,
          note: '< 140 mg/dl of blood glucose in 2-hour after glucose loading',
        },
        objective: 'ศึกษาผลของอาหารไขมันสูงและยาต่อภาวะไขมันพอกตับในหนู C57BL/6',
        // แผนการใช้สัตว์ทดลอง — รายการสุดท้ายคือ "End" บนใบติดหน้ากรง
        plan: [
          { date: isoDaysAgo(21), detail: 'รับสัตว์เข้าห้องกักกันโรค · ปรับสภาพ 7 วัน' },
          { date: isoDaysAgo(14), detail: 'ชั่งน้ำหนักแรกเข้า นำหนูเข้ากรง และเริ่มให้อาหารตามชนิดที่กำหนด' },
          { date: isoDaysAgo(7),  detail: 'เริ่มให้สารทดสอบตามขนาดที่กำหนด · ติดตามอาการรายวัน' },
          { date: isoDaysAgo(-28), detail: 'เก็บตัวอย่างเลือดกลางการทดลอง และประเมินค่าทางชีวเคมี' },
          { date: isoDaysAgo(-70), detail: 'สิ้นสุดการทดลอง · การุณยฆาตตามหลักมนุษยธรรม และผ่าซากเก็บตับ' },
        ],
        protocolEndpoint: 'สิ้นสุดเมื่อครบ 12 สัปดาห์ของการให้อาหารตามชนิดที่กำหนด และเก็บตัวอย่างตับครบทุกตัว',
        humaneEndpoint: 'น้ำหนักลดเกิน 20% ของน้ำหนักเริ่มต้น · ไม่กินอาหาร/น้ำเกิน 24 ชม. · ขนหยองซึม ไม่ตอบสนองต่อสิ่งเร้า — ให้ทำการุณยฆาตทันที',
      },
      // ตำแหน่งที่สัตวแพทย์จัดสรร — เป็น "สถานะปัจจุบัน" ของหนูในโครงการนี้
      facility: { roomNo: 'AR02', rackNo: 'R3 · R4', racks: ['R3', 'R4'], quarantineDate: isoDaysAgo(21), moveInDate: isoDaysAgo(14) },
      shelves: 4,
      cagesPerShelf: 6,
      shelfNames: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' },
      // โครงการนี้กินพื้นที่ 2 แร็ค — ชั้น A/B อยู่แร็ค R3, ชั้น C/D อยู่แร็ค R4
      shelfRacks: { 1: 'R3', 2: 'R3', 3: 'R4', 4: 'R4' },
      diets: dietsP1,
      groups: groupsP1,
      cages: cagesP1,
      // ค่าบริการที่หน่วยเรียกเก็บจากโครงการนี้
      //   rate      — อัตราค่าฝากเลี้ยงเฉพาะโครงการ (null = ใช้อัตรากลาง)
      //   services  — หัตถการที่ฝากหน่วยทำ หนึ่งแถวต่อหนึ่งครั้งที่ทำ
      //               price ติดมากับแถว เพื่อให้ยอดเดือนที่ปิดไปแล้วไม่ขยับ
      //               เมื่อมีการปรับราคากลางภายหลัง
      billing: {
        rate: null,
        services: [
          { date: isoDaysAgo(12), key: 'weigh',  qty: 48, price: 15,  by: 'Sci — นักวิทยาศาสตร์', note: 'ชั่งน้ำหนักแรกเข้าทั้งโครงการ' },
          { date: isoDaysAgo(7),  key: 'gavage', qty: 36, price: 35,  by: 'AHS — นักวิจัยปฏิบัติการ', note: 'เริ่มให้สารทดสอบ 3 กลุ่ม' },
          { date: isoDaysAgo(5),  key: 'weigh',  qty: 46, price: 15,  by: 'Sci — นักวิทยาศาสตร์', note: 'รอบชั่งประจำสัปดาห์' },
          { date: isoDaysAgo(3),  key: 'blood',  qty: 8,  price: 120, by: 'AHS — นักวิจัยปฏิบัติการ', note: 'เก็บเลือดกลุ่ม Treatment-3' },
          { date: isoDaysAgo(2),  key: 'euth',   qty: 1,  price: 150, by: 'AV — สัตวแพทย์ประจำหน่วย', note: 'D-01-2 humane endpoint' },
          { date: isoDaysAgo(1),  key: 'necropsy', qty: 1, price: 350, by: 'Sci — นักวิทยาศาสตร์', note: 'ผ่าซาก D-01-2 เก็บตับ' },
        ],
      },
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
      status: 'closed', phase: 'running',
      request: {
        lotNo: '1', protocolNo: 'MU-AEC-2568-112', pi: 'ดร. นภา ศรีสุข',
        approvedDate: '2025-12-20', untilDate: '2026-12-19',
        species: 'Mus musculus', strain: 'BALB/c',
        sexes: ['M', 'F'], ageMin: 8, ageMax: 10, weightMin: 22, weightMax: 28,
        maleCount: 6, femaleCount: 6, totalMice: 12,
        // เกณฑ์ Humane endpoint — ตั้งค่าตอน PI ยื่นคำขอ แต่ละโครงการต่างกันได้
        humaneScore: {
          criteria: [
            { name: 'Behavior and Physical appearance', auto: null, other: true, levels: [
              'Normal appearance, healthy with normal activity',
              'Lack of grooming, Weakness, loss of appetite, Dehydration',
              'Rough coat, Lethargy, Isolation, Porphyrin staining (Eye, Nose, Mouth)',
              'Do not movement, Moribund, Inactivity, Hunched posture (± Clinical signs)'] },
            // เก็บเป็นจุดตัด % — คำอธิบายระบบสร้างให้เอง ขัดกับการคำนวณไม่ได้
            { name: 'Body weight change', auto: 'weight', other: false, cuts: [10, 20] },
            { name: 'Grimace scale', auto: null, other: false, levels: [
              'Grimace score = 0', 'Grimace score = 0.1 – 0.9',
              'Grimace score = 1.0 – 1.9', 'Grimace score ≥ 2.0'] },
          ],
          totalThreshold: 6, weightLossPct: 20,
          note: '< 140 mg/dl of blood glucose in 2-hour after glucose loading',
        },
        objective: 'โครงการนำร่องพฤติกรรม — ดำเนินการครบตามแผนและปิดโครงการแล้ว',
        plan: [
          { date: '2026-01-02', detail: 'รับสัตว์เข้าห้องกักกันโรค' },
          { date: '2026-01-08', detail: 'ชั่งน้ำหนักแรกเข้า นำหนูเข้ากรง' },
          { date: '2026-04-02', detail: 'สิ้นสุดการทดลอง · ปิดโครงการ' },
        ],
      },
      facility: { roomNo: 'AR01', rackNo: 'R1', racks: ['R1'], quarantineDate: '2026-01-02', moveInDate: '2026-01-08' },
      shelves: 2,
      cagesPerShelf: 3,
      shelfNames: { 1: 'A', 2: 'B' },
      shelfRacks: { 1: 'R1', 2: 'R1' },
      diets: dietsDone,
      groups: groupsDone,
      cages: cagesDone,
      // โครงการนำร่อง — ตกลงอัตราพิเศษไว้ 15 บาท/ตัว/วัน ต่ำกว่าอัตรากลาง
      billing: {
        rate: 15,
        services: [
          { date: '2026-01-08', key: 'weigh', qty: 12, price: 15, by: 'Sci — นักวิทยาศาสตร์', note: 'ชั่งน้ำหนักแรกเข้า' },
          { date: '2026-02-10', key: 'weigh', qty: 12, price: 15, by: 'Sci — นักวิทยาศาสตร์', note: 'รอบเดือนกุมภาพันธ์' },
          { date: '2026-04-02', key: 'euth',  qty: 12, price: 150, by: 'AV — สัตวแพทย์ประจำหน่วย', note: 'สิ้นสุดการทดลอง' },
        ],
      },
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

// โครงการที่เดินแล้วก็ผ่านการกักโรคมาก่อนเหมือนกัน — ถ้าไม่มีเอกสารย้อนหลัง
// หน้ากักกันโรคของโครงการหลักจะว่างเปล่าทั้งที่แผนการใช้สัตว์เขียนไว้ว่ากักมาแล้ว
(function seedPastQuarantine() {
  const past = [
    { id: 'P1', count: 48, tagPrefix: 'NF', strain: 'C57BL/6', sex: 'M / F',
      protocolNo: 'MU-AEC-2569-007', ageWeeks: 6, weightMin: 20, weightMax: 25 },
    { id: 'P3', count: 12, tagPrefix: 'BP', strain: 'BALB/c', sex: 'M / F',
      protocolNo: 'MU-AEC-2568-112', ageWeeks: 8, weightMin: 22, weightMax: 28 },
  ];
  past.forEach(o => {
    const p = DB.projects.find(x => x.id === o.id);
    if (!p || p.quarantine) return;
    // เริ่มกักคือวันที่ระบุไว้ในแผน ("รับสัตว์เข้าห้องกักกันโรค")
    p.quarantine = quarantineDemo({ ...o, start: p.facility.quarantineDate, released: true, failAt: null });
  });
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
        humaneScore: req.humaneScore || null,  // เกณฑ์หยุดการทดลองที่ PI เสนอมา
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
    // เกณฑ์ Humane endpoint — ตั้งค่าตอน PI ยื่นคำขอ แต่ละโครงการต่างกันได้
    humaneScore: {
      criteria: [
        { name: 'Behavior and Physical appearance', auto: null, other: true, levels: [
          'Normal appearance, healthy with normal activity',
          'Lack of grooming, Weakness, loss of appetite, Dehydration',
          'Rough coat, Lethargy, Isolation, Porphyrin staining (Eye, Nose, Mouth)',
          'Do not movement, Moribund, Inactivity, Hunched posture (± Clinical signs)'] },
        { name: 'Body weight change', auto: 'weight', other: false, cuts: [10, 20] },
        { name: 'Grimace scale', auto: null, other: false, levels: [
          'Grimace score = 0', 'Grimace score = 0.1 – 0.9',
          'Grimace score = 1.0 – 1.9', 'Grimace score ≥ 2.0'] },
      ],
      totalThreshold: 6, weightLossPct: 20,
      note: '< 140 mg/dl of blood glucose in 2-hour after glucose loading',
    },
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
    // stage 2 — AEC approved, waiting for AV to build.
    // คำขอนี้ขอแต่งตั้งคนที่ "ยังไม่มีบัญชี" มาด้วยหนึ่งคน — เป็นตัวอย่างของงานที่
    // สัตวแพทย์ต้องทำตอนจัดสรรกรง คือตรวจชื่อ/อีเมล/รหัสผ่านที่ผู้วิจัยกรอกมาแล้ว
    // เปิดบัญชีให้ (อีเมลในตัวอย่างสะกดผิดไว้ตั้งใจ ให้เห็นว่าแก้ได้ก่อนเปิดบัญชี)
    requestProject('P7', 'Hepatic Clearance Assay', 'u_pi', 'aec_ok',
      { ...demoReq, objective: 'ศึกษาการกำจัดสารผ่านตับในหนูทดลอง', totalMice: 16,
        groups: [ { name: 'Control', isControl: true, plannedMice: 8 }, { name: 'Treatment', isControl: false, plannedMice: 8 } ],
        appointments: [
          { role: 'COPI', userId: 'u_copi', name: 'CoPI — นักวิจัยร่วม' },
          { role: 'AHS', userId: '__new__', firstName: 'ธนกฤต', lastName: 'พงษ์ไพบูลย์',
            email: 'thanakrit.cmu.ac.th', password: 'labwork2569', name: 'ธนกฤต พงษ์ไพบูลย์' },
        ] },
      { aecReview: { by: 'AEC — สำนักเลขาฯ จริยธรรม', at: isoDaysAgo(1) } }),
    // rejected at the AEC stage
    requestProject('P6', 'Metabolic Screen', 'u_pi', 'rejected', demoReq,
      { rejectStage: 'aec', rejectReason: 'จำนวนสัตว์ต่อกลุ่มยังไม่สอดคล้องกับการคำนวณทางสถิติ และแผนภาพการทดลองไม่ครบถ้วน', reviewedBy: 'AEC — สำนักเลขาฯ จริยธรรม', reviewedAt: isoDaysAgo(1) }),
  );

  // สองสถานะก่อนโครงการเดินจริง — แม่พิมพ์เดียวกัน ต่างกันแค่ระยะที่ไปถึง
  DB.projects.push(
    // สร้างกรงแล้ว แต่สัตว์ยังไม่มาส่ง — วันมาถึงอยู่ในอนาคต ยังไม่มีเอกสารกักโรคสักใบ
    builtProject({ id: 'P9', name: 'Bone Healing Study', protocolNo: 'MU-AEC-2569-024',
      objective: 'ศึกษาการสมานของกระดูกหลังได้รับสารกระตุ้นในหนูทดลอง',
      endDetail: 'สิ้นสุดการทดลอง · เก็บตัวอย่างกระดูกและการุณยฆาต',
      strain: 'ICR', arrive: isoDaysAgo(-4), phase: 'awaiting_intake',
      quarantine: { intake: null, program: null, daily: [], release: null } }),
    // สัตว์มาถึงและกักอยู่ (วันที่ 6 จาก 7) — เอกสารครบทั้งสองใบ พิมพ์ได้ทันที
    builtProject({ id: 'P8', name: 'Renal Function Study', protocolNo: 'MU-AEC-2569-021',
      objective: 'ประเมินการทำงานของไตหลังได้รับสารทดสอบในหนูทดลอง',
      endDetail: 'สิ้นสุดการทดลอง · เก็บตัวอย่างไตและการุณยฆาต',
      strain: 'ICR', arrive: isoDaysAgo(5), phase: 'quarantine',
      quarantine: quarantineDemo({ start: isoDaysAgo(5), count: 10, failAt: 6, released: false,
        protocolNo: 'MU-AEC-2569-021', tagPrefix: 'RT', strain: 'ICR', sex: 'M / F',
        ageWeeks: 7, weightMin: 22, weightMax: 28 }) }),
    // กักครบ 7 วันและสัตวแพทย์ปล่อยเมื่อวาน — วันนี้ถึงคิว Sci ชั่งน้ำหนักแรกเข้า
    builtProject({ id: 'P10', name: 'Gut Microbiome Pilot', protocolNo: 'MU-AEC-2569-026',
      objective: 'ศึกษาผลของโพรไบโอติกต่อจุลชีพในลำไส้ของหนูทดลอง',
      endDetail: 'สิ้นสุดการทดลอง · เก็บตัวอย่างลำไส้และการุณยฆาต',
      strain: 'C57BL/6', arrive: isoDaysAgo(7), phase: 'running',
      quarantine: quarantineDemo({ start: isoDaysAgo(7), count: 10, failAt: null, released: true,
        protocolNo: 'MU-AEC-2569-026', tagPrefix: 'GM', strain: 'C57BL/6', sex: 'M / F',
        ageWeeks: 7, weightMin: 20, weightMax: 26 }) }),
  );

  // an AV-built project that is already live but still empty: shelves may hold
  // UNEQUAL numbers of cages, every cage has no mice, no diet and no treatment group.
  // ชุดเอกสารกักกันโรคตัวอย่าง — ตรวจรับครบ 10 ตัว (ไม่ผ่าน 1) และดูแลมาแล้ว 5 วัน
  // มีไว้ให้เปิดหน้ากักกันโรคแล้วพิมพ์เอกสารได้ทั้งสองใบทันทีโดยไม่ต้องกรอกอะไรก่อน
  // โครงการที่ AV สร้างกรงเสร็จแล้ว — ใช้สร้างตัวอย่างของ "ทั้งสองสถานะก่อนเดินจริง"
  // จากแม่พิมพ์เดียวกัน ต่างกันแค่ระยะที่ไปถึง: ยังไม่มาส่ง กับ มาถึงแล้วกำลังกัก
  function builtProject(o) {
    const id = o.id;
    // ทุกวันในโครงการนี้อ้างจากวันเดียว = วันที่สัตว์มาถึงหน่วย (เริ่มกักโรค)
    //   มาถึง → กัก 7 วัน → ปล่อย → ชั่งน้ำหนักแรกเข้า → สิ้นสุดการทดลอง
    // ถ้าปล่อยให้แต่ละที่นับ isoDaysAgo ของตัวเอง วันบนใบฟอร์ม แผนการใช้สัตว์
    // และสถานะจะหลุดจากกันทันทีที่แก้อันใดอันหนึ่ง
    const arrive = o.arrive;
    const release = isoPlus(arrive, QUARANTINE_DAYS - 1);
    const moveIn = isoPlus(release, 1);
    const endDate = isoPlus(moveIn, 84);
    const diets = [
      { id: `${id}-D1`, name: 'อาหารทั่วไป', isDefault: true,  color: '#A8A79C', desc: 'อาหารมาตรฐาน', capacity: 10 },
      { id: `${id}-D2`, name: 'ไขมันสูง',    isDefault: false, color: '#B08B2E', desc: 'อาหารไขมันสูง', capacity: 6 },
    ];
    const groups = [
      { id: `${id}-G1`, name: 'Control',   isControl: true,  color: '#6B6F6A', desc: 'กลุ่มควบคุม', capacity: 4 },
      { id: `${id}-G2`, name: 'Treatment', isControl: false, color: '#5F7355', desc: 'กลุ่มได้รับสารทดสอบ', capacity: 6 },
    ];
    // shelf 1 has 3 cages, shelf 2 has 2 cages (deliberately unequal)
    const layout = [
      { shelf: 1, no: 'A', cages: ['A-01', 'A-02', 'A-03'] },
      { shelf: 2, no: 'B', cages: ['B-01', 'B-02'] },
    ];
    const RACK = 'R1';                       // โครงการนี้ใช้แร็คเดียว
    const shelfNames = {};
    const shelfRacks = {};
    const cages = [];
    let seq = 0;
    layout.forEach(row => {
      shelfNames[row.shelf] = row.no;
      shelfRacks[row.shelf] = RACK;
      row.cages.forEach((code, i) => {
        cages.push({
          id: `${id}-C${++seq}`, code, shelfLabel: row.no, groupId: null, dietId: null,
          rackNo: RACK,
          shelf: row.shelf, position: i + 1, mice: [],
          water: { remaining: 300, added: null, consumed: 0 },
          food:  { remaining: 100, added: null, consumed: 0 },
          careLog: [],
          status: 'pending', lastRecordDate: todayISO(),
        });
      });
    });
    return {
      id, name: o.name,
      description: o.objective,
      // startDate ในระบบนี้หมายถึง "วันที่หนูเข้ากรง/ชั่งครั้งแรก" (ตรงกับช่อง Start
      // บนใบติดหน้ากรง) ไม่ใช่วันที่สัตว์มาถึงหน่วย — ต้องใช้ moveIn ให้ตรงกับ P1
      startDate: moveIn, status: 'active', createdBy: 'u_pi', approval: 'approved',
      // โครงการตัวอย่างที่ค้างอยู่ในช่วงกักโรค — เปิดหน้ากักกันโรคแล้วพิมพ์เอกสาร
      // ได้ทั้งสองใบทันทีโดยไม่ต้องกรอกอะไรก่อน
      phase: o.phase,
      quarantine: o.quarantine,
      requestDate: isoPlus(arrive, -16),
      request: {
        // หัวโปรโตคอลครบชุดเหมือนที่ฟอร์มคำขอสร้างให้ — ใบติดหน้ากรงอ่านจากตรงนี้
        lotNo: '1', protocolNo: o.protocolNo, pi: 'ดร. นภา ศรีสุข',
        approvedDate: isoPlus(arrive, -14), untilDate: isoPlus(arrive, 351),
        species: 'Mus musculus', strain: o.strain,
        sexes: ['M', 'F'], ageMin: 7, ageMax: 9, weightMin: 22, weightMax: 28,
        maleCount: 6, femaleCount: 4,
        // เกณฑ์ Humane endpoint — ตั้งค่าตอน PI ยื่นคำขอ แต่ละโครงการต่างกันได้
        humaneScore: {
          criteria: [
            { name: 'Behavior and Physical appearance', auto: null, other: true, levels: [
              'Normal appearance, healthy with normal activity',
              'Lack of grooming, Weakness, loss of appetite, Dehydration',
              'Rough coat, Lethargy, Isolation, Porphyrin staining (Eye, Nose, Mouth)',
              'Do not movement, Moribund, Inactivity, Hunched posture (± Clinical signs)'] },
            // เก็บเป็นจุดตัด % — คำอธิบายระบบสร้างให้เอง ขัดกับการคำนวณไม่ได้
            { name: 'Body weight change', auto: 'weight', other: false, cuts: [10, 20] },
            { name: 'Grimace scale', auto: null, other: false, levels: [
              'Grimace score = 0', 'Grimace score = 0.1 – 0.9',
              'Grimace score = 1.0 – 1.9', 'Grimace score ≥ 2.0'] },
          ],
          totalThreshold: 6, weightLossPct: 20,
          note: '< 140 mg/dl of blood glucose in 2-hour after glucose loading',
        },
        totalMice: 10, objective: o.objective,
        diets: [ { name: 'อาหารทั่วไป', isDefault: true, plannedMice: 10 }, { name: 'ไขมันสูง', isDefault: false, plannedMice: 6 } ],
        groups: [ { name: 'Control', isControl: true, plannedMice: 4 }, { name: 'Treatment', isControl: false, plannedMice: 6 } ],
        // รายการสุดท้ายของแผน = ช่อง "End" บนใบติดหน้ากรง
        plan: [
          { date: arrive, detail: `รับสัตว์เข้าห้องกักกันโรค · กัก ${QUARANTINE_DAYS} วัน` },
          { date: moveIn, detail: 'ชั่งน้ำหนักแรกเข้า นำหนูเข้ากรง และแบ่งกลุ่ม' },
          { date: endDate, detail: o.endDetail },
        ],
        protocolEndpoint: 'สิ้นสุดเมื่อครบ 12 สัปดาห์ หรือเมื่อเก็บตัวอย่างไตครบทุกตัว',
        humaneEndpoint: 'น้ำหนักลดเกิน 20% ของน้ำหนักเริ่มต้น · ไม่กินอาหาร/น้ำเกิน 24 ชม. · ปัสสาวะผิดปกติร่วมกับซึมไม่ตอบสนอง — ให้ทำการุณยฆาตทันที',
        diagram: null, aup: null, approvalDoc: null,
        appointments: [ { role: 'COPI', userId: 'u_copi', name: 'CoPI — นักวิจัยร่วม' } ],
      },
      aecReview: { by: 'AEC — สำนักเลขาฯ จริยธรรม', at: isoPlus(arrive, -13) },
      builtBy: { by: 'AV — สัตวแพทย์ประจำหน่วย', at: isoPlus(arrive, -7) },
      facility: { roomNo: 'AR01', rackNo: RACK, racks: [RACK], quarantineDate: arrive, moveInDate: moveIn },
      shelves: layout.length, cagesPerShelf: 3, shelfNames, shelfRacks,
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

// ประวัติการเรียกใช้ครุภัณฑ์ย้อนหลัง — ผูกกับรอบงานที่โครงการทำจริง
// (ชั่งน้ำหนักรายสัปดาห์ของ NAFLD และรอบตรวจกรงประจำวัน) เพื่อให้คอลัมน์
// "การใช้งาน" ในหน้าพัสดุมีตัวเลขให้เห็นตั้งแต่เปิดระบบครั้งแรก
(function seedAssetUsage() {
  const byCode = c => DB.assets.find(a => a.code === c);
  const scale = byCode('มช.6640-002-0007');       // เครื่องชั่ง
  const cart  = byCode('มช.6640-002-0031');       // รถเข็นเปลี่ยนกรง
  const bsc2  = byCode('มช.6640-002-0023');       // ตู้ปลอดเชื้อสำรอง
  const p1 = DB.projects.find(x => x.id === 'P1');
  const p8 = DB.projects.find(x => x.id === 'P8');
  let n = 0;
  const put = (a, action, proj, daysAgo, start, minutes, by) => {
    if (!a) return;
    const [h, m] = start.split(':').map(Number);
    const end = new Date(2000, 0, 1, h, m + minutes);
    a.usage.push({
      id: 'AUSEED' + (++n), action,
      projectId: proj ? proj.id : null, projectName: proj ? proj.name : '—',
      by, date: isoDaysAgo(daysAgo), start,
      end: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
      minutes, note: '',
    });
  };
  const SCI = 'Sci — นักวิทยาศาสตร์', ACT = 'ปิยะ ใจดี (ACT)';
  // ชั่งน้ำหนักรายสัปดาห์ 3 รอบ + รอบรับหนูเข้าโครงการตอนเริ่มโครงการ
  put(scale, 'intake', p1, 14, '09:10', 95, SCI);
  put(scale, 'weigh',  p1, 14, '11:05', 48, SCI);
  put(scale, 'weigh',  p1, 7,  '09:00', 41, SCI);
  put(scale, 'weigh',  p1, 1,  '08:55', 44, SCI);
  put(scale, 'qzIntake', p8, 5, '09:20', 0, SCI);
  // รถเข็นเปลี่ยนกรง — ใช้ทุกวันที่มีรอบตรวจกรง
  [6, 5, 4, 3, 2, 1].forEach((d, i) => put(cart, 'care', p1, d, ['08:40','08:35','09:05','08:50','08:45','08:30'][i], 25 + i * 4, ACT));
  put(cart, 'qzDaily', p8, 2, '08:30', 0, ACT);
  // ตู้ปลอดเชื้อสำรอง — รอบให้สารทดสอบ
  put(bsc2, 'dose', p1, 6, '13:20', 62, 'ก้อง วัฒนา (AHS)');
  put(bsc2, 'dose', p1, 2, '13:10', 55, 'ก้อง วัฒนา (AHS)');
  put(bsc2, 'treat', p1, 1, '15:40', 0, 'สพ.ญ. กมล');
})();

// seed a few historical log entries that match the demo state
(function seedAudit() {
  const HOUR = 3600000;
  const p1 = DB.projects.find(x => x.id === 'P1');
  // ผูกเวลากับวันจริงของโครงการ ไม่ใช่นับถอยหลังจากวันนี้เป็นตัวเลขลอย ๆ —
  // ไม่งั้น log จะบอกว่า "สร้างโครงการ 5 วันก่อน" ทั้งที่หนูอยู่ในกรงมาสองสัปดาห์แล้ว
  // 'YYYY-MM-DD' เปล่า ๆ ถูกอ่านเป็น UTC เที่ยงคืน เวลาที่แสดงจะเพี้ยนไป +7 ชม.
  // ต่อท้าย T00:00:00 เพื่อให้อ่านเป็นเวลาท้องถิ่น ชั่วโมงที่ตั้งไว้จึงตรงตามที่เขียน
  const at = (iso, h = 9) => new Date(iso + 'T00:00:00').getTime() + h * HOUR;
  const arrive = p1.facility.quarantineDate;          // สัตว์มาถึง = เริ่มกักโรค
  const release = p1.quarantine.release.date;
  const moveIn = p1.facility.moveInDate;
  const P = 'NAFLD Diet Study';
  DB.auditLog.push(
    { ts: at(isoPlus(arrive, -19), 10), user: 'ดร. นภา ศรีสุข', role: 'PI', action: 'ยื่นคำขอสร้างโครงการ', detail: `${P} · สัตว์ทดลอง 48 ตัว · 4 กลุ่ม`, project: P },
    { ts: at(isoPlus(arrive, -16), 14), user: 'AEC — สำนักเลขาฯ จริยธรรม', role: 'AEC', action: 'ผ่านการตรวจจริยธรรม', detail: `${P} · เอกสารครบถ้วน`, project: P },
    { ts: at(isoPlus(arrive, -7), 11), user: 'สพ.ญ. อรุณ ทองดี', role: 'AV', action: 'สร้างโครงการ (สัตวแพทย์)', detail: `${P} · 4 ชั้น × 6 กรง กรงละ 2 ตัว`, project: P },
    { ts: at(arrive, 9), user: 'Sci — นักวิทยาศาสตร์', role: 'SCI', action: 'ตรวจรับสัตว์เข้าส่วนกักโรค', detail: '48 ตัว · ผ่าน 48 · ไม่ผ่าน 0', project: P },
    { ts: at(release, 10), user: 'สพ.ญ. กมล ศรีวิไล', role: 'VET', action: 'ปล่อยสัตว์ออกจากกักกันโรค', detail: `ครบกำหนดกัก ${QUARANTINE_DAYS} วัน · สุขภาพปกติทุกตัว`, project: P },
    { ts: at(moveIn, 9), user: 'Sci — นักวิทยาศาสตร์', role: 'SCI', action: 'รับหนูเข้าโครงการ (น้ำหนักแรกเข้า)', detail: '24 กรง · 48 ตัว', project: P },
    // เหตุการณ์ทางคลินิก — ตรงกับวันที่บันทึกไว้ในตัวหนูจริง
    { ts: at(isoDaysAgo(7), 8), user: 'นายสมชาย (AHS)', role: 'ACT', action: 'บันทึกการตาย', detail: 'C-04-2 · พบตายในกรง · ทำลายซาก', project: P },
    { ts: at(isoDaysAgo(6), 10), user: 'สพ. อนันต์', role: 'VET', action: 'บันทึกการรักษา', detail: 'C-02-1 · บาดแผลถลอกที่หาง', project: P },
    { ts: at(isoDaysAgo(4), 11), user: 'สพ.ญ. กมล', role: 'VET', action: 'บันทึกการตาย', detail: 'D-01-2 · Humane endpoint · ส่งชันสูตร', project: P },
    { ts: at(isoDaysAgo(2), 9), user: 'สพ. อนันต์', role: 'VET', action: 'ปิดเคส', detail: 'C-02-1 · แผลหายดี ขนขึ้นปกติ', project: P },
    { ts: at(isoDaysAgo(2), 13), user: 'ดร. นภา ศรีสุข', role: 'PI', action: 'Stop (ไม่คิดเฉลี่ย)', detail: 'C-02-2 · หยุดนำไปคิดค่าเฉลี่ยกลุ่ม', project: P },
    { ts: at(isoDaysAgo(1), 9), user: 'สพ.ญ. กมล', role: 'VET', action: 'สั่ง Humane endpoint', detail: 'B-01-1 · น้ำหนักลด >20% ไม่ตอบสนองการรักษา', project: P },
    { ts: at(isoDaysAgo(1), 10), user: 'สพ.ญ. กมล', role: 'VET', action: 'บันทึกการรักษา', detail: 'B-03-1 · สงสัยติดเชื้อทางเดินอาหาร', project: P },
    { ts: at(isoDaysAgo(1), 15), user: 'ปิยะ ใจดี (ACT)', role: 'ACT', action: 'ชั่งน้ำหนัก', detail: 'บันทึกกรง A-01', project: P },
    { ts: at(isoDaysAgo(0), 8), user: 'ก้อง วัฒนา (AHS)', role: 'AHS', action: 'แจ้งผิดปกติ', detail: 'A-04-1 · ขนยุ่ง นั่งซึมมุมกรง', project: P },
    // โครงการที่กำลังกักโรคอยู่
    { ts: at(DB.projects.find(x => x.id === 'P8').facility.quarantineDate, 9), user: 'Sci — นักวิทยาศาสตร์', role: 'SCI',
      action: 'ตรวจรับสัตว์เข้าส่วนกักโรค', detail: '10 ตัว · ผ่าน 9 · ไม่ผ่าน 1', project: 'Renal Function Study' },
  );
  // เขียนไว้เป็นกลุ่มตามโครงการเพื่อให้อ่านง่ายตอนแก้ แต่ log ต้องเรียงตามเวลาจริง
  DB.auditLog.sort((a, b) => a.ts - b.ts);
})();

// demo: give every project the same team so the members list is consistent when
// switching personas. PI/CoPI/AHS are the working research team; Sci/VET/ACT are
// the per-project appointments of the service positions.
// AHS dosing history for the running project, so "ทำเหมือนรอบที่แล้ว" has something
// to repeat FROM. Each arm gets its own routine line — that is what makes the repeat
// screen collapse 24 cages into one confirmation per arm — plus a one-off here and
// there that must NOT carry forward.
(function seedDoses() {
  const p1 = DB.projects.find(p => p.id === 'P1');
  if (!p1) return;
  const routineByGroup = {
    G1: 'ป้อน vehicle (0.5% CMC) 10 mL/kg ทางปาก',
    G2: 'ป้อนสาร A 10 mg/kg ทางปาก (oral gavage)',
    G3: 'ป้อนสาร A 30 mg/kg ทางปาก (oral gavage)',
    G4: 'ป้อนสาร A 30 mg/kg ทางปาก + วัดอุณหภูมิร่างกาย',
  };
  const AHS = 'AHS — นักวิจัยปฏิบัติการ';
  p1.cages.forEach(c => {
    const line = routineByGroup[c.groupId];
    if (!line) return;
    c.mice.forEach(m => {
      if (!m.alive) return;
      // สองรอบก่อนหน้า — รอบล่าสุด (เมื่อวาน) คือรอบที่ปุ่มทำซ้ำจะหยิบมาใช้
      [3, 1].forEach(ago => {
        const items = [{ text: line, kind: 'routine' }];
        // รายการชั่วคราวของรอบก่อน ต้องไม่ตามมาในการทำซ้ำ
        if (ago === 1 && m.cageNo === 1 && c.code === 'B-03') {
          items.push({ text: 'เจาะเลือดหางข้างซ้าย 100 µL', kind: 'once' });
        }
        m.doses.push({ date: isoDaysAgo(ago), time: ago === 1 ? '09:15' : '09:05', by: AHS,
          items, paused: false, pauseReason: '' });
      });
    });
  });
  // หนึ่งตัวถูกพักไว้เมื่อวาน — ต้องถูกคัดออกจากการทำซ้ำ ไม่ใช่กวาดไปด้วย
  const c04 = p1.cages.find(c => c.code === 'C-04');
  const paused = c04 && c04.mice.find(m => m.alive);
  if (paused) {
    paused.doses.push({ date: isoDaysAgo(1), time: '09:20', by: AHS, items: [],
      paused: true, pauseReason: 'น้ำหนักลดต่อเนื่อง 3 วัน รอสัตวแพทย์ประเมินก่อน' });
  }
})();

// ประวัติการประเมิน Humane endpoint ย้อนหลังของโครงการที่กำลังเดิน
// ส่วนใหญ่ N (ปกติ) ทุกสัปดาห์ — นั่นคือประเด็น: บันทึกไว้ว่ามีคนประเมินจริง
// และมีบางตัวที่คะแนนไต่ขึ้น ซึ่งเป็นที่มาของเคสที่ค้างอยู่ตอนนี้
(function seedHealth() {
  const p1 = DB.projects.find(p => p.id === 'P1');
  if (!p1) return;
  const crit = p1.request.humaneScore.criteria;
  const cfg = p1.request.humaneScore;
  const SCI = 'Sci — นักวิทยาศาสตร์';
  const mk = (date, scores, note) => {
    const total = scores.reduce((a, b) => a + b, 0);
    const result = total >= cfg.totalThreshold ? 'E' : 'N';
    return { date, time: '09:30', by: SCI, source: 'weigh',
      status: result === 'E' ? 'critical' : total === 0 ? 'normal' : 'abnormal',
      note: note || '',
      scores: crit.map((c, i) => ({ name: c.name, v: scores[i] })),
      total, max: crit.length * 3, result, lossPct: 0 };
  };
  const zeros = crit.map(() => 0);
  p1.cages.forEach(c => c.mice.forEach(m => {
    // ประเมินรายสัปดาห์ — ย้อนหลัง 2 รอบ
    [14, 7].forEach(d => m.health.push(mk(isoDaysAgo(d), zeros)));
  }));
  // ตัวที่ตอนนี้ยังมีเรื่องค้างอยู่ — คะแนนไต่ขึ้นก่อนหน้านั้น
  [['A-04', 1], ['B-03', 1]].forEach(([code, no]) => {
    const cage = p1.cages.find(x => x.code === code);
    const m = cage && cage.mice.find(x => x.cageNo === no);
    if (!m) return;
    m.health.push(mk(isoDaysAgo(3), [1, 0, 0, 0], 'Lack of grooming เริ่มเห็นชัด'));
    m.health.push(mk(isoDaysAgo(1), [2, 1, 1, 1], 'Rough coat, lethargy · เริ่มแยกตัวจากกลุ่ม'));
  });
})();

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

// ------------------------------------------------------------------
// SHAPE GUARD — every project's `request` must carry the full field set
//
// The request blob has grown over time (protocol header, age range, plan,
// endpoints, extra attachments…). Projects seeded BEFORE a field existed simply
// lack the key, and anything reading it prints nothing — that is exactly how the
// cage card ended up almost blank for P8, and earlier for P1/P3.
//
// This backfills the missing keys with an EMPTY value of the right type, so a
// consumer always finds the key and renders a blank line instead of breaking.
// It never overwrites a value that is already there, so a project built through
// the real request form passes through untouched.
//
// When adding a field to the request form, add it here too.
// ------------------------------------------------------------------
const REQUEST_SHAPE = {
  lotNo: '', protocolNo: '', pi: '',
  approvedDate: '', untilDate: '',
  species: '', strain: '', sexes: [],
  ageMin: '', ageMax: '', weightMin: '', weightMax: '',
  maleCount: 0, femaleCount: 0, totalMice: 0,
  objective: '', protocolEndpoint: '', humaneEndpoint: '',
  diets: [], groups: [], plan: [], humaneScore: null,
  diagram: null, aup: null, approvalDoc: null, extraDocs: [], appointments: [],
};
(function normalizeRequests() {
  DB.projects.forEach(p => {
    const r = p.request || (p.request = {});
    Object.entries(REQUEST_SHAPE).forEach(([k, blank]) => {
      if (r[k] === undefined) r[k] = Array.isArray(blank) ? [] : blank;
    });
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
