/* ============================================================
 * Mouse Laboratory Management System — Prototype v0.1
 * Mock data layer (in-memory only, no real database)
 * ============================================================ */

// Project-level roles. A user can hold several of these per project; their
// capabilities are the UNION of all roles held. Keys stay EC/PI/STOCK/VET/SCI
// (STOCK is shown as "AHS"). System-level role (admin/user) is on the user.
const ROLES = {
  EC:    { key: 'EC',    label: 'EC (กรรมการจริยธรรม)',      caps: ['view'] },
  PI:    { key: 'PI',    label: 'PI (หัวหน้าโครงการ)',        caps: ['view', 'editProject', 'deathStop', 'manageMembers'] },
  STOCK: { key: 'STOCK', label: 'AHS (ดูแลสัตว์/สต็อก)',      caps: ['view', 'weigh', 'deathStop'] },
  SCI:   { key: 'SCI',   label: 'นักวิทย์',                    caps: ['view', 'weigh', 'deathStop'] },
  VET:   { key: 'VET',   label: 'Vet (สัตวแพทย์)',            caps: ['view', 'treat', 'deathStop'] },
};
const ROLE_ORDER = ['EC', 'PI', 'STOCK', 'SCI', 'VET'];

// capability catalogue (for the permission matrix / gating)
const CAPABILITIES = [
  { key: 'view',          label: 'ดูข้อมูลโครงการ / กรง / หนู' },
  { key: 'editProject',   label: 'จัดการกรง / แก้ไขผังโครงการ' },
  { key: 'weigh',         label: 'ชั่งน้ำหนัก (บันทึกประจำวัน)' },
  { key: 'treat',         label: 'ตรวจรักษา / ปิดเคส / Humane endpoint' },
  { key: 'deathStop',     label: 'บันทึกการตาย / Stop' },
  { key: 'manageMembers', label: 'จัดการสมาชิก & สิทธิในโครงการ' },
];

// mock user accounts (system role: admin = superuser, user = per-project roles)
// `name` is the display name kept in sync with firstName + lastName.
function makeUser(id, firstName, lastName, email, password, systemRole) {
  return { id, firstName, lastName, email, password, systemRole, name: `${firstName} ${lastName}`.trim() };
}
const USERS = [
  makeUser('u_admin', 'แอดมิน', 'ระบบ',     'admin@lab.test',   'admin1234', 'admin'),
  makeUser('u_pi',    'สมชาย',  'ใจดี',      'somchai@lab.test', 'demo1234',  'user'),
  makeUser('u_napa',  'นภา',    'ศรีสุข',    'napa@lab.test',    'demo1234',  'user'),
  makeUser('u_vet',   'กมล',    'รักสัตว์',  'kamon@lab.test',   'demo1234',  'user'),
  makeUser('u_sci',   'ปิยะ',   'วิจัย',     'piya@lab.test',    'demo1234',  'user'),
  makeUser('u_ahs',   'ก้อง',   'ดูแลสัตว์', 'kong@lab.test',    'demo1234',  'user'),
  makeUser('u_ec',    'วิไล',   'ตรวจสอบ',   'wilai@lab.test',   'demo1234',  'user'),
];

// ---- helpers for generating believable weight histories -----
function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
    treatments: [],
    excluded: false,           // "stopped": kept out of group-average stats (still eats/drinks)
    alive: true,
    death: null,               // { type:'natural'|'humane', disposition:'dispose'|'necropsy', note, date }
    careOpen: false,           // vet case currently open (drives the cage "care" colour)
    humaneOrder: null,         // vet order to euthanise: { reason, vet, date }
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
// Project 1 : NAFLD Diet Study
// ------------------------------------------------------------
const groupsP1 = [
  { id: 'G1', name: 'Control',      isControl: true,  color: '#64748b' },
  { id: 'G2', name: 'Treatment-1',  isControl: false, color: '#2563eb' },
  { id: 'G3', name: 'Treatment-2',  isControl: false, color: '#7c3aed' },
];

// per-group weight profile (baseline weight + average daily gain)
const groupProfile = {
  G1: { baseline: 28.0, trend: 0.30 },   // control — normal healthy gain
  G2: { baseline: 30.0, trend: 0.18 },   // treatment-1 — reduced gain
  G3: { baseline: 32.0, trend: 0.08 },   // treatment-2 — poor gain
};

let _cageSeq = 0;
function nextCageId() { _cageSeq++; return 'C' + _cageSeq; }

// Layout: 4 shelves × 6 cages, 5 mice per cage. One group per shelf (cycled).
const shelfLetters = ['A', 'B', 'C', 'D'];
const cagesP1 = [];
for (let si = 0; si < 4; si++) {
  const groupId = groupsP1[si % groupsP1.length].id;
  const prof = groupProfile[groupId];
  const letter = shelfLetters[si];
  for (let pos = 1; pos <= 6; pos++) {
    const code = `${letter}-${String(pos).padStart(2, '0')}`;
    const mice = [];
    for (let k = 1; k <= 5; k++) {
      mice.push(makeMouse(`${code}-${k}`, 'M',
        prof.baseline + rand(-1.2, 1.2),
        prof.trend + rand(-0.05, 0.05)));
    }
    cagesP1.push(makeCage(nextCageId(), code, groupId, si + 1, pos, mice, {
      lastRecordDate: isoDaysAgo(1),
    }));
  }
}

// Seed a couple of individual treatments + one alert cage for demo
(function seedTreatments() {
  // sick mouse in cage B-03 → cage flagged alert
  const b03 = cagesP1.find(c => c.code === 'B-03');
  const sick = b03.mice[0];
  sick.remark = 'ซึม กินอาหารน้อยลง';
  const w = sick.weights;
  w[w.length - 1].weight = Math.round((w[w.length - 2].weight - 1.8) * 10) / 10;
  sick.treatments.push({
    date: isoDaysAgo(1),
    vet: 'สพ.ญ. กมล',
    diagnosis: 'สงสัยติดเชื้อทางเดินอาหาร',
    treatment: 'ให้สารน้ำใต้ผิวหนัง + ติดตามอาการ 48 ชม.',
  });
  sick.careOpen = true;   // case still open → cage shows "care"

  // a healed mouse elsewhere still carries a treatment record (mouse-level marker)
  const c02 = cagesP1.find(c => c.code === 'C-02');
  c02.mice[2].treatments.push({
    date: isoDaysAgo(4),
    vet: 'สพ. อนันต์',
    diagnosis: 'บาดแผลถลอกที่หาง',
    treatment: 'ทำความสะอาดแผล + ยาปฏิชีวนะเฉพาะที่ 3 วัน',
  });

  // demo: a vet has ordered humane endpoint (awaiting the experimenter to act)
  const b01 = cagesP1.find(c => c.code === 'B-01');
  b01.mice[2].remark = 'น้ำหนักลดต่อเนื่อง เข้าเกณฑ์ endpoint';
  b01.mice[2].humaneOrder = {
    reason: 'น้ำหนักลด >20% จากค่าเริ่มต้น และไม่ตอบสนองต่อการรักษา',
    vet: 'สพ.ญ. กมล',
    date: isoDaysAgo(1),
  };

  // demo states: one "stopped" (out of stats) and one dead mouse
  c02.mice[1].excluded = true;
  const d01 = cagesP1.find(c => c.code === 'D-01');
  d01.mice[4].alive = false;
  d01.mice[4].excluded = true;
  d01.mice[4].death = {
    type: 'humane', disposition: 'necropsy',
    note: 'น้ำหนักลดต่อเนื่องเกินเกณฑ์ · เก็บตับและไตส่งตรวจ',
    date: isoDaysAgo(2),
  };
})();

// ------------------------------------------------------------
// Project 2 : Wound Healing (fewer cages, different layout)
// ------------------------------------------------------------
const groupsP2 = [
  { id: 'G4', name: 'Control (Saline)',   isControl: true,  color: '#64748b' },
  { id: 'G5', name: 'Treatment (Gel)',    isControl: false, color: '#16a34a' },
];
const cagesP2 = [
  makeCage(nextCageId(), 'W-01', 'G4', 1, 1, [
    makeMouse('W-01-1', 'F', 24.0, 0.08),
    makeMouse('W-01-2', 'F', 23.5, 0.10),
  ], { status: 'pending' }),
  makeCage(nextCageId(), 'W-02', 'G4', 1, 2, [
    makeMouse('W-02-1', 'F', 24.2, 0.09),
  ], { status: 'pending' }),
  makeCage(nextCageId(), 'W-03', 'G5', 2, 1, [
    makeMouse('W-03-1', 'F', 23.8, 0.11),
    makeMouse('W-03-2', 'F', 24.5, 0.12),
  ], { status: 'pending' }),
];

// ------------------------------------------------------------
// Root DB object
// ------------------------------------------------------------
const DB = {
  users: USERS,
  currentUserId: 'u_pi',      // active identity (switchable for testing)
  projects: [
    {
      id: 'P1',
      name: 'NAFLD Diet Study',
      description: 'ศึกษาผลของอาหารไขมันสูงและยาต่อภาวะไขมันพอกตับในหนู C57BL/6',
      startDate: '2026-05-12',
      status: 'active',
      shelves: 4,
      cagesPerShelf: 6,
      groups: groupsP1,
      cages: cagesP1,
      // ดร. นภา ถือ 2 บทบาท (PI+VET) ในโครงการนี้ เพื่อสาธิต union สิทธิ์
      members: [
        { userId: 'u_pi', roles: ['PI'] },
        { userId: 'u_napa', roles: ['PI', 'VET'] },
        { userId: 'u_vet', roles: ['VET'] },
        { userId: 'u_sci', roles: ['SCI'] },
        { userId: 'u_ahs', roles: ['STOCK'] },
        { userId: 'u_ec', roles: ['EC'] },
      ],
    },
    {
      id: 'P2',
      name: 'Wound Healing Gel',
      description: 'ทดสอบประสิทธิภาพเจลสมานแผลเทียบกับกลุ่มควบคุม',
      startDate: '2026-06-20',
      status: 'active',
      shelves: 2,
      cagesPerShelf: 4,
      groups: groupsP2,
      cages: cagesP2,
      // ดร. สมชาย เป็น EC ในโครงการนี้ (ต่างจากโครงการ P1 ที่เป็น PI)
      members: [
        { userId: 'u_pi', roles: ['EC'] },
        { userId: 'u_sci', roles: ['SCI'] },
        { userId: 'u_vet', roles: ['VET'] },
      ],
    },
    {
      id: 'P3',
      name: 'Behavioral Pilot (เสร็จสิ้น)',
      description: 'โครงการนำร่องพฤติกรรม — ปิดโครงการแล้ว',
      startDate: '2026-01-08',
      status: 'closed',
      shelves: 2,
      cagesPerShelf: 4,
      groups: [{ id: 'G6', name: 'Pilot', isControl: true, color: '#64748b' }],
      cages: [],
      members: [{ userId: 'u_napa', roles: ['PI'] }],
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
    { ts: now - 5 * DAY, user: 'ผู้ดูแลระบบ', role: 'PI', action: 'สร้างโครงการ', detail: 'NAFLD Diet Study · 4 ชั้น × 6 กรง', project: 'NAFLD Diet Study' },
    { ts: now - 4 * DAY, user: 'สพ. อนันต์', role: 'VET', action: 'บันทึกการรักษา', detail: 'C-02-3 · บาดแผลถลอกที่หาง', project: 'NAFLD Diet Study' },
    { ts: now - 2 * DAY, user: 'สพ.ญ. กมล', role: 'VET', action: 'สั่ง Humane endpoint', detail: 'B-01-3 · น้ำหนักลด >20% ไม่ตอบสนองการรักษา', project: 'NAFLD Diet Study' },
    { ts: now - 2 * DAY + 3600000, user: 'ปิยะ (นักวิทย์)', role: 'SCI', action: 'บันทึกการตาย', detail: 'D-01-5 · Humane endpoint · ชันสูตร/เก็บตัวอย่าง', project: 'NAFLD Diet Study' },
    { ts: now - 1 * DAY, user: 'สพ.ญ. กมล', role: 'VET', action: 'บันทึกการรักษา', detail: 'B-03-1 · สงสัยติดเชื้อทางเดินอาหาร', project: 'NAFLD Diet Study' },
    { ts: now - 1 * DAY + 1800000, user: 'ปิยะ (นักวิทย์)', role: 'SCI', action: 'ชั่งน้ำหนัก', detail: 'บันทึกกรง A-01', project: 'NAFLD Diet Study' },
    { ts: now - 6 * 3600000, user: 'ปิยะ (นักวิทย์)', role: 'SCI', action: 'Stop (ไม่คิดเฉลี่ย)', detail: 'C-02-2 · หยุดนำไปคิดค่าเฉลี่ยกลุ่ม', project: 'NAFLD Diet Study' },
  );
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
