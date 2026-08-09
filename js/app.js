/* ============================================================
 * iLAMP — Intelligent Laboratory Animal Management Platform (Prototype)
 * App controller: routing, rendering, weighing workflow
 * (Pure front-end mockup — no backend / no database)
 * ============================================================ */

const App = {
  route: { name: 'login', projectId: null },
  weighing: false,            // whole-system weighing mode toggle
  wizard: null,               // active weighing wizard state
  caring: false,              // ACT cage-inspection round
  careWiz: null,

  // --- HUMANE ENDPOINT SCORING ------------------------------------------
  // โครงสร้างมาจากเอกสาร "Humane endpoint and record" ของศูนย์ฯ — เกณฑ์ให้คะแนน
  // ข้อละ 0–3 พร้อมนิยามทุกระดับ, การุณยฆาตเมื่อคะแนนรวมถึงเกณฑ์หรือน้ำหนักลดเกิน %
  //
  // แต่ "แต่ละโปรโตคอลมีเกณฑ์ไม่เหมือนกัน" — ชุดข้างล่างนี้จึงเป็นแค่ค่าตั้งต้นที่
  // กรอกให้ตอนสร้างโครงการ PI แก้ชื่อ แก้นิยามทุกระดับ เพิ่ม/ลบข้อ และตั้งเกณฑ์เองได้
  // ทั้งหมด สิ่งเดียวที่ระบบตรึงไว้คือมาตรวัด 0–3 เพื่อให้คะแนนเทียบกันได้
  // Option terms are English verbatim from the paper form — technical, not translated.
  HEALTH_SCALE: [
    { v: 0, label: 'ปกติ' }, { v: 1, label: 'เล็กน้อย' },
    { v: 2, label: 'ปานกลาง' }, { v: 3, label: 'รุนแรง' },
  ],
  MIN_HUMANE_CRITERIA: 2,
  MAX_HUMANE_CRITERIA: 8,
  // ค่าตั้งต้น (ตามเอกสาร 2569/RT-0007) — แก้ได้ทุกตัวอักษร
  DEFAULT_HUMANE_CRITERIA: [
    { name: 'Behavior and Physical appearance', auto: null, other: true,
      levels: [
        'Normal appearance, healthy with normal activity',
        'Lack of grooming, Weakness, loss of appetite, Dehydration',
        'Rough coat, Lethargy, Isolation, Porphyrin staining (Eye, Nose, Mouth)',
        'Do not movement, Moribund, Inactivity, Hunched posture (± Clinical signs)',
      ] },
    // auto:'weight' — คะแนนข้อนี้ระบบคิดจากน้ำหนักที่ชั่ง จึงเก็บเป็น "จุดตัด %" (cuts)
    // ไม่ใช่ข้อความอิสระ แล้วสร้างคำอธิบายจากตัวเลขนั้น: ข้อความกับการคำนวณจึงเป็น
    // ค่าเดียวกันเสมอ ขัดกันไม่ได้ — PI แก้ตัวเลข ระบบแก้ข้อความตาม
    { name: 'Body weight change', auto: 'weight', other: false, cuts: [10, 20] },
    { name: 'Grimace scale', auto: null, other: false,
      levels: ['Grimace score = 0', 'Grimace score = 0.1 – 0.9',
               'Grimace score = 1.0 – 1.9', 'Grimace score ≥ 2.0'] },
    // ตั้งต้นแค่ 3 ข้อที่ใช้ร่วมกันได้ทุกโครงการ — เกณฑ์เฉพาะโปรโตคอล (เช่น
    // Protocol-related parameter) ให้ PI เพิ่มเองตามการทดลองของตัวเอง
  ],
  DEFAULT_HUMANE: { totalThreshold: 6, weightLossPct: 20, note: '' },
  HUMANE_RESULT: {
    N: { label: 'N', full: 'N — Normal', th: 'ปกติ ทำการทดลองต่อได้', tone: 'ok' },
    E: { label: 'E', full: 'E — Euthanasia', th: 'ถึงเกณฑ์ต้องทำการุณยฆาต', tone: 'bad' },
    D: { label: 'D', full: 'D — Death', th: 'พบตาย', tone: 'bad' },
  },

  humaneCfg(p) {
    const c = (p && p.request && p.request.humaneScore) || {};
    const crit = (c.criteria || []).filter(x => x && (x.name || '').trim());
    return {
      criteria: crit.length ? crit : this.DEFAULT_HUMANE_CRITERIA,
      totalThreshold: +c.totalThreshold > 0 ? +c.totalThreshold : this.DEFAULT_HUMANE.totalThreshold,
      weightLossPct: +c.weightLossPct > 0 ? +c.weightLossPct : this.DEFAULT_HUMANE.weightLossPct,
      note: c.note || '',
    };
  },
  humaneCriteria(p) { return this.humaneCfg(p).criteria; },
  humaneMax(p) { return this.humaneCriteria(p).length * 3; },
  // โครงการนี้ให้ระบบคิดคะแนนน้ำหนักให้หรือไม่ (ขึ้นกับว่า PI เก็บข้อ auto:'weight' ไว้)
  hasAutoWeight(p) { return this.humaneCriteria(p).some(c => c.auto === 'weight'); },

  // น้ำหนักสูงสุดที่สัตว์ตัวนี้เคยทำได้ — ใช้เป็นฐานคิด % ที่ลด (เข้มงวดกว่าน้ำหนัก
  // แรกเข้า: จับการทรุดโทรมได้แม้หนูจะโตมาก่อนแล้วค่อยลด)
  peakWeight(mouse) {
    const w = (mouse.weights || []).map(x => x.weight).filter(v => v != null);
    return w.length ? Math.max(...w) : null;
  },
  // % ที่ลดจากจุดสูงสุด — `at` = น้ำหนักที่กำลังจะบันทึก (ยังไม่เข้า weights)
  weightLossPct(mouse, at = null) {
    const peak = this.peakWeight(mouse);
    const cur = at != null ? at : Data.latestWeight(mouse);
    if (peak == null || cur == null || peak <= 0) return null;
    return Math.max(0, Math.round(((peak - cur) / peak) * 1000) / 10);
  },
  DEFAULT_WEIGHT_CUTS: [10, 20],
  weightCuts(c) {
    const cu = (c && c.cuts) || this.DEFAULT_WEIGHT_CUTS;
    const a = +cu[0], b = +cu[1];
    return [Number.isFinite(a) && a > 0 ? a : 10, Number.isFinite(b) && b > a ? b : Math.max(20, a + 1)];
  },
  // คำอธิบาย 4 ระดับของเกณฑ์น้ำหนัก — สร้างจากจุดตัด ไม่ได้พิมพ์เอง
  weightLevels(c) {
    const [a, b] = this.weightCuts(c);
    return ['Normal or Increase', `< ${a}% weight loss`, `${a} – ${b}% weight loss`, `> ${b}% weight loss`];
  },
  // คำอธิบายของเกณฑ์ข้อหนึ่ง — ข้อ auto ใช้ตัวที่สร้างจากจุดตัดเสมอ
  critLevels(c) { return c.auto === 'weight' ? this.weightLevels(c) : (c.levels || ['', '', '', '']); },
  weightScore(lossPct, c) {
    if (lossPct == null) return null;
    const [a, b] = this.weightCuts(c);
    if (lossPct <= 0) return 0;
    if (lossPct < a) return 1;
    if (lossPct <= b) return 2;
    return 3;
  },
  // ผลการประเมิน — การุณยฆาตเมื่อ "น้ำหนักลดถึง %" หรือ "คะแนนรวมถึงเกณฑ์" สองทางแยกกัน
  humaneResult(p, total, lossPct) {
    const cfg = this.humaneCfg(p);
    if (this.hasAutoWeight(p) && lossPct != null && lossPct >= cfg.weightLossPct) return 'E';
    if (total != null && total >= cfg.totalThreshold) return 'E';
    return 'N';
  },

  // --- HEALTH TIMELINE ------------------------------------------------------
  // One append-only history per animal. `flag` stays what it always was — the
  // marker for "nobody has looked at this yet" — but it gets CLEARED when the vet
  // decides, which used to destroy the observation with it. The timeline is the
  // record: it is never cleared, so "Sci saw ขนหยอง on the 3rd, vet checked on the
  // 4th and called it normal" survives, and so does "this animal was looked at
  // every day for two weeks and was fine".
  HEALTH_SOURCE: {
    weigh:    { icon: '🩺', label: 'ตรวจก่อนชั่งน้ำหนัก' },
    flag:     { icon: '⚠️', label: 'แจ้งผิดปกติ' },
    cagecare: { icon: '🧹', label: 'พบตอนตรวจดูแลกรง' },
    vet:      { icon: '🩹', label: 'สัตวแพทย์' },
    humane:   { icon: '🛑', label: 'สั่งการุณยฆาต' },
    death:    { icon: '✝',  label: 'บันทึกการตาย' },
    necropsy: { icon: '🔬', label: 'ผลชันสูตร' },
  },
  HEALTH_STATUS: {
    normal:   { label: 'ปกติ',        tone: 'ok' },
    abnormal: { label: 'ผิดปกติ',      tone: 'warn' },
    treating: { label: 'กำลังรักษา',   tone: 'warn' },
    healed:   { label: 'หายดี',        tone: 'ok' },
    critical: { label: 'วิกฤต',        tone: 'bad' },
    dead:     { label: 'ตาย',          tone: 'bad' },
  },
  logHealth(mouse, entry) {
    if (!mouse) return;
    mouse.health = mouse.health || [];
    this.pushDated(mouse.health, {
      ...this.recStamp(),                  // ⏱ ย้อนหลัง — เก็บวัน-เวลาที่กรอกจริงไว้คู่กัน
      date: entry.date || this.recDate(),
      time: entry.time != null ? entry.time : this.recTime(),
      by: entry.by || this.user.name,
      source: entry.source, status: entry.status,
      note: entry.note || '',
      scores: entry.scores || null, total: entry.total ?? null, max: entry.max ?? null,
      result: entry.result || null,        // N / E / D ตามแบบฟอร์ม
      lossPct: entry.lossPct ?? null,      // % ที่ลดจากน้ำหนักสูงสุด
    });
  },
  // สถานะสุขภาพ "ตอนนี้" ของหนูหนึ่งตัว — ใช้ทั้งหน้ารวมและการ์ดรายตัว
  healthNow(mouse) {
    if (!mouse.alive) return 'dead';
    if (mouse.humaneOrder) return 'critical';
    if (mouse.careOpen) return 'treating';
    if (mouse.flagOpen) return 'abnormal';
    const last = (mouse.health || []).slice(-1)[0];
    return last && last.status === 'healed' ? 'healed' : 'normal';
  },
  // การตรวจให้คะแนนครั้งล่าสุด (เฉพาะที่มีคะแนน)
  lastScored(mouse) {
    return [...(mouse.health || [])].reverse().find(h => h.total != null) || null;
  },
  dosing: false,              // AHS dosing round
  dosePick: false,            // …picking several cages off the rack layout
  doseSel: new Set(),         // …the cage ids picked

  // --- Official lab forms (ศูนย์สัตว์ทดลอง มช.) -----------------------------
  // Sick Case Report (LA Guide-AF 11.1-02): clinical signs grouped by system.
  // Option terms are technical English — kept verbatim from the form (not translated).
  SICK_SIGNS: [
    { g: 'General appearance', items: ['Rough hair', 'Dehydrate', 'Lethargic', 'Isolated', 'Moribund'] },
    { g: 'Skin', items: ['Scratching', 'Fighting wound', 'Alopecia', 'Wound/Ulcer'] },
    { g: 'Eye / Nose / Mouth / Ear', items: ['Discharge', 'Ulcer'] },
    { g: 'Digestive tract', items: ['Malocclusion', 'Diarrhea', 'Enlarge abdomen'] },
  ],
  SICK_SUPPORT: ['Food on floor', 'Soft food', 'Hydration gel', 'Heat', 'Trim nails/teeth', 'Topical wound care', 'Separate'],
  SICK_RECO: ['Tx.', 'Continue Tx.', 'Continue monitoring', 'Euthanasia by humane endpoint'],
  // Necropsy Record (LA Guide-AF 11.3-01): examination by system / organ.
  // Organ names are verbatim from the paper form. `en` = the paper's system heading.
  NECROPSY_SYS: [
    { en: '01 General condition', g: '01 สภาพทั่วไป (General condition)', items: ['Body condition score', 'Skin and cutaneous adnexa', 'Natural orifices'] },
    { en: '02. Abdominal cavity', g: '02 ช่องท้อง (Abdominal cavity)', items: ['Spleen', 'Digestive tracts and Pancreas', 'Liver + Gall bladder', 'Genital organ', 'Kidney and Urinary apparatus'] },
    { en: '03. Thoracic cavity', g: '03 ช่องอก (Thoracic cavity)', items: ['Heart and blood vessels', 'Lung and Respiratory organ'] },
    { en: '04. Cranial cavity', g: '04 ช่องกะโหลก (Cranial cavity)', items: ['Brain and Nerves'] },
  ],

  el(id) { return document.getElementById(id); },

  // FLIP — when a list re-orders under the user's hands, slide the rows to their new
  // places so the one that moved can be followed by eye. Used only where a list
  // re-sorts itself mid-edit (the plan list re-sorts the moment a date is picked);
  // everywhere else an instant repaint is the right answer for a data-entry screen.
  // Web Animations API, no library. `mutate` does the re-render.
  flipReorder(container, keyAttr, mutate) {
    if (!container || matchMedia('(prefers-reduced-motion: reduce)').matches) return mutate();
    const before = new Map();
    container.querySelectorAll(`[${keyAttr}]`).forEach(el => before.set(el.getAttribute(keyAttr), el.getBoundingClientRect().top));
    mutate();
    container.querySelectorAll(`[${keyAttr}]`).forEach(el => {
      const prev = before.get(el.getAttribute(keyAttr));
      if (prev == null) return;
      const dy = prev - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
                 { duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
  },
  // stable per-row key so FLIP can match a row across a re-render (the array index
  // changes when the list re-sorts, so it cannot be the key)
  uid() { return 'r' + Math.random().toString(36).slice(2, 9); },

  // format grams to exactly 1 decimal place ( '–' when empty )
  g(v) { return (v == null || isNaN(v)) ? '–' : Number(v).toFixed(1); },
  // signed 1-decimal ( '+2.3' / '-1.0' )
  gs(v) { return (v == null || isNaN(v)) ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(1); },

  // full Thai date, Buddhist era: '2026-07-12' → '12 กรกฎาคม 2569'.
  // Done by hand rather than toLocaleDateString('th-TH-u-ca-buddhist') so the output
  // is identical in every browser. Storage stays ISO/CE — only the display is Thai.
  TH_MONTHS: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
              'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  TH_DOW: ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'],
  thaiDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso;
    return `${d} ${this.TH_MONTHS[m - 1]} ${y + 543}`;
  },
  isoOf(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; },
  // a licence normally runs one year: approved 1 ส.ค. 2569 → until 31 ก.ค. 2570
  // (the anniversary minus a day, so the period is exactly one year inclusive)
  oneYearUntil(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return '';
    const dt = new Date(y + 1, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    return this.isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  },

  // ---------------------------------------------------------
  // BACKDATED ENTRY — บันทึกย้อนหลัง
  // ---------------------------------------------------------
  // A round happens on the floor, not at a keyboard. No signal in the animal room,
  // a flat tablet, a power cut — the work gets written on paper and typed in the
  // next day. Refusing to accept that does not produce a cleaner record, it produces
  // a WRONG one: every entry stamped with the day somebody found a computer.
  //
  // So two dates are kept, never one:
  //   rec.date  → the date of the EVENT — what every save stamps
  //   late{}    → the ENTRY — who typed it, at what real date/time, and why late
  // They travel together on the saved record, so a reviewer can always separate
  // "when it happened" from "when we wrote it down". A reason is compulsory: a
  // backdated record with no explanation is precisely what an audit flags.
  //
  // Off by default, and cleared on leaving the project or logging out — a mode this
  // quiet must never survive into the next thing the user does.
  rec: { date: null, time: '', why: '', pid: null },
  recOn() { return !!this.rec.date; },
  // the date every save stamps — today unless backdating
  recDate() { return this.rec.date || todayISO(); },
  // the time it happened. While backdating this may legitimately be '' — the person
  // noted the day in a notebook, not the minute. Blank beats inventing a clock time.
  recTime() { return this.recOn() ? (this.rec.time || '') : nowHM(); },
  // audit stamp merged into every record saved while backdating — spread it in.
  // `key` lets a two-stage record (death → carcass) stamp each stage separately.
  recStamp(key = 'late') {
    if (!this.recOn()) return {};
    return { [key]: { at: todayISO(), atTime: nowHM(), by: this.user.name, why: this.rec.why } };
  },
  // the marker shown wherever such a record is listed
  lateChip(r, key = 'late') {
    const l = r && r[key];
    if (!l) return '';
    return `<span class="late-chip" title="กรอกย้อนหลังเมื่อ ${this.thaiDate(l.at)} ${l.atTime || ''} โดย ${this.esc(l.by)} — เหตุผล: ${this.esc(l.why)}">⏱ ย้อนหลัง</span>`;
  },
  recReset() { this.rec = { date: null, time: '', why: '', pid: null }; },
  // every capability that writes a dated record — drives who sees the control
  REC_CAPS: ['weigh', 'cageCare', 'dosing', 'treat', 'flag', 'reportDeath', 'handleCarcass'],

  // ---- ORDER-SAFE INSERTS -------------------------------------------------
  // Every history in the app is read positionally: latestWeight/prevWeight take the
  // last two weights, healthNow/lastDose/lastCarePanel take slice(-1), treatments[0]
  // is the newest. That was safe while records could only ever be added for TODAY.
  // Backdating breaks it — a round typed in for last Tuesday would append itself
  // after today's and become "the latest". So a backdated record is INSERTED at its
  // place in the timeline instead of pushed onto the end.
  recKey(r) { return `${r.date || ''} ${r.time || ''}`; },
  // arrays kept oldest → newest (health, doses, careLog)
  pushDated(arr, row) {
    const i = arr.findIndex(r => this.recKey(r) > this.recKey(row));
    if (i < 0) arr.push(row); else arr.splice(i, 0, row);
    return row;
  },
  // arrays kept newest → oldest (treatments)
  unshiftDated(arr, row) {
    const i = arr.findIndex(r => this.recKey(r) < this.recKey(row));
    if (i < 0) arr.push(row); else arr.splice(i, 0, row);
    return row;
  },
  // one weight per date: replace the entry for that day, otherwise insert in order
  putWeight(mouse, date, weight) {
    const at = mouse.weights.findIndex(w => w.date === date);
    if (at >= 0) { mouse.weights[at].weight = weight; Object.assign(mouse.weights[at], this.recStamp()); return; }
    this.pushDated(mouse.weights, { date, weight, ...this.recStamp() });
  },
  // "ล่าสุด" markers must never move backwards because someone filled in an old day
  bumpDate(cur, d) { return cur && cur > d ? cur : d; },

  // ---- SUPPLY HISTORY (ประวัติน้ำ / อาหาร) --------------------------------
  // น้ำและอาหารถูกชั่งทุกรอบ แต่เดิมเก็บเป็นค่าเดียวที่ถูกเขียนทับทุกครั้ง — รอบก่อน
  // หน้าหายหมด กราฟน้ำ/อาหารในหน้ารายงานจึงต้อง "สุ่มเส้นขึ้นมาเอง" จากค่าปัจจุบัน
  // ซึ่งไม่ใช่ข้อมูลที่ใครบันทึกไว้เลย ตอนนี้ทุกรอบลง supplyLog เป็นแถวของตัวเอง
  // แล้ว cage.water/food กลายเป็นแค่ "สรุปของรอบล่าสุด"
  //
  // เรียกหลังจากอัปเดต cage.water / cage.food แล้วเท่านั้น — ตัวมันถ่ายภาพค่าที่เป็นอยู่
  logSupply(cage, source) {
    cage.supplyLog = cage.supplyLog || [];
    this.pushDated(cage.supplyLog, {
      date: this.recDate(), time: this.recTime(), by: this.user.name, source,
      water: { ...cage.water },
      food: { ...cage.food },
      // จำนวนหนูตอนนั้น — ตายไปแล้วค่า g/ตัว ของรอบเก่าต้องไม่เปลี่ยนตาม
      mice: cage.mice.filter(m => m.alive).length,
      ...this.recStamp(),
    });
  },
  SUPPLY_SOURCE: {
    intake: { icon: '🐭', label: 'รับหนูเข้ากรง' },
    weigh:  { icon: '⚖️', label: 'รอบชั่งน้ำหนัก' },
    care:   { icon: '🧹', label: 'รอบตรวจดูแลกรง' },
  },
  // g ต่อตัว ของรายการหนึ่ง — หารด้วยจำนวนหนู ณ รอบนั้น ไม่ใช่จำนวนตอนนี้
  perMouse(v, n) { return n ? Math.round((v / n) * 10) / 10 : null; },
  // a round is "รอบวันนี้" only when it really is today — a notification telling the
  // team that today's round is finished, when the data is last Tuesday's, is a lie
  recRoundLabel() { return this.recOn() ? `รอบวันที่ ${this.thaiDate(this.rec.date)}` : 'รอบวันนี้'; },

  REC_REASONS: [
    'ไม่มีสัญญาณอินเทอร์เน็ตในห้องเลี้ยงสัตว์',
    'อุปกรณ์ไม่พร้อม / แบตเตอรี่หมด',
    'จดใส่กระดาษไว้ก่อน แล้วมากรอกภายหลัง',
    'ระบบขัดข้อง เข้าใช้งานไม่ได้ในวันนั้น',
    'กรอกแทนผู้ปฏิบัติงานที่ไม่ได้เข้าระบบ',
  ],

  // the button that lives at the right end of the project-name row: it shows the
  // date/time the next save will carry, which is the whole point of putting it there.
  recBtn() {
    if (this.recOn()) {
      return `<button class="recbtn on" id="recDateBtn" title="กำลังบันทึกย้อนหลัง — กดเพื่อแก้ไขหรือกลับมาบันทึกวันนี้">
          <span class="rb-ico">⏱</span>
          <span class="rb-txt">บันทึกย้อนหลัง · <b>${this.thaiDate(this.rec.date)}</b>${this.rec.time ? ' ' + this.rec.time : ''}</span>
        </button>`;
    }
    return `<button class="recbtn" id="recDateBtn" title="วันที่ที่ระบบจะบันทึก — กดเพื่อบันทึกย้อนหลังเมื่อวันนั้นกรอกไม่ได้">
        <span class="rb-ico">📅</span>
        <span class="rb-txt">${this.thaiDate(todayISO())}</span>
        <span class="rb-time" id="recClock">${nowHM()}</span>
      </button>`;
  },

  // ตั้งค่าวันที่บันทึก — วันที่ + เวลา (ถ้าทราบ) + เหตุผล
  openRecDate(p) {
    let d = this.rec.date || '';
    let t = this.rec.time || '';
    let why = this.rec.why || '';
    const today = todayISO();
    const min = p && p.startDate ? p.startDate : '';

    const draw = () => {
      const picked = d && d !== today;
      this.setModal(`
        <div class="modal-head">
          <div><h3>🗓️ วันที่ที่จะบันทึก</h3>
            <div class="sub">${p ? p.name : ''}</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <p class="empty-note" style="margin-top:0">
            ตามปกติทุกอย่างจะถูกบันทึกเป็น <b>วันนี้</b> — ใช้หน้านี้เฉพาะเมื่อ<b>วันที่เกิดเหตุจริงกรอกไม่ได้</b>
            (เช่น ไม่มีสัญญาณ อุปกรณ์ไม่พร้อม) แล้วนำมากรอกทีหลัง<br>
            ระบบจะยังเก็บ<b>วัน–เวลาที่กรอกจริง</b>ไว้คู่กันเสมอ และทำเครื่องหมาย <span class="late-chip">⏱ ย้อนหลัง</span> ที่รายการนั้น
          </p>

          <div class="rd-grid">
            <div class="field">
              <label>วันที่เกิดเหตุ <span style="color:var(--red)">*</span></label>
              ${this.dateChip('rdDate', picked ? d : '', 'วันนี้ (' + this.thaiDate(today) + ')')}
            </div>
            <div class="field">
              <label>เวลา <span class="muted-lbl">(ถ้าไม่ทราบ เว้นว่างได้)</span></label>
              <input id="rdTime" value="${this.esc(t)}" placeholder="เช่น 09:30" ${picked ? '' : 'disabled'}>
            </div>
          </div>

          <div class="field">
            <label>เหตุผลที่กรอกย้อนหลัง <span style="color:var(--red)">*</span></label>
            <div class="rd-chips">${this.REC_REASONS.map(r =>
              `<button type="button" class="btn btn-sm rd-chip${why === r ? ' on' : ''}" data-why="${this.esc(r)}">${r}</button>`).join('')}</div>
            <textarea id="rdWhy" rows="2" placeholder="ระบุเหตุผล — จะถูกเก็บไว้กับทุกรายการที่บันทึกในโหมดนี้">${this.esc(why)}</textarea>
          </div>

          ${picked ? `<p class="rd-warn">ทุกการบันทึกหลังจากนี้ (ชั่งน้ำหนัก · ตรวจกรง · ให้สารทดสอบ · แจ้งป่วย · แจ้งตาย ฯลฯ)
            จะลงวันที่เป็น <b>${this.thaiDate(d)}</b> จนกว่าจะกดกลับมาบันทึกวันนี้</p>` : ''}
        </div>
        <div class="modal-foot">
          ${this.recOn() ? `<button class="btn" id="rdOff">↩︎ กลับมาบันทึกวันนี้</button>` : ''}
          <span class="spacer" style="flex:1"></span>
          <button class="btn" id="rdCancel">ยกเลิก</button>
          <button class="btn btn-primary" id="rdOk" ${picked ? '' : 'disabled'}>${this.recOn() ? 'บันทึกการแก้ไข' : 'เริ่มบันทึกย้อนหลัง'}</button>
        </div>`);
      wire();
    };

    // the dialog is only ever reachable from the dashboard, so repainting under it
    // is enough — never go() here, that would disarm the mode we just armed
    const finish = () => { this.closeModal(); this.refreshUnderlay(p); };

    const wire = () => {
      this.el('closeModal').onclick = () => this.closeModal();
      this.el('rdCancel').onclick = () => this.closeModal();
      this.el('rdDate').onclick = (e) => this.openThaiCalendar(e.currentTarget, d, iso => {
        d = iso || '';
        if (!d || d === today) t = '';
        draw();
      });
      const time = this.el('rdTime');
      if (time) time.oninput = () => { t = time.value.trim(); };
      const ta = this.el('rdWhy');
      ta.oninput = () => { why = ta.value; document.querySelectorAll('.rd-chip').forEach(b => b.classList.toggle('on', b.dataset.why === why.trim())); };
      document.querySelectorAll('.rd-chip').forEach(b => b.onclick = () => { why = b.dataset.why; draw(); });
      const off = this.el('rdOff');
      if (off) off.onclick = () => {
        this.recReset();
        this.log('กลับมาบันทึกตามวันจริง', 'ปิดโหมดบันทึกย้อนหลัง', p ? p.name : '');
        this.toast('กลับมาบันทึกเป็นวันนี้แล้ว');
        finish();
      };
      this.el('rdOk').onclick = () => {
        if (!d || d === today) return;
        if (d > today) { this.toast('เลือกวันที่ล่วงหน้าไม่ได้ — บันทึกได้เฉพาะวันที่ผ่านมาแล้ว'); return; }
        if (min && d < min) { this.toast(`โครงการเริ่มวันที่ ${this.thaiDate(min)} — ย้อนหลังก่อนหน้านั้นไม่ได้`); return; }
        if (t && !/^\d{1,2}:\d{2}$/.test(t)) { this.el('rdTime').focus(); this.toast('รูปแบบเวลาไม่ถูกต้อง (เช่น 09:30)'); return; }
        if (!why.trim()) { this.el('rdWhy').focus(); this.toast('กรุณาระบุเหตุผลที่กรอกย้อนหลัง'); return; }
        // log BEFORE arming, so the row that turns the mode on isn't itself stamped ย้อนหลัง
        this.log('เปิดโหมดบันทึกย้อนหลัง', `ลงวันที่ ${d}${t ? ' ' + t : ''} · ${why.trim()}`, p ? p.name : '');
        this.rec = { date: d, time: t, why: why.trim(), pid: p ? p.id : null };
        this.toast(`บันทึกย้อนหลังเป็นวันที่ ${this.thaiDate(d)}`);
        finish();
      };
    };

    this.openModal('', { compact: true });
    draw();
  },

  // ---------------------------------------------------------
  // Thai date picker. The native <input type="date"> calendar follows the BROWSER's
  // language, not the page — there is no way to force Thai month names or a Buddhist
  // year on it — so the picker is drawn here instead. Values stay ISO/CE everywhere;
  // only what the user sees is Thai.
  //   openThaiCalendar(anchorEl, 'YYYY-MM-DD' | '', iso => …)  ·  '' from the callback = cleared
  // ---------------------------------------------------------
  openThaiCalendar(anchor, iso, onPick) {
    this.closeThaiCalendar();
    const today = todayISO();
    const sel = iso || '';
    let view = sel || today;      // any date inside the month being shown
    let mode = 'day';             // 'day' → grid of days · 'month' → grid of months

    const cal = document.createElement('div');
    cal.className = 'thcal';
    cal.setAttribute('role', 'dialog');
    cal.setAttribute('aria-label', 'เลือกวันที่');
    document.body.appendChild(cal);
    this._thcal = cal;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = cal.offsetWidth, h = cal.offsetHeight;
      let left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);   // flip above
      cal.style.left = `${left}px`;
      cal.style.top = `${top}px`;
    };

    const draw = () => {
      const [vy, vm] = view.split('-').map(Number);
      if (mode === 'month') {
        cal.innerHTML = `
          <div class="thc-head">
            <button type="button" class="thc-nav" data-step="-1" aria-label="ปีก่อนหน้า">‹</button>
            <button type="button" class="thc-title" data-mode="day">${vy + 543}</button>
            <button type="button" class="thc-nav" data-step="1" aria-label="ปีถัดไป">›</button>
          </div>
          <div class="thc-months">${this.TH_MONTHS.map((n, i) =>
            `<button type="button" class="thc-m${i + 1 === vm ? ' sel' : ''}" data-m="${i + 1}">${n}</button>`).join('')}</div>`;
      } else {
        const lead = new Date(vy, vm - 1, 1).getDay();          // 0 = อาทิตย์
        const days = new Date(vy, vm, 0).getDate();
        let cells = '';
        for (let i = 0; i < lead; i++) cells += '<span class="thc-d empty"></span>';
        for (let d = 1; d <= days; d++) {
          const v = this.isoOf(vy, vm, d);
          cells += `<button type="button" class="thc-d${v === sel ? ' sel' : ''}${v === today ? ' today' : ''}" data-d="${v}"
                      aria-label="${this.thaiDate(v)}"${v === sel ? ' aria-current="date"' : ''}>${d}</button>`;
        }
        cal.innerHTML = `
          <div class="thc-head">
            <button type="button" class="thc-nav" data-step="-1" aria-label="เดือนก่อนหน้า">‹</button>
            <button type="button" class="thc-title" data-mode="month" title="เลือกเดือน / ปี">${this.TH_MONTHS[vm - 1]} ${vy + 543}</button>
            <button type="button" class="thc-nav" data-step="1" aria-label="เดือนถัดไป">›</button>
          </div>
          <div class="thc-dow">${this.TH_DOW.map(d => `<span>${d}</span>`).join('')}</div>
          <div class="thc-grid">${cells}</div>
          <div class="thc-foot">
            <button type="button" class="thc-link" data-pick="${today}">วันนี้</button>
            ${sel ? `<button type="button" class="thc-link danger" data-pick="">ล้างวันที่</button>` : ''}
          </div>`;
      }

      cal.querySelectorAll('.thc-nav').forEach(b => b.onclick = () => {
        const [y, m] = view.split('-').map(Number);
        const step = +b.dataset.step;
        if (mode === 'month') view = this.isoOf(y + step, m, 1);
        else { const nd = new Date(y, m - 1 + step, 1); view = this.isoOf(nd.getFullYear(), nd.getMonth() + 1, 1); }
        draw();
      });
      const title = cal.querySelector('.thc-title');
      if (title) title.onclick = () => { mode = title.dataset.mode; draw(); };
      cal.querySelectorAll('.thc-m').forEach(b => b.onclick = () => {
        view = this.isoOf(+view.split('-')[0], +b.dataset.m, 1); mode = 'day'; draw();
      });
      cal.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { onPick(b.dataset.d); this.closeThaiCalendar(); });
      cal.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { onPick(b.dataset.pick); this.closeThaiCalendar(); });
      place();
    };
    draw();

    // dismissal — outside click (armed next tick so this very click doesn't close it),
    // Escape (captured, so it never reaches a surrounding dialog), and follow on scroll
    this._thcalOut = (e) => { if (!cal.contains(e.target) && !anchor.contains(e.target)) this.closeThaiCalendar(); };
    this._thcalKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.closeThaiCalendar(); anchor.focus(); } };
    this._thcalMove = () => place();
    setTimeout(() => document.addEventListener('mousedown', this._thcalOut), 0);
    document.addEventListener('keydown', this._thcalKey, true);
    window.addEventListener('scroll', this._thcalMove, true);
    window.addEventListener('resize', this._thcalMove);
  },

  closeThaiCalendar() {
    if (!this._thcal) return;
    document.removeEventListener('mousedown', this._thcalOut);
    document.removeEventListener('keydown', this._thcalKey, true);
    window.removeEventListener('scroll', this._thcalMove, true);
    window.removeEventListener('resize', this._thcalMove);
    this._thcal.remove();
    this._thcal = null;
  },
  // mouse-level treatment marker (nurse/medical symbol) if the mouse has any record
  treatMark(m) {
    if (!m.treatments || !m.treatments.length) return '';
    // red = case still open (being treated) · light green = past treatment, case closed/healed
    const healed = !m.careOpen;
    return `<span class="treat-mark${healed ? ' healed' : ''}" title="${healed ? 'เคยรักษา (เคสปิดแล้ว)' : 'กำลังรักษา'}">+</span>`;
  },
  // orange "!" when a mouse is flagged abnormal and awaiting VET review
  flagMark(m) {
    if (!m.flagOpen || !m.alive) return '';
    return `<span class="flag-mark" title="แจ้งผิดปกติ — รอ VET ตรวจสอบ">!</span>`;
  },
  // ซากอยู่ในช่องแช่แข็ง = งานค้างของ Sci/VET (จัดการซาก) — ต้องเห็นได้จากผังกรง
  // ไม่ต้องเปิดการ์ดเข้าไปดู
  frozenMark(m) {
    if (m.alive || !m.death || m.death.carcass !== 'frozen') return '';
    return `<span class="frozen-mark" title="ซากแช่แข็ง — รอจัดการซาก">❄</span>`;
  },

  // minimum acceptable daily weight gain (g). Below this = warning; loss/no-gain = bad.
  GAIN_THRESHOLD: 0.2,
  // mouse-level status by daily weight change → 'good' | 'warn' | 'bad' | 'none'
  mouseStatus(m) {
    if (!m.alive || m.excluded) return 'none';     // dead / stopped → no gain status
    const chg = Data.weightChange(m);
    if (chg == null) return 'none';
    if (chg <= 0) return 'bad';                    // ลด หรือ ไม่เพิ่ม
    if (chg < this.GAIN_THRESHOLD) return 'warn';  // ขึ้นน้อยกว่าค่าที่กำหนด
    return 'good';                                 // ขึ้นปกติ
  },
  // cage-level status → 'danger' (living mouse ordered for humane endpoint)
  //                    | 'care' (open treatment/care case) | 'normal'
  // once the euthanasia is carried out the mouse is no longer alive (and its
  // humaneOrder is cleared), so the cage falls back to normal automatically.
  cageStatus(cage) {
    if (cage.mice.some(m => m.alive && m.humaneOrder)) return 'danger';
    if (cage.mice.some(m => m.alive && m.careOpen)) return 'care';
    if (cage.mice.some(m => m.alive && m.flagOpen)) return 'flag';   // orange — awaiting VET review
    return 'normal';
  },

  init() {
    this.recReset();
    // นาฬิกาบนปุ่มวันที่ — เดินเองทุกครึ่งนาที ไม่ต้อง re-render ทั้งหน้า
    setInterval(() => { const c = this.el('recClock'); if (c) c.textContent = nowHM(); }, 30000);
    this.renderLogin();
    this.el('root').addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t) { e.preventDefault(); this.handleNav(t.dataset.nav, t.dataset); }
    });
    // ONE global key handler for every modal (installed once — no per-render leaks).
    // It works by clicking the dialog's own controls, so each dialog keeps its
    // existing semantics (e.g. cancelling the wizard-exit restores the step).
    document.addEventListener('keydown', (e) => this.handleKey(e));
  },

  // Escape closes/cancels the top dialog · the populate number pad accepts typing
  handleKey(e) {
    const overlay = this.el('overlay');
    if (!overlay) return;
    const click = (sel) => { const b = overlay.querySelector(sel); if (b) { b.click(); return true; } return false; };

    if (e.key === 'Escape') {
      e.preventDefault();
      // Prefer a "ยกเลิก" button over the ✕: cancel is the reversible action and, in
      // multi-step dialogs, steps back one level (e.g. the number pad returns to the
      // cage list) instead of throwing away the whole dialog.
      if (click('.modal-foot [id$="Cancel"], .modal-foot [id^="cancel"]')) return;
      if (click('#wizClose')) return;      // weighing wizard: asks before discarding
      if (click('#closeModal')) return;    // standard ✕
      if (!this.wizard && !this.careWiz) this.closeModal();
      return;
    }

    // ---- number-pad wizard (PI populate): type instead of tapping -------------
    // The pad's buttons already hold all the logic, so we just click them.
    if (!overlay.querySelector('.num-cards')) return;
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); click(`.kp-key[data-key="${e.key}"]`); return; }
    if (e.key === '.' || e.key === ',') { e.preventDefault(); click('.kp-key[data-key="dot"]'); return; }
    if (e.key === 'Backspace') { e.preventDefault(); click('.kp-key[data-key="back"]'); return; }
    if (e.key === 'Delete') { e.preventDefault(); click('.kp-key[data-key="clear"]'); return; }
    if (e.key === 'Enter') { e.preventDefault(); click('#kpOk'); return; }
    if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const cards = [...overlay.querySelectorAll('.num-card')];
      const cur = cards.findIndex(c => c.classList.contains('active'));
      const next = cards[(cur + 1) % cards.length];
      if (next) next.click();
    }
  },

  // ---- identity: POSITIONS (system, may be several) + PROJECT ROLES -------
  // See the permission-model comment at the top of data.js. Effective
  // capability = the ONE position's caps ∪ every project role's caps, additive.
  // Gate through can() — never test a position or role key directly.
  get user() { return DB.users.find(u => u.id === DB.currentUserId) || DB.users[0]; },
  // a user holds exactly one system position; positionKeys() returns it as a
  // one-element array so the many .map/.join/.includes call sites keep working.
  positionKeys(u) { return [(u || this.user).position || 'EXTERNAL']; },
  get position() { return POSITIONS[this.user.position] || POSITIONS.EXTERNAL; },
  get positions() { return [this.position]; },
  positionLabel(u) { const p = POSITIONS[(u || this.user).position]; return p ? p.label : (u || this.user).position || '—'; },
  // caps granted by the position alone (no project involved)
  hasPositionCap(cap) { return this.position.caps.includes(cap); },
  get isAdmin() { return this.user.position === 'ADMIN'; },
  get isAV() { return this.user.position === 'AV'; },              // หัวหน้าสัตวแพทย์
  get canReview() { return this.hasPositionCap('approve') || this.hasPositionCap('reviewAEC'); }, // sees the pipeline
  get canReviewAEC() { return this.hasPositionCap('reviewAEC'); },  // AEC ethics review (stage 1)
  get canBuild() { return this.hasPositionCap('approve'); },        // AV builds the project (stage 2)
  get canManageUsers() { return this.hasPositionCap('manageUsers'); },
  // a facility-wide position lets the user see every project
  get seesAllProjects() { return this.position.scope === 'all'; },
  positionKey(u) { return (u || this.user).position || 'EXTERNAL'; },

  // Is this project "live"? Project roles only take effect once AV has approved
  // it — before that the project does not exist yet and only its creator may
  // touch it (see myProjectRoles).
  isApproved(project) { return (project.approval || 'approved') === 'approved'; },
  // live project that has no mice yet — Sci has not done the first weighing/intake
  isEmptyProject(project) {
    return this.isApproved(project) && !(project.cages || []).some(c => c.mice.length);
  },
  // ---- two-layer experiment grouping ------------------------------------
  // layer 1 = ชนิดอาหาร (a cage with no dietId falls back to the default diet)
  // layer 2 = กลุ่มทดสอบ (a cage with no groupId is not in any treatment group yet)
  diets(p) { return p.diets || []; },
  defaultDiet(p) { return this.diets(p).find(d => d.isDefault) || this.diets(p)[0] || null; },
  cageDiet(p, cage) {
    const d = this.diets(p).find(x => x.id === cage.dietId);
    return d || this.defaultDiet(p);          // ยังไม่กำหนด ⇒ อาหารทั่วไป
  },
  cageGroup(p, cage) { return (p.groups || []).find(g => g.id === cage.groupId) || null; },
  // display TAG appended to the permanent code once the PI has grouped the cage:
  //   อาหาร-กลุ่ม-ลำดับในกลุ่ม   e.g. ไขมันสูง-DrugA-7
  mouseTag(p, cage, mouse) {
    const g = this.cageGroup(p, cage);
    if (!g || mouse.groupNo == null) return '';
    const d = this.cageDiet(p, cage);
    return `${d ? d.name : '—'}-${g.name}-${mouse.groupNo}`;
  },
  // full label: permanent identity + tag (when grouped)
  mouseLabel(p, cage, mouse) {
    const tag = this.mouseTag(p, cage, mouse);
    return tag ? `${mouse.code} (${tag})` : mouse.code;
  },
  // the tag as a coloured chip for on-screen lists (empty string when ungrouped)
  tagChip(p, cage, mouse) {
    const tag = this.mouseTag(p, cage, mouse);
    if (!tag) return '<span class="tag-chip none">ยังไม่จัดกลุ่ม</span>';
    const g = this.cageGroup(p, cage);
    return `<span class="tag-chip" style="--tc:${g ? g.color : '#64748b'}">${tag}</span>`;
  },
  // "real" = the project physically exists (has cages + members): built OR approved
  isReal(project) { return this.approvalStage(project) === 'approved'; },
  isCreator(project) { return !!project && project.createdBy === this.user.id; },
  // where a project sits in the creation pipeline
  approvalStage(project) { return project.approval || 'approved'; },
  // human label + short status text for any stage
  stageInfo(project) {
    switch (this.approvalStage(project)) {
      case 'requested': return { text: '⏳ รอสำนักเลขาฯ จริยธรรมตรวจ', cls: 'req' };
      // "ผ่านจริยธรรม" is implied by the stage — the popup names the reviewer and date
      case 'aec_ok':    return { text: '📋 รอสัตวแพทย์จัดสรรพื้นที่', cls: 'aec' };
      case 'rejected':  return { text: '✗ ตีกลับให้แก้ไข', cls: 'rej' };
      default:
        if (project.status === 'closed') return { text: 'ปิดแล้ว', cls: 'ok' };
        // live but no mice yet — Sci still has to weigh them in
        return this.isEmptyProject(project)
          ? { text: '🦠 กักกันโรค/รอนำหนูเข้าโครงการ (น้ำหนักแรกเข้า)', cls: 'empty' }
          : { text: 'กำลังดำเนิน', cls: 'ok' };
    }
  },

  // project roles the current user holds (array of ROLES keys).
  // A DEMO persona (user.projectRole set) holds that role in every project so a
  // client can compare views. Real deployment: project.members drives it.
  myProjectRoles(project) {
    if (!project) return [];
    // requested / aec_ok / rejected: nobody is appointed yet — only the creator
    // acts, as PI. Once AV has built it ('built') the members exist, so membership
    // drives roles from there on (built + approved).
    if (!this.isReal(project)) return this.isCreator(project) ? ['PI'] : [];
    if (this.user.projectRole) return [this.user.projectRole];
    const m = (project.members || []).find(x => x.userId === this.user.id);
    return m ? m.roles : [];
  },
  // capability check — admin can do anything; otherwise positions ∪ project roles
  can(cap, project) {
    if (this.isAdmin) return true;
    if (this.hasPositionCap(cap)) return true;
    return this.myProjectRoles(project).some(r => ROLES[r] && ROLES[r].caps.includes(cap));
  },
  // can the current user see this project in the list at all?
  // needs the `view` capability first — that is what keeps GM (stockroom/finance
  // only) out of every project even though their position scope is 'all'.
  hasAccess(project) {
    if (!this.can('view', project)) return false;
    // A project still in the creation pipeline (requested / aec_ok / rejected) is
    // "not real yet": only the people who move it forward may even see it —
    // the creator plus the reviewers (AEC / AV / admin). Everyone else, even a
    // facility-wide position, sees nothing until AV has built it. Once built the
    // cages + members exist, so normal membership/scope visibility applies.
    if (!this.isReal(project)) return this.isCreator(project) || this.canReview;
    if (this.seesAllProjects) return true;
    return this.myProjectRoles(project).length > 0 || this.isCreator(project);
  },
  // may the user actually open the project and look inside? OCH sees the cards
  // but has no enterProject, so a card click takes them to the safety form instead.
  canEnter(project) { return this.hasAccess(project) && this.can('enterProject', project); },

  // ---- top-level tabs (โครงการ / งานคลัง / การเงิน) ----------------------
  // Visibility is per capability: GM sees only the last two, EX sees all three,
  // everyone else sees only โครงการ.
  TABS: [
    { key: 'projects', label: 'โครงการ', icon: '🧪', cap: 'view' },
    { key: 'supply',   label: 'งานคลัง', icon: '📦', cap: 'viewSupply' },
    { key: 'finance',  label: 'การเงิน', icon: '💰', cap: 'viewFinance' },
  ],
  visibleTabs() { return this.TABS.filter(t => this.can(t.cap)); },
  // which tab a route belongs to (for highlighting)
  tabOfRoute(name) {
    if (name === 'supply' || name === 'finance') return name;
    if (['projects', 'dashboard', 'reports', 'create', 'build', 'ochreport'].includes(name)) return 'projects';
    return '';
  },
  // where to land after login / when a route is not permitted
  homeRoute() {
    const t = this.visibleTabs()[0];
    return t ? t.key : 'roles';
  },
  // what to show as "my role here": project role if any, else the position
  myRoleLabel(project) {
    const roles = this.myProjectRoles(project);
    return roles.length ? roles.join(' + ') : this.positionKey();
  },
  // a project is "operational" (data can be recorded: weigh/flag/treat/death)
  // only once AV has approved it and it isn't closed. Waiting/rejected projects
  // are view-only for operations, but a PI may still edit cages/docs/members to prepare/fix.
  isOperational(project) {
    return (project.approval || 'approved') === 'approved' && project.status !== 'closed';
  },

  // ---------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------
  handleNav(name, ds) {
    switch (name) {
      case 'projects': this.go('projects'); break;
      case 'project':  this.go('dashboard', ds.projectId); break;
      case 'reports':  this.go('reports', this.route.projectId); break;
      case 'create':   this.go('create'); break;
      case 'audit':    this.go('audit', this.route.projectId); break;
      case 'roles':    this.go('roles', this.route.projectId); break;
      case 'users':    this.go('users'); break;
      case 'supply':   this.go('supply'); break;
      case 'finance':  this.go('finance'); break;
      case 'build':
      case 'ochreport': this.go(name, ds.projectId || this.route.projectId); break;
      case 'logout':   this.go('login'); break;
    }
  },

  go(name, projectId = null) {
    // บันทึกย้อนหลังผูกกับโครงการที่กำลังทำอยู่ — พาผู้ใช้ออกจากโครงการเมื่อไหร่
    // ต้องกลับมาเป็น "วันนี้" เสมอ ไม่งั้นโหมดเงียบ ๆ นี้จะติดไปโผล่ที่งานถัดไป
    if (this.recOn() && !(name === 'dashboard' && projectId === this.rec.pid)) this.recReset();
    this.route = { name, projectId };
    this.weighing = false;
    this.editing = false;
    this.caring = false;
    this.careWiz = null;
    this.dosing = false;
    this.dosePick = false;
    this.doseSel = new Set();
    window.scrollTo(0, 0);
    if (name === 'login') return this.renderLogin();
    if (name === 'projects') return this.renderProjects();
    if (name === 'create') return this.renderCreateProject();
    if (name === 'build') return this.renderBuildProject();
    if (name === 'dashboard') return this.renderDashboard();
    if (name === 'reports') return this.renderReports();
    if (name === 'audit') return this.renderAudit();
    if (name === 'roles') return this.renderRoles();
    if (name === 'users') return this.renderUsers();
    if (name === 'supply') return this.renderModulePlaceholder('supply');
    if (name === 'finance') return this.renderModulePlaceholder('finance');
    if (this.PROJECT_MODULES[name]) return this.renderProjectModule(name);
  },

  // ---------------------------------------------------------
  // Top-level modules reserved for the next phase (งานคลัง / การเงิน).
  // These are facility-wide, NOT per project. The tab, route and permission gate
  // exist now so the real screens can drop straight in; there is deliberately no
  // data model behind them yet.
  // ---------------------------------------------------------
  MODULES: {
    supply:  { icon: '📦', title: 'งานคลัง', cap: 'viewSupply',  desc: 'คลังวัสดุ อาหารสัตว์ และครุภัณฑ์ของหน่วยสัตว์ทดลอง' },
    finance: { icon: '💰', title: 'การเงิน', cap: 'viewFinance', desc: 'งบประมาณ ค่าใช้จ่าย และการเบิกจ่าย' },
  },

  // Per-project screens reserved for the next phase. Same idea as MODULES, but
  // these hang off a project, so they carry a projectId and a breadcrumb.
  PROJECT_MODULES: {
    ochreport:{ icon: '🦺', title: 'รายงานความปลอดภัย', cap: 'ochReport',
                desc: 'ตรวจหน้างานตามมาตรฐานชีวอนามัย และออกรายงานเมื่อพบสิ่งผิดปกติ' },
  },
  renderProjectModule(key) {
    const mod = this.PROJECT_MODULES[key];
    const p = Data.getProject(this.route.projectId);
    if (!p) return this.go(this.homeRoute());
    if (!this.hasAccess(p) || !this.can(mod.cap, p)) {
      this.toast('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
      return this.go(this.homeRoute());
    }
    // OCH never enters the project, so their breadcrumb must not link inside it
    const canEnter = this.canEnter(p);
    this.shell(
      `${canEnter ? `<a data-nav="project" data-project-id="${p.id}">${p.name}</a><span class="sep">/</span>` : `<span>${p.name}</span><span class="sep">/</span>`}
       <a data-nav="${key}" data-project-id="${p.id}">${mod.title}</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>${mod.icon} ${mod.title}</h2><div class="desc">${p.name} · ${mod.desc}</div></div>
        </div>
        <div class="report-canvas module-soon">
          <div class="ms-ico">${mod.icon}</div>
          <h3>อยู่ระหว่างพัฒนา — เฟสถัดไป</h3>
          <p>โครงสร้างหน้าและสิทธิ์การเข้าถึงถูกวางไว้แล้ว รอออกแบบรายละเอียดร่วมกับผู้ใช้งานจริง</p>
          <button class="btn" data-nav="projects">← กลับไปหน้ารายการโครงการ</button>
        </div>
      </div>`
    );
  },
  renderModulePlaceholder(key) {
    const mod = this.MODULES[key];
    if (!this.can(mod.cap)) { this.toast('คุณไม่มีสิทธิ์เข้าถึงหน้านี้'); return this.go(this.homeRoute()); }

    this.shell(
      '',   // the active tab already says where we are
      `<div class="page">
        <div class="page-head">
          <div><h2>${mod.icon} ${mod.title}</h2><div class="desc">${mod.desc}</div></div>
        </div>
        <div class="report-canvas module-soon">
          <div class="ms-ico">${mod.icon}</div>
          <h3>อยู่ระหว่างพัฒนา — เฟสถัดไป</h3>
          <p>โครงสร้างหน้าและสิทธิ์การเข้าถึงถูกวางไว้แล้ว รอออกแบบรายละเอียดร่วมกับผู้ใช้งานจริง</p>
        </div>
      </div>`
    );
  },

  // ---- user account helpers ----
  adminCount() { return DB.users.filter(u => u.position === 'ADMIN').length; },
  isLastAdmin(u) { return u.position === 'ADMIN' && this.adminCount() <= 1; },

  // ---- audit log (append-only, visible to everyone) ----
  log(action, detail, projectName = '') {
    const proj = DB.projects.find(p => p.name === projectName);
    const role = (proj && this.myProjectRoles(proj).join('/')) || this.positionKey();
    // ts is ALWAYS the real clock — an audit trail that can be backdated is not one.
    // A backdated action carries the event date alongside it instead.
    DB.auditLog.push({ ts: Date.now(), user: this.user.name, role, action, detail, project: projectName,
                       ...this.recStamp() });
  },
  // =========================================================
  // NOTIFICATIONS
  // One row per EVENT with a recipient list, not one row per person — the same
  // event then reads/dismisses consistently for everyone. `link` says where the
  // notification takes you; openNotification() re-checks permission before going,
  // because who may enter a project can change after the notification was sent.
  // =========================================================
  // recipient resolvers — always return an array of userIds
  nTo: {
    position(key) { return DB.users.filter(u => u.position === key).map(u => u.id); },
    // members of a project holding any of these project roles
    roles(p, roles) {
      return ((p && p.members) || []).filter(m => (m.roles || []).some(r => roles.includes(r))).map(m => m.userId);
    },
    team(p) { return ((p && p.members) || []).map(m => m.userId); },
    creator(p) { return p && p.createdBy ? [p.createdBy] : []; },
  },

  // send. `to` may contain duplicates/nulls and always drops the actor themselves —
  // nobody needs telling about the thing they just did.
  notify({ kind, title, detail = '', project = null, to = [], link = null }) {
    const me = this.user.id;
    const list = [...new Set(to.filter(Boolean))].filter(id => id !== me);
    if (!list.length) return null;
    const n = {
      id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), kind, title, detail,
      projectId: project ? project.id : null,
      projectName: project ? project.name : '',
      by: this.user.name,
      to: list, readBy: [], link,
    };
    DB.notifications.push(n);
    return n;
  },

  myNotifications() {
    const me = this.user.id;
    return DB.notifications.filter(n => n.to.includes(me)).sort((a, b) => b.ts - a.ts);
  },
  unreadCount() {
    const me = this.user.id;
    return DB.notifications.filter(n => n.to.includes(me) && !n.readBy.includes(me)).length;
  },
  markRead(n) { const me = this.user.id; if (!n.readBy.includes(me)) n.readBy.push(me); },
  markAllRead() { this.myNotifications().forEach(n => this.markRead(n)); },

  // how long ago, in words
  agoText(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'เมื่อสักครู่';
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    if (s < 86400) return `${Math.floor(s / 3600)} ชั่วโมงที่แล้ว`;
    if (s < 604800) return `${Math.floor(s / 86400)} วันที่แล้ว`;
    return this.thaiDate(new Date(ts).toISOString().slice(0, 10));
  },

  // each kind carries its own icon + urgency colour
  NOTIFY_KINDS: {
    request:  { icon: '📨', tone: 'info' },
    approve:  { icon: '✅', tone: 'ok' },
    reject:   { icon: '✗',  tone: 'bad' },
    build:    { icon: '🏗️', tone: 'ok' },
    member:   { icon: '👥', tone: 'info' },
    weigh:    { icon: '⚖️', tone: 'info' },
    care:     { icon: '🧹', tone: 'info' },
    dose:     { icon: '💉', tone: 'warn' },
    intake:   { icon: '🐭', tone: 'info' },
    group:    { icon: '💊', tone: 'info' },
    flag:     { icon: '⚠️', tone: 'warn' },
    treat:    { icon: '🩺', tone: 'warn' },
    healed:   { icon: '💚', tone: 'ok' },
    humane:   { icon: '🛑', tone: 'bad' },
    death:    { icon: '✝',  tone: 'bad' },
    carcass:  { icon: '❄️', tone: 'warn' },
    necropsy: { icon: '🔬', tone: 'info' },
    doc:      { icon: '📎', tone: 'warn' },   // ใช้เฉพาะตอน "ลบ" เอกสาร — การแนบเพิ่มไม่แจ้ง
  },

  // go where the notification points — but only if the user may still go there
  openNotification(n) {
    this.markRead(n);
    this.closeNotifyPanel();
    const p = n.projectId ? Data.getProject(n.projectId) : null;
    const l = n.link || {};
    if (p && !this.hasAccess(p)) { this.toast('คุณไม่มีสิทธิ์เข้าถึงโครงการนี้แล้ว'); return this.go(this.homeRoute()); }
    switch (l.type) {
      case 'projectInfo': return p ? this.openProjectInfo(p) : this.go('projects');
      case 'build':       return p && this.canBuild ? this.buildProject(p) : this.openProjectInfo(p);
      case 'editRequest': return p && this.isCreator(p) ? this.editProject(p) : this.openProjectInfo(p);
      case 'dashboard':
        if (p && this.canEnter(p)) return this.go('dashboard', p.id);
        return p ? this.openProjectInfo(p) : this.go('projects');
      case 'mouse': {
        if (!p || !this.canEnter(p) || !this.can('viewCage', p)) return p ? this.openProjectInfo(p) : this.go('projects');
        const cage = (p.cages || []).find(c => c.id === l.cageId);
        const mouse = cage && cage.mice.find(m => m.id === l.mouseId);
        this.go('dashboard', p.id);
        if (cage && mouse) this.openMouseDetail(p, cage, mouse);
        else if (cage) this.openCagePopup(p, cage);
        return;
      }
      default: return p ? this.openProjectInfo(p) : this.go('projects');
    }
  },

  // ---- the dropdown panel -------------------------------------------------
  toggleNotifyPanel() {
    const panel = this.el('notifyPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) return this.closeNotifyPanel();
    this.renderNotifyPanel();
    panel.classList.add('open');
    setTimeout(() => document.addEventListener('mousedown', this._notifyOut = (e) => {
      if (!e.target.closest('.notify-wrap')) this.closeNotifyPanel();
    }), 0);
  },
  closeNotifyPanel() {
    const panel = this.el('notifyPanel');
    if (panel) panel.classList.remove('open');
    if (this._notifyOut) { document.removeEventListener('mousedown', this._notifyOut); this._notifyOut = null; }
  },
  renderNotifyPanel() {
    const panel = this.el('notifyPanel'); if (!panel) return;
    const me = this.user.id;
    const list = this.myNotifications();
    const unread = this.unreadCount();
    const rows = list.slice(0, 40).map(n => {
      const k = this.NOTIFY_KINDS[n.kind] || { icon: '🔔', tone: 'info' };
      const isUnread = !n.readBy.includes(me);
      return `<button class="nt-item ${k.tone}${isUnread ? ' unread' : ''}" data-nid="${n.id}">
          <span class="nt-ico">${k.icon}</span>
          <span class="nt-body">
            <span class="nt-title">${n.title}</span>
            ${n.detail ? `<span class="nt-detail">${n.detail}</span>` : ''}
            <span class="nt-meta">${n.projectName ? n.projectName + ' · ' : ''}${n.by} · ${this.agoText(n.ts)}</span>
          </span>
          ${isUnread ? '<span class="nt-dot"></span>' : ''}
        </button>`;
    }).join('') || '<p class="nt-empty">ยังไม่มีการแจ้งเตือน</p>';

    panel.innerHTML = `
      <div class="nt-head">
        <b>การแจ้งเตือน</b>
        ${unread ? `<span class="nt-count">${unread} ใหม่</span>` : ''}
        <span class="spacer" style="flex:1"></span>
        ${unread ? '<button class="nt-link" id="ntAllRead">อ่านทั้งหมด</button>' : ''}
      </div>
      <div class="nt-list">${rows}</div>`;

    panel.querySelectorAll('.nt-item').forEach(b => b.onclick = () => {
      const n = DB.notifications.find(x => x.id === b.dataset.nid);
      if (n) this.openNotification(n);
    });
    const all = this.el('ntAllRead');
    if (all) all.onclick = (e) => { e.stopPropagation(); this.markAllRead(); this.renderNotifyPanel(); this.refreshNotifyBadge(); };
  },
  // update just the badge without re-rendering the page underneath
  refreshNotifyBadge() {
    const btn = this.el('notifyBtn'); if (!btn) return;
    const unread = this.unreadCount();
    btn.innerHTML = `🔔${unread ? `<span class="notify-dot">${unread > 99 ? '99+' : unread}</span>` : ''}`;
  },

  // vets who should hear about an animal in this project: the ones appointed to it,
  // plus the head vet (AV) who is accountable across every project
  nVets(p) { return [...this.nTo.roles(p, ['VET']), ...this.nTo.position('AV')]; },
  nResearchers(p) { return [...this.nTo.creator(p), ...this.nTo.roles(p, ['PI', 'COPI'])]; },

  formatTs(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // ---------------------------------------------------------
  // Shell + header
  // ---------------------------------------------------------
  shell(crumbsHTML, bodyHTML) {
    const u = this.user;
    const initial = (u.firstName || u.name || '?').trim().charAt(0);
    const proj = Data.getProject(this.route.projectId);
    // project role is only meaningful when actually appointed to this project
    const projRoles = proj ? this.myProjectRoles(proj) : [];
    const projRole = projRoles.join(' + ');
    const sysLabel = `${this.positionLabel()} (${this.positionKey()})`;
    // top-level tabs — only those the position is entitled to (GM: คลัง+การเงิน only)
    const activeTab = this.tabOfRoute(this.route.name);
    // always rendered: the lit tab is both the "you are here" marker and the way
    // back up (the redundant leading breadcrumb was removed in favour of it)
    const tabsHTML = this.visibleTabs()
      .map(t => `<button class="main-tab ${t.key === activeTab ? 'on' : ''}" data-nav="${t.key}">${t.icon} ${t.label}</button>`)
      .join('');
    // demo switcher: system positions first, then the project-role personas
    const opt = x => `<option value="${x.id}" ${x.id === u.id ? 'selected' : ''}>${x.name}</option>`;
    const userOptions =
      `<optgroup label="ตำแหน่งระดับระบบ">${DB.users.filter(x => !x.projectRole).map(opt).join('')}</optgroup>` +
      `<optgroup label="บทบาทในโครงการ (ทีมวิจัย)">${DB.users.filter(x => x.projectRole).map(opt).join('')}</optgroup>`;

    const unread = this.unreadCount();
    this.el('root').innerHTML = `
      <div id="app-shell">
        <header class="appbar">
          <div class="brand"><span class="mark">🐭</span> iLAMP</div>
          <nav class="main-tabs">${tabsHTML}</nav>
          <nav class="crumbs">${crumbsHTML}</nav>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-nav="audit">📋 Audit Log</button>
          ${this.canManageUsers ? `<button class="btn btn-ghost" data-nav="users">👤 จัดการผู้ใช้</button>` : ''}
          <div class="notify-wrap">
            <button class="notify-btn" id="notifyBtn" title="การแจ้งเตือน" aria-label="การแจ้งเตือน" aria-haspopup="true">
              🔔${unread ? `<span class="notify-dot">${unread > 99 ? '99+' : unread}</span>` : ''}
            </button>
            <div class="notify-panel" id="notifyPanel"></div>
          </div>
          <div class="user-menu">
            <button class="user-btn" id="userMenuBtn">
              <span class="avatar">${initial}</span>
              <span class="user-meta"><span class="u-name">${u.name}</span><span class="u-sys">${projRole || this.positionKey()}</span></span>
              <span class="caret">▾</span>
            </button>
            <div class="user-dropdown" id="userDropdown">
              <div class="ud-head">
                <span class="avatar lg">${initial}</span>
                <div><div class="u-name">${u.name}</div><div class="u-sys">${sysLabel}</div>${projRole ? `<div class="u-proj">บทบาทในโครงการนี้: <b>${projRole}</b></div>` : ''}</div>
              </div>
              <button class="ud-item" data-nav="roles">👤 ดูข้อมูลผู้ใช้ & สิทธิ์</button>
              <button class="ud-item danger" data-nav="logout">🚪 ออกจากระบบ</button>
            </div>
          </div>
        </header>
        <main>${bodyHTML}</main>
      </div>
      <div class="demo-fab ${this.demoOpen ? 'open' : ''}" id="demoFab">
        <div class="demo-body">
          <div class="demo-label">🧪 โหมดสาธิต — ดูมุมมองตามตำแหน่ง</div>
          <select id="demoUser">${userOptions}</select>
          <div class="demo-hint">เลือกตำแหน่งเพื่อดูว่าตำแหน่งนั้นเห็น/ทำอะไรได้บ้าง (แต่ละตำแหน่งเห็นทุกโครงการเหมือนกัน)</div>
        </div>
        <button class="demo-toggle" id="demoToggle" title="สลับผู้ใช้ (โหมดสาธิต)">🧪 <span class="demo-toggle-txt">สาธิต</span></button>
      </div>`;

    // notification bell
    this.el('notifyBtn').onclick = (e) => { e.stopPropagation(); this.toggleNotifyPanel(); };

    // user menu dropdown (close on outside click, wired only while open)
    const menuBtn = this.el('userMenuBtn'), dropdown = this.el('userDropdown');
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !dropdown.classList.contains('open');
      dropdown.classList.toggle('open', willOpen);
      if (willOpen) setTimeout(() => document.addEventListener('click', function h() {
        dropdown.classList.remove('open'); document.removeEventListener('click', h);
      }, { once: true }), 0);
    };

    // floating demo identity switcher
    this.el('demoToggle').onclick = () => {
      this.demoOpen = !this.demoOpen;
      this.el('demoFab').classList.toggle('open', this.demoOpen);
    };
    this.el('demoUser').addEventListener('change', (e) => {
      DB.currentUserId = e.target.value;
      this.recReset();        // เหตุผลการบันทึกย้อนหลังเป็นของคนเดิม ไม่ตามคนใหม่ไป
      this.demoOpen = true;   // keep the panel open after switching
      // the new identity may not be allowed on the current route/project
      const cur = Data.getProject(this.route.projectId);
      const tabOk = this.visibleTabs().some(t => t.key === this.tabOfRoute(this.route.name));
      if (this.tabOfRoute(this.route.name) && !tabOk) this.go(this.homeRoute());
      else if (this.route.projectId && cur && !this.hasAccess(cur)) this.go(this.homeRoute());
      else this.go(this.route.name, this.route.projectId);
    });
  },

  // ---------------------------------------------------------
  // 1. LOGIN
  // ---------------------------------------------------------
  // inline SVG so the login screen carries no emoji-as-icon (the app chrome still does)
  ICO: {
    flask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v6.6L4.7 18.1A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.7-2.9L14 9.6V3"/><path d="M7.4 14.2h9.2"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M12 7.8v4.8M12 16.1h.01"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 12S5.8 5.6 12 5.6 21.8 12 21.8 12 18.2 18.4 12 18.4 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.6c6.2 0 9.8 6.4 9.8 6.4a17 17 0 0 1-3.3 4.1M6.5 7.9A17 17 0 0 0 2.2 12S5.8 18.4 12 18.4c1.6 0 3-.4 4.2-1"/><path d="M10 10a2.9 2.9 0 0 0 4 4"/><path d="m3.2 3.2 17.6 17.6"/></svg>`,
  },

  renderLogin() {
    this.el('root').innerHTML = `
      <div id="view-login">
        <div class="login-main">
          <form class="login-card" id="loginForm" novalidate>
            <div class="login-logo-slot" title="พื้นที่สำหรับโลโก้หน่วยงาน">${this.ICO.flask}</div>
            <h1 class="login-sys">iLAMP</h1>
            <p class="login-sysfull">Intelligent Laboratory Animal Management Platform</p>

            <p class="login-error hidden" id="loginError" role="alert"></p>

            <div class="field" id="fieldEmail">
              <label for="loginEmail">ชื่อผู้ใช้ / อีเมล</label>
              <input type="text" id="loginEmail" placeholder="name@cmu.ac.th" autocomplete="username" autocapitalize="off" spellcheck="false">
            </div>
            <div class="field" id="fieldPass">
              <label for="loginPass">รหัสผ่าน</label>
              <div class="input-wrap">
                <input type="password" id="loginPass" placeholder="••••••••" autocomplete="current-password">
                <button type="button" class="pw-toggle" id="pwToggle" aria-label="แสดงรหัสผ่าน" aria-pressed="false" title="แสดงรหัสผ่าน">${this.ICO.eye}</button>
              </div>
              <p class="caps-hint hidden" id="capsHint">${this.ICO.warn}<span>Caps Lock เปิดอยู่</span></p>
            </div>

            <button class="btn btn-primary btn-block btn-lg" type="submit" id="loginBtn">เข้าสู่ระบบ</button>
          </form>
        </div>
        <footer class="login-owner">Preclinical Laboratory Animal Center, Faculty of Medicine, Chiang Mai University&nbsp;: PLAC</footer>
      </div>`;

    const emailIn = this.el('loginEmail'), passIn = this.el('loginPass');
    const errBox = this.el('loginError'), capsHint = this.el('capsHint'), btn = this.el('loginBtn');
    const showErr = (msg, field) => {
      errBox.innerHTML = `${this.ICO.warn}<span>${msg}</span>`;
      errBox.classList.remove('hidden');
      this.el(field).classList.add('invalid');
      this.el(field === 'fieldEmail' ? 'loginEmail' : 'loginPass').focus();
    };
    const clearErr = () => {
      errBox.classList.add('hidden');
      this.el('fieldEmail').classList.remove('invalid');
      this.el('fieldPass').classList.remove('invalid');
    };
    emailIn.addEventListener('input', clearErr);
    passIn.addEventListener('input', clearErr);

    // show/hide password — the label and the icon both flip
    this.el('pwToggle').onclick = (e) => {
      const shown = passIn.type === 'text';
      passIn.type = shown ? 'password' : 'text';
      e.currentTarget.innerHTML = shown ? this.ICO.eye : this.ICO.eyeOff;
      e.currentTarget.setAttribute('aria-pressed', String(!shown));
      e.currentTarget.setAttribute('aria-label', shown ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน');
      e.currentTarget.title = shown ? 'แสดงรหัสผ่าน' : 'ซ่อนรหัสผ่าน';
      passIn.focus();
    };
    // Caps Lock catches most "รหัสผ่านไม่ถูก" reports on a shared lab machine
    const caps = (e) => capsHint.classList.toggle('hidden', !e.getModifierState || !e.getModifierState('CapsLock'));
    passIn.addEventListener('keydown', caps);
    passIn.addEventListener('keyup', caps);
    passIn.addEventListener('blur', () => capsHint.classList.add('hidden'));

    this.el('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      clearErr();
      // demo: match the typed e-mail to a seeded user; blank → ADMIN, so pressing
      // เข้าสู่ระบบ with an empty form lands on the identity that sees everything.
      // A typed-but-unknown address is a mistake worth reporting, not a silent fallback.
      // (the password is NOT checked — this is a click-through prototype)
      const email = (emailIn.value || '').trim().toLowerCase();
      const match = email ? DB.users.find(u => (u.email || '').toLowerCase() === email) : { id: DB.currentUserId };
      if (!match) return showErr('ไม่พบบัญชีนี้ในระบบ กรุณาตรวจสอบอีเมลอีกครั้ง', 'fieldEmail');

      // brief pending state so the click has an acknowledgement (see UX: submit feedback)
      btn.disabled = true;
      btn.innerHTML = `<span class="spin"></span> กำลังเข้าสู่ระบบ…`;
      setTimeout(() => {
        DB.currentUserId = match.id;
        // land on the first tab this position is entitled to (GM starts at งานคลัง)
        this.go(this.homeRoute());
      }, 350);
    });

    emailIn.focus();
  },

  // ---------------------------------------------------------
  // 2. PROJECT LIST
  // ---------------------------------------------------------
  renderProjects() {
    // positions without `view` (GM) have no โครงการ tab at all
    if (!this.can('view')) { this.toast('คุณไม่มีสิทธิ์เข้าถึงหน้าโครงการ'); return this.go(this.homeRoute()); }
    // hasAccess already encodes the rules: approved projects by membership/scope,
    // pipeline projects only for the creator + reviewers.
    // Sorted by what needs attention first, newest within a state.
    // Order: ตีกลับ → รอจริยธรรมตรวจ → รอ AV จัดสรร → กักกันโรค/รอนำหนูเข้าโครงการ → กำลังดำเนิน → ปิดแล้ว
    const visible = DB.projects.filter(p => this.hasAccess(p))
      .sort((a, b) => this.projectRank(a) - this.projectRank(b)
                   || this.projectDate(b).localeCompare(this.projectDate(a)));

    // The card is a uniform, purely informational tile: status · name · summary · meta.
    // Every detail, note and action lives one step deeper, in openProjectInfo().
    const cards = visible.map(p => {
      const stage = this.approvalStage(p);
      const real = stage === 'approved';                         // cages physically exist
      const closed = p.status === 'closed';
      const info = this.stageInfo(p);
      const mice = real ? p.cages.reduce((s, c) => s + c.mice.length, 0) : (p.request?.totalMice || 0);

      const pillCls = { req: 'waiting', aec: 'aec', empty: 'built', rej: 'rejected', ok: closed ? 'closed' : 'active' }[info.cls];

      return `
        <div class="project-card card-open ${closed ? 'closed' : ''} ${info.cls === 'rej' ? 'rejected' : ''} ${info.cls === 'req' || info.cls === 'aec' ? 'waiting' : ''}" data-pid="${p.id}">
          <div class="pc-top">
            <span class="pill ${pillCls}">${info.text}</span>
            <span class="role-tag">${this.myRoleLabel(p)}</span>
          </div>
          <h3 title="${p.name}">${p.name}</h3>
          <p class="p-desc">${p.description}</p>
          <div class="project-meta">
            <span class="pm-i"><i>📅</i>${real ? 'เริ่ม ' + p.startDate : 'ยื่น ' + (p.requestDate || p.startDate)}</span>
            <span class="pm-i"><i>📦</i>${real ? p.cages.length + ' กรง' : (p.request?.groups?.length || 0) + ' กลุ่ม'}</span>
            <span class="pm-i"><i>🐭</i>${mice} ตัว</span>
          </div>
        </div>`;
    }).join('') || `<p class="empty-note">คุณยังไม่มีโครงการที่เข้าถึงได้ — กด “+ สร้างโครงการ” เพื่อยื่นคำขอ (คุณจะเป็น PI ของโครงการนั้น)</p>`;

    // what the list is showing depends on the POSITION's scope, not on approval rights
    const who = `เข้าใช้เป็น <b>${this.user.name}</b> (${this.positionKey()})`;
    const count = `<span class="count-chip">${visible.length} โครงการ</span>`;
    const sub = this.canReview
      ? `${who} · เห็นทุกโครงการเพื่อตรวจสอบ/อนุมัติ`
      : this.seesAllProjects
        ? `${who} · เห็นทุกโครงการตามหน้าที่ของตำแหน่ง`
        : `${who} · แสดงเฉพาะโครงการที่คุณได้รับแต่งตั้ง`;

    this.shell(
      '',   // the active tab already says "โครงการ"
      `<div class="page">
        <div class="page-head">
          <div><h2>โครงการ${this.canReview ? '' : 'ของฉัน'}${count}</h2><div class="desc">${sub}</div></div>
          ${this.can('createProject') ? `<button class="btn btn-primary" id="newProjectBtn"><span class="ico-plus">+</span> สร้างโครงการ</button>` : ''}
        </div>
        <div class="project-grid">${cards}</div>
      </div>`
    );

    // "new project" always starts a fresh draft (never resumes a stale edit-draft)
    const newBtn = this.el('newProjectBtn');
    if (newBtn) newBtn.onclick = () => { this.draft = null; this.go('create'); };

    // the whole card is one target — it opens the detail popup, nothing else
    document.querySelectorAll('.card-open').forEach(el => {
      el.addEventListener('click', () => {
        const p = Data.getProject(el.dataset.pid);
        if (p) this.openProject(p);
      });
    });
  },

  // list order — lowest rank first (what needs attention), then newest.
  // Keep in step with stageInfo(): both describe the same five card states.
  projectRank(p) {
    const stage = this.approvalStage(p);
    if (stage === 'rejected')  return 0;   // ✗ ตีกลับให้แก้ไข
    if (stage === 'requested') return 1;   // ⏳ รอสำนักเลขาฯ จริยธรรมตรวจ
    if (stage === 'aec_ok')    return 2;   // 📋 รอสัตวแพทย์จัดสรรพื้นที่
    if (p.status === 'closed') return 5;   // ปิดแล้ว
    return this.isEmptyProject(p) ? 3 : 4; // 🦠 กักกันโรค/รอนำหนูเข้าโครงการ · กำลังดำเนิน
  },
  // "ล่าสุด" = the same date the card prints (เริ่ม for live, ยื่น for a pending request).
  // NOT max(startDate, requestDate): a request also carries a startDate, which would
  // mask requestDate and make a resubmitted request keep its old position.
  projectDate(p) {
    return this.approvalStage(p) === 'approved'
      ? (p.startDate || '')
      : (p.requestDate || p.startDate || '');
  },

  // A card click ALWAYS opens the detail popup first — one inserted step before any
  // real action. Entering the dashboard, reviewing, building, editing and deleting
  // are all buttons inside that popup (see openProjectInfo).
  openProject(p) {
    // OCH inspects on site: a card click opens the safety report, never the dashboard
    if (!this.can('enterProject', p) && this.can('ochReport', p)) {
      return this.go('ochreport', p.id);
    }
    this.openProjectInfo(p);
  },

  // load an existing (non-approved) project into the create wizard for editing
  // load an existing pipeline project's REQUEST back into the request form for editing
  editProject(p) {
    const req = p.request || {};
    const blank = this.blankRequestDraft();
    this.draft = {
      ...blank,
      editId: p.id,
      meta: {
        ...blank.meta,
        name: p.name,
        lotNo: req.lotNo || '',
        protocolNo: req.protocolNo || '',
        pi: req.pi || DB.users.find(u => u.id === p.createdBy)?.name || '',
        approvedDate: req.approvedDate || '', untilDate: req.untilDate || '',
        species: req.species || '', strain: req.strain || '',
        sexes: (req.sexes && req.sexes.length) ? [...req.sexes] : ['M'],
        ageMin: req.ageMin ?? '', ageMax: req.ageMax ?? '', weightMin: req.weightMin ?? '', weightMax: req.weightMax ?? '',
        maleCount: req.maleCount ?? '', femaleCount: req.femaleCount ?? '',
        objective: req.objective || '',
        protocolEndpoint: req.protocolEndpoint || '',
        humaneEndpoint: req.humaneEndpoint || '',
      },
      diets: (req.diets && req.diets.length ? req.diets : blank.diets)
        .map((x, i) => ({ name: x.name, isDefault: !!x.isDefault, plannedMice: x.plannedMice ?? '', color: x.color || this.DIET_PALETTE[i % this.DIET_PALETTE.length] })),
      groups: (req.groups && req.groups.length ? req.groups : blank.groups)
        .map((g, i) => ({ name: g.name, isControl: g.isControl, plannedMice: g.plannedMice ?? '', color: g.color || this.GROUP_PALETTE[i % this.GROUP_PALETTE.length] })),
      plan: (req.plan || []).map(x => ({ _id: this.uid(), date: x.date || '', detail: x.detail || '' })),
      humane: {
        criteria: ((req.humaneScore && req.humaneScore.criteria) || []).length
          ? req.humaneScore.criteria.map(c => ({ ...c,
              levels: c.levels ? [...c.levels] : ['', '', '', ''], cuts: c.cuts ? [...c.cuts] : undefined }))
          : this.DEFAULT_HUMANE_CRITERIA.map(c => ({ ...c,
              levels: c.levels ? [...c.levels] : ['', '', '', ''], cuts: c.cuts ? [...c.cuts] : undefined })),
        totalThreshold: (req.humaneScore && req.humaneScore.totalThreshold) ?? 8,
        weightLossPct: (req.humaneScore && req.humaneScore.weightLossPct) ?? 20,
        note: (req.humaneScore && req.humaneScore.note) || '',
      },
      diagram: req.diagram || null,
      aup: req.aup || null,
      approvalDoc: req.approvalDoc || null,
      extraDocs: (req.extraDocs || []).map(x => ({ _id: this.uid(), label: x.label || '', file: x.file || null })),
      appointments: (req.appointments || []).map(a => ({ ...a })),
    };
    if (!this.draft.diets.some(x => x.isDefault)) this.draft.diets[0].isDefault = true;
    this.go('create');
  },

  // ---- project pipeline: requested → aec_ok → approved ----------------
  // stage 1 — AEC approves the ethics request → hands off to AV to build
  aecApprove(p) {
    p.approval = 'aec_ok'; p.rejectReason = '';
    p.aecReview = { by: this.user.name, at: todayISO() };
    this.log('อนุมัติคำขอ (จริยธรรม)', p.name, p.name);
    // A2 — the vet is next in the chain
    this.notify({ kind: 'approve', title: 'คำขอผ่านจริยธรรมแล้ว — รอจัดสรรพื้นที่',
      detail: p.name, project: p, to: this.nTo.position('AV'), link: { type: 'build' } });
    this.notify({ kind: 'approve', title: 'คำขอของคุณผ่านการตรวจจริยธรรมแล้ว',
      detail: `${p.name} — รอสัตวแพทย์จัดสรรพื้นที่และสร้างกรง`, project: p,
      to: [...this.nTo.creator(p), ...this.nTo.roles(p, ['COPI'])], link: { type: 'projectInfo' } });
    this.toast(`ผ่านการตรวจจริยธรรม — ส่งต่อสัตวแพทย์เพื่อสร้างโครงการ`);
  },
  // either reviewer sends it back; `stage` records who bounced it
  rejectProject(p, reason, stage, phone) {
    p.approval = 'rejected'; p.rejectReason = reason; p.rejectStage = stage;
    p.reviewedBy = this.user.name; p.reviewedAt = todayISO();
    p.rejectPhone = (phone || '').trim();   // so the PI can call back straight away
    this.log('ตีกลับโครงการ', `${p.name} · ${reason}`, p.name);
    // A3 — the researcher has to act; carry the reason and the callback number
    this.notify({ kind: 'reject', title: `คำขอถูกตีกลับ (${stage === 'av' ? 'สัตวแพทย์' : 'จริยธรรม'})`,
      detail: `${reason}${p.rejectPhone ? ` · ติดต่อ ${p.rejectPhone}` : ''}`, project: p,
      to: [...this.nTo.creator(p), ...this.nTo.roles(p, ['COPI'])],
      link: { type: 'editRequest' } });
    this.toast(`ตีกลับให้แก้ไข: ${p.name}`);
  },
  // the creator fixes a rejected request → back to the AEC queue
  resubmitProject(p) {
    const bouncedBy = p.rejectStage;          // remember before it is cleared
    p.approval = 'requested'; p.rejectReason = ''; p.rejectStage = null;
    p.requestDate = todayISO();
    this.log('ยื่นคำขออีกครั้ง', p.name, p.name);
    // A4 — back to whoever sent it back (AV bounces still re-enter at the AEC queue,
    // so tell both when the vet was the one who rejected it)
    this.notify({ kind: 'request', title: 'ผู้วิจัยแก้คำขอและยื่นใหม่แล้ว',
      detail: p.name, project: p,
      to: bouncedBy === 'av' ? [...this.nTo.position('AV'), ...this.nTo.position('AEC')] : this.nTo.position('AEC'),
      link: { type: 'projectInfo' } });
    this.toast('ส่งคำขอให้สำนักเลขาฯ จริยธรรมตรวจอีกครั้ง');
  },
  confirmDeleteProject(p) {
    this.openModal(`
      <div class="modal-head"><div><h3>ลบโครงการ</h3><div class="sub">${p.name}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button></div>
      <div class="modal-body"><p>ยืนยันการลบโครงการนี้ถาวร? การลบไม่สามารถกู้คืนได้</p></div>
      <div class="modal-foot">
        <button class="btn" id="cancelDel">ยกเลิก</button>
        <button class="btn btn-danger" id="okDel">🗑 ลบถาวร</button>
      </div>`);
    const close = () => { this.closeModal(); this.renderProjects(); };
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('cancelDel').onclick = () => this.closeModal();
    this.el('okDel').onclick = () => {
      const i = DB.projects.indexOf(p);
      if (i >= 0) DB.projects.splice(i, 1);
      this.log('ลบโครงการ', p.name, p.name);
      this.toast(`ลบโครงการ "${p.name}" แล้ว`);
      close();
    };
  },

  // project info modal — request detail + review actions per pipeline stage
  openProjectInfo(p) {
    const stage = this.approvalStage(p);
    const approved = stage === 'approved';
    const real = approved;                                             // cages physically exist
    const empty = approved && this.isEmptyProject(p);                  // live but no mice yet
    const info = this.stageInfo(p);
    const req = p.request || {};
    const aecCanReview = stage === 'requested' && this.canReviewAEC;   // AEC approves the request
    const avCanBuild = stage === 'aec_ok' && this.canBuild;            // AV proceeds to build
    // everything the project cards used to carry now lives in this popup's footer
    const owner = this.isCreator(p) || this.isAdmin;
    const canEnter    = approved && this.canEnter(p);
    const canEditReq  = (stage === 'requested' || stage === 'rejected') && owner;
    const canResubmit = stage === 'rejected' && owner;
    const canCages    = approved && this.can('editProject', p);
    const canMembers  = approved && this.can('manageMembers', p);

    // request detail (both group layers w/ planned mice, attachments, appointments)
    const reqDiets = (req.diets || []).map(x => `<div class="pi-grp"><i class="sw" style="background:${x.color || '#94a3b8'}"></i><b>${x.name}</b>${x.isDefault ? ' <span class="muted">(ค่าเริ่มต้น)</span>' : ''} <span class="muted">· ${x.plannedMice} ตัว</span></div>`).join('') || '<span class="muted">—</span>';
    const reqGroups = (req.groups || []).map(g => `<div class="pi-grp"><i class="sw" style="background:${g.color || '#94a3b8'}"></i><b>${g.name}</b>${g.isControl ? ' <span class="muted">(control)</span>' : ''} <span class="muted">· ${g.plannedMice} ตัว</span></div>`).join('') || '<span class="muted">—</span>';
    const fileLine = (f, label) => f
      ? `<div class="pi-doc"><span>📎 ${label}: ${f.name}</span>${f.url ? `<button class="mini-btn pifile-open" data-url="${f.url}">เปิด</button>` : '<span class="muted">ตัวอย่าง</span>'}</div>`
      : `<div class="pi-doc"><span class="muted">📎 ${label}: ไม่ได้แนบ</span></div>`;
    // the experiment diagram is an image → show it inline for the reviewer
    const diagramPreview = req.diagram && req.diagram.url
      ? `<a class="pi-diagram" href="${req.diagram.url}" target="_blank" title="เปิดภาพเต็ม"><img src="${req.diagram.url}" alt="แผนภาพการทดลอง"></a>`
      : (req.diagram ? '<div class="pi-diagram empty">🖼️ แผนภาพการทดลอง (ตัวอย่าง — ไม่มีไฟล์จริงในโปรโตไทป์)</div>' : '');
    // ---- protocol header, read-only ----
    const SEX_TH = { M: '♂ เพศผู้ (Male)', F: '♀ เพศเมีย (Female)' };
    const sexLabel = (req.sexes || []).map(s => SEX_TH[s] || s).join(' · ') || '—';
    // a range prints as "20–25 หน่วย"; one end alone still prints, both blank prints —
    const rangeLabel = (lo, hi, unit) => {
      const has = v => v != null && v !== '';
      if (has(lo) && has(hi)) return `${lo}–${hi} ${unit}`;
      if (has(lo) || has(hi)) return `${has(lo) ? lo : hi} ${unit}`;
      return '—';
    };
    const weightLabel = rangeLabel(req.weightMin, req.weightMax, 'กรัม');
    const ageLabel = rangeLabel(req.ageMin, req.ageMax, 'สัปดาห์');
    const countBreak = (req.maleCount || req.femaleCount)
      ? ` <span class="muted">(♂ ${req.maleCount || 0} · ♀ ${req.femaleCount || 0})</span>` : '';
    // the vet's endpoint rules — set at the AV build stage, shown at every stage after
    const endpointBlock =
      (req.protocolEndpoint ? `<div class="section-title">Protocol endpoint</div><p class="pi-descread">${req.protocolEndpoint}</p>` : '')
      + (req.humaneEndpoint ? `<div class="section-title">Humane endpoint</div><p class="pi-descread warn">${req.humaneEndpoint}</p>` : '');

    // แผนการใช้สัตว์ทดลอง — read-only timeline, same order as the form (earliest first)
    const planBlock = (req.plan || []).length
      ? `<div class="section-title">แผนการใช้สัตว์ทดลอง</div>
         <ol class="pi-plan">${[...req.plan]
           .sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'))
           .map(x => `<li><span class="pp-date">${this.thaiDate(x.date)}</span><span class="pp-detail">${x.detail || '—'}</span></li>`).join('')}</ol>`
      : '';
    const reqAppoint = (req.appointments || []).length
      ? (req.appointments || []).map(a => {
          const u = a.userId !== '__new__' ? DB.users.find(x => x.id === a.userId) : null;
          const email = a.userId === '__new__' ? a.email : (u ? u.email : '');
          return `<div class="pi-mem"><span class="role-tag">${a.role}</span> <b>${a.name}</b> <span class="muted">· ${email || '—'}${a.userId === '__new__' ? ' · ยังไม่มีบัญชี (รอ AV เปิดให้)' : ''}</span></div>`;
        }).join('')
      : '<span class="muted">— ไม่ได้ร้องขอ —</span>';

    // live projects also show the team + facility
    const members = real ? ((p.members || []).map(m => {
      const u = DB.users.find(x => x.id === m.userId);
      return `<div class="pi-mem"><b>${u ? u.name : m.userId}</b> ${(m.roles || []).map(r => `<span class="role-tag">${r}</span>`).join(' ')}</div>`;
    }).join('') || '<span class="muted">—</span>') : '';

    const body = real
      ? `${empty ? '<div class="reject-banner built"><b>🦠 อยู่ระหว่างกักกันโรค — ยังไม่มีหนูในโครงการ</b> — รอนักวิทยาศาสตร์ (Sci) ชั่งน้ำหนักแรกเข้าเพื่อนำหนูเข้าโครงการ</div>' : ''}
        <div class="pi-grid">
          <div><span class="pi-k">วันที่เริ่ม</span> ${p.startDate || '—'}</div>
          <div><span class="pi-k">ห้อง / แร็ค</span> ${p.facility?.roomNo || '—'}${p.facility?.rackNo ? ' · ' + p.facility.rackNo : ''}</div>
          <div><span class="pi-k">ผังกรง</span> ${p.shelves} ชั้น · ${p.cages.length} กรง</div>
          <div><span class="pi-k">หนู</span> ${p.cages.reduce((s, c) => s + c.mice.length, 0)} ตัว</div>
        </div>
        <div class="section-title">ชั้นที่ 1 · ชนิดอาหาร</div>${(p.diets || []).map(x => `<div class="pi-grp"><i class="sw" style="background:${x.color}"></i><b>${x.name}</b>${x.isDefault ? ' <span class="muted">(ค่าเริ่มต้น)</span>' : ''}${x.capacity != null ? ` <span class="muted">· ${this.dietCountLive(p, x.id)}/${x.capacity} ตัว</span>` : ''}</div>`).join('') || '<span class="muted">—</span>'}
        <div class="section-title">ชั้นที่ 2 · กลุ่มทดสอบ</div>${p.groups.map(gr => `<div class="pi-grp"><i class="sw" style="background:${gr.color}"></i><b>${gr.name}</b>${gr.isControl ? ' <span class="muted">(control)</span>' : ''}${gr.capacity != null ? ` <span class="muted">· ${this.popGroupCountLive(p, gr.id)}/${gr.capacity} ตัว</span>` : ''}</div>`).join('')}
        ${endpointBlock}
        ${planBlock}
        <div class="section-title">สมาชิก</div>${members}`
      : `<div class="pi-grid">
          <div><span class="pi-k">วันที่ยื่นคำขอ</span> ${this.thaiDate(p.requestDate) || '—'}</div>
          <div><span class="pi-k">Protocol No</span> ${req.protocolNo || '—'}</div>
          <div><span class="pi-k">Lot No</span> ${req.lotNo || '—'}</div>
          <div><span class="pi-k">Principal Investigator</span> ${req.pi || DB.users.find(u => u.id === p.createdBy)?.name || '—'}</div>
          <div><span class="pi-k">Approved — Until</span> ${req.approvedDate ? this.thaiDate(req.approvedDate) : '—'} — ${req.untilDate ? this.thaiDate(req.untilDate) : '—'}</div>
          <div><span class="pi-k">Species</span> ${req.species || '—'}</div>
          <div><span class="pi-k">Stock / Strain</span> ${req.strain || '—'}</div>
          <div><span class="pi-k">Sex</span> ${sexLabel}</div>
          <div><span class="pi-k">Age</span> ${ageLabel}</div>
          <div><span class="pi-k">Average weight</span> ${weightLabel}</div>
          <div><span class="pi-k">Total No of Animals</span> ${req.totalMice || '—'} ตัว${countBreak}</div>
        </div>
        ${req.objective ? `<div class="section-title">Protocol description</div><p class="pi-descread">${req.objective}</p>` : ''}
        ${endpointBlock}
        <div class="section-title">ชั้นที่ 1 · ชนิดอาหาร</div>${reqDiets}
        <div class="section-title">ชั้นที่ 2 · กลุ่มทดสอบ</div>${reqGroups}
        ${planBlock}
        <div class="section-title">แผนภาพการทดลอง</div>${diagramPreview || '<span class="muted">ไม่ได้แนบ</span>'}
        <div class="section-title">เอกสารแนบ</div><div class="pi-docs">${fileLine(req.aup, 'AUP')}${fileLine(req.approvalDoc, 'ใบอนุมัติจริยธรรม')}${(req.extraDocs || []).map(x => fileLine(x.file, x.label)).join('')}</div>
        <div class="section-title">ร้องขอแต่งตั้ง</div>${reqAppoint}
        ${stage === 'aec_ok' && p.aecReview ? `<p class="empty-note" style="margin-top:10px">✓ ผ่านการตรวจจริยธรรมโดย ${p.aecReview.by} · ${p.aecReview.at}</p>` : ''}`;

    this.openModal(`
      <div class="modal-head"><div><h3>${real ? 'ข้อมูลโครงการ' : 'คำขอสร้างโครงการ'}</h3><div class="sub">${info.text}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button></div>
      <div class="modal-body">
        ${stage === 'rejected' ? `<div class="reject-banner"><b>ตีกลับ${p.rejectStage === 'av' ? ' (สัตวแพทย์)' : ' (จริยธรรม)'}</b> — ${p.rejectReason || '—'}
          <div class="muted" style="font-size:12px;margin-top:3px">โดย ${p.reviewedBy || '—'} · ${this.thaiDate(p.reviewedAt) || ''}</div>
          ${p.rejectPhone ? `<div class="reject-call">📞 สอบถามผู้ตรวจได้ที่ <a href="tel:${String(p.rejectPhone).replace(/[^0-9+]/g, '')}"><b>${p.rejectPhone}</b></a></div>` : ''}</div>` : ''}
        <h4 class="pi-name">${p.name}</h4>
        ${body}
        ${aecCanReview ? `<div class="reject-box" id="rejectBox" style="display:none">
          <div class="field"><label for="rejectReason">เหตุผลที่ตีกลับ <span class="req-star">*</span></label>
            <textarea id="rejectReason" rows="3" placeholder="ระบุสิ่งที่ผู้วิจัยต้องแก้ไข"></textarea></div>
          <div class="field" style="margin-bottom:0"><label for="rejectPhone">เบอร์โทรติดต่อกลับ <span class="req-star">*</span></label>
            <input id="rejectPhone" type="tel" inputmode="tel" placeholder="เช่น 053-935-000 ต่อ 123" value="${(this.user.phone || '').replace(/"/g, '&quot;')}">
            <span class="field-hint">ผู้วิจัยจะเห็นเบอร์นี้ เพื่อสอบถามรายละเอียดได้ทันที</span></div>
        </div>` : ''}
      </div>
      <div class="modal-foot wrap">
        <button class="btn" id="piClose">ปิด</button>
        <span class="spacer" style="flex:1"></span>
        ${canEditReq ? `<button class="btn danger" id="piDelete">🗑 ลบ</button>` : ''}
        ${canEditReq ? `<button class="btn" id="piEdit">✏️ แก้คำขอ</button>` : ''}
        ${canMembers ? `<button class="btn" id="piMembers">👥 จัดการสมาชิก</button>` : ''}
        ${canCages ? `<button class="btn" id="piCages">✏️ จัดการกรง</button>` : ''}
        ${canResubmit ? `<button class="btn btn-primary" id="piResubmit">↻ ยื่นใหม่</button>` : ''}
        ${avCanBuild ? `<button class="btn btn-primary" id="piBuild">🏗️ จัดสรรพื้นที่ต่อ</button>` : ''}
        ${aecCanReview ? `<button class="btn btn-danger" id="piReject">✗ ตีกลับ</button><button class="btn btn-green" id="piApprove">✓ อนุมัติคำขอ</button>` : ''}
        ${canEnter ? `<button class="btn btn-primary" id="piEnter">เข้าโครงการ →</button>` : ''}
      </div>`);

    document.querySelectorAll('.pifile-open').forEach(b => b.onclick = () => window.open(b.dataset.url, '_blank'));
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('piClose').onclick = () => this.closeModal();
    if (canEnter) this.el('piEnter').onclick = () => { this.closeModal(); this.go('dashboard', p.id); };
    if (canCages) this.el('piCages').onclick = () => {
      this.closeModal(); this.go('dashboard', p.id); this.editing = true; this.renderDashboard();
    };
    if (canMembers) this.el('piMembers').onclick = () => { this.closeModal(); this.openMembers(p); };
    if (canEditReq) {
      this.el('piEdit').onclick = () => { this.closeModal(); this.editProject(p); };
      this.el('piDelete').onclick = () => { this.closeModal(); this.confirmDeleteProject(p); };
    }
    if (canResubmit) this.el('piResubmit').onclick = () => { this.resubmitProject(p); this.closeModal(); this.renderProjects(); };
    if (avCanBuild) this.el('piBuild').onclick = () => { this.closeModal(); this.buildProject(p); };
    if (aecCanReview) {
      const rb = this.el('rejectBox');
      this.el('piApprove').onclick = () => { this.aecApprove(p); this.closeModal(); this.renderProjects(); };
      this.el('piReject').onclick = () => {
        if (rb.style.display === 'none') { rb.style.display = ''; this.el('rejectReason').focus(); this.toast('ระบุเหตุผลและเบอร์ติดต่อ แล้วกด "ตีกลับ" อีกครั้ง'); return; }
        const reason = this.el('rejectReason').value.trim();
        if (!reason) { this.el('rejectReason').focus(); this.toast('กรุณาระบุเหตุผลที่ตีกลับ'); return; }
        const phone = this.el('rejectPhone').value.trim();
        if (!phone) { this.el('rejectPhone').focus(); this.toast('กรุณาระบุเบอร์โทรติดต่อกลับ'); return; }
        this.rejectProject(p, reason, 'aec', phone); this.closeModal(); this.renderProjects();
      };
    }
  },

  // ---------------------------------------------------------
  // 2b. CREATE PROJECT
  // ---------------------------------------------------------
  GROUP_PALETTE: ['#64748b', '#2563eb', '#7c3aed', '#16a34a', '#dc2626', '#d97706', '#0891b2', '#db2777'],
  // ชนิดอาหาร (layer 1) — warm tones so the two layers never look alike on screen
  DIET_PALETTE: ['#94a3b8', '#d97706', '#b45309', '#a16207', '#9a3412', '#7c2d12'],

  // STAGE 1 — the PI's project REQUEST form. No cages here: the PI only declares
  // what the study needs; AV lays out the real cages later when building.
  // a blank PI request. `meta` holds every plain field of the protocol header;
  // the repeatable parts (lots, diets, groups, plan, appointments) sit beside it.
  blankRequestDraft() {
    return {
      mode: 'request', editId: null,
      meta: {
        name: '', lotNo: '', protocolNo: '', pi: this.user.name,
        approvedDate: '', untilDate: '',
        species: '', strain: '', sexes: ['M'], ageMin: '', ageMax: '',
        weightMin: '', weightMax: '', maleCount: '', femaleCount: '',
        objective: '',
        // filled at the AV stage, not on this form — carried through untouched
        protocolEndpoint: '', humaneEndpoint: '',
      },
      diets: [{ name: 'อาหารทั่วไป', color: this.DIET_PALETTE[0], isDefault: true, plannedMice: '' }],
      groups: [
        { name: 'Control', color: '#64748b', isControl: true, plannedMice: '' },
        { name: 'Treatment-1', color: '#2563eb', isControl: false, plannedMice: '' },
      ],
      plan: [],
      // เกณฑ์ Humane endpoint — เริ่มจากชุดมาตรฐาน แก้ได้ทั้งหมด
      humane: {
        criteria: this.DEFAULT_HUMANE_CRITERIA.map(c => ({ ...c,
          levels: c.levels ? [...c.levels] : ['', '', '', ''], cuts: c.cuts ? [...c.cuts] : undefined })),
        ...this.DEFAULT_HUMANE,
      },
      diagram: null, aup: null, approvalDoc: null,
      extraDocs: [],      // เอกสารเพิ่มเติมที่ PI แนบเองได้ไม่จำกัด [{_id,label,file}]
      appointments: [],
    };
  },

  renderCreateProject() {
    // ยื่นคำขอได้เฉพาะผู้ที่มีสิทธิ์ — ปิดทางเข้าที่ตัว route เอง ไม่ใช่แค่ซ่อนปุ่ม
    if (!this.can('createProject')) { this.toast('คุณไม่มีสิทธิ์ยื่นขอสร้างโครงการ'); return this.go(this.homeRoute()); }
    if (!this.draft || this.draft.mode === 'build') this.draft = this.blankRequestDraft();
    // a draft built by an older version may be missing the newer collections
    const blank = this.blankRequestDraft();
    ['diets', 'plan', 'extraDocs'].forEach(k => { if (!this.draft[k]) this.draft[k] = blank[k]; });
    this.draft.meta = { ...blank.meta, ...(this.draft.meta || {}) };
    if (!this.draft.meta.sexes || !this.draft.meta.sexes.length) this.draft.meta.sexes = ['M'];

    const d = this.draft, isEdit = !!d.editId, meta = d.meta;
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const fileRow = (key, label, hint, accept, isImage) => {
      const f = d[key];
      const preview = isImage && f && f.url ? `<img class="rf-thumb" src="${f.url}" alt="${label}">` : '';
      return `<div class="req-file ${preview ? 'has-thumb' : ''}" data-key="${key}">
        ${preview}
        <div class="rf-info"><b>${label}</b><span class="empty-note">${hint}</span></div>
        <div class="rf-slot">${f ? `<span class="rf-name">📎 ${f.name}</span><button class="mini-btn danger" data-clear="${key}">ลบ</button>`
          : `<label class="btn btn-sm rf-pick">แนบไฟล์<input type="file" accept="${accept}" data-file="${key}" hidden></label>`}</div>
      </div>`;
    };

    this.shell(
      `<a data-nav="create">${isEdit ? 'แก้ไขคำขอ' : 'ขอสร้างโครงการ'}</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>${isEdit ? 'แก้ไขคำขอสร้างโครงการ' : 'คำขอสร้างโครงการ'}</h2>
            <div class="desc">กรอกรายละเอียดการทดลองเพื่อยื่นให้ <b>สำนักเลขาฯ คณะกรรมการจริยธรรมการใช้สัตว์ทดลอง (AEC)</b> ตรวจสอบ เมื่อผ่านแล้ว <b>สัตวแพทย์ (AV)</b> จะดำเนินการสร้างโครงการในระบบต่อไป</div></div>
        </div>

        <div class="create-flow">
          <span class="cf-step on">1 · ผู้วิจัยยื่นคำขอ</span><span class="cf-arrow">→</span>
          <span class="cf-step">2 · จริยธรรมตรวจ</span><span class="cf-arrow">→</span>
          <span class="cf-step">3 · สัตวแพทย์สร้างโครงการ</span>
        </div>

        <div class="create-wrap">
          <div class="form-card">
            <div class="form-card-title">ข้อมูลโครงการ</div>
            <div class="fgrid">
              <div class="field span2 name-lot">
                <div><label for="cpName">ชื่อโครงการ <span class="req-star">*</span></label>
                  <input id="cpName" placeholder="เช่น NAFLD Diet Study" value="${esc(meta.name)}"></div>
                <div><label for="cpLotNo">Lot No</label>
                  <input id="cpLotNo" placeholder="เช่น 1" value="${esc(meta.lotNo)}"></div>
              </div>
              <div class="field"><label for="cpProtocolNo">Protocol No</label>
                <input id="cpProtocolNo" placeholder="เช่น MU-AEC-2569-014" value="${esc(meta.protocolNo)}"></div>
              <div class="field"><label for="cpPI">Principal Investigator (PI)</label>
                <input id="cpPI" placeholder="ชื่อหัวหน้าโครงการ" value="${esc(meta.pi)}"></div>
              <div class="field"><label>Approved</label>${this.dateChip('cpApproved', meta.approvedDate, 'วันที่อนุมัติ')}</div>
              <div class="field"><label>Until</label>${this.dateChip('cpUntil', meta.untilDate, 'สิ้นสุดใบอนุญาต')}
                <span class="field-hint">ระบบเติมให้ 1 ปีนับจากวันอนุมัติ — แก้ไขได้</span></div>
              <div class="field"><label for="cpSpecies">Species</label>
                <input id="cpSpecies" placeholder="เช่น Mus musculus (หนูเมาส์)" value="${esc(meta.species)}"></div>
              <div class="field"><label for="cpStrain">Stock / Strain</label>
                <input id="cpStrain" placeholder="เช่น C57BL/6" value="${esc(meta.strain)}"></div>
              <div class="field"><label>Age (week)</label>
                <div class="range-row">
                  <input id="cpAgeMin" type="number" min="0" max="200" value="${esc(meta.ageMin)}">
                  <span class="rr-dash">–</span>
                  <input id="cpAgeMax" type="number" min="0" max="200" value="${esc(meta.ageMax)}">
                  <span class="rr-unit">สัปดาห์</span>
                </div></div>
              <div class="field"><label>Average weight</label>
                <div class="range-row">
                  <input id="cpWMin" type="number" min="0" step="0.1" value="${esc(meta.weightMin)}">
                  <span class="rr-dash">–</span>
                  <input id="cpWMax" type="number" min="0" step="0.1" value="${esc(meta.weightMax)}">
                  <span class="rr-unit">กรัม</span>
                </div></div>
              <div class="field span2"><label>Sex <span class="lbl-hint">— กรอกจำนวนของเพศที่จะใช้ (เว้นว่าง = ไม่ใช้เพศนั้น)</span></label>
                <div class="sexcount-row">
                  <div class="sc-item m"><label for="cpMale">♂ เพศผู้ (Male)</label>
                    <input id="cpMale" type="number" min="0" max="9999" placeholder="0" value="${esc(meta.maleCount)}"></div>
                  <div class="sc-item f"><label for="cpFemale">♀ เพศเมีย (Female)</label>
                    <input id="cpFemale" type="number" min="0" max="9999" placeholder="0" value="${esc(meta.femaleCount)}"></div>
                </div></div>
            </div>

            <div class="fc-sub">Total No of Animals</div>
            <div class="total-readout" id="cpTotalSum"></div>

            <div class="fc-sub">Protocol description</div>
            <textarea id="cpObjective" rows="3" placeholder="อธิบายวัตถุประสงค์และวิธีดำเนินการทดลองโดยย่อ">${meta.objective || ''}</textarea>
            <div class="fc-sub">Protocol endpoint</div>
            <textarea id="cpProtoEnd" rows="2" placeholder="เงื่อนไขที่ถือว่าการทดลองสิ้นสุดตามแผน">${meta.protocolEndpoint || ''}</textarea>
            <div class="fc-sub">Humane endpoint</div>
            <textarea id="cpHumaneEnd" rows="3" placeholder="สภาวะของสัตว์ที่ถือว่าทำการทดลองต่อไม่ได้ ต้องทำการุณยฆาต (euthanasia)">${meta.humaneEndpoint || ''}</textarea>
            <span class="field-hint">สัตวแพทย์จะทบทวนและปรับข้อกำหนดนี้อีกครั้งตอนจัดสรรพื้นที่</span>
          </div>

          <div class="form-card">
            <div class="form-card-title">ชนิดอาหาร <span class="fc-layer">ชั้นที่ 1</span>
              <button class="btn btn-ghost btn-sm" id="cpAddDiet" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มชนิดอาหาร</button>
            </div>
            <p class="empty-note" style="margin-top:0">ระบุชนิดอาหารและจำนวนหนูต่อชนิด · เลือก 1 ชนิดเป็น <b>ค่าเริ่มต้น</b> — กรงที่ยังไม่ถูกกำหนดจะใช้ชนิดนี้</p>
            <div id="cpDiets"></div>
            <div class="req-sum" id="cpDietSum"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">กลุ่มทดสอบ <span class="fc-layer">ชั้นที่ 2</span>
              <button class="btn btn-ghost btn-sm" id="cpAddGroup" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มกลุ่ม</button>
            </div>
            <p class="empty-note" style="margin-top:0">ระบุกลุ่มการทดลองและจำนวนหนูต่อกลุ่ม · เลือก 1 กลุ่มเป็นกลุ่มควบคุม (Control)</p>
            <div id="cpGroups"></div>
            <div class="req-sum" id="cpGroupSum"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">เกณฑ์หยุดการทดลอง (Humane endpoint)
              <button class="btn btn-ghost btn-sm" id="cpAddHumane" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มเกณฑ์</button>
            </div>
            <p class="empty-note" style="margin-top:0">
              นักวิทยาศาสตร์ให้คะแนนทุกเกณฑ์ <b>ก่อนชั่งน้ำหนักหนูแต่ละตัว</b> (ตามปกติคือรอบละสัปดาห์)
              · ข้อละ <b>0–3</b> พร้อมนิยามแต่ละระดับ
              · ชุดที่ให้มาเป็นค่าตั้งต้น <b>แก้ชื่อ แก้นิยาม เพิ่ม/ลบข้อได้ตามโปรโตคอลของโครงการ</b></p>
            <div id="cpHumane"></div>
            <div class="hs-thresh">
              <label for="cpHumaneTh">การุณยฆาตเมื่อคะแนนรวม ≥</label>
              <input type="number" id="cpHumaneTh" min="1" step="1" value="${d.humane.totalThreshold}">
              <span class="hs-max">จากคะแนนเต็ม <b id="cpHumaneMax">—</b></span>
            </div>
            <div class="hs-thresh" id="cpWlRow">
              <label for="cpHumaneWl">หรือเมื่อน้ำหนักลดจากน้ำหนักสูงสุด ≥</label>
              <input type="number" id="cpHumaneWl" min="1" max="100" step="1" value="${d.humane.weightLossPct}">
              <span class="hs-max">% (ระบบคิดให้เองจากน้ำหนักที่ชั่ง)</span>
            </div>
            <div class="field" style="margin-top:10px">
              <label for="cpHumaneNote">หมายเหตุเพิ่มเติมของเกณฑ์ (ไม่บังคับ)</label>
              <input type="text" id="cpHumaneNote" value="${esc(d.humane.note)}"
                     placeholder="เช่น < 140 mg/dl of blood glucose in 2-hour after glucose loading">
            </div>
          </div>

          <div class="form-card">
            <div class="form-card-title">แผนการใช้สัตว์ทดลอง
              <button class="btn btn-ghost btn-sm" id="cpAddPlan" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มรายการ</button>
            </div>
            <p class="empty-note" style="margin-top:0">ระบุกิจกรรมที่จะทำกับสัตว์ทดลองพร้อมวันที่ · ระบบเรียงลำดับตามวันที่ให้อัตโนมัติ (เริ่มก่อนอยู่บน)</p>
            <div id="cpPlan"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">เอกสารแนบ
              <button class="btn btn-ghost btn-sm" id="cpAddDoc" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มเอกสารอื่น</button>
            </div>
            ${fileRow('diagram', 'แผนภาพการทดลอง', 'รูปภาพ (PNG / JPG)', 'image/*', true)}
            ${fileRow('aup', 'AUP — Animal Use Protocol', 'ไฟล์ PDF', 'application/pdf')}
            ${fileRow('approvalDoc', 'ใบอนุมัติจริยธรรม', 'ไฟล์ PDF', 'application/pdf')}
            <div class="fc-sub">เอกสารเพิ่มเติม</div>
            <p class="empty-note" style="margin-top:0">แนบเอกสารอื่นได้ตามต้องการ เช่น SOP · ผลแล็บ · หนังสือรับรอง — ตั้งชื่อเอกสารเองได้</p>
            <div id="cpExtraDocs"></div>
            <p class="empty-note">โปรโตไทป์นี้เก็บไฟล์ไว้ในหน่วยความจำชั่วคราวเท่านั้น (รีเฟรชแล้วหาย)</p>
          </div>

          <div class="form-card">
            <div class="form-card-title">ร้องขอแต่งตั้งเจ้าหน้าที่ประจำโครงการ
              <button class="btn btn-ghost btn-sm" id="cpAddPerson" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มรายชื่อ</button>
            </div>
            <p class="empty-note" style="margin-top:0">ร้องขอแต่งตั้ง <b>CoPI (นักวิจัยร่วม)</b> และ <b>AHS (นักวิจัยปฏิบัติการ)</b> แต่ละตำแหน่งมีได้มากกว่า 1 คน · หากยังไม่มีบัญชี สัตวแพทย์จะเป็นผู้เปิดบัญชีและแต่งตั้งให้ภายหลัง</p>
            <div id="cpPeople"></div>
          </div>

          <div class="create-actions">
            <span class="empty-note" style="flex:1">${isEdit ? '' : `วันที่ยื่นคำขอ: <b>${todayISO()}</b> (ระบบบันทึกอัตโนมัติ)`}</span>
            <button class="btn" data-nav="projects">ยกเลิก</button>
            <button class="btn btn-primary" id="cpCreate">${isEdit ? '↻ บันทึก & ยื่นใหม่' : '📨 ยื่นคำขอ'}</button>
          </div>
        </div>
      </div>`
    );

    ['cpMale', 'cpFemale'].forEach(id => this.el(id).addEventListener('input', () => this.updateReqTotals()));
    this.renderReqDiets();
    this.renderReqGroups();
    this.renderReqHumane();
    this.renderReqPlan();
    this.renderReqExtraDocs();
    this.renderReqPeople();
    this.updateReqTotals();      // seeds the total readout + both layer sums + the lot cap

    // the two protocol dates use the app's Thai calendar (see openThaiCalendar).
    // Picking Approved fills Until with the usual one-year period — but only while
    // Until is still blank or still holds the value that auto-fill produced. Once the
    // PI has typed a different end date, changing Approved leaves it alone.
    const approvedBtn = this.el('cpApproved'), untilBtn = this.el('cpUntil');
    approvedBtn.onclick = () => this.openThaiCalendar(approvedBtn, d.meta.approvedDate, (v) => {
      const wasAuto = !d.meta.untilDate || d.meta.untilDate === this.oneYearUntil(d.meta.approvedDate);
      d.meta.approvedDate = v;
      this.setDateChip(approvedBtn, v, 'วันที่อนุมัติ');
      if (wasAuto) {
        d.meta.untilDate = this.oneYearUntil(v);
        this.setDateChip(untilBtn, d.meta.untilDate, 'สิ้นสุดใบอนุญาต');
      }
    });
    untilBtn.onclick = () => this.openThaiCalendar(untilBtn, d.meta.untilDate, (v) => {
      d.meta.untilDate = v;
      this.setDateChip(untilBtn, v, 'สิ้นสุดใบอนุญาต');
    });

    this.el('cpAddDiet').onclick = () => {
      this.captureReqDiets();
      const i = this.draft.diets.length;
      this.draft.diets.push({ name: '', color: this.DIET_PALETTE[i % this.DIET_PALETTE.length], isDefault: false, plannedMice: '' });
      this.renderReqDiets();
    };
    this.el('cpAddGroup').onclick = () => {
      this.captureReqGroups();
      const i = this.draft.groups.length;
      this.draft.groups.push({ name: `Treatment-${i}`, color: this.GROUP_PALETTE[i % this.GROUP_PALETTE.length], isControl: false, plannedMice: '' });
      this.renderReqGroups();
    };
    this.el('cpAddPlan').onclick = () => { this.draft.plan.push({ _id: this.uid(), date: '', detail: '' }); this.renderReqPlan(true); };
    this.el('cpAddHumane').onclick = () => {
      this.captureReqHumane();
      if (this.draft.humane.criteria.length >= this.MAX_HUMANE_CRITERIA) return;
      this.draft.humane.criteria.push({ name: '', auto: null, other: false, levels: ['', '', '', ''] });
      this.renderReqHumane(true);
    };
    ['cpHumaneTh', 'cpHumaneWl', 'cpHumaneNote'].forEach(id =>
      this.el(id).addEventListener('input', () => this.captureReqHumane()));
    this.el('cpAddDoc').onclick = () => { this.draft.extraDocs.push({ _id: this.uid(), label: '', file: null }); this.renderReqExtraDocs(); };
    this.el('cpAddPerson').onclick = () => { this.captureReqPeople(); this.draft.appointments.push({ role: 'COPI', userId: '', name: '' }); this.renderReqPeople(); };

    // file pickers + clears — capture everything first, the whole page re-renders
    const captureAll = () => { this.captureReqMeta(); this.captureReqDiets(); this.captureReqGroups(); this.captureReqHumane(); this.captureReqPeople(); };
    // extraDocs labels are written to the draft on input, so nothing to capture there
    this.el('root').querySelectorAll('[data-file]').forEach(inp => {
      inp.onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        captureAll();
        this.draft[e.target.dataset.file] = { name: f.name, url: URL.createObjectURL(f), size: f.size };
        this.renderCreateProject();
      };
    });
    this.el('root').querySelectorAll('[data-clear]').forEach(b => {
      b.onclick = () => { captureAll(); this.draft[b.dataset.clear] = null; this.renderCreateProject(); };
    });
    this.el('cpCreate').onclick = () => this.submitCreateProject();
  },

  // shared date button — the label is Thai, the value it stands for stays ISO
  dateChip(id, iso, placeholder) {
    return `<button type="button" class="date-chip" id="${id}" aria-haspopup="dialog" data-ph="${placeholder}">
      <span class="pd-ico">📅</span>
      <span class="pd-text ${iso ? '' : 'empty'}">${iso ? this.thaiDate(iso) : placeholder}</span>
    </button>`;
  },
  setDateChip(btn, iso, placeholder) {
    const t = btn.querySelector('.pd-text');
    t.textContent = iso ? this.thaiDate(iso) : (placeholder || btn.dataset.ph || 'เลือกวันที่');
    t.classList.toggle('empty', !iso);
  },

  // Sex is entered as a COUNT per sex — a sex with no number simply isn't used.
  // sexes[] is therefore derived, never toggled.
  reqSexes() {
    const v = id => +(this.el(id)?.value) || 0;
    return [v('cpMale') > 0 ? 'M' : null, v('cpFemale') > 0 ? 'F' : null].filter(Boolean);
  },
  // total = male + female (the single source of truth for every "/ N ตัว" hint)
  reqTotalMice() {
    const v = id => +(this.el(id)?.value) || 0;
    return v('cpMale') + v('cpFemale');
  },
  updateReqTotals() {
    const total = this.reqTotalMice();
    const el = this.el('cpTotalSum');
    if (el) {
      const m = +(this.el('cpMale')?.value) || 0, f = +(this.el('cpFemale')?.value) || 0;
      el.className = `total-readout ${total ? 'ok' : ''}`;
      el.innerHTML = total
        ? `<b>${total}</b> ตัว <span class="tr-break">♂ ${m} · ♀ ${f}</span>`
        : `<span class="tr-empty">ยังไม่ได้ระบุจำนวนสัตว์ — กรอกที่ช่อง Sex ด้านบน</span>`;
    }
    this.updateLayerSum('diet');
    this.updateLayerSum('group');
  },

  // ---- ชั้นที่ 1: ชนิดอาหาร (mirrors renderReqGroups; radio marks the DEFAULT) ----
  renderReqDiets() {
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const rows = this.draft.diets.map((x, i) => `
      <div class="group-item">
        <div class="group-row">
          <input type="color" class="g-color" value="${x.color}" data-i="${i}">
          <input class="g-name" value="${esc(x.name)}" placeholder="ชื่อชนิดอาหาร เช่น ไขมันสูง" data-i="${i}">
          <input class="g-mice" type="number" min="0" max="9999" value="${esc(x.plannedMice)}" placeholder="จำนวน" data-i="${i}">
          <label class="g-ctrl"><input type="radio" name="cpDefaultDiet" ${x.isDefault ? 'checked' : ''} data-i="${i}"> ค่าเริ่มต้น</label>
          <button class="icon-btn g-del" data-i="${i}" title="ลบชนิดอาหาร" ${this.draft.diets.length <= 1 ? 'disabled' : ''}>🗑️</button>
        </div>
      </div>`).join('');
    const box = this.el('cpDiets');
    box.innerHTML = rows;
    box.querySelectorAll('.g-del').forEach(btn => btn.onclick = () => {
      this.captureReqDiets();
      this.draft.diets.splice(+btn.dataset.i, 1);
      if (!this.draft.diets.some(x => x.isDefault) && this.draft.diets.length) this.draft.diets[0].isDefault = true;
      this.renderReqDiets();
    });
    box.querySelectorAll('.g-mice').forEach(i => i.addEventListener('input', () => this.updateLayerSum('diet')));
    this.updateLayerSum('diet');
  },
  captureReqDiets() {
    const box = this.el('cpDiets'); if (!box) return;
    box.querySelectorAll('.group-item').forEach((row, i) => {
      const x = this.draft.diets[i]; if (!x) return;
      x.name = row.querySelector('.g-name').value;
      x.color = row.querySelector('.g-color').value;
      x.plannedMice = row.querySelector('.g-mice').value;
      x.isDefault = row.querySelector('input[name="cpDefaultDiet"]').checked;
    });
  },

  // "sum of this layer vs Total No of Animals" hint, shared by both layers
  updateLayerSum(kind) {
    const box = this.el(kind === 'diet' ? 'cpDiets' : 'cpGroups');
    const out = this.el(kind === 'diet' ? 'cpDietSum' : 'cpGroupSum');
    if (!box || !out) return;
    let sum = 0; box.querySelectorAll('.g-mice').forEach(i => { sum += +i.value || 0; });
    const total = this.reqTotalMice();
    const ok = total && sum === total;
    const label = kind === 'diet' ? 'รวมหนูตามชนิดอาหาร' : 'รวมหนูในกลุ่ม';
    out.className = `req-sum ${total ? (ok ? 'ok' : 'warn') : ''}`;
    out.innerHTML = total
      ? `${label} <b>${sum}</b> / ${total} ตัว ${ok ? '✓' : (sum > total ? '· เกินจำนวนที่ระบุ' : '· ยังไม่ครบ')}`
      : `${label} <b>${sum}</b> ตัว`;
  },

  // every plain input of the protocol header → draft.meta (so a full re-render keeps them)
  captureReqMeta() {
    const m = this.draft.meta, v = id => this.el(id) ? this.el(id).value : undefined;
    const set = (key, id) => { const x = v(id); if (x !== undefined) m[key] = x; };
    set('name', 'cpName'); set('lotNo', 'cpLotNo'); set('protocolNo', 'cpProtocolNo'); set('pi', 'cpPI');
    set('species', 'cpSpecies'); set('strain', 'cpStrain');
    set('ageMin', 'cpAgeMin'); set('ageMax', 'cpAgeMax');
    set('weightMin', 'cpWMin'); set('weightMax', 'cpWMax');
    set('maleCount', 'cpMale'); set('femaleCount', 'cpFemale');
    set('objective', 'cpObjective');
    set('protocolEndpoint', 'cpProtoEnd'); set('humaneEndpoint', 'cpHumaneEnd');
    if (this.el('cpMale')) m.sexes = this.reqSexes();   // derived from the counts
  },

  renderReqGroups() {
    const rows = this.draft.groups.map((g, i) => `
      <div class="group-item">
        <div class="group-row">
          <input type="color" class="g-color" value="${g.color}" data-i="${i}">
          <input class="g-name" value="${g.name}" placeholder="ชื่อกลุ่ม" data-i="${i}">
          <input class="g-mice" type="number" min="0" max="9999" value="${g.plannedMice}" placeholder="จำนวน" data-i="${i}">
          <label class="g-ctrl"><input type="radio" name="cpControl" ${g.isControl ? 'checked' : ''} data-i="${i}"> Control</label>
          <button class="icon-btn g-del" data-i="${i}" title="ลบกลุ่ม" ${this.draft.groups.length <= 1 ? 'disabled' : ''}>🗑️</button>
        </div>
      </div>`).join('');
    this.el('cpGroups').innerHTML = rows;
    this.el('cpGroups').querySelectorAll('.g-del').forEach(btn => {
      btn.onclick = () => {
        this.captureReqGroups();
        this.draft.groups.splice(+btn.dataset.i, 1);
        if (!this.draft.groups.some(g => g.isControl) && this.draft.groups.length) this.draft.groups[0].isControl = true;
        this.renderReqGroups();
      };
    });
    this.el('cpGroups').querySelectorAll('.g-mice').forEach(inp => inp.addEventListener('input', () => this.updateLayerSum('group')));
    this.updateLayerSum('group');
  },

  // ---- แผนการใช้สัตว์ทดลอง: dated activity list -------------------------
  // Rows are kept sorted by date (earliest first); rows with no date yet sit at the
  // bottom until one is picked. Re-rendering is limited to date changes / add /
  // delete — typing in a detail box writes straight to the draft, so the caret and
  // the row order stay put while the user is mid-sentence.
  sortReqPlan() {
    this.draft.plan.sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99'));
  },
  // ---- เกณฑ์ Humane endpoint ในฟอร์มคำขอของ PI ----
  renderReqHumane(focusLast = false) {
    const d = this.draft;
    d.humane = d.humane || { criteria: [], ...this.DEFAULT_HUMANE };
    const box = this.el('cpHumane');
    if (!box) return;
    box.innerHTML = d.humane.criteria.map((c, i) => `
      <div class="hu-crit ${c.auto ? 'auto' : ''}" data-i="${i}">
        <div class="hu-head">
          <span class="hu-n">${i + 1}</span>
          <input class="hu-name" type="text" data-i="${i}" value="${this.esc(c.name)}"
                 placeholder="ชื่อเกณฑ์ เช่น Behavior and Physical appearance">
          ${c.auto === 'weight' ? '<span class="hu-auto" title="ระบบคิดคะแนนให้จากน้ำหนักที่ชั่ง">⚙️ ระบบคิดให้</span>' : ''}
          <button type="button" class="mini-btn danger hu-del" data-i="${i}"
                  ${d.humane.criteria.length <= this.MIN_HUMANE_CRITERIA ? 'disabled' : ''}>ลบ</button>
        </div>
        <div class="hu-levels">
          ${c.auto === 'weight' ? (() => {
            const raw = c.cuts || this.DEFAULT_WEIGHT_CUTS;
            const ca = raw[0], cb = raw[1];
            const bad = !(Math.round(+ca) >= 1 && Math.round(+cb) > Math.round(+ca) && Math.round(+cb) <= 100);
            return `
            <div class="hu-cuts">
              <span>ระบบคิดคะแนนจาก % ที่ลดจากน้ำหนักสูงสุด — กำหนดจุดตัดเป็นตัวเลข
                    คำอธิบายจะถูกสร้างตามให้เอง ข้อความกับการคำนวณจึงตรงกันเสมอ</span>
              <div class="hu-cutrow">
                <label>ลดน้อยกว่า</label>
                <input class="hu-cut ${bad ? 'bad' : ''}" type="number" min="1" max="100" step="1" data-i="${i}" data-c="0" value="${this.esc(ca)}">
                <label>% = 1 คะแนน · ถึง</label>
                <input class="hu-cut ${bad ? 'bad' : ''}" type="number" min="1" max="100" step="1" data-i="${i}" data-c="1" value="${this.esc(cb)}">
                <label>% = 2 · เกินกว่านั้น = 3</label>
              </div>
              ${bad ? '<div class="hu-cutwarn">ตัวเลขที่สองต้องมากกว่าตัวแรก และไม่เกิน 100 — คำอธิบายด้านล่างยังไม่ถูกต้องจนกว่าจะแก้</div>' : ''}
            </div>
            ${this.weightLevels(c).map((lv, k) => `
              <div class="hu-lv">
                <span class="hu-lvn s${k}">${k}</span>
                <span class="hu-lvauto">${this.esc(lv)}</span>
              </div>`).join('')}`;
          })() : c.levels.map((lv, k) => `
            <div class="hu-lv">
              <span class="hu-lvn s${k}">${k}</span>
              <input class="hu-lvtext" type="text" data-i="${i}" data-k="${k}" value="${this.esc(lv)}"
                     placeholder="อาการที่ถือว่าได้ ${k} คะแนน">
            </div>`).join('')}
        </div>
        ${c.other ? '<label class="hu-other"><input type="checkbox" class="hu-oth" data-i="${i}" checked> มีช่อง Other ให้ระบุเพิ่ม</label>'.replace('${i}', i) : `<label class="hu-other"><input type="checkbox" class="hu-oth" data-i="${i}"> มีช่อง Other ให้ระบุเพิ่ม</label>`}
      </div>`).join('');

    if (this.el('cpHumaneMax')) this.el('cpHumaneMax').textContent = `${d.humane.criteria.length * 3} คะแนน`;
    const add = this.el('cpAddHumane');
    if (add) add.disabled = d.humane.criteria.length >= this.MAX_HUMANE_CRITERIA;
    // แถวเกณฑ์น้ำหนักโผล่เฉพาะเมื่อยังมีข้อที่ให้ระบบคิดน้ำหนักอยู่
    const wl = this.el('cpWlRow');
    if (wl) wl.style.display = d.humane.criteria.some(c => c.auto === 'weight') ? '' : 'none';

    box.querySelectorAll('.hu-name, .hu-lvtext, .hu-oth').forEach(i =>
      i.addEventListener(i.type === 'checkbox' ? 'change' : 'input', () => this.captureReqHumane()));
    // แก้จุดตัดแล้ววาดใหม่ทันที เพื่อให้เห็นคำอธิบายที่ระบบสร้างเปลี่ยนตาม
    box.querySelectorAll('.hu-cut').forEach(i => i.addEventListener('change', () => {
      this.captureReqHumane(); this.renderReqHumane();
    }));
    box.querySelectorAll('.hu-del').forEach(b => b.onclick = () => {
      this.captureReqHumane(); d.humane.criteria.splice(+b.dataset.i, 1); this.renderReqHumane();
    });
    if (focusLast) { const last = box.querySelector('.hu-crit:last-child .hu-name'); if (last) last.focus(); }
  },
  captureReqHumane() {
    const d = this.draft, box = this.el('cpHumane');
    if (!box || !d.humane) return;
    box.querySelectorAll('.hu-name').forEach(i => { d.humane.criteria[+i.dataset.i].name = i.value; });
    box.querySelectorAll('.hu-lvtext').forEach(i => { d.humane.criteria[+i.dataset.i].levels[+i.dataset.k] = i.value; });
    box.querySelectorAll('.hu-oth').forEach(i => { d.humane.criteria[+i.dataset.i].other = i.checked; });
    box.querySelectorAll('.hu-cut').forEach(i => {
      const c = d.humane.criteria[+i.dataset.i];
      c.cuts = c.cuts ? [...c.cuts] : [...this.DEFAULT_WEIGHT_CUTS];
      c.cuts[+i.dataset.c] = i.value;
    });
    const th = this.el('cpHumaneTh'); if (th) d.humane.totalThreshold = th.value;
    const wl = this.el('cpHumaneWl'); if (wl) d.humane.weightLossPct = wl.value;
    const nt = this.el('cpHumaneNote'); if (nt) d.humane.note = nt.value;
  },

  renderReqPlan(focusLast = false) {
    this.sortReqPlan();
    const esc = v => (v || '').replace(/"/g, '&quot;');
    const rows = this.draft.plan.map((it, i) => `
      <div class="plan-item" data-i="${i}" data-k="${it._id || ''}">
        <button type="button" class="date-chip plan-date" data-i="${i}" aria-haspopup="dialog"
                aria-label="วันที่ของรายการที่ ${i + 1}${it.date ? ' — ' + this.thaiDate(it.date) : ''}">
          <span class="pd-ico">📅</span>
          <span class="pd-text ${it.date ? '' : 'empty'}">${it.date ? this.thaiDate(it.date) : 'เลือกวันที่'}</span>
        </button>
        <textarea class="plan-detail" data-i="${i}" rows="2" placeholder="รายละเอียดของรายการนี้ เช่น เริ่มให้สารทดสอบ · เก็บตัวอย่างเลือด">${it.detail || ''}</textarea>
        <button class="icon-btn plan-del" data-i="${i}" title="ลบรายการ" aria-label="ลบรายการ">🗑️</button>
      </div>`).join('') || '<p class="empty-note">ยังไม่มีรายการ — กด “+ เพิ่มรายการ” เพื่อเริ่มวางแผน</p>';
    const box = this.el('cpPlan');
    box.innerHTML = rows;

    // picking a date re-sorts the list — slide the rows so the one that moved is followed
    const openPicker = (btn) => this.openThaiCalendar(btn, this.draft.plan[+btn.dataset.i].date, (v) => {
      this.draft.plan[+btn.dataset.i].date = v;
      this.flipReorder(box, 'data-k', () => this.renderReqPlan());
    });
    box.querySelectorAll('.plan-date').forEach(btn => { btn.onclick = () => openPicker(btn); });
    box.querySelectorAll('.plan-detail').forEach(t => {
      t.addEventListener('input', () => { this.draft.plan[+t.dataset.i].detail = t.value; });
    });
    box.querySelectorAll('.plan-del').forEach(b => {
      b.onclick = () => {
        this.draft.plan.splice(+b.dataset.i, 1);
        this.flipReorder(box, 'data-k', () => this.renderReqPlan());   // rows below close the gap
      };
    });
    // a freshly added row has no date, so it is always last — drop its picker open
    if (focusLast) { const last = box.querySelector('.plan-item:last-child .plan-date'); if (last) openPicker(last); }
  },

  // ---- เอกสารเพิ่มเติม: PI แนบได้ไม่จำกัด (นอกเหนือจาก 3 ฉบับที่บังคับ) ----
  renderReqExtraDocs() {
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const rows = (this.draft.extraDocs || []).map((x, i) => `
      <div class="xdoc-item" data-i="${i}">
        <input class="xdoc-label" data-i="${i}" placeholder="ชื่อเอกสาร เช่น SOP การให้สาร" value="${esc(x.label)}">
        <div class="xdoc-slot">${x.file
          ? `<span class="rf-name">📎 ${x.file.name}</span><button type="button" class="mini-btn danger xdoc-unfile" data-i="${i}">เอาไฟล์ออก</button>`
          : `<label class="btn btn-sm rf-pick">เลือกไฟล์<input type="file" class="xdoc-file" data-i="${i}" hidden></label>`}</div>
        <button class="icon-btn xdoc-del" data-i="${i}" title="ลบรายการ" aria-label="ลบรายการ">🗑️</button>
      </div>`).join('') || '<p class="empty-note">ยังไม่มีเอกสารเพิ่มเติม</p>';
    const box = this.el('cpExtraDocs');
    if (!box) return;
    box.innerHTML = rows;
    // typing the label must NOT re-render (caret) — write straight to the draft
    box.querySelectorAll('.xdoc-label').forEach(i => i.addEventListener('input', () => {
      this.draft.extraDocs[+i.dataset.i].label = i.value;
    }));
    box.querySelectorAll('.xdoc-file').forEach(inp => inp.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      this.draft.extraDocs[+inp.dataset.i].file = { name: f.name, url: URL.createObjectURL(f), size: f.size };
      this.renderReqExtraDocs();
    });
    box.querySelectorAll('.xdoc-unfile').forEach(b => b.onclick = () => {
      this.draft.extraDocs[+b.dataset.i].file = null; this.renderReqExtraDocs();
    });
    box.querySelectorAll('.xdoc-del').forEach(b => b.onclick = () => {
      this.draft.extraDocs.splice(+b.dataset.i, 1); this.renderReqExtraDocs();
    });
  },

  captureReqGroups() {
    const c = this.el('cpGroups');
    if (!c) return;
    c.querySelectorAll('.group-item').forEach((row, i) => {
      if (!this.draft.groups[i]) return;
      this.draft.groups[i].name = row.querySelector('.g-name').value;
      this.draft.groups[i].color = row.querySelector('.g-color').value;
      this.draft.groups[i].plannedMice = row.querySelector('.g-mice').value;
      this.draft.groups[i].isControl = row.querySelector('input[name="cpControl"]').checked;
    });
  },


  renderReqPeople() {
    const staff = DB.users.filter(u => u.position !== 'ADMIN');
    const esc = v => (v || '').replace(/"/g, '&quot;');
    const rows = this.draft.appointments.map((a, i) => {
      const isNew = a.userId === '__new__';
      // for a person without an account, collect the FULL account structure
      // (first/last/email) — AV only needs to set a password when confirming.
      const newFields = isNew ? `
        <div class="rp-new">
          <div class="rp-new-hd">ข้อมูลบัญชีใหม่ — สัตวแพทย์จะตั้งรหัสผ่านให้ตอนสร้างโครงการ</div>
          <div class="rp-new-grid">
            <input class="rp-first" data-i="${i}" placeholder="ชื่อ *" value="${esc(a.firstName)}">
            <input class="rp-last" data-i="${i}" placeholder="สกุล" value="${esc(a.lastName)}">
            <input class="rp-email" data-i="${i}" type="email" placeholder="อีเมล *" value="${esc(a.email)}">
          </div>
        </div>` : '';
      return `
      <div class="req-person ${isNew ? 'has-new' : ''}" data-i="${i}">
        <div class="rp-row">
          <select class="rp-role" data-i="${i}">
            <option value="COPI" ${a.role === 'COPI' ? 'selected' : ''}>CoPI — นักวิจัยร่วม</option>
            <option value="AHS" ${a.role === 'AHS' ? 'selected' : ''}>AHS — นักวิจัยปฏิบัติการ</option>
          </select>
          <select class="rp-user" data-i="${i}">
            <option value="">— เลือกบุคลากรที่มีบัญชีแล้ว —</option>
            ${staff.map(u => `<option value="${u.id}" ${a.userId === u.id ? 'selected' : ''}>${u.name} · ${u.email}</option>`).join('')}
            <option value="__new__" ${isNew ? 'selected' : ''}>➕ ยังไม่มีบัญชี — กรอกข้อมูลใหม่</option>
          </select>
          <button class="icon-btn rp-del" data-i="${i}" title="ลบ">🗑️</button>
        </div>
        ${newFields}
      </div>`;
    }).join('') || '<p class="empty-note">ยังไม่ได้ร้องขอแต่งตั้งใคร</p>';
    this.el('cpPeople').innerHTML = rows;
    this.el('cpPeople').querySelectorAll('.rp-role').forEach(s => s.onchange = () => { this.captureReqPeople(); });
    this.el('cpPeople').querySelectorAll('.rp-user').forEach(s => s.onchange = () => { this.captureReqPeople(); this.renderReqPeople(); });
    this.el('cpPeople').querySelectorAll('.rp-del').forEach(b => b.onclick = () => { this.captureReqPeople(); this.draft.appointments.splice(+b.dataset.i, 1); this.renderReqPeople(); });
  },

  captureReqPeople() {
    const c = this.el('cpPeople'); if (!c) return;
    c.querySelectorAll('.req-person').forEach((row, i) => {
      const a = this.draft.appointments[i]; if (!a) return;
      a.role = row.querySelector('.rp-role').value;
      a.userId = row.querySelector('.rp-user').value;
      if (a.userId === '__new__') {
        // the new-account inputs may not be rendered yet (this capture runs right
        // after the dropdown changes to __new__, before the re-render) — keep any
        // existing values in that case so the fields aren't wiped.
        const first = row.querySelector('.rp-first'), last = row.querySelector('.rp-last'), email = row.querySelector('.rp-email');
        if (first) a.firstName = first.value.trim();
        if (last) a.lastName = last.value.trim();
        if (email) a.email = email.value.trim();
        a.name = `${a.firstName || ''} ${a.lastName || ''}`.trim();
      } else {
        a.name = DB.users.find(u => u.id === a.userId)?.name || '';
      }
    });
  },

  // short, human-readable project id (P1, P2, …) — used as the prefix of every
  // mouse identity code, so it must stay compact (never a timestamp)
  nextProjectId() {
    const nums = DB.projects.map(p => { const m = /^P(\d+)$/.exec(p.id || ''); return m ? +m[1] : 0; });
    return 'P' + ((nums.length ? Math.max(...nums) : 0) + 1);
  },

  // build a brand-new mouse (single starting weight today, no history)
  // `weight` is the reading Sci takes at intake (first weighing). Omit it only for
  // demo/seed rows that have no real measurement.
  freshMouse(code, sex = 'M', groupNo = null, cageNo = null, weight = null) {
    return {
      id: 'M' + Math.random().toString(36).slice(2, 9),
      code, sex, groupNo, cageNo,
      weights: [{ date: this.recDate(), weight: weight != null ? weight : Math.round((25 + rand(-2, 2)) * 10) / 10, ...this.recStamp() }],
      remark: '', treatments: [], excluded: false, alive: true, death: null, careOpen: false, flagOpen: false, flag: null, humaneOrder: null, necropsy: null, doses: [], health: [],
    };
  },

  // submit (or resubmit) the PI request → project enters the AEC queue
  submitCreateProject() {
    if (!this.can('createProject')) { this.toast('คุณไม่มีสิทธิ์ยื่นขอสร้างโครงการ'); return this.go(this.homeRoute()); }
    this.captureReqMeta();
    this.captureReqDiets();
    this.captureReqGroups();
    this.captureReqHumane();
    this.captureReqPeople();
    const d = this.draft, m = d.meta;
    const name = (m.name || '').trim();
    const objective = (m.objective || '').trim();
    const maleCount = +m.maleCount || 0, femaleCount = +m.femaleCount || 0;
    const totalMice = maleCount + femaleCount;
    if (!name) { this.el('cpName').focus(); this.toast('กรุณากรอกชื่อโครงการ'); return; }
    if (!totalMice) { (this.el('cpMale') || this.el('cpFemale'))?.focus(); this.toast('กรุณาระบุจำนวนสัตว์ทดลองอย่างน้อย 1 เพศ'); return; }
    if (m.approvedDate && m.untilDate && m.untilDate < m.approvedDate) { this.toast('วันที่ Until ต้องไม่ก่อนวันที่ Approved'); return; }
    const wMin = m.weightMin === '' ? null : +m.weightMin, wMax = m.weightMax === '' ? null : +m.weightMax;
    if (wMin != null && wMax != null && wMax < wMin) { this.el('cpWMax').focus(); this.toast('น้ำหนักสูงสุดต้องไม่น้อยกว่าน้ำหนักต่ำสุด'); return; }
    const aMin = m.ageMin === '' ? null : +m.ageMin, aMax = m.ageMax === '' ? null : +m.ageMax;
    if (aMin != null && aMax != null && aMax < aMin) { this.el('cpAgeMax').focus(); this.toast('อายุสูงสุดต้องไม่น้อยกว่าอายุต่ำสุด'); return; }
    if (d.diets.some(x => !x.name.trim())) { this.toast('กรุณาตั้งชื่อให้ครบทุกชนิดอาหาร'); return; }
    if (!d.diets.some(x => x.isDefault)) d.diets[0].isDefault = true;
    if (d.groups.some(g => !g.name.trim())) { this.toast('กรุณาตั้งชื่อให้ครบทุกกลุ่ม'); return; }
    if (!d.groups.some(g => g.isControl)) d.groups[0].isControl = true;
    // แผนการใช้สัตว์ทดลอง — drop rows the user left completely blank, but a row that
    // has a detail must carry a date (it is the thing the plan is sorted by)
    d.plan = (d.plan || []).filter(x => (x.date || '') || (x.detail || '').trim());
    if (d.plan.some(x => !x.date)) { this.toast('กรุณาเลือกวันที่ให้ครบทุกรายการในแผนการใช้สัตว์ทดลอง'); this.renderReqPlan(); return; }
    if (d.plan.some(x => !(x.detail || '').trim())) { this.toast('กรุณากรอกรายละเอียดให้ครบทุกรายการในแผนการใช้สัตว์ทดลอง'); this.renderReqPlan(); return; }
    this.sortReqPlan();
    // เกณฑ์ตรวจสุขภาพ — อย่างน้อย MIN ข้อ ตั้งชื่อครบ และเกณฑ์รวมต้องอยู่ในช่วงที่เป็นไปได้
    const hu = d.humane;
    hu.criteria = (hu.criteria || []).filter(c => (c.name || '').trim() || c.levels.some(l => (l || '').trim()));
    if (hu.criteria.length < this.MIN_HUMANE_CRITERIA) {
      this.toast(`เกณฑ์ Humane endpoint ต้องมีอย่างน้อย ${this.MIN_HUMANE_CRITERIA} ข้อ`); this.renderReqHumane(); return;
    }
    if (hu.criteria.some(c => !(c.name || '').trim())) {
      this.toast('กรุณาตั้งชื่อเกณฑ์ให้ครบทุกข้อ'); this.renderReqHumane(); return;
    }
    const blankLv = hu.criteria.find(c => !c.auto && (c.levels || []).some(l => !(l || '').trim()));
    if (blankLv) {
      this.toast(`กรุณากรอกนิยามให้ครบทั้ง 4 ระดับของ "${blankLv.name.trim()}"`); this.renderReqHumane(); return;
    }
    const badCut = hu.criteria.find(c => {
      if (c.auto !== 'weight') return false;
      const a = Math.round(+(c.cuts || [])[0]), b = Math.round(+(c.cuts || [])[1]);
      return !Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b <= a || b > 100;
    });
    if (badCut) {
      this.toast('จุดตัด % ของเกณฑ์น้ำหนักต้องเรียงจากน้อยไปมาก และอยู่ระหว่าง 1–100');
      this.renderReqHumane(); return;
    }
    const hMax = hu.criteria.length * 3;
    const hTh = Math.round(+hu.totalThreshold);
    if (!Number.isFinite(hTh) || hTh < 1 || hTh > hMax) {
      this.el('cpHumaneTh')?.focus();
      this.toast(`เกณฑ์คะแนนรวมต้องอยู่ระหว่าง 1 ถึง ${hMax}`); return;
    }
    const hWl = Math.round(+hu.weightLossPct);
    if (hu.criteria.some(c => c.auto === 'weight') && (!Number.isFinite(hWl) || hWl < 1 || hWl > 100)) {
      this.el('cpHumaneWl')?.focus();
      this.toast('เกณฑ์น้ำหนักที่ลดต้องอยู่ระหว่าง 1–100%'); return;
    }
    // validate requested appointments — an existing user must be picked, or a new
    // account must have a full name + a valid, unique email (AV adds the password)
    for (const a of d.appointments) {
      if (!a.userId) { this.toast('กรุณาเลือกบุคลากรหรือกรอกข้อมูลบัญชีใหม่ให้ครบ'); return; }
      if (a.userId === '__new__') {
        if (!a.firstName) { this.toast('กรุณากรอกชื่อผู้ที่ขอแต่งตั้ง'); return; }
        if (!/^\S+@\S+\.\S+$/.test(a.email || '')) { this.toast(`อีเมลของ "${a.firstName}" ไม่ถูกต้อง`); return; }
        const dup = DB.users.some(u => u.email.toLowerCase() === a.email.toLowerCase())
          || d.appointments.filter(x => x.userId === '__new__').some((x, idx, arr) => x.email.toLowerCase() === a.email.toLowerCase() && arr.indexOf(x) !== idx);
        if (dup) { this.toast(`อีเมล ${a.email} ถูกใช้แล้ว`); return; }
      }
    }

    const request = {
      lotNo: (m.lotNo || '').trim(),
      protocolNo: (m.protocolNo || '').trim(),
      pi: (m.pi || '').trim(),
      approvedDate: m.approvedDate || '', untilDate: m.untilDate || '',
      species: (m.species || '').trim(), strain: (m.strain || '').trim(),
      sexes: [...m.sexes], ageMin: aMin, ageMax: aMax,
      weightMin: wMin, weightMax: wMax,
      maleCount, femaleCount, totalMice,
      objective,
      protocolEndpoint: (m.protocolEndpoint || '').trim(),
      humaneEndpoint: (m.humaneEndpoint || '').trim(),
      diets: d.diets.map(x => ({ name: x.name.trim(), isDefault: x.isDefault, color: x.color, plannedMice: +x.plannedMice || 0 })),
      groups: d.groups.map(g => ({ name: g.name.trim(), isControl: g.isControl, color: g.color, plannedMice: +g.plannedMice || 0 })),
      plan: d.plan.map(x => ({ date: x.date, detail: x.detail.trim() })),
      humaneScore: {
        criteria: hu.criteria.map(c => c.auto === 'weight'
          ? { name: c.name.trim(), auto: 'weight', other: !!c.other,
              cuts: [Math.round(+c.cuts[0]), Math.round(+c.cuts[1])] }
          : { name: c.name.trim(), auto: null, other: !!c.other, levels: c.levels.map(l => l.trim()) }),
        totalThreshold: hTh, weightLossPct: hWl, note: (hu.note || '').trim(),
      },
      diagram: d.diagram, aup: d.aup, approvalDoc: d.approvalDoc,
      extraDocs: (d.extraDocs || []).filter(x => x.file).map(x => ({ label: (x.label || '').trim() || x.file.name, file: x.file })),
      appointments: d.appointments.map(a => a.userId === '__new__'
        ? { role: a.role, userId: '__new__', firstName: a.firstName, lastName: a.lastName || '', email: a.email, name: `${a.firstName} ${a.lastName || ''}`.trim() }
        : { role: a.role, userId: a.userId, name: DB.users.find(u => u.id === a.userId)?.name || a.name }),
    };

    if (d.editId) {
      const p = Data.getProject(d.editId);
      Object.assign(p, { name, description: objective || '—', request });
      this.resubmitProject(p);
      this.draft = null;
      return this.go('projects');
    }

    const pid = this.nextProjectId();
    DB.projects.push({
      id: pid, name, description: objective || '—', startDate: todayISO(),
      status: 'active', createdBy: this.user.id, approval: 'requested',
      requestDate: todayISO(), request, facility: null,
      shelves: 0, cagesPerShelf: 0, groups: [], cages: [], documents: [],
      members: [{ userId: this.user.id, roles: ['PI'] }],
    });
    this.log('ยื่นคำขอสร้างโครงการ', `${name} · ${totalMice} ตัว · ${request.groups.length} กลุ่ม`, name);
    // A1 — the ethics office has something to review; the vet just needs to know
    const newP = DB.projects[DB.projects.length - 1];
    this.notify({ kind: 'request', title: 'มีคำขอสร้างโครงการใหม่ รอตรวจ',
      detail: `${name} · สัตว์ทดลอง ${totalMice} ตัว`, project: newP,
      to: [...this.nTo.position('AEC'), ...this.nTo.position('AV')],
      link: { type: 'projectInfo' } });
    this.draft = null;
    this.toast(`ยื่นคำขอ "${name}" แล้ว — รอสำนักเลขาฯ จริยธรรมตรวจสอบ`);
    this.go('projects');
  },

  // ---------------------------------------------------------
  // STAGE 3 — AV builds the approved request into a real project (cages, facility)
  // ---------------------------------------------------------
  buildProject(p) {
    const req = p.request || { groups: [] };
    // seed the build draft from the request; groups keep their planned colours +
    // the requested mouse count becomes the editable per-group capacity (the PI
    // cannot enter more mice than this when populating later).
    this.draft = {
      mode: 'build', buildId: p.id,
      facility: { roomNo: '', rackNo: '', quarantineDate: '', moveInDate: todayISO(), ...(p.facility || {}) },
      // ชั้นที่ 1 — ชนิดอาหาร (PI เสนอมาในคำขอ, AV ยืนยัน). ถ้าคำขอไม่ได้ระบุ ให้ตั้ง "อาหารทั่วไป" ไว้เป็นค่าเริ่มต้น
      diets: ((req.diets && req.diets.length) ? req.diets : [{ name: 'อาหารทั่วไป', isDefault: true, plannedMice: req.totalMice || 1 }])
        .map((x, i) => ({
          name: x.name, color: x.color || this.DIET_PALETTE[i % this.DIET_PALETTE.length],
          isDefault: !!x.isDefault, desc: '', capacity: x.plannedMice || 1,
        })),
      // ชั้นที่ 2 — กลุ่มทดสอบ
      groups: (req.groups || []).map((g, i) => ({
        name: g.name, color: g.color || this.GROUP_PALETTE[i % this.GROUP_PALETTE.length],
        isControl: g.isControl, desc: '', capacity: g.plannedMice || 1,
      })),
      // shelves are added one by one; each holds an independent list of (empty) cages,
      // so different shelves may carry different numbers of cages. No default numbers —
      // AV fills the shelf number + every cage code by hand.
      // ชั้นเก็บแบบ flat แต่ทุกชั้นสังกัด "แร็ค" — โครงการหนึ่งมีได้หลายแร็ค
      // และหน้าแดชบอร์ดจะวางแร็คถัดไปไว้ด้านล่างพร้อมเส้นแบ่งหนา
      shelves: [{ no: '', rack: '', cages: [{ code: '' }] }],
      // ข้อกำหนดการสิ้นสุด — the vet owns these (they left the PI request form);
      // seeded from whatever the request already carried.
      protocolEndpoint: req.protocolEndpoint || '',
      humaneEndpoint: req.humaneEndpoint || '',
      appointments: [],   // VET / SCI / ACT appointed from internal staff
      // password AV sets for each requested new-account person, keyed by email
      newPasswords: {},
    };
    this.go('build', p.id);
  },

  renderBuildProject() {
    const p = Data.getProject(this.route.projectId);
    if (!p) return this.go('projects');
    if (!this.canBuild) { this.toast('เฉพาะสัตวแพทย์ (AV) เท่านั้น'); return this.go('projects'); }
    if (this.approvalStage(p) !== 'aec_ok' && this.approvalStage(p) !== 'approved') {
      this.toast('โครงการนี้ยังไม่ผ่านการตรวจจริยธรรม'); return this.go('projects');
    }
    if (!this.draft || this.draft.mode !== 'build' || this.draft.buildId !== p.id) this.buildProject(p);
    // drafts made before multi-rack: give every shelf the project's single rack
    (this.draft.shelves || []).forEach(sh => { if (sh.rack === undefined) sh.rack = ''; });
    const d = this.draft, req = p.request || {};
    const f = d.facility;
    const plannedSummary = (req.groups || []).map(g => `${g.name} ${g.plannedMice}`).join(' · ');

    this.shell(
      `<a data-nav="build" data-project-id="${p.id}">จัดสรรพื้นที่</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>สร้างโครงการ & จัดสรรพื้นที่ — ${p.name}</h2>
            <div class="desc">ยืนยันรายการกลุ่มทดลองทั้ง 2 ชั้นตามที่ผู้วิจัยเสนอ กำหนดสถานที่ และสร้างกรง (เว้นว่างไว้) — กดสร้างแล้วโครงการจะเริ่มทันที รอนักวิทยาศาสตร์ชั่งหนูเข้ากรง</div></div>
        </div>

        <div class="create-flow">
          <span class="cf-step done">1 · ผู้วิจัยยื่นคำขอ</span><span class="cf-arrow">→</span>
          <span class="cf-step done">2 · จริยธรรมตรวจ</span><span class="cf-arrow">→</span>
          <span class="cf-step on">3 · สัตวแพทย์สร้างโครงการ</span>
        </div>

        <div class="req-recap">📋 คำขอ: หนู <b>${req.totalMice || '—'}</b> ตัว · ${req.groups ? req.groups.length : 0} กลุ่ม (${plannedSummary || '—'})
          <button class="btn btn-sm" id="bpViewReq" style="margin-left:auto">ดูรายละเอียดคำขอ</button></div>

        <div class="create-wrap">
          <div class="form-card">
            <div class="form-card-title">ข้อมูลสถานที่และการรับสัตว์</div>
            <div class="fgrid">
              <div class="field"><label for="bpRoom">เลขห้องปฏิบัติการ (Room)</label><input id="bpRoom" value="${(f.roomNo || '').replace(/"/g, '&quot;')}" placeholder="เช่น AR01"></div>
              <div class="field"><label>เลขชั้นวาง/แร็ค (Rack)</label>
                <div class="rack-note">กำหนดในหัวข้อ <b>ผังกรง</b> ด้านล่าง — โครงการหนึ่งมีได้หลายแร็ค</div></div>
              <div class="field"><label>วันที่รับเข้ากักกันโรค</label>${this.dateChip('bpQuar', f.quarantineDate, 'เลือกวันที่')}</div>
              <div class="field"><label>วันที่ย้ายเข้าห้องทดลอง</label>${this.dateChip('bpMove', f.moveInDate, 'เลือกวันที่')}</div>
            </div>
          </div>

          <div class="form-card">
            <div class="form-card-title">ชนิดอาหาร <span class="fc-layer">ชั้นที่ 1</span>
              <button class="btn btn-ghost btn-sm" id="bpAddDiet" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มชนิดอาหาร</button>
            </div>
            <p class="empty-note" style="margin-top:0">ยืนยันรายการชนิดอาหารที่ผู้วิจัยเสนอมา · ติ๊ก <b>ค่าเริ่มต้น</b> ให้อาหารทั่วไป — กรงที่ผู้วิจัยยังไม่กำหนดจะใช้อาหารนี้</p>
            <div id="cpDiets"></div>
            <div class="req-sum" id="bpDietSum"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">กลุ่มทดสอบ <span class="fc-layer">ชั้นที่ 2</span>
              <button class="btn btn-ghost btn-sm" id="bpAddGroup" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มกลุ่ม</button>
            </div>
            <p class="empty-note" style="margin-top:0">กำหนด <b>จำนวนหนูสูงสุดต่อกลุ่ม</b> — ผู้วิจัยจะจัดกรงเข้ากลุ่มได้ไม่เกินจำนวนนี้ (ตั้งต้นจากคำขอ)</p>
            <div id="cpGroups"></div>
            <div class="req-sum" id="bpCapSum"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">ข้อกำหนดการสิ้นสุดการทดลอง</div>
            <p class="empty-note" style="margin-top:0">สัตวแพทย์เป็นผู้กำหนด · ตั้งต้นจากที่ผู้วิจัยระบุมาในคำขอ (ถ้ามี)</p>
            <div class="fc-sub">Protocol endpoint</div>
            <textarea id="bpProtoEnd" rows="2" placeholder="เงื่อนไขที่ถือว่าการทดลองสิ้นสุดตามแผน">${d.protocolEndpoint || ''}</textarea>
            <div class="fc-sub">Humane endpoint</div>
            <textarea id="bpHumaneEnd" rows="3" placeholder="สภาวะของสัตว์ที่ถือว่าทำการทดลองต่อไม่ได้ ต้องทำการุณยฆาต (euthanasia)">${d.humaneEndpoint || ''}</textarea>
          </div>

          <div class="form-card">
            <div class="form-card-title">ผังกรง (สร้างกรงเปล่า)
              <button class="btn btn-ghost btn-sm" id="bpAddRack" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่มแร็ค</button>
            </div>
            <p class="empty-note" style="margin-top:0">โครงการหนึ่งมีได้หลายแร็ค · แต่ละแร็คเพิ่มชั้นได้อิสระ และแต่ละชั้นมีจำนวนกรงไม่เท่ากันได้ (สูงสุด ${this.MAX_CAGES_PER_ROW} กรงต่อแถว) · ตั้งเลขแร็ค เลขชั้น และรหัสกรงเองได้ · กรงจะถูกเว้นว่างไว้ รอนักวิทยาศาสตร์ชั่งหนูเข้า</p>
            <div id="cpGrid" class="build-shelves"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">ทีมวิจัยตามคำขอ (CoPI / AHS)</div>
            <p class="empty-note" style="margin-top:0">ผู้ที่มีบัญชีแล้วจะถูกแต่งตั้งอัตโนมัติ · สำหรับผู้ที่ <b>ยังไม่มีบัญชี</b> กรุณาตั้งรหัสผ่านเพื่อเปิดบัญชีและยืนยัน</p>
            <div id="bpRequested"></div>
          </div>

          <div class="form-card">
            <div class="form-card-title">แต่งตั้งเจ้าหน้าที่ประจำโครงการ
              <button class="btn btn-ghost btn-sm" id="bpAddStaff" style="margin-left:auto"><span class="ico-plus">+</span> เพิ่ม</button>
            </div>
            <p class="empty-note" style="margin-top:0">แต่งตั้ง <b>VET · Sci · ACT</b> ประจำโครงการ เลือกจากบุคลากรภายในของแต่ละตำแหน่ง</p>
            <div id="bpStaff"></div>
          </div>

          <div class="create-actions">
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-danger" id="bpReject">✗ ตีกลับ</button>
            <button class="btn" data-nav="projects">ยกเลิก</button>
            <button class="btn btn-primary" id="bpCreate">✓ สร้างกรง & ส่งต่อผู้วิจัย</button>
          </div>
        </div>
      </div>`
    );

    this.renderBuildDiets();
    this.renderBuildGroups();
    this.renderCageEditor();
    this.renderRequestedTeam(p);
    this.renderBuildStaff();

    // facility dates use the app's Thai calendar, like every other date in the app
    [['bpQuar', 'quarantineDate'], ['bpMove', 'moveInDate']].forEach(([id, key]) => {
      const btn = this.el(id);
      btn.onclick = () => this.openThaiCalendar(btn, d.facility[key], (v) => {
        d.facility[key] = v;
        this.setDateChip(btn, v, 'เลือกวันที่');
      });
    });

    this.el('bpAddDiet').onclick = () => { this.captureBuildDiets(); const i = d.diets.length; d.diets.push({ name: '', color: this.DIET_PALETTE[i % this.DIET_PALETTE.length], isDefault: false, desc: '', capacity: 1 }); this.renderBuildDiets(); };
    this.el('bpAddGroup').onclick = () => { this.captureBuildGroups(); const i = d.groups.length; d.groups.push({ name: `Treatment-${i}`, color: this.GROUP_PALETTE[i % this.GROUP_PALETTE.length], isControl: false, desc: '', capacity: 1 }); this.renderBuildGroups(); };
    this.el('bpAddRack').onclick = () => {
      this.captureShelves();
      const used = [...new Set(d.shelves.map(sh => sh.rack))];
      d.shelves.push({ no: '', rack: `R${used.length + 1}`, cages: [{ code: '' }] });
      this.renderCageEditor();
    };
    this.el('bpAddStaff').onclick = () => { this.captureBuildStaff(); d.appointments.push({ role: 'VET', userId: '' }); this.renderBuildStaff(); };
    this.el('bpViewReq').onclick = () => this.openProjectInfo(p);
    this.el('bpReject').onclick = () => this.promptReject(p, 'av');
    this.el('bpCreate').onclick = () => this.submitBuildProject(p);
  },

  // read the shelf-number and cage-code inputs back into the draft (keeps focus-safe edits)
  captureShelves() {
    const c = this.el('cpGrid'); if (!c) return;
    c.querySelectorAll('.bs-shelf').forEach((row, si) => {
      const sh = this.draft.shelves[si]; if (!sh) return;
      const noInp = row.querySelector('.bs-shelf-no'); if (noInp) sh.no = noInp.value;
      row.querySelectorAll('.bs-cage-code').forEach((inp, ci) => { if (sh.cages[ci]) sh.cages[ci].code = inp.value; });
    });
  },

  // add-rack / add-shelf / add-cage editor. Shelves are stored flat but each carries
  // a `rack` label; the editor groups them so a project with several racks reads the
  // same way the dashboard lays it out — rack after rack, top to bottom.
  renderCageEditor() {
    const d = this.draft;
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const totalCages = d.shelves.reduce((s, sh) => s + sh.cages.length, 0);
    const racks = [...new Set(d.shelves.map(sh => sh.rack || ''))];

    const shelfHtml = (sh, si) => {
      const over = sh.cages.length > this.MAX_CAGES_PER_ROW;
      const cages = sh.cages.map((cg, ci) => `
        <div class="bs-cage">
          <input class="bs-cage-code" data-si="${si}" data-ci="${ci}" value="${esc(cg.code)}" placeholder="รหัสกรง">
          <button class="icon-btn bs-cage-del" data-si="${si}" data-ci="${ci}" title="ลบกรง">✕</button>
        </div>`).join('');
      return `<div class="bs-shelf" data-si="${si}">
          <div class="bs-shelf-head">
            <span class="bs-shelf-tag">ชั้น</span>
            <input class="bs-shelf-no" data-si="${si}" value="${esc(sh.no)}" placeholder="เลขชั้น" title="เลขชั้น">
            <span class="bs-shelf-count${over ? ' over' : ''}">${sh.cages.length} กรง${over ? ` · เกิน ${this.MAX_CAGES_PER_ROW}` : ''}</span>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-ghost btn-sm bs-add-cage" data-si="${si}"><span class="ico-plus">+</span> เพิ่มกรง</button>
            <button class="icon-btn bs-shelf-del" data-si="${si}" title="ลบชั้น" ${d.shelves.length <= 1 ? 'disabled' : ''}>🗑️</button>
          </div>
          <div class="bs-cages">${cages || '<span class="empty-note">ยังไม่มีกรง — กด “เพิ่มกรง”</span>'}</div>
        </div>`;
    };

    const html = racks.map((rk, ri) => {
      const idxs = d.shelves.map((sh, si) => [sh, si]).filter(([sh]) => (sh.rack || '') === rk);
      const cageCount = idxs.reduce((n, [sh]) => n + sh.cages.length, 0);
      return `<div class="bs-rack" data-rack="${esc(rk)}">
          <div class="bs-rack-head">
            <span class="bs-rack-tag">แร็ค</span>
            <input class="bs-rack-no" data-ri="${ri}" value="${esc(rk)}" placeholder="เลขแร็ค เช่น R1" title="เลขแร็ค">
            <span class="bs-shelf-count">${idxs.length} ชั้น · ${cageCount} กรง</span>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-ghost btn-sm bs-add-shelf" data-ri="${ri}"><span class="ico-plus">+</span> เพิ่มชั้น</button>
            <button class="icon-btn bs-rack-del" data-ri="${ri}" title="ลบแร็คนี้ทั้งหมด" ${racks.length <= 1 ? 'disabled' : ''}>🗑️</button>
          </div>
          ${idxs.map(([sh, si]) => shelfHtml(sh, si)).join('')}
        </div>`;
    }).join('');

    this.el('cpGrid').innerHTML = html
      + `<div class="cpv-total">รวม ${racks.length} แร็ค · ${d.shelves.length} ชั้น · ${totalCages} กรง (กรงเปล่า)</div>`;

    const g = this.el('cpGrid');
    // live-capture text edits without re-render (keep caret)
    g.querySelectorAll('.bs-shelf-no').forEach(inp => inp.oninput = () => { d.shelves[+inp.dataset.si].no = inp.value; });
    g.querySelectorAll('.bs-cage-code').forEach(inp => inp.oninput = () => { d.shelves[+inp.dataset.si].cages[+inp.dataset.ci].code = inp.value; });
    // renaming a rack renames it on every shelf that belongs to it
    g.querySelectorAll('.bs-rack-no').forEach(inp => inp.oninput = () => {
      const from = racks[+inp.dataset.ri];
      d.shelves.forEach(sh => { if ((sh.rack || '') === from) sh.rack = inp.value; });
      racks[+inp.dataset.ri] = inp.value;
    });
    g.querySelectorAll('.bs-add-shelf').forEach(b => b.onclick = () => {
      this.captureShelves();
      const rk = racks[+b.dataset.ri];
      // insert right after the last shelf of that rack so the order stays grouped
      let at = d.shelves.length;
      for (let i = d.shelves.length - 1; i >= 0; i--) if ((d.shelves[i].rack || '') === rk) { at = i + 1; break; }
      d.shelves.splice(at, 0, { no: '', rack: rk, cages: [{ code: '' }] });
      this.renderCageEditor();
    });
    g.querySelectorAll('.bs-rack-del').forEach(b => b.onclick = () => {
      this.captureShelves();
      const rk = racks[+b.dataset.ri];
      this.draft.shelves = d.shelves.filter(sh => (sh.rack || '') !== rk);
      this.renderCageEditor();
    });
    g.querySelectorAll('.bs-add-cage').forEach(b => b.onclick = () => {
      this.captureShelves();
      const sh = d.shelves[+b.dataset.si];
      if (sh.cages.length >= this.MAX_CAGES_PER_ROW) { this.toast(`หนึ่งชั้นมีได้ไม่เกิน ${this.MAX_CAGES_PER_ROW} กรง`); return; }
      sh.cages.push({ code: '' });   // blank — AV types the code
      this.renderCageEditor();
    });
    g.querySelectorAll('.bs-cage-del').forEach(b => b.onclick = () => {
      this.captureShelves(); d.shelves[+b.dataset.si].cages.splice(+b.dataset.ci, 1); this.renderCageEditor();
    });
    g.querySelectorAll('.bs-shelf-del').forEach(b => b.onclick = () => {
      this.captureShelves(); d.shelves.splice(+b.dataset.si, 1); this.renderCageEditor();
    });
  },

  // ชั้นที่ 1 — ชนิดอาหาร. Same shape as the group editor, but the radio marks the
  // DEFAULT diet (the fallback for cages the PI has not assigned) instead of Control.
  renderBuildDiets() {
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const rows = this.draft.diets.map((x, i) => `
      <div class="layer-item${x.isDefault ? ' marked' : ''}" style="--layer:${x.color}">
        <div class="li-bar"></div>
        <div class="li-body">
          <div class="li-row">
            <label class="li-f li-swatch"><span class="li-lb">สี</span>
              <input type="color" class="d-color" value="${x.color}" data-i="${i}"></label>
            <label class="li-f li-grow"><span class="li-lb">ชื่อชนิดอาหาร</span>
              <input class="d-name" value="${esc(x.name)}" placeholder="เช่น ไขมันสูง" data-i="${i}"></label>
            <label class="li-f li-cap"><span class="li-lb">โควตาสูงสุด</span>
              <span class="li-cap-in"><input type="number" class="d-capacity" min="1" max="200" value="${x.capacity || 1}" data-i="${i}"><em>ตัว</em></span></label>
            <label class="li-mark"><input type="radio" name="cpDefaultDiet" ${x.isDefault ? 'checked' : ''} data-i="${i}"><span>ค่าเริ่มต้น</span></label>
            <button class="icon-btn d-del" data-i="${i}" title="ลบชนิดอาหาร" aria-label="ลบชนิดอาหาร" ${this.draft.diets.length <= 1 ? 'disabled' : ''}>🗑️</button>
          </div>
          <label class="li-f"><span class="li-lb">คำอธิบาย</span>
            <input class="d-desc" value="${esc(x.desc)}" placeholder="เช่น อาหารไขมันสูง 60% kcal" data-i="${i}"></label>
        </div>
      </div>`).join('');
    this.el('cpDiets').innerHTML = rows;
    this.el('cpDiets').querySelectorAll('.d-del').forEach(btn => btn.onclick = () => {
      this.captureBuildDiets(); this.draft.diets.splice(+btn.dataset.i, 1);
      if (!this.draft.diets.some(x => x.isDefault) && this.draft.diets.length) this.draft.diets[0].isDefault = true;
      this.renderBuildDiets();
    });
    // re-render on radio so the "ค่าเริ่มต้น" highlight moves with it
    this.el('cpDiets').querySelectorAll('input[name="cpDefaultDiet"]').forEach(r => r.onchange = () => { this.captureBuildDiets(); this.renderBuildDiets(); });
    // colour repaints the row's accent live — no re-render, the picker keeps focus
    this.el('cpDiets').querySelectorAll('.d-color').forEach(inp => inp.oninput = () => inp.closest('.layer-item').style.setProperty('--layer', inp.value));
    this.el('cpDiets').querySelectorAll('.d-capacity').forEach(inp => inp.oninput = () => { this.captureBuildDiets(); this.updateDietSum(); });
    this.updateDietSum();
  },

  captureBuildDiets() {
    const c = this.el('cpDiets'); if (!c) return;
    c.querySelectorAll('.layer-item').forEach((row, i) => {
      if (!this.draft.diets[i]) return;
      this.draft.diets[i].name = row.querySelector('.d-name').value;
      this.draft.diets[i].color = row.querySelector('.d-color').value;
      this.draft.diets[i].desc = row.querySelector('.d-desc').value;
      this.draft.diets[i].capacity = Math.max(1, Math.min(200, +row.querySelector('.d-capacity').value || 1));
      this.draft.diets[i].isDefault = row.querySelector('input[name="cpDefaultDiet"]').checked;
    });
  },

  updateDietSum() {
    const el = this.el('bpDietSum'); if (!el) return;
    const p = Data.getProject(this.draft && this.draft.buildId);
    const want = (p && p.request && +p.request.totalMice) || 0;
    const sum = (this.draft.diets || []).reduce((s, x) => s + (+x.capacity || 0), 0);
    const ok = want && sum === want;
    el.className = `req-sum ${want ? (ok ? 'ok' : 'warn') : ''}`;
    el.innerHTML = want
      ? `รวมโควตาทุกชนิดอาหาร <b>${sum}</b> / ${want} ตัวที่ผู้วิจัยขอ ${ok ? '✓' : (sum > want ? '· มากกว่าที่ขอ' : '· น้อยกว่าที่ขอ')}`
      : `รวมโควตาทุกชนิดอาหาร <b>${sum}</b> ตัว`;
  },

  renderBuildGroups() {
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    const rows = this.draft.groups.map((g, i) => `
      <div class="layer-item${g.isControl ? ' marked' : ''}" style="--layer:${g.color}">
        <div class="li-bar"></div>
        <div class="li-body">
          <div class="li-row">
            <label class="li-f li-swatch"><span class="li-lb">สี</span>
              <input type="color" class="g-color" value="${g.color}" data-i="${i}"></label>
            <label class="li-f li-grow"><span class="li-lb">ชื่อกลุ่มทดสอบ</span>
              <input class="g-name" value="${esc(g.name)}" placeholder="เช่น Low dose" data-i="${i}"></label>
            <label class="li-f li-cap"><span class="li-lb">โควตาสูงสุด</span>
              <span class="li-cap-in"><input type="number" class="g-capacity" min="1" max="200" value="${g.capacity || 1}" data-i="${i}"><em>ตัว</em></span></label>
            <label class="li-mark"><input type="radio" name="cpControl" ${g.isControl ? 'checked' : ''} data-i="${i}"><span>Control</span></label>
            <button class="icon-btn g-del" data-i="${i}" title="ลบกลุ่ม" aria-label="ลบกลุ่ม" ${this.draft.groups.length <= 1 ? 'disabled' : ''}>🗑️</button>
          </div>
          <label class="li-f"><span class="li-lb">คำอธิบาย</span>
            <input class="g-desc" value="${esc(g.desc)}" placeholder="เช่น ให้สารทดสอบขนาด 10 mg/kg" data-i="${i}"></label>
        </div>
      </div>`).join('');
    this.el('cpGroups').innerHTML = rows;
    this.el('cpGroups').querySelectorAll('.g-del').forEach(btn => btn.onclick = () => {
      this.captureBuildGroups(); this.draft.groups.splice(+btn.dataset.i, 1);
      if (!this.draft.groups.some(g => g.isControl) && this.draft.groups.length) this.draft.groups[0].isControl = true;
      this.renderBuildGroups();
    });
    this.el('cpGroups').querySelectorAll('input[name="cpControl"]').forEach(r => r.onchange = () => { this.captureBuildGroups(); this.renderBuildGroups(); });
    this.el('cpGroups').querySelectorAll('.g-color').forEach(inp => inp.oninput = () => inp.closest('.layer-item').style.setProperty('--layer', inp.value));
    // live "รวมโควตา vs จำนวนที่ผู้วิจัยขอ" — same idea as updateGroupSum on the request form
    this.el('cpGroups').querySelectorAll('.g-capacity').forEach(inp => inp.oninput = () => { this.captureBuildGroups(); this.updateCapSum(); });
    this.updateCapSum();
  },

  // hint under the group cards: does the sum of the capacities AV set match the
  // total the PI asked for? (a mismatch is allowed — AV may allocate less)
  updateCapSum() {
    const el = this.el('bpCapSum'); if (!el) return;
    const p = Data.getProject(this.draft && this.draft.buildId);
    const want = (p && p.request && +p.request.totalMice) || 0;
    const sum = (this.draft.groups || []).reduce((s, g) => s + (+g.capacity || 0), 0);
    const ok = want && sum === want;
    el.className = `req-sum ${want ? (ok ? 'ok' : 'warn') : ''}`;
    el.innerHTML = want
      ? `รวมโควตาทุกกลุ่ม <b>${sum}</b> / ${want} ตัวที่ผู้วิจัยขอ ${ok ? '✓' : (sum > want ? '· มากกว่าที่ขอ' : '· น้อยกว่าที่ขอ')}`
      : `รวมโควตาทุกกลุ่ม <b>${sum}</b> ตัว`;
  },

  captureBuildGroups() {
    const c = this.el('cpGroups'); if (!c) return;
    c.querySelectorAll('.layer-item').forEach((row, i) => {
      if (!this.draft.groups[i]) return;
      this.draft.groups[i].name = row.querySelector('.g-name').value;
      this.draft.groups[i].color = row.querySelector('.g-color').value;
      this.draft.groups[i].desc = row.querySelector('.g-desc').value;
      this.draft.groups[i].capacity = Math.max(1, Math.min(200, +row.querySelector('.g-capacity').value || 1));
      this.draft.groups[i].isControl = row.querySelector('input[name="cpControl"]').checked;
    });
  },

  renderBuildStaff() {
    const byRole = { VET: 'VET', SCI: 'SCI', ACT: 'ACT' };
    const pool = r => DB.users.filter(u => u.position === byRole[r]);
    const rows = this.draft.appointments.map((a, i) => `
      <div class="req-person" data-i="${i}">
        <select class="bs-role" data-i="${i}">
          <option value="VET" ${a.role === 'VET' ? 'selected' : ''}>VET — สัตวแพทย์</option>
          <option value="SCI" ${a.role === 'SCI' ? 'selected' : ''}>Sci — นักวิทยาศาสตร์</option>
          <option value="ACT" ${a.role === 'ACT' ? 'selected' : ''}>ACT — จนท.ดูแลสัตว์</option>
        </select>
        <select class="bs-user" data-i="${i}">
          <option value="">— เลือกบุคลากร ${a.role} —</option>
          ${pool(a.role).map(u => `<option value="${u.id}" ${a.userId === u.id ? 'selected' : ''}>${u.name}</option>`).join('')}
        </select>
        <button class="icon-btn bs-del" data-i="${i}" title="ลบ">🗑️</button>
      </div>`).join('') || '<p class="empty-note">ยังไม่ได้แต่งตั้งเจ้าหน้าที่ประจำโครงการ</p>';
    this.el('bpStaff').innerHTML = rows;
    this.el('bpStaff').querySelectorAll('.bs-role').forEach(s => s.onchange = () => { this.captureBuildStaff(); this.renderBuildStaff(); });
    this.el('bpStaff').querySelectorAll('.bs-user').forEach(s => s.onchange = () => this.captureBuildStaff());
    this.el('bpStaff').querySelectorAll('.bs-del').forEach(b => b.onclick = () => { this.captureBuildStaff(); this.draft.appointments.splice(+b.dataset.i, 1); this.renderBuildStaff(); });
  },

  captureBuildStaff() {
    const c = this.el('bpStaff'); if (!c) return;
    c.querySelectorAll('.req-person').forEach((row, i) => {
      const a = this.draft.appointments[i]; if (!a) return;
      a.role = row.querySelector('.bs-role').value;
      a.userId = row.querySelector('.bs-user').value;
    });
  },

  // the CoPI/AHS the PI requested: existing users are auto-appointed; a person
  // with no account yet gets a password field so AV can open the account here.
  renderRequestedTeam(p) {
    const reqs = (p.request?.appointments || []);
    if (!reqs.length) { this.el('bpRequested').innerHTML = '<p class="empty-note">คำขอนี้ไม่ได้ร้องขอแต่งตั้งใคร</p>'; return; }
    const rows = reqs.map((a, i) => {
      if (a.userId === '__new__') {
        return `<div class="bp-req new" data-email="${a.email}">
          <div class="bp-req-main"><span class="role-tag">${a.role}</span> <b>${a.name}</b> <span class="empty-note">· ${a.email} · ยังไม่มีบัญชี</span></div>
          <div class="bp-req-pw"><input type="text" class="bp-pw" data-email="${a.email}" placeholder="ตั้งรหัสผ่าน (≥6)" value="${this.draft.newPasswords[a.email] || ''}"></div>
        </div>`;
      }
      const u = DB.users.find(x => x.id === a.userId);
      return `<div class="bp-req"><div class="bp-req-main"><span class="role-tag">${a.role}</span> <b>${u ? u.name : a.name}</b> <span class="empty-note">· ${u ? u.email : ''} · แต่งตั้งอัตโนมัติ ✓</span></div></div>`;
    }).join('');
    this.el('bpRequested').innerHTML = rows;
    this.el('bpRequested').querySelectorAll('.bp-pw').forEach(inp => {
      inp.oninput = () => { this.draft.newPasswords[inp.dataset.email] = inp.value; };
    });
  },

  submitBuildProject(p) {
    this.captureBuildDiets();
    this.captureBuildGroups();
    this.captureShelves();
    this.captureBuildStaff();
    const d = this.draft;
    d.protocolEndpoint = this.el('bpProtoEnd').value.trim();
    d.humaneEndpoint = this.el('bpHumaneEnd').value.trim();
    if (!d.diets.length) { this.toast('ต้องมีชนิดอาหารอย่างน้อย 1 รายการ'); return; }
    if (d.diets.some(x => !(x.name || '').trim())) { this.toast('กรุณากรอกชื่อชนิดอาหารให้ครบ'); return; }
    if (d.groups.some(g => !(g.name || '').trim())) { this.toast('กรุณากรอกชื่อกลุ่มทดสอบให้ครบ'); return; }
    const dietNames = d.diets.map(x => x.name.trim());
    if (new Set(dietNames).size !== dietNames.length) { this.toast('ชื่อชนิดอาหารซ้ำกัน'); return; }
    const groupNames = d.groups.map(g => g.name.trim());
    if (new Set(groupNames).size !== groupNames.length) { this.toast('ชื่อกลุ่มทดสอบซ้ำกัน'); return; }
    const totalCages = d.shelves.reduce((s, sh) => s + sh.cages.length, 0);
    if (!totalCages) { this.toast('กรุณาสร้างกรงอย่างน้อย 1 กรง'); return; }
    if (d.shelves.some(sh => sh.cages.some(c => !(c.code || '').trim()))) { this.toast('กรุณากรอกรหัสกรงให้ครบทุกกรง'); return; }
    // รหัสกรงต้องไม่ซ้ำกันในโครงการ — เป็นตัวชี้ตำแหน่งที่คนใช้อ้างอิงหน้างาน
    const seenCodes = new Set();
    for (const sh of d.shelves) {
      for (const c of sh.cages) {
        const code = c.code.trim();
        if (seenCodes.has(code)) { this.toast(`รหัสกรง "${code}" ซ้ำกัน — ต้องไม่ซ้ำภายในโครงการ`); return; }
        seenCodes.add(code);
      }
    }
    const rackList = [...new Set(d.shelves.map(sh => (sh.rack || '').trim()))];
    if (rackList.some(r => !r)) { this.toast('กรุณากรอกเลขแร็คให้ครบทุกแร็ค'); return; }
    const overRow = d.shelves.find(sh => sh.cages.length > this.MAX_CAGES_PER_ROW);
    if (overRow) { this.toast(`ชั้น "${overRow.no || '—'}" มี ${overRow.cages.length} กรง — เกิน ${this.MAX_CAGES_PER_ROW} กรงต่อแถว`); return; }
    if (d.appointments.some(a => !a.userId)) { this.toast('กรุณาเลือกบุคลากรให้ครบทุกรายการที่แต่งตั้ง'); return; }
    if (!this.el('bpRoom').value.trim()) { this.el('bpRoom').focus(); this.toast('กรุณากรอกเลขห้องปฏิบัติการ'); return; }

    // open the accounts the PI requested for people who had none — AV sets the
    // password here; each new account is EXTERNAL and keeps its requested role.
    const requested = (p.request?.appointments || []);
    const newOnes = requested.filter(a => a.userId === '__new__');
    for (const a of newOnes) {
      const pw = (d.newPasswords[a.email] || '').trim();
      if (pw.length < 6) { this.toast(`ตั้งรหัสผ่านให้ "${a.name}" อย่างน้อย 6 ตัวอักษร`); return; }
    }
    // create them (email uniqueness was checked at request time)
    newOnes.forEach(a => {
      const nu = { id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        firstName: a.firstName, lastName: a.lastName || '', email: a.email,
        password: d.newPasswords[a.email].trim(), position: 'EXTERNAL', projectRole: null,
        name: a.name };
      DB.users.push(nu);
      a._createdId = nu.id;   // so we can appoint the fresh account below
      this.log('เปิดบัญชีผู้ใช้ (จากคำขอโครงการ)', `${nu.name} (${nu.email}) · EXTERNAL`, p.name);
    });

    // both layers carry a capacity (max mice) the PI cannot exceed when grouping cages
    const diets = d.diets.map((x, i) => ({ id: `${p.id}-D${i + 1}`, name: x.name.trim(), isDefault: !!x.isDefault, color: x.color, desc: (x.desc || '').trim(), capacity: x.capacity || 1 }));
    if (diets.length && !diets.some(x => x.isDefault)) diets[0].isDefault = true;   // always one fallback diet
    const groups = d.groups.map((g, i) => ({ id: `${p.id}-G${i + 1}`, name: g.name.trim(), isControl: g.isControl, color: g.color, desc: (g.desc || '').trim(), capacity: g.capacity || 1 }));
    // build EMPTY cages — no mice, no diet, no treatment group. Sci weighs the mice
    // in later; the PI assigns the two group layers after that.
    const cages = [];
    const shelfNames = {};
    const shelfRacks = {};                    // ชั้นที่ N อยู่บนแร็คไหน
    let seq = 0;
    d.shelves.forEach((sh, si) => {
      const s = si + 1;
      shelfNames[s] = (sh.no || '').trim() || String(s);
      shelfRacks[s] = (sh.rack || '').trim();
      sh.cages.forEach((cg, ci) => {
        cages.push({
          id: `${p.id}-C${++seq}`, code: (cg.code || '').trim(), shelfLabel: shelfNames[s], groupId: null, dietId: null,
          rackNo: shelfRacks[s],
          shelf: s, position: ci + 1, mice: [],
          water: { remaining: 300, added: null, consumed: 0 }, food: { remaining: 100, added: null, consumed: 0 },
          careLog: [],
          status: 'pending', lastRecordDate: todayISO(),
        });
      });
    });
    const cagesPerShelf = Math.max(1, ...d.shelves.map(sh => sh.cages.length));

    // members = creator (PI) + requested CoPI/AHS + AV-appointed VET/Sci/ACT
    const members = [{ userId: p.createdBy, roles: ['PI'] }];
    const add = (userId, role) => {
      if (!userId || userId === '__new__') return;
      let m = members.find(x => x.userId === userId);
      if (!m) { m = { userId, roles: [] }; members.push(m); }
      if (!m.roles.includes(role)) m.roles.push(role);
    };
    requested.forEach(a => add(a.userId === '__new__' ? a._createdId : a.userId, a.role));
    d.appointments.forEach(a => add(a.userId, a.role));

    // AV is the LAST step of creation — the project goes live right here.
    Object.assign(p, {
      approval: 'approved', startDate: d.facility.moveInDate || todayISO(),
      facility: { roomNo: this.el('bpRoom').value.trim(), rackNo: rackList.join(' · '), racks: rackList,
                  quarantineDate: d.facility.quarantineDate, moveInDate: d.facility.moveInDate },
      builtBy: { by: this.user.name, at: todayISO() },
      shelves: d.shelves.length, cagesPerShelf, shelfNames, shelfRacks,
      diets, groups, cages, members,
      // the vet's endpoint rules live on with the project (read back in openProjectInfo)
      request: { ...(p.request || {}), protocolEndpoint: d.protocolEndpoint, humaneEndpoint: d.humaneEndpoint },
    });
    this.log('สร้างโครงการ (สัตวแพทย์)', `${p.name} · ${cages.length} กรง · ${diets.length} ชนิดอาหาร · ${groups.length} กลุ่มทดสอบ`, p.name);
    // A5 — the project is live: everyone on it can start
    this.notify({ kind: 'build', title: 'โครงการเริ่มแล้ว — จัดสรรพื้นที่เรียบร้อย',
      detail: `${cages.length} กรง · รอชั่งน้ำหนักแรกเข้า`, project: p,
      to: this.nTo.team(p), link: { type: 'dashboard' } });
    // A6 — the staff AV appointed hear it as an appointment, not just a start
    this.notify({ kind: 'member', title: 'คุณได้รับแต่งตั้งเข้าโครงการ',
      detail: p.name, project: p,
      to: d.appointments.map(a => a.userId), link: { type: 'dashboard' } });
    this.draft = null;
    this.toast(`สร้างโครงการ "${p.name}" เรียบร้อย — รอนักวิทยาศาสตร์ชั่งหนูเข้ากรง`);
    this.go('projects');
  },

  // ---------------------------------------------------------
  // ใบติดหน้ากรง (CAGE CARD)
  // ---------------------------------------------------------
  // Replicates the printed card slotted into the cage-front holder. The field
  // LABELS are English verbatim exactly as on the paper card (Protocol No. · PI. ·
  // Animal Sp. · Strain · Sex. · Animal in Protocol · Animal in Cage · CAGE No. ·
  // GROUP · Start · End · Protocol) — same rule as every other official form here.
  // Values sit on a rule that runs to the next label, so anything the system does
  // not know prints as an EMPTY RULE to be filled in by hand, like the original.
  //
  // Works from two places, hence the tolerant `cage` shape:
  //   • AV build screen — draft cages, no animals yet → the protocol half is filled,
  //     the animal half is left blank for the day the mice arrive.
  //   • a live cage — every slot filled from the animals actually in it.
  CAGE_CARD_CSS: `
    /* 90 × 55 mm = ขนาดนามบัตรมาตรฐาน (ไทย/ยุโรป) — เข้าซองใส่หน้ากรงและ
       เครื่องตัดนามบัตรทั่วไปได้เลย.
       2 × 5 = 10 ใบ/หน้า A4: 2×90 = 180mm กว้าง, 5×55 = 275mm สูง ยังเหลือขอบ
       ให้เครื่องพิมพ์ (พิมพ์ชิดขอบกระดาษไม่ได้) และไม่ล้นไปหน้า 2. */
    .cards { display: grid; grid-template-columns: repeat(2, 90mm); justify-content: center; }
    .cc {
      width: 90mm; height: 55mm; padding: 3.2mm 3.6mm; border: 0.35mm solid #111;
      page-break-inside: avoid; overflow: hidden; position: relative;
      display: flex; flex-direction: column; font-size: 7pt; line-height: 1.1;
      /* rows keep their natural height and share the leftover space, so a card
         with short values breathes and one whose values wrap tightens up by
         itself instead of pushing the last line off the bottom */
      justify-content: space-between; gap: 1.1mm;
    }
    /* one line of the form: labels keep their natural width, values stretch */
    .cc-r { display: flex; align-items: flex-end; gap: 1.2mm; }
    .cc-l { flex: none; white-space: nowrap; font-size: 7pt; }
    /* values WRAP rather than clip — a cage card that hides half the protocol
       number is worse than one with a value on two lines. The tail below is
       flexible, so the extra line eats its slack instead of the card's. */
    .cc-v {
      flex: 1 1 auto; min-width: 0; border-bottom: 0.2mm solid #111;
      padding: 0 0.8mm 0.3mm; font-weight: 700;
      overflow-wrap: break-word; line-height: 1.1;   /* break long words only, never "Ma/le" */
    }
    .cc-v.sm { font-size: 6.5pt; }
    /* short fixed vocabularies (Male/Female) must never be squeezed by a long
       species or strain sharing the row */
    .cc-v.fix { flex: 0 0 auto; min-width: 14mm; }
    /* CAGE No. row — the number is the one thing readable from across the room */
    .cc-cage { display: flex; align-items: center; gap: 1.6mm; }
    .cc-cage .cc-l { align-self: center; }
    .cc-no { font-size: 22pt; font-weight: 700; line-height: 1; letter-spacing: 0.4pt; }
    .cc-grp { flex: 1 1 auto; min-width: 0; display: flex; align-items: flex-end; gap: 1.2mm; }
    /* free-text tail: protocol line + study title, filling the rest of the card */
    .cc-tail { display: flex; gap: 1.2mm; flex: 0 1 auto; min-height: 0; }
    .cc-tail .cc-l { align-self: flex-start; padding-top: 0.7mm; }
    .cc-txt { flex: 1 1 auto; min-width: 0; border-top: 0.2mm solid #111; padding-top: 0.8mm; }
    .cc-txt b { font-size: 7pt; }
    /* a very long study title is clamped to two lines so the diet line below it
       always survives — what goes in the hopper matters more than the full title */
    .cc-title {
      font-size: 7.5pt; font-weight: 700; margin-top: 0.8mm; line-height: 1.15;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .cc-diet { font-size: 6.5pt; margin-top: 0.8mm; }
    @media print { @page { size: A4; margin: 8mm 5mm; } }
  `,
  // one card. `cage` may be a real cage or a build draft `{ code }`.
  buildCageCard(p, cage) {
    const esc = v => String(v ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const r = p.request || {};
    const mice = cage.mice || [];
    const live = mice.filter(m => m.alive);

    // Sex belongs to the CAGE, not the protocol: Sci picks it at intake and the
    // whole cage is one sex. The licence may cover both — this card states what
    // is actually in front of you. (Joined, not truncated, if data ever disagrees.)
    const sexes = [...new Set(live.map(m => m.sex))];
    const sexText = sexes.map(s => (s === 'M' ? 'Male' : 'Female')).join(', ');

    // Start = the day THESE animals went into THIS cage (their first weighing),
    // so each card carries its own date rather than the project's.
    // End = the last dated item on the plan (แผนการใช้สัตว์ทดลอง) — the day the
    // protocol says this study finishes.
    const firstDates = live.map(m => (m.weights && m.weights.length ? m.weights[0].date : null)).filter(Boolean);
    const startDate = firstDates.length ? firstDates.sort()[0] : '';
    const planDates = (r.plan || []).map(x => x.date).filter(Boolean).sort();
    const endDate = planDates.length ? planDates[planDates.length - 1] : '';

    // "Animal in Protocol" → Lot. 1 = 40   ·   "Animal in Cage" → 2 [ #3, #4 ]
    const total = r.totalMice || '';
    const inProtocol = total ? (r.lotNo ? `Lot. ${esc(r.lotNo)} = ${total}` : String(total)) : '';
    const nos = live.map(m => `#${m.cageNo}`).join(', ');
    const inCage = live.length ? `${live.length}${nos ? `  [ ${nos} ]` : ''}` : '';

    const group = this.cageGroup(p, cage);
    const diet = this.cageDiet(p, cage);
    // อายุ–เพศ ที่รับสัตว์เข้าโครงการ = บรรทัด Protocol ของต้นฉบับ
    const age = r.ageMin && r.ageMax ? (r.ageMin === r.ageMax ? `${r.ageMin}` : `${r.ageMin}–${r.ageMax}`)
      : (r.ageMin || r.ageMax || '');
    const intake = age ? `รับสัตว์ทดลอง = ${age} weeks${sexText ? ' – ' + sexText : ''}` : '';

    const row = (...cells) => `<div class="cc-r">${cells.join('')}</div>`;
    const L = t => `<span class="cc-l">${t}</span>`;
    const V = (v, cls = '') => `<span class="cc-v ${cls}">${esc(v) || '&nbsp;'}</span>`;

    return `<div class="cc">
      ${row(L('Protocol No.'), V(r.protocolNo), L('PI.'), V(r.pi, 'sm'))}
      ${row(L('Animal Sp.'), V(r.species, 'sm'), L('Strain'), V(r.strain, 'sm'), L('Sex.'), V(sexText, 'sm fix'))}
      ${row(L('Animal in Protocol'), V(inProtocol, 'sm'), L('Animal in Cage'), V(inCage, 'sm'))}
      <div class="cc-cage">
        ${L('CAGE No.')}<span class="cc-no">${esc(cage.code)}</span>
        <span class="cc-grp">${L('GROUP')}${V(group ? group.name : '')}</span>
      </div>
      ${row(L('Start'), V(startDate ? this.thaiDate(startDate) : '', 'sm'),
            L('End'), V(endDate ? this.thaiDate(endDate) : '', 'sm'))}
      <div class="cc-tail">
        ${L('Protocol')}
        <span class="cc-txt">
          <b>${esc(intake) || '&nbsp;'}</b>
          <div class="cc-title">${esc(p.name)}${r.lotNo ? ` (Lot ${esc(r.lotNo)})` : ''}</div>
          ${/* ไม่มีในต้นฉบับ — เพิ่มเพราะระบบนี้แยกชนิดอาหารเป็นอีกชั้นหนึ่ง
                และคนเติมอาหารต้องอ่านจากหน้ากรงว่าต้องใส่สูตรไหน */''}
          ${diet ? `<div class="cc-diet">🍚 อาหาร: <b>${esc(diet.name)}</b></div>` : ''}
        </span>
      </div>
    </div>`;
  },
  // print a sheet of cards — 2 × 4 per A4, cut on the borders
  printCageCards(p, cages, tag = '') {
    if (!cages.length) { this.toast('ยังไม่มีกรงให้พิมพ์ — สร้างกรงก่อน'); return; }
    const cards = cages.map(c => this.buildCageCard(p, c)).join('');
    this.printDocument(`CageCards_${p.name}${tag}`,
      `<style>${this.CAGE_CARD_CSS}</style><div class="cards">${cards}</div>`);
    this.log('พิมพ์ใบติดหน้ากรง', `${cages.length} ใบ`, p.name);
  },
  // Reprint cards for a project that is already running — all of them, or just the
  // cages that changed (a cage regrouped, animals moved, a card torn or faded).
  // Selection is per cage and grouped the way the rack physically is, so you tick
  // what you are standing in front of.
  openCageCards(p) {
    if (!this.can('cageCard', p)) { this.toast('ใบติดหน้ากรงเป็นงานของทีมวิจัย (PI / CoPI / AHS)'); return; }
    const sel = new Set(p.cages.map(c => c.id));      // ค่าเริ่มต้น = ทั้งหมด
    const byShelf = {};
    p.cages.forEach(c => { (byShelf[c.shelf] = byShelf[c.shelf] || []).push(c); });

    const draw = () => {
      const shelves = Object.keys(byShelf).sort((a, b) => a - b).map(sh => {
        const list = byShelf[sh];
        const rack = (p.shelfRacks || {})[sh];
        const all = list.every(c => sel.has(c.id));
        return `<div class="cs-shelf">
          <div class="cs-head">
            <b>ชั้น ${p.shelfNames?.[sh] || sh}</b>${rack ? `<span class="cs-rack">แร็ค ${rack}</span>` : ''}
            <span class="spacer" style="flex:1"></span>
            <button class="nt-link" data-shelf="${sh}">${all ? 'ไม่เอาชั้นนี้' : 'เลือกทั้งชั้น'}</button>
          </div>
          <div class="cs-grid">${list.map(c => {
            const g = this.cageGroup(p, c);
            const n = c.mice.filter(m => m.alive).length;
            return `<button class="cs-cage ${sel.has(c.id) ? 'on' : ''}" data-cid="${c.id}">
              <b>${c.code}</b>
              <span>${g ? g.name : 'ยังไม่จัดกลุ่ม'}</span>
              <span class="cs-n">${n ? n + ' ตัว' : 'ว่าง'}</span>
            </button>`;
          }).join('')}</div>
        </div>`;
      }).join('');

      this.openModal(`
        <div class="modal-head">
          <div><h3>🏷️ ใบติดหน้ากรง</h3>
            <div class="sub">${p.name} · เลือกกรงที่ต้องการพิมพ์ · 10 ใบ/หน้า A4 · ขนาดนามบัตร 90 × 55 มม.</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="cs-bar">
            <button class="btn mini" id="csAll">เลือกทั้งหมด</button>
            <button class="btn mini" id="csNone">ล้างที่เลือก</button>
            <span class="spacer" style="flex:1"></span>
            <span class="count-chip">เลือกแล้ว ${sel.size} / ${p.cages.length} กรง</span>
          </div>
          ${shelves}
        </div>
        <div class="modal-foot">
          <button class="btn" id="csCancel">ปิด</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary" id="csPrint" ${sel.size ? '' : 'disabled'}>🖨️ พิมพ์ ${sel.size} ใบ</button>
        </div>
      `, { wide: true });

      this.el('closeModal').onclick = () => this.closeModal();
      this.el('csCancel').onclick = () => this.closeModal();
      this.el('csAll').onclick = () => { p.cages.forEach(c => sel.add(c.id)); draw(); };
      this.el('csNone').onclick = () => { sel.clear(); draw(); };
      document.querySelectorAll('[data-shelf]').forEach(b => b.onclick = () => {
        const list = byShelf[b.dataset.shelf];
        const all = list.every(c => sel.has(c.id));
        list.forEach(c => (all ? sel.delete(c.id) : sel.add(c.id)));
        draw();
      });
      document.querySelectorAll('.cs-cage').forEach(b => b.onclick = () => {
        const id = b.dataset.cid;
        sel.has(id) ? sel.delete(id) : sel.add(id);
        draw();
      });
      this.el('csPrint').onclick = () => {
        const chosen = p.cages.filter(c => sel.has(c.id));
        if (!chosen.length) return;
        this.closeModal();
        this.printCageCards(p, chosen, chosen.length === p.cages.length ? '' : `_${chosen.length}ใบ`);
      };
    };
    draw();
  },

  // NOTE: the AV build screen used to print blank cards straight from the cage
  // draft. Printing the card is the research team's job (`cageCard` = PI/CoPI/AHS),
  // and AV does not hold it, so that button and its draft printer are gone. The
  // team prints the same blank cards from the dashboard the moment AV hands the
  // project over — before intake every slot is still empty anyway.

  // shared reject prompt for the AV build screen
  promptReject(p, stage) {
    const esc = v => String(v ?? '').replace(/"/g, '&quot;');
    this.openModal(`
      <div class="modal-head"><div><h3>ตีกลับโครงการ</h3><div class="sub">${p.name}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button></div>
      <div class="modal-body">
        <div class="field"><label for="rjReason">เหตุผลที่ตีกลับ <span class="req-star">*</span></label>
          <textarea id="rjReason" rows="3" placeholder="ระบุสิ่งที่ผู้วิจัยต้องแก้ไข"></textarea></div>
        <div class="field"><label for="rjPhone">เบอร์โทรติดต่อกลับ <span class="req-star">*</span></label>
          <input id="rjPhone" type="tel" inputmode="tel" placeholder="เช่น 053-935-000 ต่อ 123" value="${esc(this.user.phone)}">
          <span class="field-hint">ผู้วิจัยจะเห็นเบอร์นี้ในคำขอที่ถูกตีกลับ เพื่อสอบถามรายละเอียดได้ทันที</span></div>
      </div>
      <div class="modal-foot"><button class="btn" id="rjCancel">ยกเลิก</button>
        <button class="btn btn-danger" id="rjOk">✗ ตีกลับ</button></div>`);
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('rjCancel').onclick = () => this.closeModal();
    this.el('rjOk').onclick = () => {
      const reason = this.el('rjReason').value.trim();
      if (!reason) { this.el('rjReason').focus(); this.toast('กรุณาระบุเหตุผลที่ตีกลับ'); return; }
      const phone = this.el('rjPhone').value.trim();
      if (!phone) { this.el('rjPhone').focus(); this.toast('กรุณาระบุเบอร์โทรติดต่อกลับ'); return; }
      this.rejectProject(p, reason, stage, phone);
      this.draft = null;
      this.closeModal(); this.go('projects');
    };
  },

  // ---------------------------------------------------------
  // Location = CURRENT STATUS, derived from whichever cage holds the mouse
  // (see the mouse identity/location note in CLAUDE.md). Never store this on the
  // mouse — read it through here so a future "ย้ายกรง" needs no display changes.
  // ---------------------------------------------------------
  // ห้อง / แร็ค of a project (AV sets these when allocating space)
  facilityLine(p) {
    const f = p.facility || {};
    const parts = [];
    if (f.roomNo) parts.push(`ห้อง ${f.roomNo}`);
    if (f.rackNo) parts.push(`แร็ค ${f.rackNo}`);
    return parts.join(' · ');
  },
  // full physical location of a cage: ห้อง · แร็ค · ชั้น · กรง
  // the shelf a cage sits on. The project's shelfNames map is the source of truth —
  // cage.shelfLabel is only a cached copy and seeded cages may not carry one at all,
  // so never read it directly.
  shelfNameOf(p, cage) {
    return (p.shelfNames && p.shelfNames[cage.shelf]) || cage.shelfLabel || cage.shelf || '—';
  },
  cageLocation(p, cage, withCage = true) {
    const parts = [];
    const fac = this.facilityLine(p);
    if (fac) parts.push(fac);
    const shelf = this.shelfNameOf(p, cage);
    if (shelf) parts.push(`ชั้น ${shelf}`);
    if (withCage) parts.push(`กรง ${cage.code}`);
    return parts.join(' · ');
  },
  popGroupCountLive(p, groupId) {
    return (p.cages || []).reduce((n, c) => n + (c.groupId === groupId ? c.mice.length : 0), 0);
  },
  // mice currently on a given diet — cages with no dietId count toward the DEFAULT diet
  dietCountLive(p, dietId) {
    return (p.cages || []).reduce((n, c) => {
      const d = this.cageDiet(p, c);
      return n + (d && d.id === dietId ? c.mice.length : 0);
    }, 0);
  },
  // colour helpers for the populate keypad tint (accept #rgb / #rrggbb)
  rgbOf(hex) {
    const m = (hex || '#64748b').replace('#', '');
    const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    return { r: parseInt(n.slice(0, 2), 16) || 0, g: parseInt(n.slice(2, 4), 16) || 0, b: parseInt(n.slice(4, 6), 16) || 0 };
  },
  shadeHex(hex, f) { const { r, g, b } = this.rgbOf(hex); const d = v => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${d(r)},${d(g)},${d(b)})`; },
  softHex(hex, a) { const { r, g, b } = this.rgbOf(hex); return `rgba(${r},${g},${b},${a})`; },

  // "ลำดับในกรง" (cageNo) = เลขย่อยที่นักวิจัยใช้เรียกหนูในกรงนั้น — มีได้แค่ 1…5
  // และห้ามซ้ำกันภายในกรงเดียวกัน ⇒ กรงหนึ่งจุหนูได้สูงสุด 5 ตัว
  MAX_CAGE_NO: 5,
  // one shelf shows as one row on the dashboard — the layout is tuned for up to this many
  MAX_CAGES_PER_ROW: 8,

  // typed by the user to confirm CHANGING an assignment that was already made
  CONFIRM_PHRASE: 'confirm change',

  // ---------------------------------------------------------
  // PI ASSIGNS THE TWO GROUP LAYERS (after the mice are already in their cages).
  // The two are deliberately separate actions — a cage may have a diet but no
  // treatment group, or vice versa.
  // ---------------------------------------------------------
  // ชั้น 1 — ชนิดอาหาร. dietId null ⇒ กลับไปใช้อาหารทั่วไป (ค่าเริ่มต้น)
  assignCageDiet(p, cage, dietId) {
    if (cage.dietId === dietId) return { ok: true, changed: false };
    if (dietId) {
      const d = this.diets(p).find(x => x.id === dietId);
      if (!d) return { ok: false, msg: 'ไม่พบชนิดอาหารนี้' };
      if (d.capacity != null) {
        const used = this.dietCountLive(p, dietId) - (this.cageDiet(p, cage)?.id === dietId ? cage.mice.length : 0);
        if (used + cage.mice.length > d.capacity) {
          return { ok: false, msg: `เกินโควตาอาหาร ${d.name} (สูงสุด ${d.capacity} ตัว · ใช้แล้ว ${used})` };
        }
      }
    }
    cage.dietId = dietId;
    return { ok: true, changed: true };
  },

  // ชั้น 2 — กลุ่มทดสอบ. Assigning also hands every mouse in the cage its
  // ลำดับในกลุ่ม (groupNo) — the last piece of the display tag. Removing the cage
  // from a group releases those numbers again.
  assignCageGroup(p, cage, groupId) {
    if (cage.groupId === groupId) return { ok: true, changed: false };
    if (groupId) {
      const g = (p.groups || []).find(x => x.id === groupId);
      if (!g) return { ok: false, msg: 'ไม่พบกลุ่มทดสอบนี้' };
      if (g.capacity != null) {
        const used = this.popGroupCountLive(p, groupId);
        if (used + cage.mice.length > g.capacity) {
          return { ok: false, msg: `เกินโควตากลุ่ม ${g.name} (สูงสุด ${g.capacity} ตัว · ใช้แล้ว ${used})` };
        }
      }
    }
    cage.mice.forEach(m => { m.groupNo = null; });     // release the old numbers first
    cage.groupId = groupId;
    if (groupId) {
      const used = new Set();
      (p.cages || []).forEach(c => { if (c.groupId === groupId) c.mice.forEach(m => { if (m.groupNo != null) used.add(m.groupNo); }); });
      let n = 0;
      cage.mice.forEach(m => { do { n++; } while (used.has(n)); used.add(n); m.groupNo = n; });
    }
    return { ok: true, changed: true };
  },

  // The palette shown under the จัดการกรง mode bar. Picking a chip arms a "brush";
  // tapping cages then applies it. Each sub-mode has its own palette so the two
  // assignment jobs never happen in the same interaction.
  editModePanel(p) {
    if (this.editMode === 'diet') {
      const chips = this.diets(p).map(d => {
        const used = this.dietCountLive(p, d.id);
        return `<button class="asg-chip ${this.dietBrush === d.id ? 'on' : ''}" data-diet="${d.id}" style="--ac:${d.color}">
            <i class="sw" style="background:${d.color}"></i>${d.name}${d.isDefault ? ' <span class="muted">(ค่าเริ่มต้น)</span>' : ''}
            <span class="asg-cap">${used}${d.capacity != null ? '/' + d.capacity : ''}</span>
          </button>`;
      }).join('');
      return `<div class="eb-panel">
          <span class="ebp-label">เลือกชนิดอาหาร แล้วแตะกรงที่ต้องการ:</span>
          <div class="asg-chips">${chips}</div>
        </div>`;
    }
    if (this.editMode === 'group') {
      const chips = (p.groups || []).map(g => {
        const used = this.popGroupCountLive(p, g.id);
        return `<button class="asg-chip ${this.groupBrush === g.id ? 'on' : ''}" data-group="${g.id}" style="--ac:${g.color}">
            <i class="sw" style="background:${g.color}"></i>${g.name}${g.isControl ? ' <span class="muted">(control)</span>' : ''}
            <span class="asg-cap">${used}${g.capacity != null ? '/' + g.capacity : ''}</span>
          </button>`;
      }).join('');
      return `<div class="eb-panel">
          <span class="ebp-label">เลือกกลุ่มทดสอบ แล้วแตะกรงที่ต้องการ:</span>
          <div class="asg-chips">${chips}
            <button class="asg-chip clear ${this.groupBrush === '__none__' ? 'on' : ''}" data-group="__none__">✕ เอาออกจากกลุ่ม</button>
          </div>
        </div>`;
    }
    if (this.editMode === 'move') {
      const c = this.moveCageId ? p.cages.find(x => x.id === this.moveCageId) : null;
      return `<div class="eb-panel">
          <span class="ebp-label">${c
            ? `เลือกกรง <b>${c.code}</b> แล้ว — กด “ย้ายมาชั้นนี้” ที่หัวชั้นปลายทาง`
            : 'แตะกรงที่ต้องการย้าย'}</span>
          ${c ? '<button class="btn btn-sm" id="cancelMove">ยกเลิกการเลือก</button>' : ''}
        </div>`;
    }
    return '';
  },

  // ---------------------------------------------------------
  // FIRST WEIGHING / INTAKE (Sci) — หนูถูกชั่งแล้วนำเข้ากรง
  // At this point the animal gets its PERMANENT code (โครงการ-รหัสกรง-ลำดับในกรง).
  // No treatment group is assigned yet and the cage stays on the default diet;
  // the PI groups the cages afterwards, as two separate actions.
  // ---------------------------------------------------------
  openIntakeCage(p, cage) {
    let selSex = null;                       // one sex per cage
    let mice = [];                           // [{cageNo, weight}]
    let kp = null;                           // two-card keypad state (mouse: no + weight)
    let kpS = null;                          // two-card keypad state (supplies: water + food)
    // น้ำและอาหารต้องชั่งก่อนนำหนูเข้ากรง — เป็นค่าตั้งต้นที่รอบถัดไปเอาไปหักหาปริมาณที่กินจริง
    let sup = { water: null, food: null };
    const diet = this.cageDiet(p, cage);

    const renderList = () => {
      const supDone = sup.water != null && sup.food != null;
      const ready = !!selSex && supDone;
      const rows = mice.map((m, i) => `
        <div class="pop-mrow" data-i="${i}">
          <span class="pm-idx">หนูตัวที่ ${i + 1}</span>
          <button type="button" class="pm-chip" data-i="${i}" data-field="n">ในกรง <b>#${m.cageNo}</b></button>
          <button type="button" class="pm-chip" data-i="${i}" data-field="w">น้ำหนัก <b>${this.g(m.weight)} g</b></button>
          <button class="icon-btn pm-del" data-i="${i}" title="เอาออก">✕</button>
        </div>`).join('') || '<p class="empty-note">ยังไม่ได้นำหนูเข้ากรงนี้</p>';

      this.setModal(`
        <div class="modal-head">
          <div><h3>🐭 รับหนูเข้าโครงการ · กรง ${cage.code}</h3>
            <div class="sub">ชั่งน้ำหนักแรกเข้า · ${this.cageLocation(p, cage, false)}</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="intake-note">อาหารเริ่มต้น: <b>${diet ? diet.name : '—'}</b> · ยังไม่จัดกลุ่มทดสอบ — ผู้วิจัยจะกำหนดภายหลัง</div>
          <div class="field"><label>1. เพศของหนูในกรงนี้ <span class="muted">(ทั้งกรงเพศเดียวกัน)</span></label>
            <div class="sex-row" id="inSex">
              <button type="button" class="sex-btn male ${selSex === 'M' ? 'sel' : ''}" data-sex="M">♂ เพศผู้</button>
              <button type="button" class="sex-btn female ${selSex === 'F' ? 'sel' : ''}" data-sex="F">♀ เพศเมีย</button>
            </div>
          </div>
          <div class="field">
            <label>2. ชั่งน้ำและอาหารที่ใส่เข้ากรง <span class="req-star">*</span></label>
            <div class="sup-row">
              <button type="button" class="sup-chip water ${sup.water != null ? 'on' : ''}" id="inSupW">
                <span class="sc-ico">💧</span>
                <span class="sc-body"><span class="sc-lb">น้ำแรกเข้า</span>
                  <span class="sc-val">${sup.water == null ? 'ยังไม่ชั่ง' : this.g(sup.water) + ' g'}</span></span>
              </button>
              <button type="button" class="sup-chip food ${sup.food != null ? 'on' : ''}" id="inSupF">
                <span class="sc-ico">🍚</span>
                <span class="sc-body"><span class="sc-lb">อาหารแรกเข้า</span>
                  <span class="sc-val">${sup.food == null ? 'ยังไม่ชั่ง' : this.g(sup.food) + ' g'}</span></span>
              </button>
            </div>
          </div>
          <div class="field">
            <label>3. หนูที่ชั่งแล้ว <span class="muted">(สูงสุด ${this.MAX_CAGE_NO} ตัว)</span></label>
            <div id="inMice">${rows}</div>
            <button class="btn btn-ghost btn-sm" id="inAdd" ${!ready ? 'disabled' : ''}><span class="ico-plus">+</span> ชั่ง & เพิ่มหนู</button>
            ${!ready ? `<p class="empty-note" style="margin-top:6px">${!selSex ? 'เลือกเพศ' : 'ชั่งน้ำและอาหาร'}ก่อนจึงจะเพิ่มหนูได้</p>` : ''}
          </div>
        </div>
        <div class="modal-foot">
          <span class="spacer" style="flex:1"></span>
          <button class="btn" id="inCancel">ยกเลิก</button>
          <button class="btn btn-primary" id="inSave">บันทึกเข้ากรง</button>
        </div>
      `);

      this.el('inSex').querySelectorAll('.sex-btn').forEach(b => b.onclick = () => { selSex = b.dataset.sex; render(); });
      this.el('inSupW').onclick = () => startSup('w');
      this.el('inSupF').onclick = () => startSup('f');
      this.el('inMice').querySelectorAll('.pm-chip').forEach(b => b.onclick = () => startNums(+b.dataset.i, false, b.dataset.field));
      this.el('inMice').querySelectorAll('.pm-del').forEach(b => b.onclick = () => { mice.splice(+b.dataset.i, 1); render(); });
      if (ready) this.el('inAdd').onclick = () => {
        if (mice.length >= this.MAX_CAGE_NO) { this.toast(`กรงหนึ่งรับหนูได้ไม่เกิน ${this.MAX_CAGE_NO} ตัว`); return; }
        mice.push({ cageNo: null, weight: null });
        startNums(mice.length - 1, true, 'n');
      };
      this.el('closeModal').onclick = () => this.closeModal();
      this.el('inCancel').onclick = () => this.closeModal();
      this.el('inSave').onclick = () => commit();
    };

    // one page, two cards: ลำดับในกรง (integer) + น้ำหนัก (decimal), one shared pad
    const renderNums = () => {
      const accent = (diet && diet.color) || '#2563eb';
      const nAccent = accent, wAccent = this.shadeHex(accent, 0.55);
      const nSoft = this.softHex(accent, 0.12), wSoft = this.softHex(accent, 0.22);
      const activeAccent = kp.active === 'n' ? nAccent : wAccent;
      const activeSoft = kp.active === 'n' ? nSoft : wSoft;
      const card = (key, label, ac, soft, hint, buf, unit) => `
        <button type="button" class="num-card ${kp.active === key ? 'active' : ''}" data-card="${key}" style="--nc-accent:${ac};--nc-soft:${soft}">
          <span class="nc-label">${label}</span>
          <span class="nc-val ${buf === '' ? 'empty' : ''}">${buf === '' ? '—' : buf}${buf !== '' && unit ? `<small>${unit}</small>` : ''}</span>
          <span class="nc-hint">${hint}</span>
        </button>`;
      const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="kp-key" data-key="${n}">${n}</button>`).join('');
      this.setModal(`
        <div class="modal-head">
          <div><h3>กรง ${cage.code} · หนูตัวที่ ${kp.i + 1}</h3>
            <div class="sub">แตะการ์ดเพื่อเลือกช่อง แล้วกดตัวเลข · หรือพิมพ์จากคีย์บอร์ด (Tab สลับช่อง · Enter ยืนยัน)</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="kp-ctx">เพศ ${selSex === 'F' ? '♀ เพศเมีย' : '♂ เพศผู้'} · ${diet ? diet.name : '—'}</div>
          <div class="num-cards">
            ${card('n', 'ลำดับในกรง', nAccent, nSoft, `1–${this.MAX_CAGE_NO}`, kp.nBuf, '')}
            ${card('w', 'น้ำหนักที่ชั่งได้', wAccent, wSoft, 'กรัม (g)', kp.wBuf, ' g')}
          </div>
          <div class="kp-wrap" style="--kp-accent:${activeAccent};--kp-soft:${activeSoft}">
            <div class="kp-grid">${keys}</div>
            <div class="kp-row">
              <button class="kp-key kp-act" data-key="clear">C</button>
              <button class="kp-key" data-key="0">0</button>
              ${kp.active === 'w' ? '<button class="kp-key kp-act" data-key="dot">.</button>' : ''}
              <button class="kp-key kp-act" data-key="back">⌫</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="kpCancel">ยกเลิก</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary" id="kpOk" style="background:${nAccent}">ยืนยัน</button>
        </div>
      `);
      this.el('closeModal').onclick = () => this.closeModal();
      this.el('kpCancel').onclick = () => cancelStep();
      this.el('kpOk').onclick = () => okNums();
      document.querySelectorAll('.num-card').forEach(b => b.onclick = () => { kp.active = b.dataset.card; render(); });
      document.querySelectorAll('.kp-key').forEach(b => b.onclick = () => {
        const k = b.dataset.key, bk = kp.active === 'n' ? 'nBuf' : 'wBuf';
        if (k === 'back') kp[bk] = kp[bk].slice(0, -1);
        else if (k === 'clear') kp[bk] = '';
        else if (k === 'dot') { if (!kp[bk].includes('.')) kp[bk] = (kp[bk] === '' ? '0.' : kp[bk] + '.'); }
        else if (kp[bk].replace('.', '').length < 4) kp[bk] = (kp[bk] === '0' ? '' : kp[bk]) + k;
        render();
      });
    };

    // ชั่งน้ำ/อาหาร — การ์ดสองใบใช้แป้นตัวเลขร่วมกัน เหมือนแป้นของหนู
    const renderSupPad = () => {
      const wA = '#0ea5e9', fA = '#d97706';
      const activeAccent = kpS.active === 'w' ? wA : fA;
      const activeSoft = kpS.active === 'w' ? this.softHex(wA, 0.16) : this.softHex(fA, 0.16);
      const card = (key, label, ac, soft, hint, buf) => `
        <button type="button" class="num-card ${kpS.active === key ? 'active' : ''}" data-scard="${key}" style="--nc-accent:${ac};--nc-soft:${soft}">
          <span class="nc-label">${label}</span>
          <span class="nc-val ${buf === '' ? 'empty' : ''}">${buf === '' ? '—' : buf}${buf !== '' ? '<small> g</small>' : ''}</span>
          <span class="nc-hint">${hint}</span>
        </button>`;
      const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="kp-key" data-key="${n}">${n}</button>`).join('');
      this.setModal(`
        <div class="modal-head">
          <div><h3>กรง ${cage.code} · น้ำและอาหารแรกเข้า</h3>
            <div class="sub">ชั่งปริมาณที่ใส่เข้ากรงก่อนนำหนูเข้า · แตะการ์ดเพื่อเลือกช่อง แล้วกดตัวเลข</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="kp-ctx">ค่านี้เป็นจุดตั้งต้น — รอบชั่งถัดไปจะนำไปหักเพื่อหาปริมาณที่กินจริง</div>
          <div class="num-cards">
            ${card('w', '💧 น้ำแรกเข้า', wA, this.softHex(wA, 0.16), 'กรัม (g)', kpS.wBuf)}
            ${card('f', '🍚 อาหารแรกเข้า', fA, this.softHex(fA, 0.16), 'กรัม (g)', kpS.fBuf)}
          </div>
          <div class="kp-wrap" style="--kp-accent:${activeAccent};--kp-soft:${activeSoft}">
            <div class="kp-grid">${keys}</div>
            <div class="kp-row">
              <button class="kp-key kp-act" data-key="clear">C</button>
              <button class="kp-key" data-key="0">0</button>
              <button class="kp-key kp-act" data-key="dot">.</button>
              <button class="kp-key kp-act" data-key="back">⌫</button>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="kpCancel">ยกเลิก</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary" id="kpOk" style="background:${activeAccent}">ยืนยัน</button>
        </div>
      `);
      this.el('closeModal').onclick = () => this.closeModal();
      this.el('kpCancel').onclick = () => { kpS = null; render(); };
      this.el('kpOk').onclick = () => okSup();
      document.querySelectorAll('.num-card').forEach(b => b.onclick = () => { kpS.active = b.dataset.scard; render(); });
      document.querySelectorAll('.kp-key').forEach(b => b.onclick = () => {
        const k = b.dataset.key, bk = kpS.active === 'w' ? 'wBuf' : 'fBuf';
        if (k === 'back') kpS[bk] = kpS[bk].slice(0, -1);
        else if (k === 'clear') kpS[bk] = '';
        else if (k === 'dot') { if (!kpS[bk].includes('.')) kpS[bk] = (kpS[bk] === '' ? '0.' : kpS[bk] + '.'); }
        else if (kpS[bk].replace('.', '').length < 5) kpS[bk] = (kpS[bk] === '0' ? '' : kpS[bk]) + k;
        render();
      });
    };
    const startSup = (active) => {
      kpS = { active,
        wBuf: sup.water == null ? '' : String(sup.water),
        fBuf: sup.food == null ? '' : String(sup.food) };
      render();
    };
    const okSup = () => {
      const wv = kpS.wBuf === '' ? null : parseFloat(kpS.wBuf);
      const fv = kpS.fBuf === '' ? null : parseFloat(kpS.fBuf);
      if (wv == null || !(wv > 0)) { this.toast('กรุณาชั่งน้ำที่ใส่เข้ากรง'); kpS.active = 'w'; return render(); }
      if (fv == null || !(fv > 0)) { this.toast('กรุณาชั่งอาหารที่ใส่เข้ากรง'); kpS.active = 'f'; return render(); }
      sup.water = Math.round(wv * 10) / 10;
      sup.food = Math.round(fv * 10) / 10;
      kpS = null; render();
    };

    const startNums = (i, isNew, active) => {
      kp = { i, isNew, active: active || 'n',
        nBuf: mice[i].cageNo == null ? '' : String(mice[i].cageNo),
        wBuf: mice[i].weight == null ? '' : String(mice[i].weight) };
      render();
    };
    const cancelStep = () => { if (kp.isNew) mice.splice(kp.i, 1); kp = null; render(); };
    const okNums = () => {
      const nv = kp.nBuf === '' ? null : +kp.nBuf;
      const wv = kp.wBuf === '' ? null : parseFloat(kp.wBuf);
      if (nv == null || nv < 1) { this.toast('กรุณากรอกลำดับในกรง'); kp.active = 'n'; return render(); }
      if (nv > this.MAX_CAGE_NO) { this.toast(`ลำดับในกรงต้องอยู่ระหว่าง 1–${this.MAX_CAGE_NO}`); kp.active = 'n'; return render(); }
      if (mice.some((m, i) => i !== kp.i && m.cageNo === nv)) { this.toast(`ลำดับในกรง #${nv} ถูกใช้แล้วในกรงนี้`); kp.active = 'n'; return render(); }
      if (wv == null || !(wv > 0)) { this.toast('กรุณากรอกน้ำหนักที่ชั่งได้'); kp.active = 'w'; return render(); }
      mice[kp.i].cageNo = nv;
      mice[kp.i].weight = Math.round(wv * 10) / 10;
      kp = null; render();
    };

    // create the real animals — this is the moment each mouse gets its permanent code
    const commit = () => {
      if (sup.water == null || sup.food == null) { this.toast('ชั่งน้ำและอาหารก่อนบันทึก'); return; }
      if (!mice.length) { this.toast('ยังไม่ได้เพิ่มหนู'); return; }
      if (mice.some(m => m.cageNo == null || m.weight == null)) { this.toast('กรอกลำดับในกรงและน้ำหนักให้ครบทุกตัว'); return; }
      // จุดตั้งต้นของน้ำ/อาหาร: ใส่เข้าไปเท่านี้ ยังไม่มีการกิน
      cage.water = { remaining: sup.water, added: sup.water, consumed: 0 };
      cage.food = { remaining: sup.food, added: sup.food, consumed: 0 };
      cage.mice = mice
        .slice()
        .sort((a, b) => a.cageNo - b.cageNo)
        .map(m => this.freshMouse(mouseCode(p.id, cage.code, m.cageNo), selSex, null, m.cageNo, m.weight));
      this.logSupply(cage, 'intake');   // ยอดตั้งต้น — ต้องเรียกหลังใส่หนู เพราะนับตัวจากในกรง
      cage.lastRecordDate = this.recDate();
      this.log('รับหนูเข้าโครงการ (น้ำหนักแรกเข้า)',
        `${cage.code} · ${mice.length} ตัว (${selSex === 'M' ? '♂' : '♀'}) · น้ำ ${this.g(sup.water)} g · อาหาร ${this.g(sup.food)} g`, p.name);
      this.closeModal();
      this.toast(`นำหนู ${mice.length} ตัวเข้ากรง ${cage.code} แล้ว`);
      // B2 — once no cage is left empty the researcher's turn begins
      if (!p.cages.some(c => !c.mice.length)) {
        this.notify({ kind: 'intake', title: 'นำหนูเข้าครบทุกกรงแล้ว — รอจัดกลุ่ม',
          detail: `${p.cages.length} กรง — ถึงคิวกำหนดชนิดอาหารและกลุ่มทดสอบ`, project: p,
          to: this.nResearchers(p), link: { type: 'dashboard' } });
      }
      this.renderDashboard();
    };

    const render = () => (kp ? renderNums() : kpS ? renderSupPad() : renderList());
    this.openModal('', { compact: true });
    render();
  },

  // ---------------------------------------------------------
  renderDashboard() {
    const p = Data.getProject(this.route.projectId);
    if (!p) return this.go('projects');
    // `canEnter` also stops OCH, who sees the cards but never the inside
    if (!this.canEnter(p)) { this.toast('คุณไม่มีสิทธิ์เข้าถึงโครงการนี้'); return this.go(this.homeRoute()); }
    // waiting/rejected projects aren't "real" yet — nobody enters the dashboard
    // (the creator edits via the create/edit page; AV reviews via the info popup).
    if ((p.approval || 'approved') !== 'approved') {
      this.toast('โครงการยังไม่ได้รับอนุมัติ — ยังเปิดใช้งานไม่ได้');
      return this.go('projects');
    }

    const closed = p.status === 'closed';   // closed projects are view-only
    const approval = p.approval || 'approved';
    const operational = this.isOperational(p);   // approved & not closed → data can be recorded
    // weighing needs an operational project; cage/member/doc editing stays available to PI
    // on waiting/rejected so they can prepare/fix before (re)submitting.
    const canWeigh = operational && this.can('weigh', p);
    // ACT ตรวจดูแลกรงได้เมื่อมีหนูอยู่จริงแล้ว (กรงว่างไม่มีอะไรให้ตรวจ)
    const canCare = operational && this.can('cageCare', p) && !this.isEmptyProject(p);
    // AHS ให้สารทดสอบรายตัว — ต้องมีหนูอยู่แล้วเช่นกัน
    const canDose = operational && this.can('dosing', p) && !this.isEmptyProject(p);
    const canEdit = !closed && this.can('editProject', p);
    const canMembers = this.can('manageMembers', p);
    // the บันทึกย้อนหลัง control only makes sense to someone who can actually record
    // something here — for everyone else it would be a date display and nothing more
    const canRecord = operational && this.REC_CAPS.some(c => this.can(c, p));
    if (this.recOn() && !canRecord) this.recReset();
    // การชั่งครั้งแรก: Sci ชั่งหนูแล้วนำเข้ากรงที่ยังว่าง — ทำได้ตราบใดที่ยังมีกรงว่าง
    const emptyCages = p.cages.filter(c => !c.mice.length);
    const canIntake = canWeigh && emptyCages.length > 0;
    if (this.editing && !canEdit) this.editing = false;
    if (this.caring && !canCare) this.caring = false;
    if (this.dosing && !canDose) this.dosing = false;
    if (this.weighing && !canWeigh) this.weighing = false;
    if (this.intake && !canIntake) this.intake = false;

    // tallest cage drives a uniform box height across the whole project
    const maxMice = p.cages.reduce((m, c) => Math.max(m, c.mice.length), 1);

    // After the project starts, cages and mice are FIXED — จัดการกรง only assigns the
    // two group layers and moves a cage to another shelf. Shelves render the same in
    // every mode; only the cage cards change (see cageCard).
    // Shelves render grouped by RACK. A project may occupy several racks; each rack
    // starts below the previous one, separated by a heavy rule, so the physical layout
    // on screen matches walking down the room.
    const rackOf = (s) => (p.shelfRacks && p.shelfRacks[s]) || (p.facility && p.facility.rackNo) || '';
    const shelfBlock = (s) => {
      const shelfCages = p.cages.filter(c => c.shelf === s).sort((a, b) => a.position - b.position);
      const cells = shelfCages.map(cage => this.cageCard(p, cage, maxMice));
      if (!shelfCages.length) cells.push(this.emptyCell(maxMice));
      const moveHere = this.editing && this.editMode === 'move' && this.moveCageId
        && !shelfCages.some(c => c.id === this.moveCageId)
        ? `<button class="btn btn-sm move-here" data-moveto="${s}">⬇️ ย้ายมาชั้นนี้</button>` : '';
      // the row never stretches past MAX_CAGES_PER_ROW columns, so a 3-cage shelf and
      // an 8-cage shelf keep the same card width down the whole rack
      return `
        <div class="shelf">
          <div class="shelf-label">${(p.shelfNames && p.shelfNames[s]) || 'ชั้นที่ ' + s}${moveHere}</div>
          <div class="cage-row" style="--cols:${Math.min(this.MAX_CAGES_PER_ROW, Math.max(1, shelfCages.length))}">${cells.join('')}</div>
        </div>`;
    };

    const rackOrder = [];
    for (let s = 1; s <= p.shelves; s++) { const r = rackOf(s); if (!rackOrder.includes(r)) rackOrder.push(r); }
    const multiRack = rackOrder.length > 1;
    const shelves = rackOrder.map((rk, ri) => {
      const list = [];
      for (let s = 1; s <= p.shelves; s++) if (rackOf(s) === rk) list.push(shelfBlock(s));
      const head = multiRack
        ? `<div class="rack-head"><span class="rack-badge">แร็ค ${rk || '—'}</span>
             <span class="rack-meta">${list.length} ชั้น</span></div>` : '';
      return `<section class="rack${ri > 0 ? ' next' : ''}">${head}${list.join('')}</section>`;
    });

    // เอกสารที่พิมพ์ได้จากโครงการนี้ — รวมอยู่ในเมนูเดียว (ดู printMenu)
    const printItems = [];
    if (p.cages.length) {
      if (this.can('cageCard', p)) printItems.push({ key: 'cagecard', icon: '🏷️',
        label: 'ใบติดหน้ากรง', hint: 'เลือกกรง · ขนาดนามบัตร 10 ใบ/หน้า' });
      printItems.push({ key: 'humane', icon: '🩺',
        label: 'แผ่นบันทึก Humane endpoint', hint: 'รายสัปดาห์ · เลือกสัปดาห์ หรือแผ่นเปล่า' });
    }
    printItems.push({ key: 'death', icon: '✝', label: 'รายงานการตายของสัตว์ทดลอง', hint: 'LA Guide–AF 11.1-01' });
    printItems.push({ key: 'sick', icon: '🩺', label: 'บันทึกติดตามอาการสัตว์ป่วย', hint: 'LA Guide–AF 11.1-03 · หนึ่งแผ่นต่อตัว' });

    const modeBar = this.intake
      ? `<div class="weighing-banner intake">
           <span>🦠 <b>โหมดรับหนูเข้าโครงการ (น้ำหนักแรกเข้า)</b> — แตะกรงว่างเพื่อชั่งน้ำ/อาหาร แล้วชั่งหนูเข้ากรง · เหลือ ${emptyCages.length} กรงว่าง</span>
           <span class="spacer"></span>
           <button class="btn" id="exitIntake">เสร็จสิ้น</button>
         </div>`
      : this.weighing
      ? (() => {
          const total = p.cages.filter(c => c.mice.some(m => m.alive)).length;
          const done = this.weighSession ? this.weighSession.done.size : 0;
          return `<div class="weighing-banner">
           <span>⚖️ <b>โหมดชั่งน้ำหนัก</b> — แตะกรงที่ต้องการเริ่มบันทึก (กรงสีเขียว = บันทึกแล้ว)</span>
           <span class="weigh-progress${done >= total && total ? ' full' : ''}">ชั่งแล้ว ${done} / ${total} กรง</span>
           <span class="spacer"></span>
           <button class="btn" id="exitWeighing">ออกจากโหมด</button>
           <button class="btn btn-green" id="finishWeighing" ${!done ? 'disabled' : ''}>✓ เสร็จสิ้น${this.recRoundLabel()}</button>
         </div>`;
        })()
      : this.caring
      ? (() => {
          const total = p.cages.filter(c => c.mice.length).length;
          const done = this.careSession ? this.careSession.done.size : 0;
          return `<div class="weighing-banner care">
           <span>🧹 <b>โหมดตรวจดูแลกรง</b> — แตะกรงเพื่อตรวจ Animals · Feed · Water · Cage (กรงสีเขียว = ตรวจแล้ว)</span>
           <span class="weigh-progress${done >= total && total ? ' full' : ''}">ตรวจแล้ว ${done} / ${total} กรง</span>
           <span class="spacer"></span>
           <button class="btn" id="exitCare">ออกจากโหมด</button>
           <button class="btn btn-green" id="finishCare" ${!done ? 'disabled' : ''}>✓ เสร็จสิ้น${this.recRoundLabel()}</button>
         </div>`;
        })()
      : this.dosing
      ? (() => {
          const mice = p.cages.flatMap(c => c.mice.filter(m => m.alive));
          const done = this.doseSession ? this.doseSession.done.size : 0;
          // เลือกหลายกรงจากผัง — ชิปกลุ่มทดสอบเป็นแค่ทางลัดในการเลือก ไม่ใช่คนละกลไก
          if (this.dosePick) {
            const picked = [...(this.doseSel || [])];
            const nMice = picked.reduce((s, id) => {
              const c = p.cages.find(x => x.id === id);
              return s + (c ? c.mice.filter(m => m.alive).length : 0);
            }, 0);
            const chips = (p.groups || []).map(g => {
              const cages = p.cages.filter(c => c.groupId === g.id && c.mice.some(m => m.alive));
              if (!cages.length) return '';
              const all = cages.every(c => this.doseSel.has(c.id));
              return `<button class="btn btn-sm gchip ${all ? 'on' : ''}" data-gpick="${g.id}"
                       style="--gc:${g.color}">${g.name} <b>${cages.length}</b></button>`;
            }).join('');
            return `<div class="weighing-banner dose col">
             <div class="eb-top">
               <span>☑️ <b>เลือกหลายกรง</b> — แตะกรงบนผังเพื่อเลือก แล้วบันทึกครั้งเดียวให้ทุกตัวที่เลือก</span>
               <span class="weigh-progress${nMice ? ' full' : ''}">เลือกแล้ว ${picked.length} กรง · ${nMice} ตัว</span>
               <span class="spacer" style="flex:1"></span>
               <button class="btn" id="cancelPick">ยกเลิก</button>
               <button class="btn btn-primary" id="doseSelected" ${nMice ? '' : 'disabled'}>บันทึก ${nMice} ตัว →</button>
             </div>
             <div class="eb-modes">
               <span class="gchip-label">เลือกทั้งกลุ่ม:</span>${chips}
               <button class="btn btn-sm" id="pickNone">ล้างที่เลือก</button>
             </div>
           </div>`;
          }
          return `<div class="weighing-banner dose">
           <span>💉 <b>โหมดให้สารทดสอบ</b> — แตะกรงเพื่อเลือกหนูในกรงนั้น</span>
           <span class="weigh-progress${done >= mice.length && mice.length ? ' full' : ''}">บันทึกแล้ว ${done} / ${mice.length} ตัว</span>
           <span class="spacer"></span>
           <button class="btn" id="doseRepeat">🔁 ทำเหมือนรอบที่แล้ว</button>
           <button class="btn" id="startPick">☑️ เลือกหลายกรง</button>
           <button class="btn" id="exitDose">ออกจากโหมด</button>
           <button class="btn btn-green" id="finishDose" ${!done ? 'disabled' : ''}>✓ เสร็จสิ้นรอบนี้</button>
         </div>`;
        })()
      : this.editing
      ? `<div class="edit-banner col">
           <div class="eb-top">
             <span>✏️ <b>จัดการกรง</b> — เลือกสิ่งที่ต้องการทำ (ทำได้ทีละอย่าง)</span>
             <span class="spacer" style="flex:1"></span>
             <button class="btn" id="exitEditing">เสร็จสิ้น</button>
           </div>
           <div class="eb-modes">
             <button class="btn eb-mode ${this.editMode === 'diet' ? 'on' : ''}" data-editmode="diet">🍚 กำหนดชนิดอาหาร</button>
             <button class="btn eb-mode ${this.editMode === 'group' ? 'on' : ''}" data-editmode="group">💊 กำหนดกลุ่มทดสอบ</button>
             <button class="btn eb-mode ${this.editMode === 'move' ? 'on' : ''}" data-editmode="move">↔️ ย้ายกรงไปชั้นอื่น</button>
           </div>
           ${this.editModePanel(p)}
         </div>`
      : `<div class="mode-bar">
           <span style="flex:1"></span>
           <button class="btn" id="healthBoard">🩺 สุขภาพสัตว์</button>
           <button class="btn" id="supplyReport">💧 น้ำ-อาหาร</button>
           <button class="btn" id="sickReport">🩺 ติดตามอาการป่วย</button>
           <button class="btn" id="deathReport">✝ รายงานการตาย</button>
           ${this.printMenu('docPrint', 'พิมพ์เอกสาร', printItems)}
           ${this.can('viewReports', p) ? `<button class="btn" data-nav="reports">📈 กราฟ</button>` : ''}
           ${canCare ? `<button class="btn btn-primary" id="startCare">🧹 ตรวจดูแลกรง</button>` : ''}
           ${canDose ? `<button class="btn btn-primary" id="startDose">💉 ให้สารทดสอบ</button>` : ''}
           ${canIntake ? `<button class="btn btn-primary" id="startIntake">🐭 รับหนูเข้าโครงการ (${emptyCages.length} กรงว่าง)</button>` : ''}
           ${canWeigh && !this.isEmptyProject(p) ? `<button class="btn btn-primary" id="startWeighing">⚖️ ชั่งน้ำหนัก</button>` : ''}
         </div>`;

    this.shell(
      `<a data-nav="project" data-project-id="${p.id}">${p.name}</a>`,
      `<div class="page wide">
        <div class="page-head">
          <div><h2>${p.name} ${closed ? '<span class="pill closed">ปิดแล้ว</span>' : ''}</h2>
            <div class="desc">${p.description}${closed ? ' · โครงการปิดแล้ว (ดูอย่างเดียว)' : ''}</div>
            ${this.facilityLine(p) ? `<div class="desc loc">📍 ${this.facilityLine(p)}</div>` : ''}</div>
          <span class="spacer" style="flex:1"></span>
          ${canRecord ? this.recBtn() : ''}
        </div>
        ${this.recOn() ? `<div class="rec-banner">
            <span>⏱ <b>กำลังบันทึกย้อนหลัง</b> — ทุกรายการที่บันทึกจะลงวันที่ <b>${this.thaiDate(this.rec.date)}${this.rec.time ? ' ' + this.rec.time : ''}</b>
              · เหตุผล: ${this.esc(this.rec.why)}</span>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-sm" id="recEdit">แก้ไข</button>
            <button class="btn btn-sm" id="recOff">↩︎ กลับมาบันทึกวันนี้</button>
          </div>` : ''}
        ${modeBar}
        ${shelves.join('')}
        <div class="legend legend-footer">
          <b style="color:var(--text)">กรง:</b>
          <span><i class="dot normal"></i> ปกติ</span>
          <span><i class="dot care"></i> กำลังรักษา/ดูแล</span>
          <span><i class="dot flag"></i> แจ้งผิดปกติ (รอ VET)</span>
          <span><i class="dot danger"></i> สั่งการุณยฆาต</span>
          <span class="legend-sep"></span>
          <b style="color:var(--text)">หนู:</b>
          <span><i class="dot good"></i> น้ำหนักขึ้นปกติ</span>
          <span><i class="dot warn"></i> ขึ้นน้อยกว่ากำหนด</span>
          <span><i class="dot bad"></i> ลด/ไม่เพิ่ม</span>
          <span><span class="treat-mark">+</span> กำลังรักษา</span>
          <span><span class="flag-mark">!</span> แจ้งผิดปกติ</span>
          <span><span class="frozen-mark">❄</span> ซากแช่แข็ง รอจัดการ</span>
        </div>
      </div>`
    );

    if (canRecord) {
      this.el('recDateBtn').addEventListener('click', () => this.openRecDate(p));
      if (this.recOn()) {
        this.el('recEdit').addEventListener('click', () => this.openRecDate(p));
        this.el('recOff').addEventListener('click', () => {
          this.recReset();
          this.log('กลับมาบันทึกตามวันจริง', 'ปิดโหมดบันทึกย้อนหลัง', p.name);
          this.toast('กลับมาบันทึกเป็นวันนี้แล้ว');
          this.renderDashboard();
        });
      }
    }

    if (canWeigh && !this.isEmptyProject(p) && !this.weighing && !this.editing && !this.intake && !this.caring && !this.dosing) {
      this.el('startWeighing').addEventListener('click', () => {
        this.weighing = true;
        this.weighSession = { done: new Set() };   // no cage weighed yet this round
        this.renderDashboard();
      });
    }
    if (canIntake && !this.weighing && !this.editing && !this.intake && !this.caring && !this.dosing) {
      this.el('startIntake').addEventListener('click', () => { this.intake = true; this.renderDashboard(); });
    }
    if (canCare && !this.weighing && !this.editing && !this.intake && !this.caring && !this.dosing) {
      this.el('startCare').addEventListener('click', () => {
        this.caring = true;
        this.careSession = { done: new Set() };
        this.renderDashboard();
      });
    }
    if (canDose && !this.weighing && !this.editing && !this.intake && !this.caring && !this.dosing) {
      this.el('startDose').addEventListener('click', () => {
        this.dosing = true;
        this.doseSession = { done: new Set() };
        this.renderDashboard();
      });
    }
    if (this.dosing && this.dosePick) {
      this.el('cancelPick').onclick = () => { this.dosePick = false; this.doseSel = new Set(); this.renderDashboard(); };
      this.el('pickNone').onclick = () => { this.doseSel = new Set(); this.renderDashboard(); };
      document.querySelectorAll('[data-gpick]').forEach(b => b.onclick = () => {
        const cages = p.cages.filter(c => c.groupId === b.dataset.gpick && c.mice.some(m => m.alive));
        const all = cages.every(c => this.doseSel.has(c.id));
        cages.forEach(c => (all ? this.doseSel.delete(c.id) : this.doseSel.add(c.id)));
        this.renderDashboard();
      });
      this.el('doseSelected').onclick = () => {
        const cages = p.cages.filter(c => this.doseSel.has(c.id));
        const mice = cages.flatMap(c => c.mice.filter(m => m.alive));
        if (!mice.length) return;
        this.openDoseForm(p, mice, {
          where: `${cages.length} กรง (${cages.map(c => c.code).join(', ')})`,
          back: () => { this.dosePick = false; this.doseSel = new Set(); this.closeModal(); this.renderDashboard(); },
        });
      };
    }
    if (this.dosing && !this.dosePick) {
      this.el('startPick').addEventListener('click', () => {
        this.dosePick = true; this.doseSel = new Set(); this.renderDashboard();
      });
      this.el('doseRepeat').addEventListener('click', () => this.openDoseRepeat(p));
    }
    if (this.dosing) {
      this.el('exitDose')?.addEventListener('click', () => {
        this.dosing = false; this.doseSession = null;
        this.dosePick = false; this.doseSel = new Set();
        this.renderDashboard();
      });
      this.el('finishDose')?.addEventListener('click', () => {
        const mice = p.cages.flatMap(c => c.mice.filter(m => m.alive));
        const done = this.doseSession ? this.doseSession.done.size : 0;
        const today = this.recDate();
        const paused = mice.filter(m => (m.doses || []).some(d => d.date === today && d.paused)).length;
        const finish = () => {
          this.log('เสร็จสิ้นรอบให้สารทดสอบ', `${done}/${mice.length} ตัว${paused ? ` · พัก ${paused} ตัว` : ''}`, p.name);
          this.notify({ kind: 'dose', title: `ให้สารทดสอบ${this.recRoundLabel()}เสร็จแล้ว`,
            detail: `บันทึก ${done} จาก ${mice.length} ตัว${done < mice.length ? ' (ยังไม่ครบ)' : ''}`
              + (paused ? ` · พักการทดสอบ ${paused} ตัว` : ''),
            project: p, to: this.nResearchers(p), link: { type: 'dashboard' } });
          this.dosing = false; this.doseSession = null;
          this.toast('ปิดรอบให้สารแล้ว — แจ้งผู้วิจัยเรียบร้อย');
          this.renderDashboard();
        };
        if (done < mice.length) {
          this.confirmDialog({
            title: 'ยังบันทึกไม่ครบทุกตัว',
            body: `บันทึกไปแล้ว <b>${done}</b> จาก <b>${mice.length}</b> ตัว — ปิดรอบเลยหรือไม่?<br>
                   ระบบจะแจ้งผู้วิจัยว่ารอบนี้ยังไม่ครบ`,
            okLabel: 'ปิดรอบเลย', onOk: finish,
          });
        } else finish();
      });
    }
    if (this.caring) {
      this.el('exitCare').addEventListener('click', () => {
        this.caring = false; this.careSession = null; this.renderDashboard();
      });
      // B4 — closing the round is what tells the research team the cages were
      // checked today, and how many turned up something wrong
      this.el('finishCare').addEventListener('click', () => {
        const cages = p.cages.filter(c => c.mice.length);
        const done = this.careSession ? this.careSession.done.size : 0;
        const today = this.recDate();
        const bad = cages.filter(c => (c.careLog || []).some(r =>
          r.date === today && this.CARE_ITEMS.some(it => r.items[it.key].status === 'abnormal'))).length;
        const finish = () => {
          this.log('เสร็จสิ้นรอบตรวจดูแลกรง', `${done}/${cages.length} กรง · ผิดปกติ ${bad} กรง`, p.name);
          this.notify({ kind: 'care', title: `ตรวจดูแลกรง${this.recRoundLabel()}เสร็จแล้ว`,
            detail: `ตรวจ ${done} จาก ${cages.length} กรง${done < cages.length ? ' (ยังไม่ครบ)' : ''}`
              + (bad ? ` · พบผิดปกติ ${bad} กรง` : ' · ปกติทุกกรง'),
            project: p, to: this.nResearchers(p), link: { type: 'dashboard' } });
          this.caring = false; this.careSession = null;
          this.toast('ปิดรอบตรวจแล้ว — แจ้งผู้วิจัยเรียบร้อย');
          this.renderDashboard();
        };
        if (done < cages.length) {
          this.confirmDialog({
            title: 'ยังตรวจไม่ครบทุกกรง',
            body: `ตรวจไปแล้ว <b>${done}</b> จาก <b>${cages.length}</b> กรง — ปิดรอบเลยหรือไม่?<br>
                   ระบบจะแจ้งผู้วิจัยว่ารอบนี้ยังไม่ครบ`,
            okLabel: 'ปิดรอบเลย', onOk: finish,
          });
        } else finish();
      });
    }
    if (this.intake) {
      this.el('exitIntake').addEventListener('click', () => { this.intake = false; this.renderDashboard(); });
    }
    if (this.weighing) {
      this.el('exitWeighing').addEventListener('click', () => {
        this.weighing = false;
        this.weighSession = null;
        this.renderDashboard();
      });
      // B1 — closing the round is a deliberate act, not just leaving the mode:
      // it is what tells the research team the day's data is ready.
      this.el('finishWeighing').addEventListener('click', () => {
        const total = p.cages.filter(c => c.mice.some(m => m.alive)).length;
        const done = this.weighSession ? this.weighSession.done.size : 0;
        const finish = () => {
          this.log('เสร็จสิ้นรอบชั่งน้ำหนัก', `${done}/${total} กรง`, p.name);
          this.notify({ kind: 'weigh', title: `ชั่งน้ำหนัก${this.recRoundLabel()}เสร็จแล้ว`,
            detail: `บันทึก ${done} จาก ${total} กรง${done < total ? ' (ยังไม่ครบ)' : ''}`,
            project: p, to: this.nResearchers(p), link: { type: 'dashboard' } });
          this.weighing = false;
          this.weighSession = null;
          this.toast(`ปิดรอบชั่งแล้ว — แจ้งผู้วิจัยเรียบร้อย`);
          this.renderDashboard();
        };
        if (done < total) {
          this.confirmDialog({
            title: 'ยังชั่งไม่ครบทุกกรง',
            body: `บันทึกไปแล้ว <b>${done}</b> จาก <b>${total}</b> กรง — ปิดรอบเลยหรือไม่?<br>
                   ระบบจะแจ้งผู้วิจัยว่ารอบนี้ยังไม่ครบ`,
            okLabel: 'ปิดรอบเลย', onOk: finish,
          });
        } else finish();
      });
    }
    if (!this.weighing && !this.editing && !this.intake && !this.caring && !this.dosing) {
      this.el('healthBoard').addEventListener('click', () => this.openHealthBoard(p));
      this.el('supplyReport').addEventListener('click', () => this.openSupplyReport(p));
      this.el('sickReport').addEventListener('click', () => this.openSickReport(p));
      this.el('deathReport').addEventListener('click', () => this.openDeathReport(p));
      this.bindPrintMenu('docPrint', (key) => {
        if (key === 'cagecard') return this.openCageCards(p);
        if (key === 'humane') return this.openHumaneSheets(p);
        if (key === 'death') {
          this.printDocument(`DeathReport_${p.name}`, this.buildDeathReportDoc(p));
          return this.log('Export PDF', `รายงานการตาย · ${p.name}`, p.name);
        }
        if (key === 'sick') {
          this.printDocument(`SickFollowup_${p.name}`, this.buildSickReportDoc(p));
          this.log('Export PDF', `ติดตามอาการป่วย · ${p.name}`, p.name);
        }
      });
    }
    if (this.editing) {
      this.el('exitEditing').addEventListener('click', () => {
        this.editing = false; this.editMode = null; this.moveCageId = null; this.renderDashboard();
      });
      // pick which of the three jobs to do — switching resets the armed brush/selection
      document.querySelectorAll('[data-editmode]').forEach(b => b.onclick = () => {
        const m = b.dataset.editmode;
        this.editMode = this.editMode === m ? null : m;
        this.dietBrush = null; this.groupBrush = null; this.moveCageId = null;
        this.renderDashboard();
      });
      document.querySelectorAll('[data-diet]').forEach(b => b.onclick = () => {
        this.dietBrush = this.dietBrush === b.dataset.diet ? null : b.dataset.diet;
        this.renderDashboard();
      });
      document.querySelectorAll('[data-group]').forEach(b => b.onclick = () => {
        this.groupBrush = this.groupBrush === b.dataset.group ? null : b.dataset.group;
        this.renderDashboard();
      });
      const cm = this.el('cancelMove');
      if (cm) cm.onclick = () => { this.moveCageId = null; this.renderDashboard(); };
      // ย้ายกรงไปชั้นอื่น — the cage keeps its code, mice and grouping; only its shelf changes
      document.querySelectorAll('[data-moveto]').forEach(b => b.onclick = () => {
        const cage = p.cages.find(x => x.id === this.moveCageId);
        if (!cage) return;
        const to = +b.dataset.moveto;
        const from = cage.shelf;
        cage.shelf = to;
        cage.shelfLabel = (p.shelfNames && p.shelfNames[to]) || String(to);
        cage.position = p.cages.filter(x => x.shelf === to && x !== cage).reduce((mx, x) => Math.max(mx, x.position), 0) + 1;
        // close the gap the cage left behind so positions stay 1..N on the old shelf
        p.cages.filter(x => x.shelf === from).sort((a, b) => a.position - b.position)
          .forEach((x, i) => { x.position = i + 1; });
        this.moveCageId = null;
        this.log('ย้ายกรง', `${cage.code} · ชั้น ${(p.shelfNames && p.shelfNames[from]) || from} → ${(p.shelfNames && p.shelfNames[to]) || to}`, p.name);
        this.toast(`ย้ายกรง ${cage.code} ไปชั้น ${(p.shelfNames && p.shelfNames[to]) || to} แล้ว`);
        this.renderDashboard();
      });
    }
    // cage clicks
    document.querySelectorAll('[data-cage]').forEach(elm => {
      elm.addEventListener('click', () => {
        const cage = Data.getCage(p, elm.dataset.cage);
        if (this.editing) this.applyCageEdit(p, cage);
        else if (this.intake) {
          if (cage.mice.length) { this.toast(`กรง ${cage.code} มีหนูอยู่แล้ว`); return; }
          this.openIntakeCage(p, cage);
        }
        else if (this.weighing) this.startWizard(p, cage);
        else if (this.caring) {
          if (!cage.mice.length) { this.toast(`กรง ${cage.code} ยังไม่มีหนู — ไม่ต้องตรวจ`); return; }
          this.startCareWizard(p, cage);
        }
        else if (this.dosing) {
          if (this.dosePick) {
            if (!cage.mice.some(m => m.alive)) { this.toast(`กรง ${cage.code} ไม่มีหนู`); return; }
            this.doseSel.has(cage.id) ? this.doseSel.delete(cage.id) : this.doseSel.add(cage.id);
            return this.renderDashboard();
          }
          this.openDoseCage(p, cage);
        }
        else if (this.can('viewCage', p)) this.openCagePopup(p, cage);
        // IACUC / AUDIT see the layout but never open a cage's animals
      });
    });
  },

  // tapping a cage while in จัดการกรง — what happens depends on the active sub-mode.
  // Assigning a layer for the FIRST time is immediate; CHANGING an existing decision
  // asks the user to type CONFIRM_PHRASE, because it rewrites how the data is grouped
  // (and, for กลุ่มทดสอบ, renumbers the animals' tags).
  applyCageEdit(p, cage) {
    if (this.editMode === 'diet') {
      if (!this.dietBrush) { this.toast('เลือกชนิดอาหารจากแถบด้านบนก่อน'); return; }
      if (!cage.mice.length) { this.toast(`กรง ${cage.code} ยังไม่มีหนู`); return; }
      const apply = () => {
        const r = this.assignCageDiet(p, cage, this.dietBrush);
        if (!r.ok) { this.toast(r.msg); return; }
        if (r.changed) this.log('กำหนดชนิดอาหาร', `${cage.code} → ${(this.cageDiet(p, cage) || {}).name || '—'}`, p.name);
        this.renderDashboard();
      };
      const from = this.diets(p).find(x => x.id === cage.dietId);   // null ⇒ ยังไม่เคยกำหนด
      if (!from) return apply();
      const to = this.diets(p).find(x => x.id === this.dietBrush);
      if (from.id === (to && to.id)) return;
      return this.confirmDialog({
        title: `เปลี่ยนชนิดอาหารของกรง ${cage.code}?`,
        body: `<b>${from.name}</b> → <b>${to ? to.name : '—'}</b> · มีผลกับหนู ${cage.mice.length} ตัวในกรงนี้`
          + `<div class="confirm-note">กรงนี้ถูกกำหนดอาหารไปแล้ว การแก้ไขจะเปลี่ยนการจัดกลุ่มของข้อมูลที่บันทึกไว้</div>`,
        okLabel: 'ยืนยันการแก้ไข', requireText: this.CONFIRM_PHRASE, onOk: apply,
      });
    }
    if (this.editMode === 'group') {
      if (!this.groupBrush) { this.toast('เลือกกลุ่มทดสอบจากแถบด้านบนก่อน'); return; }
      if (!cage.mice.length) { this.toast(`กรง ${cage.code} ยังไม่มีหนู`); return; }
      const target = this.groupBrush === '__none__' ? null : this.groupBrush;
      const apply = () => {
        const r = this.assignCageGroup(p, cage, target);
        if (!r.ok) { this.toast(r.msg); return; }
        if (r.changed) {
          this.log('กำหนดกลุ่มทดสอบ', `${cage.code} → ${(this.cageGroup(p, cage) || {}).name || 'เอาออกจากกลุ่ม'}`, p.name);
          // B3 — all cages grouped: the operators can begin dosing
          if (p.cages.length && p.cages.every(c => c.groupId)) {
            this.notify({ kind: 'group', title: 'จัดกลุ่มทดสอบครบทุกกรงแล้ว',
              detail: 'เริ่มให้สารตามโปรโตคอลได้', project: p,
              to: [...this.nTo.roles(p, ['SCI', 'AHS']), ...this.nTo.position('SCI')],
              link: { type: 'dashboard' } });
          }
        }
        this.renderDashboard();
      };
      const from = this.cageGroup(p, cage);                          // null ⇒ ยังไม่เคยจัดกลุ่ม
      if (!from) { if (!target) return; return apply(); }
      if (from.id === target) return;
      const to = target ? (p.groups || []).find(g => g.id === target) : null;
      return this.confirmDialog({
        title: `เปลี่ยนกลุ่มทดสอบของกรง ${cage.code}?`,
        body: `<b>${from.name}</b> → <b>${to ? to.name : 'เอาออกจากกลุ่ม'}</b> · มีผลกับหนู ${cage.mice.length} ตัวในกรงนี้`
          + `<div class="confirm-note">ลำดับในกลุ่มเดิม (${cage.mice.map(m => '#' + m.groupNo).join(', ')}) จะถูกคืนและออกใหม่ — รหัสกำกับของหนูจะเปลี่ยนตาม</div>`,
        okLabel: 'ยืนยันการแก้ไข', requireText: this.CONFIRM_PHRASE, onOk: apply,
      });
    }
    if (this.editMode === 'move') {
      this.moveCageId = this.moveCageId === cage.id ? null : cage.id;
      return this.renderDashboard();
    }
    this.toast('เลือกสิ่งที่ต้องการทำจากแถบด้านบนก่อน');
  },

  cageCard(p, cage, maxMice = cage.mice.length) {
    const group = Data.getGroup(p, cage.groupId);

    const n = cage.mice.length || 1;
    // In weighing mode, a cage's values stay cleared (gray) until it has been weighed this round
    const weighed = !this.weighing || (this.weighSession && this.weighSession.done.has(cage.id));

    // reserve a dedicated badge lane only when this cage has a treatment mark,
    // so the weight column keeps full width in every other cage
    // how many badges the busiest mouse in this cage carries — a treated animal that
    // died and is now in the freezer shows two (+ ❄), so the id column must fit them
    const maxMarks = cage.mice.reduce((n, m) => Math.max(n,
      ((m.treatments && m.treatments.length) ? 1 : 0)
      + ((m.flagOpen && m.alive) ? 1 : 0)
      + ((!m.alive && m.death && m.death.carcass === 'frozen') ? 1 : 0)), 0);

    // per-mouse weight list — status shown by the coloured change value only
    const mouseList = cage.mice.map(m => {
      const cur = Data.latestWeight(m);
      const chg = Data.weightChange(m);
      const st = this.mouseStatus(m);
      const dead = !m.alive;
      const arrow = (dead || !weighed || chg == null) ? '' : `${chg >= 0 ? '▲' : '▼'}${this.g(Math.abs(chg))}`;
      return `<div class="mrow ${dead ? 'dead' : m.excluded ? 'stop' : ''}">
        <span class="mid">${m.cageNo != null ? m.cageNo : m.code.split('-').slice(-1)[0]}${this.treatMark(m)}${this.flagMark(m)}${this.frozenMark(m)}</span>
        <span class="mw">${dead ? '' : (weighed ? this.g(cur) : '–') + '<span class="unit">g</span>'}</span>
        <span class="chg ${weighed ? st : ''}">${arrow}</span>
      </div>`;
    }).join('');

    // water / food: total consumed with per-mouse value (cleared until weighed)
    const supply = (icon, total, per) => `
      <div class="s">
        <div class="s-main"><span class="s-ic">${icon}</span> ${weighed ? this.g(total) + 'g' : '–'}</div>
        <div class="s-avg">${weighed ? this.g(per) + ' g/ตัว' : ''}</div>
      </div>`;

    // status colour: weighing mode → gray (not weighed) / green (done); otherwise care/normal.
    // In intake mode the empty cages are the targets, so they glow and the filled ones dim.
    const isEmpty = !cage.mice.length;
    const cared = this.caring && this.careSession && this.careSession.done.has(cage.id);
    // กรงเขียวเมื่อหนูที่ยังมีชีวิตในกรงถูกบันทึกครบทุกตัวแล้ว
    const dosed = this.dosing && this.doseSession
      && cage.mice.filter(m => m.alive).length > 0
      && cage.mice.filter(m => m.alive).every(m => this.doseSession.done.has(m.id));
    const cageStatus = this.weighing ? (weighed ? 'done' : 'normal')
      : this.intake ? (isEmpty ? 'normal' : 'done')
      : this.caring ? (cared ? 'done' : 'normal')
      : this.dosing ? (this.dosePick ? 'normal' : (dosed ? 'done' : 'normal'))
      : this.cageStatus(cage);
    // จัดการกรง: only cages that can receive the current action look interactive
    const assignable = this.editing && (this.editMode === 'diet' || this.editMode === 'group') && !isEmpty;
    const noOpen = !this.weighing && !this.intake && !this.editing && !this.caring && !this.dosing && !this.can('viewCage', p);
    const modeCls = this.weighing ? 'selectable'
      : this.caring ? (isEmpty ? 'intake-filled' : 'selectable')
      : this.dosing ? (cage.mice.some(m => m.alive)
          ? (this.dosePick && this.doseSel.has(cage.id) ? 'selectable move-picked' : 'selectable')
          : 'intake-filled')
      : this.intake ? (isEmpty ? 'selectable intake-target' : 'intake-filled')
      : assignable ? 'selectable'
      : this.editing && this.editMode === 'move' ? (this.moveCageId === cage.id ? 'selectable move-picked' : 'selectable')
      : this.editing && this.editMode ? 'intake-filled'
      : '';
    const diet = this.cageDiet(p, cage);
    return `
      <div class="cage ${cageStatus} ${modeCls}${noOpen ? ' no-open' : ''}" style="--maxmice:${maxMice}" data-cage="${cage.id}">
        <div class="cage-top">
          <span class="cage-code">${cage.code}</span>
          <span class="cage-grp">${group ? group.name : (isEmpty ? '' : '<span class="ungrouped">ยังไม่จัดกลุ่ม</span>')}</span>
        </div>
        ${diet && !isEmpty ? `<div class="cage-diet" style="--dc:${diet.color}">🍚 ${diet.name}</div>` : ''}
        <div class="cage-main">
          <div class="cage-mice" style="--marks:${maxMarks}">${mouseList || '<span class="empty-note">ไม่มีหนู</span>'}</div>
          <div class="cage-supply">
            ${supply('💧', cage.water.consumed, cage.water.consumed / n)}
            ${supply('🍚', cage.food.consumed, cage.food.consumed / n)}
          </div>
        </div>
      </div>`;
  },

  // placeholder for a shelf that holds no cages at all. Cages are created only by AV
  // at build time — after the project starts they can no longer be added or removed.
  emptyCell(maxMice = 1) {
    return `<div class="cage empty" style="--maxmice:${maxMice}"><div class="empty-mark">ว่าง</div></div>`;
  },

  // ---------------------------------------------------------
  // Cage popup (normal mode)
  // ---------------------------------------------------------
  openCagePopup(p, cage) {
    // IACUC/AUDIT may walk the dashboard but not open a cage's animals
    if (!this.can('viewCage', p)) { this.toast('ตำแหน่งของคุณดูรายละเอียดรายกรงไม่ได้'); return; }
    this.refreshUnderlay(p);   // ผังกรงด้านหลังต้องตรงกับข้อมูลล่าสุดเสมอ
    // a cage the PI left empty at populate has NO group yet (groupId === null) —
    // it still renders on the dashboard, so every group read here must be guarded
    const group = Data.getGroup(p, cage.groupId);
    const controlChange = Data.controlAvgChange(p);
    const canTreat = this.can('treat', p);
    const canReportDeath = this.can('reportDeath', p);   // anyone on the team
    const canCarcass = this.can('handleCarcass', p);     // SCI / VET only
    const canStop = this.can('stop', p);      // PI / CoPI only
    const canFlag = this.can('flag', p);      // everyone in the project
    const operational = this.isOperational(p); // recording actions require an approved, open project

    const rows = cage.mice.map(m => {
      const cur = Data.latestWeight(m);
      const chg = Data.weightChange(m);
      const chgClass = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      const chgTxt = chg == null ? '–' : `${this.gs(chg)}g`;
      let vsControl = '–';
      if (chg != null && controlChange != null && group && !group.isControl) {
        vsControl = `${this.gs(chg - controlChange)}g`;
      } else if (group && group.isControl) {
        vsControl = '(กลุ่มควบคุม)';
      }
      const dead = !m.alive;
      const badges =
        (dead ? `<span class="m-badge dead">ตาย</span>` : '') +
        (!dead && m.humaneOrder ? `<span class="m-badge humane">สั่งการุณยฆาต</span>` : '') +
        (!dead && m.flagOpen ? `<span class="m-badge flag">⚠️ ผิดปกติ</span>` : '') +
        (m.excluded && !dead ? `<span class="m-badge stop">ไม่คิดเฉลี่ย</span>` : '');
      const items = [];
      if (!dead && operational) {
        if (m.flagOpen) items.push(`<div class="menu-item flag-wait">⚠️ รอ VET ตรวจสอบ</div>`);
        else if (canFlag && !m.careOpen) items.push(`<button class="menu-item flag" data-act="flag" data-mid="${m.id}">⚠️ แจ้งผิดปกติ</button>`);
        if (canStop) items.push(`<button class="menu-item stop" data-act="stop" data-mid="${m.id}">${m.excluded ? 'รวมกลับเข้าค่าเฉลี่ย' : 'Stop (ไม่คิดเฉลี่ย)'}</button>`);
        if (canReportDeath) items.push(`<button class="menu-item death" data-act="death" data-mid="${m.id}">แจ้งหนูตาย</button>`);
      }
      // a frozen carcass still needs SCI/VET to decide dispose vs necropsy
      const frozen = dead && m.death && m.death.carcass === 'frozen';
      const actions = dead
        ? (frozen && canCarcass && operational
            ? `<button class="mini-btn" data-act="carcass" data-mid="${m.id}">❄️ จัดการซาก</button>`
            : `<span class="empty-note" style="font-size:12px">${m.death ? this.deathLabel(m.death) : 'ตาย'}</span>`)
        : items.length
        ? `<div class="kebab-wrap">
             <button class="mini-btn kebab" data-act="menu" data-mid="${m.id}">⋯</button>
             <div class="kebab-menu" id="menu-${m.id}">${items.join('')}</div>
           </div>`
        : `<span style="color:var(--text-muted)">—</span>`;
      return `
        <tr class="${dead ? 'row-dead' : m.excluded ? 'row-stop' : ''}">
          <td data-mouse="${m.id}"><b>${m.code}</b> ${this.tagChip(p, cage, m)}${this.treatMark(m)}${this.frozenMark(m)}<span class="mono" style="color:var(--text-muted)"> (${m.sex === 'M' ? '♂' : '♀'})</span> ${badges}</td>
          <td class="num" data-mouse="${m.id}">${this.g(cur)} g</td>
          <td class="num" data-mouse="${m.id}"><span class="chg ${dead ? '' : chgClass}">${dead ? '–' : chgTxt}</span></td>
          <td class="num" data-mouse="${m.id}">${dead || m.excluded ? '—' : vsControl}</td>
          <td class="actions-cell">${actions}</td>
        </tr>`;
    }).join('');

    const n = cage.mice.length || 1;
    const wAvg = this.g(cage.water.consumed / n);
    const fAvg = this.g(cage.food.consumed / n);

    this.openModal(`
      <div class="modal-head">
        <div>
          <h3>กรง ${cage.code}</h3>
          <div class="sub">${group ? group.name : 'ยังไม่กำหนดกลุ่ม'} · บันทึกล่าสุด ${cage.lastRecordDate}</div>
          <div class="sub loc">📍 ${this.cageLocation(p, cage, false)}</div>
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="supply-summary">
          <div class="supply-box"><div class="l">💧 น้ำที่กินไป</div><div class="v">${this.g(cage.water.consumed)} g</div><div class="l">เฉลี่ย ${wAvg} g/ตัว · เหลือ ${this.g(cage.water.remaining)} g</div></div>
          <div class="supply-box"><div class="l">🍚 อาหารที่กินไป</div><div class="v">${this.g(cage.food.consumed)} g</div><div class="l">เฉลี่ย ${fAvg} g/ตัว · เหลือ ${this.g(cage.food.remaining)} g</div></div>
          <div class="supply-box"><div class="l">🐭 จำนวนหนู</div><div class="v">${cage.mice.length}</div></div>
        </div>
        ${(cage.supplyLog || []).length ? `<div class="supply-more">
          ตัวเลขข้างบนคือ<b>รอบล่าสุด</b>
          <button class="nt-link" id="cageSupplyHist">ดูย้อนหลังทั้งหมด (${cage.supplyLog.length} รอบ) →</button>
        </div>` : ''}
        <table class="data">
          <thead><tr><th>หนู</th><th>น้ำหนักล่าสุด</th><th>เปลี่ยนแปลง</th><th>เทียบกลุ่มควบคุม</th><th>ดำเนินการ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="empty-note">แตะที่หนูเพื่อดูกราฟน้ำหนัก ประวัติ${canTreat ? ' และเพิ่มการรักษา' : ' และการรักษา'}</p>
        ${this.lastCarePanel(cage)}
      </div>
      <div class="modal-foot">
        ${this.can('cageCard', p) ? `<button class="btn" id="printCard">🏷️ ใบติดหน้ากรง</button>` : ''}
        <span class="spacer"></span>
        <button class="btn" id="closeModal2">ปิด</button>
      </div>
    `);

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('closeModal2').onclick = () => this.closeModal();
    const sh = this.el('cageSupplyHist');
    if (sh) sh.onclick = () => this.openSupplyReport(p, cage.id);
    // reprint this cage's card once it actually holds animals and a group
    const pc = this.el('printCard');
    if (pc) pc.onclick = () => this.printCageCards(p, [cage], `_${cage.code}`);
    document.querySelectorAll('td[data-mouse]').forEach(td => {
      td.onclick = () => {
        const m = cage.mice.find(x => x.id === td.dataset.mouse);
        this.openMouseDetail(p, cage, m);
      };
    });
    document.querySelectorAll('.actions-cell [data-act]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        const m = cage.mice.find(x => x.id === btn.dataset.mid);
        if (act === 'menu') {
          const menu = this.el('menu-' + m.id);
          const wasOpen = menu.classList.contains('open');
          document.querySelectorAll('.kebab-menu.open').forEach(el => el.classList.remove('open'));
          if (!wasOpen) menu.classList.add('open');
          return;
        }
        if (act === 'stop') {
          m.excluded = !m.excluded;
          this.log(m.excluded ? 'Stop (ไม่คิดเฉลี่ย)' : 'ยกเลิก Stop', `${m.code}`, p.name);
          this.toast(m.excluded ? `หยุดคิดค่าเฉลี่ยของ ${m.code}` : `นำ ${m.code} กลับเข้าค่าเฉลี่ย`);
          this.openCagePopup(p, cage);              // refresh table
        } else if (act === 'death') {
          this.openDeathForm(p, cage, m);
        } else if (act === 'carcass') {
          this.openCarcassForm(p, cage, m);
        } else if (act === 'flag') {
          this.openFlagForm(p, cage, m);
        }
      };
    });
    // close any open kebab menu when clicking elsewhere in the modal
    document.querySelectorAll('.overlay').forEach(ov => {
      ov.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.kebab-wrap')) {
          document.querySelectorAll('.kebab-menu.open').forEach(el => el.classList.remove('open'));
        }
      });
    });
  },

  // short summary label for a recorded death. A carcass that has only been
  // reported (stage 1) is still in the freezer awaiting a SCI/VET decision.
  deathLabel(d) {
    const t = d.type === 'humane' ? 'Humane endpoint' : 'ตายเอง';
    if (!d.disposition) return `${t} · ❄️ แช่แข็ง รอจัดการซาก`;
    const disp = d.disposition === 'necropsy' ? 'ชันสูตร/เก็บตัวอย่าง' : 'ทำลายซาก';
    return `${t} · ${disp}`;
  },

  // report a mouse as "looking abnormal" (any member) — raises the orange flag for VET review
  openFlagForm(p, cage, mouse) {
    this.openModal(`
      <div class="modal-head">
        <div><h3>⚠️ แจ้งหนูผิดปกติ — ${mouse.code}</h3><div class="sub">กรง ${cage.code} · แจ้งเพื่อให้ VET เข้าตรวจสอบ</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <p class="empty-note" style="margin-bottom:12px">แจ้งว่าหนูดู “ผิดปกติ” (ยังไม่ใช่การวินิจฉัยว่าป่วย) — ระบบจะปักธงสีส้มไว้ให้สัตวแพทย์เข้ามาตรวจสอบและตัดสินใจ</p>
        <div class="field">
          <label>ผิดปกติอย่างไร <span style="color:var(--red)">*</span></label>
          <textarea id="flagNote" rows="4" placeholder="เช่น ขนยุ่ง ซึม ไม่ขยับ · หายใจเร็ว · ตาบวม · เดินเอียง ฯลฯ">${mouse.flag ? mouse.flag.note : ''}</textarea>
        </div>
        <div class="field"><label>ผู้แจ้ง</label><input id="flagBy" value="${this.user.name}"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelFlag">ยกเลิก</button>
        <button class="btn btn-primary" id="saveFlag">🚩 แจ้งผิดปกติ</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.afterMouseForm(p, cage);
    this.el('cancelFlag').onclick = () => this.afterMouseForm(p, cage);
    this.el('saveFlag').onclick = () => {
      const note = this.el('flagNote').value.trim();
      if (!note) { this.el('flagNote').focus(); this.toast('กรุณาระบุลักษณะที่ผิดปกติ'); return; }
      mouse.flagOpen = true;
      mouse.flag = { by: this.el('flagBy').value.trim() || this.user.name, note, date: this.recDate(), ...this.recStamp() };
      this.logHealth(mouse, { source: 'flag', status: 'abnormal', note });
      this.log('แจ้งหนูผิดปกติ', `${mouse.code} · ${note}`, p.name);
      // C1 — an animal is flagged: the vet has to look at it
      this.notify({ kind: 'flag', title: '⚠️ มีหนูถูกแจ้งผิดปกติ รอสัตวแพทย์ตรวจ',
        detail: `${mouse.code} · ${note}`, project: p, to: this.nVets(p),
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      this.toast(`ปักธงผิดปกติที่ ${mouse.code} — รอ VET ตรวจสอบ`);
      this.afterMouseForm(p, cage);
    };
  },

  // STAGE 1 — report a death (`reportDeath`, anyone on the team).
  // The carcass goes to the freezer; SCI/VET decide dispose vs necropsy later.
  openDeathForm(p, cage, mouse) {
    const d = mouse.death || {};
    this.openModal(`
      <div class="modal-head">
        <div><h3>✝ แจ้งหนูตาย — ${mouse.code}</h3><div class="sub">กรง ${cage.code}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <p class="empty-note" style="margin-bottom:12px">
          แจ้งว่าพบหนูตาย — ระบบจะบันทึกว่า <b>นำซากไปแช่แข็ง</b> ไว้ก่อน
          แล้วรอ <b>นักวิทยาศาสตร์ (Sci) หรือสัตวแพทย์ (VET)</b> เข้ามาตัดสินใจว่าจะทำลายซากหรือส่งชันสูตรตามโปรโตคอล
        </p>
        <div class="form-row3">
          <div class="field"><label>วันที่ (Date)</label><input id="deathDate" value="${d.date || this.recDate()}"></div>
          <div class="field"><label>เวลา (Time)</label><input id="deathTime" value="${d.time || this.recTime()}"></div>
          <div class="field"><label>ผู้รายงาน (Reporter)</label><input id="deathReporter" value="${d.reporter || this.user.name}"></div>
        </div>
        <div class="field">
          <label>ลักษณะการตาย</label>
          <div class="choice-row" id="deathType">
            <button type="button" class="choice ${d.type === 'natural' ? 'sel' : ''}" data-v="natural">🕊️ ตายเอง</button>
            <button type="button" class="choice ${d.type === 'humane' ? 'sel' : ''}" data-v="humane">💉 สั่งให้ตาย (Humane endpoint)</button>
          </div>
        </div>
        <div class="field">
          <label>รายละเอียด / หมายเหตุ (Clinical Sign ก่อนตาย)</label>
          <textarea id="deathNote" rows="3" placeholder="เช่น พบตายในกรงตอนเช้า, อาการก่อนตาย ฯลฯ">${d.note || ''}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelDeath">ยกเลิก</button>
        <button class="btn btn-danger" id="saveDeath">❄️ แจ้งตาย & นำไปแช่แข็ง</button>
      </div>
    `);

    let type = d.type || null;
    this.el('deathType').querySelectorAll('.choice').forEach(b => {
      b.onclick = () => {
        type = b.dataset.v;
        this.el('deathType').querySelectorAll('.choice').forEach(x => x.classList.toggle('sel', x === b));
      };
    });

    this.el('closeModal').onclick = () => this.afterMouseForm(p, cage);
    this.el('cancelDeath').onclick = () => this.afterMouseForm(p, cage);
    this.el('saveDeath').onclick = () => {
      if (!type) { this.toast('กรุณาเลือกลักษณะการตาย'); return; }
      mouse.alive = false;
      mouse.excluded = true;   // dead → out of stats automatically
      mouse.careOpen = false;
      mouse.flagOpen = false; mouse.flag = null;   // abnormal flag resolved on death
      mouse.humaneOrder = null; // order fulfilled once death is recorded
      mouse.death = {
        type,
        carcass: 'frozen',      // stage 1 done — awaiting SCI/VET
        disposition: null,
        note: this.el('deathNote').value.trim(),
        date: this.el('deathDate').value || this.recDate(),
        time: this.el('deathTime').value.trim(),
        reporter: this.el('deathReporter').value.trim(),
        handledBy: '', handledAt: '',
        ...this.recStamp(),
      };
      this.logHealth(mouse, { source: 'death', status: 'dead',
        note: `${type === 'humane' ? 'การุณยฆาตตามคำสั่งสัตวแพทย์' : 'พบตายในกรง'}${mouse.death.note ? ' — ' + mouse.death.note : ''}`,
        date: mouse.death.date, time: mouse.death.time });
      this.log('แจ้งหนูตาย', `${mouse.code} · ${this.deathLabel(mouse.death)}`, p.name);
      // C5 — the death itself
      this.notify({ kind: 'death', title: 'มีหนูตายในโครงการ',
        detail: `${mouse.code} · ${this.deathLabel(mouse.death)}`, project: p,
        to: [...this.nResearchers(p), ...this.nVets(p)],
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      // C6 — and the carcass is now in the freezer waiting for dispose/necropsy
      this.notify({ kind: 'carcass', title: '❄️ มีซากรอจัดการ (ทำลาย / ชันสูตร)',
        detail: mouse.code, project: p,
        to: [...this.nTo.roles(p, ['SCI', 'VET']), ...this.nTo.position('SCI'), ...this.nTo.position('AV')],
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      this.toast(`บันทึกแล้ว — ซากของ ${mouse.code} อยู่ระหว่างแช่แข็ง รอ Sci/VET จัดการ`);
      this.afterMouseForm(p, cage);
    };
  },

  // STAGE 2 — decide what happens to the frozen carcass (`handleCarcass`, SCI/VET).
  openCarcassForm(p, cage, mouse) {
    const d = mouse.death || {};
    this.openModal(`
      <div class="modal-head">
        <div><h3>❄️ จัดการซาก — ${mouse.code}</h3><div class="sub">กรง ${cage.code} · แจ้งตายเมื่อ ${d.date || '—'} ${d.time || ''} โดย ${d.reporter || '—'}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <p class="empty-note" style="margin-bottom:12px">ตัดสินใจตามโปรโตคอลของโครงการ — หากเลือกชันสูตร ระบบจะเปิดฟอร์มบันทึกการผ่าชันสูตรซาก (LA Guide-AF 11.3-01) ต่อทันที</p>
        <div class="field">
          <label>ผลการตัดสินใจ</label>
          <div class="choice-row" id="carcassDisp">
            <button type="button" class="choice" data-v="dispose">🗑️ ทำลายซาก</button>
            <button type="button" class="choice" data-v="necropsy">🔬 ชันสูตร / เก็บตัวอย่าง</button>
          </div>
        </div>
        <div class="form-row3">
          <div class="field"><label>ผู้ดำเนินการ</label><input id="carcassBy" value="${this.user.name}"></div>
          <div class="field"><label>วันที่</label><input id="carcassAt" value="${this.recDate()}"></div>
        </div>
        <div class="field">
          <label>หมายเหตุเพิ่มเติม</label>
          <textarea id="carcassNote" rows="2" placeholder="เช่น ตัวอย่างที่เก็บ, เหตุผลที่ไม่ชันสูตร">${d.note || ''}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelCarcass">ยกเลิก</button>
        <button class="btn btn-primary" id="saveCarcass">บันทึก</button>
      </div>
    `);

    let disp = null;
    this.el('carcassDisp').querySelectorAll('.choice').forEach(b => {
      b.onclick = () => {
        disp = b.dataset.v;
        this.el('carcassDisp').querySelectorAll('.choice').forEach(x => x.classList.toggle('sel', x === b));
      };
    });
    this.el('closeModal').onclick = () => this.openCagePopup(p, cage);
    this.el('cancelCarcass').onclick = () => this.openCagePopup(p, cage);
    this.el('saveCarcass').onclick = () => {
      if (!disp) { this.toast('กรุณาเลือกว่าจะทำลายซากหรือชันสูตร'); return; }
      mouse.death.carcass = 'done';
      mouse.death.disposition = disp;
      mouse.death.note = this.el('carcassNote').value.trim();
      mouse.death.handledBy = this.el('carcassBy').value.trim();
      mouse.death.handledAt = this.el('carcassAt').value || this.recDate();
      Object.assign(mouse.death, this.recStamp('handledLate'));   // ระยะที่ 2 มีวันกรอกของตัวเอง
      this.log('จัดการซาก', `${mouse.code} · ${disp === 'necropsy' ? 'ส่งชันสูตร' : 'ทำลายซาก'}`, p.name);
      if (disp === 'necropsy') {
        this.toast('บันทึกแล้ว — กรอกผลการผ่าชันสูตรต่อได้เลย');
        this.openNecropsyForm(p, cage, mouse);
        return;
      }
      this.toast(`ทำลายซากของ ${mouse.code} เรียบร้อย`);
      this.openCagePopup(p, cage);
    };
  },

  // ---------------------------------------------------------
  // Mouse detail (chart + history + treatment)
  // ---------------------------------------------------------
  openMouseDetail(p, cage, mouse) {
    this.refreshUnderlay(p);   // ผังกรงด้านหลังต้องตรงกับข้อมูลล่าสุดเสมอ
    const operational = this.isOperational(p);        // no recording actions on waiting/rejected/closed
    const canTreat = this.can('treat', p) && operational;
    const canNecropsy = this.can('handleCarcass', p) && operational;   // SCI/VET perform the gross exam
    // ฟอร์มที่พิมพ์ได้ของหนูตัวนี้ — ขึ้นเฉพาะที่มีข้อมูลจริงแล้ว
    const mousePrintItems = [];
    if (mouse.treatments.length) {
      mousePrintItems.push({ key: 'sick', icon: '🩺', label: 'รายงานอาการป่วย', hint: 'LA Guide–AF 11.1-02' });
      mousePrintItems.push({ key: 'monitor', icon: '📋', label: 'บันทึกติดตามอาการ', hint: 'LA Guide–AF 11.1-03' });
    }
    if (mouse.necropsy) mousePrintItems.push({ key: 'necropsy', icon: '🔬', label: 'บันทึกผ่าชันสูตรซาก', hint: 'LA Guide–AF 11.3-01' });
    const cur = Data.latestWeight(mouse);
    const chg = Data.weightChange(mouse);
    const chgClass = chg == null ? '' : chg >= 0 ? 'up' : 'down';
    const first = mouse.weights[0]?.weight;
    const total = cur != null && first != null ? Math.round((cur - first) * 10) / 10 : null;

    const chart = this.lineChart(
      [{ points: mouse.weights.map(w => w.weight), color: '#2563eb' }],
      mouse.weights.map(w => w.date.slice(5))
    );

    const history = [...mouse.weights].reverse().slice(0, 8).map((w, i, arr) => {
      const prev = arr[i + 1];
      const d = prev ? Math.round((w.weight - prev.weight) * 10) / 10 : null;
      const cls = d == null ? '' : d >= 0 ? 'up' : 'down';
      return `<tr><td>${w.date}</td><td class="num">${this.g(w.weight)} g</td><td class="num"><span class="chg ${cls}">${this.gs(d)}</span></td></tr>`;
    }).join('');

    const chips = (arr, cls) => (arr && arr.length)
      ? `<div class="chip-row">${arr.map(s => `<span class="chip ${cls}">${s}</span>`).join('')}</div>` : '';
    const treatments = mouse.treatments.length
      ? mouse.treatments.map(t => `
          <div class="treat-item">
            <div class="t-top"><span>📅 ${t.date}${t.time ? ' · ' + t.time : ''}${this.lateChip(t)}</span><span>${t.vet}</span></div>
            <div class="t-dx">${t.diagnosis}</div>
            ${chips(t.signs, 'sign')}
            ${t.treatment && t.treatment !== '—' ? `<div class="t-rx">💊 ${t.treatment}</div>` : ''}
            ${chips(t.support, 'support')}
            ${t.recommend ? `<div class="t-reco">📌 ${t.recommend}</div>` : ''}
          </div>`).join('')
      : `<p class="empty-note">ยังไม่มีบันทึกการรักษา</p>`;

    this.openModal(`
      <div class="modal-head">
        <div>
          <h3>หนู ${mouse.code} ${this.tagChip(p, cage, mouse)}${this.treatMark(mouse)}${this.flagMark(mouse)}${this.frozenMark(mouse)}</h3>
          <div class="sub">📍 ${this.cageLocation(p, cage)} · เพศ ${mouse.sex === 'M' ? 'ผู้ ♂' : 'เมีย ♀'}</div>
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          ${mouse.humaneOrder ? `
            <div class="order-banner">
              <b>คำสั่ง Humane endpoint</b> — โปรดทำการุณยฆาตหนูตัวนี้
              <div class="order-reason">เหตุผล: ${mouse.humaneOrder.reason}</div>
              <div class="order-meta">โดย ${mouse.humaneOrder.vet} · ${mouse.humaneOrder.date}</div>
            </div>` : ''}
          ${mouse.careOpen && !mouse.humaneOrder ? `<div class="care-banner">🟡 เคสเปิดอยู่ — กำลังรักษา/ดูแล</div>` : ''}
          ${mouse.flagOpen ? `
            <div class="flag-banner">
              <b>⚠️ แจ้งว่าผิดปกติ</b> — ${mouse.flag ? mouse.flag.note : ''}
              <div class="order-meta">โดย ${mouse.flag ? mouse.flag.by : '—'} · ${mouse.flag ? mouse.flag.date : ''} · รอ VET ตรวจสอบ${canTreat ? ' → เปิดเคส / สั่งตาย / ยกเลิก(ปกติ)' : ''}</div>
            </div>` : ''}
          ${!mouse.alive && mouse.death ? `
            <div class="death-banner">
              <b>✝ บันทึกการตาย</b> — ${this.deathLabel(mouse.death)}
              <div class="order-meta">แจ้งโดย ${mouse.death.reporter || '—'} · ${mouse.death.date} ${mouse.death.time || ''}${mouse.death.note ? ' · ' + mouse.death.note : ''}</div>
              ${mouse.death.carcass === 'frozen'
                ? `<div class="order-meta">❄️ ซากอยู่ระหว่างแช่แข็ง — รอนักวิทยาศาสตร์ (Sci) หรือสัตวแพทย์ (VET) ตัดสินใจทำลาย/ชันสูตร</div>`
                : `<div class="order-meta">ดำเนินการโดย ${mouse.death.handledBy || '—'}${mouse.death.handledAt ? ' · ' + mouse.death.handledAt : ''}</div>`}
            </div>` : ''}
          <div class="stat-row">
            <div class="stat"><div class="l">น้ำหนักล่าสุด</div><div class="v">${this.g(cur)} g</div></div>
            <div class="stat"><div class="l">เปลี่ยนจากวันก่อน</div><div class="v"><span class="chg ${chgClass}">${this.gs(chg)}</span></div></div>
            <div class="stat"><div class="l">รวมตั้งแต่เริ่ม</div><div class="v"><span class="chg ${total >= 0 ? 'up' : 'down'}">${this.gs(total)}</span></div></div>
          </div>
          <div class="chart-wrap">
            <h4>กราฟน้ำหนัก (14 วันล่าสุด)</h4>
            ${chart}
          </div>
          <div>
            <div class="section-title">ประวัติน้ำหนัก</div>
            <table class="data"><thead><tr><th>วันที่</th><th>น้ำหนัก</th><th>เปลี่ยนแปลง</th></tr></thead><tbody>${history}</tbody></table>
          </div>
          <div>
            <div class="section-title">รายงานอาการป่วย & การรักษา</div>
            ${treatments}
          </div>
          <div>
            <div class="section-title">🩺 ประวัติสุขภาพ</div>
            ${this.renderHealthTimeline(p, mouse)}
          </div>
          ${(mouse.doses || []).length ? `
          <div>
            <div class="section-title">💉 การให้สารทดสอบ / หัตถการ</div>
            ${this.renderDoseHistory(mouse)}
          </div>` : ''}
          ${!mouse.alive && mouse.death && mouse.death.disposition === 'necropsy' ? `
          <div>
            <div class="section-title">🔬 ผลการชันสูตร (Necropsy Record)</div>
            ${mouse.necropsy ? this.renderNecropsy(mouse.necropsy) : `<p class="empty-note">ยังไม่ได้บันทึกผลการชันสูตร</p>`}
          </div>` : ''}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="backCage">← กลับ</button>
        ${this.printMenu('mousePrint', 'พิมพ์ฟอร์ม', mousePrintItems)}
        <span class="spacer" style="flex:1"></span>
        ${canTreat && mouse.alive && mouse.flagOpen ? `<button class="btn btn-green" id="clearFlagBtn">✓ ปกติ (ยกเลิกแจ้ง)</button>` : ''}
        ${canTreat && mouse.alive ? `<button class="btn btn-primary" id="addTreat">🩺 ${mouse.flagOpen ? 'เปิดเคส (ป่วย)' : 'รายงานอาการป่วย'}</button>` : ''}
        ${canTreat && mouse.alive && mouse.careOpen ? `<button class="btn btn-green" id="closeCase">✓ ปิดเคส</button>` : ''}
        ${canTreat && mouse.alive && !mouse.humaneOrder ? `<button class="btn btn-danger" id="humaneBtn">Humane endpoint</button>` : ''}
        ${canNecropsy && !mouse.alive && mouse.death && mouse.death.carcass === 'frozen'
          ? `<button class="btn btn-primary" id="carcassBtn">❄️ จัดการซาก (ทำลาย / ชันสูตร)</button>` : ''}
        ${canNecropsy && !mouse.alive && mouse.death && mouse.death.disposition === 'necropsy'
          ? `<button class="btn btn-primary" id="necropsyBtn">🔬 ${mouse.necropsy ? 'แก้ไขผลชันสูตร' : 'บันทึกผลชันสูตร'}</button>` : ''}
      </div>
    `);

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('backCage').onclick = () => this.openCagePopup(p, cage);
    this.bindPrintMenu('mousePrint', (key) => {
      if (key === 'sick') {
        this.printDocument(`SickCaseReport_${mouse.code}`, this.buildSickCaseDoc(p, cage, mouse));
        return this.log('Export PDF', `Sick Case Report · ${mouse.code}`, p.name);
      }
      if (key === 'monitor') {
        this.printDocument(`MonitoringRecord_${mouse.code}`, this.buildMonitoringForm(p, cage, mouse));
        return this.log('Export PDF', `Monitoring Record · ${mouse.code}`, p.name);
      }
      if (key === 'necropsy') {
        this.printDocument(`Necropsy_${mouse.code}`, this.buildNecropsyDoc(p, cage, mouse));
        this.log('Export PDF', `Necropsy Record · ${mouse.code}`, p.name);
      }
    });
    if (canTreat && mouse.alive) this.el('addTreat').onclick = () => this.openTreatForm(p, cage, mouse);
    if (canTreat && mouse.alive && mouse.flagOpen) {
      this.el('clearFlagBtn').onclick = () => {
        // เก็บข้อความที่เคยแจ้งไว้ก่อนล้างธง — เดิมตรงนี้คือจุดที่ข้อสังเกตหายถาวร
        const prevFlagNote = (mouse.flag && mouse.flag.note) || '';
        mouse.flagOpen = false; mouse.flag = null;
        this.logHealth(mouse, { source: 'vet', status: 'normal',
          note: `สัตวแพทย์ตรวจแล้วปกติ${prevFlagNote ? ' (จากที่แจ้งไว้: ' + prevFlagNote + ')' : ''}` });
        this.log('ยกเลิกแจ้งผิดปกติ (ปกติ)', `${mouse.code}`, p.name);
        this.toast(`${mouse.code} — ระบุว่าปกติ กลับสถานะเดิม`);
        this.openMouseDetail(p, cage, mouse);
      };
    }
    if (canTreat && mouse.alive && mouse.careOpen) {
      this.el('closeCase').onclick = () => {
        mouse.careOpen = false;
        mouse.remark = '';
        this.logHealth(mouse, { source: 'vet', status: 'healed', note: 'ปิดเคส — รักษาเสร็จสิ้น หายดี' });
        this.log('ปิดเคส', `${mouse.code} · รักษาเสร็จสิ้น`, p.name);
        // C3 — recovered
        this.notify({ kind: 'healed', title: 'ปิดเคสแล้ว — หนูหายดี',
          detail: mouse.code, project: p, to: this.nResearchers(p),
          link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
        this.toast(`ปิดเคสของ ${mouse.code} แล้ว`);
        this.openMouseDetail(p, cage, mouse);
      };
    }
    if (canTreat && mouse.alive && !mouse.humaneOrder) {
      this.el('humaneBtn').onclick = () => this.openHumaneForm(p, cage, mouse);
    }
    if (canNecropsy && !mouse.alive && mouse.death && mouse.death.disposition === 'necropsy') {
      this.el('necropsyBtn').onclick = () => this.openNecropsyForm(p, cage, mouse);
    }
    if (canNecropsy && !mouse.alive && mouse.death && mouse.death.carcass === 'frozen') {
      this.el('carcassBtn').onclick = () => this.openCarcassForm(p, cage, mouse);
    }
  },

  // read-only render of a saved Necropsy Record
  renderNecropsy(n) {
    const V = { N: '<span class="nec-v n">Normal (N)</span>', A: '<span class="nec-v a">Autolysis (A)</span>', X: '<span class="nec-v x">Abnormal</span>' };
    const rows = Object.entries(n.results || {})
      .filter(([, r]) => r && r.v)
      .map(([organ, r]) => `<tr><td>${organ}</td><td>${V[r.v] || ''}</td><td>${r.note || ''}</td></tr>`).join('');
    return `
      <div class="nec-meta">ผู้ชันสูตร: ${n.examiner || '—'} · ${n.date || ''}${n.time ? ' ' + n.time : ''}</div>
      ${rows ? `<table class="data nec-table"><thead><tr><th>ระบบ / อวัยวะ</th><th>ผล</th><th>รายละเอียด</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
      ${n.abnormal ? `<div class="nec-abnormal"><b>สรุปความผิดปกติ:</b> ${n.abnormal}</div>` : ''}
      ${n.avComment ? `<div class="nec-av"><b>AV Comment:</b> ${n.avComment}</div>` : ''}`;
  },

  // Necropsy Record (บันทึกการผ่าชันสูตรซาก — LA Guide-AF 11.3-01)
  openNecropsyForm(p, cage, mouse) {
    const n = mouse.necropsy || { results: {}, abnormal: '', avComment: '', examiner: this.user.name, date: this.recDate(), time: this.recTime() };
    const seg = (organ) => {
      const cur = (n.results[organ] && n.results[organ].v) || '';
      const note = (n.results[organ] && n.results[organ].note) || '';
      const btn = (v, label) => `<button type="button" class="nseg ${cur === v ? 'sel' : ''}" data-v="${v}">${label}</button>`;
      return `
        <div class="nec-row" data-organ="${organ}">
          <div class="nec-organ">${organ}</div>
          <div class="nseg-row">${btn('N', 'N')}${btn('A', 'A')}${btn('X', 'Abnormal')}</div>
          <input class="nec-note" placeholder="รายละเอียด (ถ้าผิดปกติ)" value="${note}">
        </div>`;
    };
    const systems = this.NECROPSY_SYS.map(sys => `
      <div class="nec-sys">
        <div class="nec-sys-label">${sys.g}</div>
        ${sys.items.map(seg).join('')}
      </div>`).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>🔬 บันทึกการผ่าชันสูตรซาก — ${mouse.code}</h3><div class="sub">กรง ${cage.code} · Necropsy Record</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row3">
          <div class="field"><label>ผู้ชันสูตร</label><input id="nExaminer" value="${n.examiner || this.user.name}"></div>
          <div class="field"><label>วันที่</label><input id="nDate" value="${n.date || this.recDate()}"></div>
          <div class="field"><label>เวลา</label><input id="nTime" value="${n.time || this.recTime()}"></div>
        </div>
        <p class="nec-legend">N = Normal · A = Autolysis · Abnormal = ระบุรายละเอียด</p>
        <div class="section-title">การตรวจตามระบบ / อวัยวะ</div>
        ${systems}
        <div class="field"><label>สรุปความผิดปกติที่พบ (Abnormal finding)</label>
          <textarea id="nAbnormal" rows="3" placeholder="สรุปสิ่งที่พบผิดปกติ · ตัวอย่างที่เก็บส่งตรวจ">${n.abnormal || ''}</textarea>
        </div>
        <div class="field"><label>AV Comment</label><input id="nAv" value="${n.avComment || ''}"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelNec">ยกเลิก</button>
        <button class="btn btn-primary" id="saveNec">💾 บันทึกผลชันสูตร</button>
      </div>
    `);

    // segmented select behaviour (per organ row)
    document.querySelectorAll('.nec-row').forEach(row => {
      row.querySelectorAll('.nseg').forEach(b => {
        b.onclick = () => {
          const on = !b.classList.contains('sel');
          row.querySelectorAll('.nseg').forEach(x => x.classList.remove('sel'));
          if (on) b.classList.add('sel');   // click again to clear
        };
      });
    });

    this.el('closeModal').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('cancelNec').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('saveNec').onclick = () => {
      const results = {};
      document.querySelectorAll('.nec-row').forEach(row => {
        const organ = row.dataset.organ;
        const selBtn = row.querySelector('.nseg.sel');
        const note = row.querySelector('.nec-note').value.trim();
        if (selBtn || note) results[organ] = { v: selBtn ? selBtn.dataset.v : '', note };
      });
      mouse.necropsy = {
        examiner: this.el('nExaminer').value.trim(),
        date: this.el('nDate').value,
        time: this.el('nTime').value,
        results,
        abnormal: this.el('nAbnormal').value.trim(),
        avComment: this.el('nAv').value.trim(),
        ...this.recStamp(),
      };
      this.logHealth(mouse, { source: 'necropsy', status: 'dead',
        note: mouse.necropsy.abnormal ? `ผลชันสูตร — ${mouse.necropsy.abnormal}` : 'บันทึกผลชันสูตรแล้ว' });
      this.log('บันทึกผลชันสูตร', `${mouse.code}${mouse.necropsy.abnormal ? ' · ' + mouse.necropsy.abnormal : ''}`, p.name);
      // C7 — necropsy result is in
      this.notify({ kind: 'necropsy', title: 'บันทึกผลชันสูตรซากแล้ว',
        detail: `${mouse.code}${mouse.necropsy.abnormal ? ' · ' + mouse.necropsy.abnormal : ''}`, project: p,
        to: [...this.nResearchers(p), ...this.nTo.position('AV')],
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      this.toast(`บันทึกผลการชันสูตรของ ${mouse.code} แล้ว`);
      this.openMouseDetail(p, cage, mouse);
    };
  },

  // Vet orders a humane endpoint (experimenter will carry it out) — reason required
  openHumaneForm(p, cage, mouse) {
    this.openModal(`
      <div class="modal-head">
        <div><h3>สั่ง Humane endpoint — ${mouse.code}</h3><div class="sub">กรง ${cage.code}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <p class="empty-note" style="margin-bottom:12px">คำสั่งนี้จะแจ้งให้นักทดลองทำการุณยฆาตหนูตัวนี้ (การบันทึกการตายจริงทำที่ปุ่ม Death ในรายการหนู)</p>
        <div class="field">
          <label>สาเหตุ / เหตุผลของคำสั่ง <span style="color:var(--red)">*</span></label>
          <textarea id="humaneReason" rows="4" placeholder="เช่น น้ำหนักลด >20% จากค่าเริ่มต้น, ไม่ตอบสนองต่อการรักษา, เข้าเกณฑ์ humane endpoint ตามโปรโตคอล"></textarea>
        </div>
        <div class="field"><label>ผู้สั่ง (Vet)</label><input id="humaneVet" value="${this.user.name} (Vet)"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelHumane">ยกเลิก</button>
        <button class="btn btn-danger" id="saveHumane">ยืนยันคำสั่ง</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('cancelHumane').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('saveHumane').onclick = () => {
      const reason = this.el('humaneReason').value.trim();
      if (!reason) { this.el('humaneReason').focus(); this.toast('กรุณาระบุสาเหตุ'); return; }
      mouse.humaneOrder = { reason, vet: this.el('humaneVet').value.trim(), date: this.recDate(), ...this.recStamp() };
      mouse.careOpen = true;
      mouse.flagOpen = false; mouse.flag = null;   // abnormal flag resolved → humane order issued
      this.logHealth(mouse, { source: 'humane', status: 'critical', note: `สั่งการุณยฆาต — ${reason}` });
      this.log('สั่ง Humane endpoint', `${mouse.code} · ${reason}`, p.name);
      // C4 — an animal is to be euthanised: researchers and the head vet must know
      this.notify({ kind: 'humane', title: '🛑 สั่ง Humane endpoint',
        detail: `${mouse.code} · ${reason}`, project: p,
        to: [...this.nResearchers(p), ...this.nTo.position('AV')],
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      this.toast(`ออกคำสั่ง Humane endpoint สำหรับ ${mouse.code}`);
      this.openMouseDetail(p, cage, mouse);
    };
  },

  // reusable checkbox grid (returns HTML); read back with .querySelectorAll(`.${cls}:checked`)
  checkGrid(cls, items, selected = []) {
    return items.map(it =>
      `<label class="chk"><input type="checkbox" class="${cls}" value="${it}" ${selected.includes(it) ? 'checked' : ''}><span>${it}</span></label>`
    ).join('');
  },

  // Sick Case Report (แบบรายงานอาการผิดปกติหรืออาการป่วย — LA Guide-AF 11.1-02)
  openTreatForm(p, cage, mouse) {
    const signGroups = this.SICK_SIGNS.map(grp => `
      <div class="chk-group">
        <div class="chk-g-label">${grp.g}</div>
        <div class="chk-list">${this.checkGrid('signChk', grp.items)}</div>
      </div>`).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>🩺 รายงานอาการป่วย — ${mouse.code}</h3><div class="sub">กรง ${cage.code} · Sick Case Report</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-row3">
          <div class="field"><label>วันที่</label><input id="tDate" value="${this.recDate()}"></div>
          <div class="field"><label>เวลา</label><input id="tTime" value="${this.recTime()}"></div>
          <div class="field"><label>ผู้บันทึก (Vet)</label><input id="tVet" value="${this.user.name}"></div>
        </div>

        <div class="section-title">อาการที่พบ (Clinical Signs)</div>
        <div class="sign-groups">${signGroups}</div>
        <div class="field"><label>อื่น ๆ (Others)</label><input id="tSignOther" placeholder="อาการอื่นที่พบ"></div>

        <div class="section-title">การดูแลเบื้องต้น (Supportive Action)</div>
        <div class="chk-list">${this.checkGrid('supportChk', this.SICK_SUPPORT)}</div>

        <div class="section-title">การประเมิน & แผนการรักษา</div>
        <div class="field"><label>การวินิจฉัย <span style="color:var(--red)">*</span></label><input id="tDx" placeholder="เช่น สงสัยติดเชื้อทางเดินอาหาร"></div>
        <div class="field"><label>การรักษา / คำสั่ง (Tx.)</label><input id="tRx" placeholder="เช่น ให้สารน้ำใต้ผิวหนัง + ติดตามอาการ 48 ชม."></div>
        <div class="field"><label>คำแนะนำ (Recommendation)</label>
          <select id="tReco">
            <option value="">— ไม่ระบุ —</option>
            ${this.SICK_RECO.map(r => `<option value="${r}">${r}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>อัปเดตหมายเหตุของหนู (จะแสดงในตารางกรง)</label><input id="tRemark" value="${mouse.remark}"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelTreat">ยกเลิก</button>
        <button class="btn btn-primary" id="saveTreat">💾 บันทึกรายงาน</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('cancelTreat').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('saveTreat').onclick = () => {
      const dx = this.el('tDx').value.trim();
      if (!dx) { this.el('tDx').focus(); this.toast('กรุณาระบุการวินิจฉัย'); return; }
      const signs = [...document.querySelectorAll('.signChk:checked')].map(x => x.value);
      const other = this.el('tSignOther').value.trim();
      if (other) signs.push(other);
      const support = [...document.querySelectorAll('.supportChk:checked')].map(x => x.value);
      this.unshiftDated(mouse.treatments, {
        date: this.el('tDate').value,
        time: this.el('tTime').value,
        vet: this.el('tVet').value,
        signs,
        support,
        diagnosis: dx,
        treatment: this.el('tRx').value.trim() || '—',
        recommend: this.el('tReco').value,
        note: '',
        ...this.recStamp(),
      });
      mouse.remark = this.el('tRemark').value.trim();
      mouse.careOpen = true;   // adding a treatment opens/keeps the case open
      mouse.flagOpen = false; mouse.flag = null;   // abnormal flag resolved → case opened
      this.logHealth(mouse, { source: 'vet', status: 'treating', note: `เปิดเคส — ${dx}` });
      this.log('รายงานอาการป่วย', `${mouse.code} · ${dx}`, p.name);
      // C2 — a case is open on one of their animals
      this.notify({ kind: 'treat', title: 'สัตวแพทย์เปิดเคสรักษาหนูในโครงการ',
        detail: `${mouse.code}${dx ? ' · ' + dx : ''}`, project: p, to: this.nResearchers(p),
        link: { type: 'mouse', cageId: cage.id, mouseId: mouse.id } });
      this.toast('บันทึกรายงานอาการป่วยแล้ว');
      this.openMouseDetail(p, cage, mouse);
    };
  },

  // ---------------------------------------------------------
  // SUMMARY REPORTS (project-level)
  // ---------------------------------------------------------
  // "น้ำและอาหาร" — ทุกรอบที่มีการชั่งจริง เรียงจากใหม่ไปเก่า
  // ตอบคำถามที่กราฟตอบไม่ได้: วันนั้นเหลือเท่าไร เติมเท่าไร กินไปเท่าไร ใครเป็นคนชั่ง
  openSupplyReport(p, cageId = null) {
    let sel = cageId && p.cages.some(c => c.id === cageId) ? cageId : 'ALL';

    const draw = () => {
      const cages = sel === 'ALL' ? p.cages : p.cages.filter(c => c.id === sel);
      const rows = [];
      cages.forEach(c => (c.supplyLog || []).forEach(e => rows.push({ c, e })));
      rows.sort((a, b) => (a.e.date === b.e.date
        ? (b.e.time || '').localeCompare(a.e.time || '')
        : (a.e.date < b.e.date ? 1 : -1)));

      const chips = ['ALL', ...p.cages.filter(c => (c.supplyLog || []).length).map(c => c.id)]
        .map(id => {
          const c = p.cages.find(x => x.id === id);
          const n = id === 'ALL'
            ? p.cages.reduce((a, x) => a + (x.supplyLog || []).length, 0)
            : (c.supplyLog || []).length;
          return `<button class="btn btn-sm sp-chip ${sel === id ? 'on' : ''}" data-cage="${id}">${
            id === 'ALL' ? 'ทุกกรง' : c.code}<b>${n}</b></button>`;
        }).join('');

      // สรุปของช่วงที่กำลังดู — ค่าเฉลี่ยต่อตัวต่อรอบ คือเลขที่เทียบข้ามกรงได้
      const tot = rows.reduce((a, { e }) => ({
        w: a.w + (e.water.consumed || 0), f: a.f + (e.food.consumed || 0),
        n: a.n + (e.mice || 0), r: a.r + 1,
      }), { w: 0, f: 0, n: 0, r: 0 });
      const avgW = tot.n ? (tot.w / tot.n).toFixed(1) : '–';
      const avgF = tot.n ? (tot.f / tot.n).toFixed(1) : '–';

      const body = rows.length ? `
        <div class="sp-sum">
          <div class="sp-stat"><span>รอบที่บันทึก</span><b>${tot.r}</b></div>
          <div class="sp-stat"><span>💧 น้ำเฉลี่ย</span><b>${avgW} g</b><i>ต่อตัว/รอบ</i></div>
          <div class="sp-stat"><span>🍚 อาหารเฉลี่ย</span><b>${avgF} g</b><i>ต่อตัว/รอบ</i></div>
        </div>
        <table class="data rep-table sp-table">
          <thead>
            <tr>
              <th rowspan="2">วันที่</th><th rowspan="2">กรง</th><th rowspan="2">ที่มา</th>
              <th colspan="3">💧 น้ำ (g)</th><th colspan="3">🍚 อาหาร (g)</th>
              <th rowspan="2">ผู้บันทึก</th>
            </tr>
            <tr><th>กินไป</th><th>เติม</th><th>คงเหลือ</th><th>กินไป</th><th>เติม</th><th>คงเหลือ</th></tr>
          </thead>
          <tbody>${rows.map(({ c, e }) => {
            const src = this.SUPPLY_SOURCE[e.source] || { icon: '•', label: e.source || '—' };
            const pm = (v) => e.mice ? `<i class="sp-pm">${this.g(this.perMouse(v, e.mice))}/ตัว</i>` : '';
            return `<tr>
              <td style="white-space:nowrap">${this.thaiDate(e.date)}<br><span class="muted-note">${e.time || ''}</span>${this.lateChip(e)}</td>
              <td><b>${c.code}</b></td>
              <td style="white-space:nowrap">${src.icon} ${src.label}</td>
              <td class="num sp-use">${this.g(e.water.consumed)}${pm(e.water.consumed)}</td>
              <td class="num">${e.water.added ? '+' + this.g(e.water.added) : '–'}</td>
              <td class="num">${this.g(e.water.remaining)}</td>
              <td class="num sp-use">${this.g(e.food.consumed)}${pm(e.food.consumed)}</td>
              <td class="num">${e.food.added ? '+' + this.g(e.food.added) : '–'}</td>
              <td class="num">${this.g(e.food.remaining)}</td>
              <td style="white-space:nowrap">${this.esc(e.by)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>`
        : `<p class="empty-note">ยังไม่มีการชั่งน้ำ/อาหารในโครงการนี้ — ข้อมูลจะเริ่มเก็บตั้งแต่รอบรับหนูเข้ากรง</p>`;

      this.openModal(`
        <div class="modal-head">
          <div><h3>💧 น้ำและอาหาร</h3>
            <div class="sub">${p.name} · ทุกรอบที่ชั่งจริง เรียงจากล่าสุด</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="sp-bar">${chips}</div>
          ${body}
        </div>
        <div class="modal-foot"><button class="btn" id="spClose">ปิด</button></div>
      `, { wide: true });

      this.el('closeModal').onclick = () => this.closeModal();
      this.el('spClose').onclick = () => this.closeModal();
      document.querySelectorAll('[data-cage]').forEach(b => b.onclick = () => { sel = b.dataset.cage; draw(); });
    };
    draw();
  },

  // "รายงานการตายของสัตว์ทดลอง" — which mice died, when, and how
  openDeathReport(p) {
    const dead = [];
    p.cages.forEach(cage => cage.mice.forEach(m => {
      if (!m.alive && m.death) dead.push({ m, cage });
    }));
    dead.sort((a, b) => (a.m.death.date < b.m.death.date ? 1 : -1));

    const rows = dead.map(({ m, cage }) => {
      const g = Data.getGroup(p, cage.groupId);
      const type = m.death.type === 'humane' ? 'Humane endpoint' : 'ตายเอง';
      const disp = m.death.disposition === 'necropsy' ? 'ชันสูตร' : 'ทำลายซาก';
      const nec = m.death.disposition !== 'necropsy' ? '—'
        : (m.necropsy ? '<span class="chg up">✓ บันทึกแล้ว</span>' : '<span class="chg down">รอบันทึก</span>');
      return `<tr class="dr-row" data-mid="${m.id}">
        <td>${m.death.date}${this.lateChip(m.death)}</td><td>${m.death.time || '—'}</td><td>${cage.code}</td>
        <td><b>${m.code}</b><br>${this.tagChip(p, cage, m)}</td><td>${g ? g.name : '—'}</td><td>${m.death.reporter || '—'}</td>
        <td>${type}</td><td>${disp}</td><td>${nec}</td></tr>`;
    }).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>✝ รายงานการตายของสัตว์ทดลอง</h3><div class="sub">${p.name} · ตายรวม ${dead.length} ตัว</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        ${dead.length ? `<table class="data rep-table">
          <thead><tr><th>วันที่ตาย</th><th>เวลา</th><th>กรง</th><th>ID</th><th>กลุ่ม</th><th>ผู้รายงาน</th><th>ลักษณะ</th><th>การจัดการซาก</th><th>ชันสูตร</th></tr></thead>
          <tbody>${rows}</tbody></table>
          <p class="empty-note">แตะแถวเพื่อดูรายละเอียดหนู</p>` : `<p class="empty-note">ยังไม่มีการตายในโครงการนี้</p>`}
      </div>
      <div class="modal-foot">
        <button class="btn" id="repClose">ปิด</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn btn-primary" id="repExport">🖨️ Export PDF</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('repClose').onclick = () => this.closeModal();
    this.el('repExport').onclick = () => {
      this.printDocument(`DeathReport_${p.name}`, this.buildDeathReportDoc(p));
      this.log('Export PDF', `รายงานการตาย · ${p.name}`, p.name);
    };
    document.querySelectorAll('.dr-row').forEach(row => {
      row.onclick = () => {
        const found = dead.find(d => d.m.id === row.dataset.mid);
        if (found) this.openMouseDetail(p, found.cage, found.m);
      };
    });
  },

  // "บันทึกติดตามอาการสัตว์ป่วย" — per animal, the day-by-day treatment log until healed
  openSickReport(p) {
    const sick = [];
    p.cages.forEach(cage => cage.mice.forEach(m => {
      if (m.treatments && m.treatments.length) sick.push({ m, cage });
    }));
    // ongoing cases first, then healed, then dead
    const rank = m => (!m.alive ? 2 : m.careOpen ? 0 : 1);
    sick.sort((a, b) => rank(a.m) - rank(b.m));

    const chips = (arr, cls) => (arr && arr.length)
      ? `<div class="chip-row">${arr.map(s => `<span class="chip ${cls}">${s}</span>`).join('')}</div>` : '';

    const cards = sick.map(({ m, cage }) => {
      const g = Data.getGroup(p, cage.groupId);
      const status = !m.alive
        ? '<span class="st-badge dead">ตายแล้ว</span>'
        : m.careOpen ? '<span class="st-badge care">กำลังรักษา</span>'
        : '<span class="st-badge well">หายดี</span>';
      // timeline oldest → newest (reads as progression)
      const log = [...m.treatments].sort((a, b) => (a.date < b.date ? -1 : 1)).map(t => `
        <div class="fu-entry">
          <div class="fu-date">📅 ${t.date}${t.time ? ' · ' + t.time : ''} <span class="fu-vet">${t.vet || ''}</span></div>
          <div class="fu-dx">${t.diagnosis}</div>
          ${chips(t.signs, 'sign')}
          ${t.treatment && t.treatment !== '—' ? `<div class="fu-rx">💊 ${t.treatment}</div>` : ''}
          ${chips(t.support, 'support')}
          ${t.recommend ? `<div class="fu-reco">📌 ${t.recommend}</div>` : ''}
          ${t.note ? `<div class="fu-note">📝 ${t.note}</div>` : ''}
        </div>`).join('');
      return `<div class="fu-card" data-mid="${m.id}">
        <div class="fu-head"><b>${m.code}</b> ${this.tagChip(p, cage, m)} · กรง ${cage.code} ${status}
          <span class="fu-count">${m.treatments.length} ครั้ง</span></div>
        <div class="fu-log">${log}</div>
      </div>`;
    }).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>🩺 บันทึกติดตามอาการสัตว์ป่วย</h3><div class="sub">${p.name} · เคสป่วยรวม ${sick.length} ตัว</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        ${sick.length ? cards : `<p class="empty-note">ยังไม่มีเคสป่วยในโครงการนี้</p>`}
      </div>
      <div class="modal-foot">
        <button class="btn" id="repClose">ปิด</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn btn-primary" id="repExport">🖨️ Export PDF</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('repClose').onclick = () => this.closeModal();
    this.el('repExport').onclick = () => {
      this.printDocument(`SickFollowup_${p.name}`, this.buildSickReportDoc(p));
      this.log('Export PDF', `ติดตามอาการป่วย · ${p.name}`, p.name);
    };
    document.querySelectorAll('.fu-card').forEach(card => {
      card.querySelector('.fu-head').onclick = () => {
        const found = sick.find(d => d.m.id === card.dataset.mid);
        if (found) this.openMouseDetail(p, found.cage, found.m);
      };
    });
  },

  // ---------------------------------------------------------
  // PROJECT DOCUMENTS  (attach important PDFs to a project)
  //   Prototype only: files are held in memory (object URLs) — a real
  //   backend would upload to object storage and keep signed URLs.
  // ---------------------------------------------------------
  DOC_CATEGORIES: ['โปรโตคอล (Protocol)', 'ใบอนุมัติ EC', 'SOP', 'ผลแล็บ (Lab result)', 'อื่นๆ (Other)'],

  fileSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  },

  openDocuments(p) {
    p.documents = p.documents || [];
    const canManage = this.can('editProject', p);   // PI/admin attach & delete; others view/open
    const catIcon = c => c.startsWith('โปรโตคอล') ? '📄' : c.startsWith('ใบอนุมัติ') ? '✅' : c === 'SOP' ? '📋' : c.startsWith('ผลแล็บ') ? '🧪' : '📎';

    const rows = p.documents.length ? p.documents.map(d => `
      <div class="doc-row" data-id="${d.id}">
        <span class="doc-ico">${catIcon(d.category)}</span>
        <div class="doc-main">
          <div class="doc-name">${d.name} ${d.url ? '' : '<span class="doc-sample">ตัวอย่าง</span>'}</div>
          <div class="doc-meta">${d.category} · ${this.fileSize(d.size)} · ${d.uploadedBy} · ${d.date}</div>
        </div>
        <button class="mini-btn doc-open" data-id="${d.id}">เปิด</button>
        ${canManage ? `<button class="mini-btn danger doc-del" data-id="${d.id}">ลบ</button>` : ''}
      </div>`).join('') : `<p class="empty-note">ยังไม่มีเอกสารแนบ</p>`;

    this.openModal(`
      <div class="modal-head">
        <div><h3>📎 เอกสารโครงการ</h3><div class="sub">${p.name} · ${p.documents.length} ไฟล์</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        ${canManage ? `
        <div class="doc-add">
          <select id="docCat">${this.DOC_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select>
          <input type="file" id="docFile" accept="application/pdf">
          <button class="btn btn-primary" id="docUpload">แนบไฟล์</button>
        </div>
        <p class="empty-note" style="margin:2px 0 12px">รองรับ PDF · เดโมนี้เก็บไฟล์ไว้ในหน่วยความจำเท่านั้น (รีเฟรชแล้วหาย · ระบบจริงจะเก็บบน object storage)</p>
        ` : ''}
        <div class="doc-list">${rows}</div>
      </div>
      <div class="modal-foot"><button class="btn" id="docClose">ปิด</button></div>
    `);

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('docClose').onclick = () => this.closeModal();

    // open a document (object URL opens the PDF inline; sample rows have no file)
    document.querySelectorAll('.doc-open').forEach(b => {
      b.onclick = () => {
        const d = p.documents.find(x => x.id === b.dataset.id);
        if (d && d.url) window.open(d.url, '_blank');
        else this.toast('ไฟล์ตัวอย่าง (เมตาดาต้า) — อัปโหลดไฟล์จริงเพื่อเปิดดู');
      };
    });

    if (canManage) {
      document.querySelectorAll('.doc-del').forEach(b => {
        b.onclick = () => {
          const i = p.documents.findIndex(x => x.id === b.dataset.id);
          if (i < 0) return;
          const name = p.documents[i].name;
          const cat = p.documents[i].category;
          if (p.documents[i].url) URL.revokeObjectURL(p.documents[i].url);
          p.documents.splice(i, 1);
          this.log('ลบเอกสาร', name, p.name);
          // การแนบเพิ่มไม่ต้องแจ้ง แต่การ "เอาออก" คือการทำลายหลักฐานที่ AV ใช้ตรวจ
          // จึงต้องแจ้งผู้วิจัยและสัตวแพทย์เสมอ
          this.notify({
            kind: 'doc', title: 'เอกสารโครงการถูกลบ',
            detail: `${name} (${cat})`, project: p,
            to: [...this.nResearchers(p), ...this.nTo.position('AV')],
            link: { type: 'projectInfo' },
          });
          this.openDocuments(p);
        };
      });
      this.el('docUpload').onclick = () => {
        const input = this.el('docFile');
        const file = input.files && input.files[0];
        if (!file) { this.toast('กรุณาเลือกไฟล์ PDF'); return; }
        if (file.type !== 'application/pdf') { this.toast('รองรับเฉพาะไฟล์ PDF'); return; }
        if (file.size > 15 * 1024 * 1024) { this.toast('ไฟล์ใหญ่เกิน 15MB'); return; }
        p.documents.push({
          id: 'd' + Date.now(),
          name: file.name,
          size: file.size,
          category: this.el('docCat').value,
          uploadedBy: this.user.name,
          date: todayISO(),
          url: URL.createObjectURL(file),
        });
        this.log('แนบเอกสาร', `${file.name} (${this.fileSize(file.size)})`, p.name);
        this.toast('แนบไฟล์แล้ว');
        this.openDocuments(p);
      };
    }
  },

  // ---------------------------------------------------------
  // EXPORT TO PDF  (browser print → "Save as PDF"; A4, no dependency)
  // ---------------------------------------------------------
  PRINT_CSS: `
    * { box-sizing: border-box; }
    body { font-family: 'IBM Plex Sans Thai', sans-serif; color: #111; margin: 0; padding: 14px; font-size: 12px; line-height: 1.35; }
    .doc { max-width: 760px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; }
    .hd td { border: 1px solid #333; padding: 5px 7px; vertical-align: middle; }
    .hd .logo { width: 74px; text-align: center; font-size: 10px; font-weight: 700; color: #6a5a97; line-height: 1.2; }
    .hd .org { background: #6a5a97; color: #fff; }
    .hd .org .en { font-size: 9.5px; opacity: .92; }
    .hd .meta { width: 165px; font-size: 10.5px; }
    .hd .fcode { text-align: center; font-size: 12px; }
    .doc-title { text-align: center; font-weight: 700; font-size: 15px; margin: 12px 0; }
    table.form { table-layout: fixed; }
    table.form td, table.form th { border: 1px solid #333; padding: 5px 7px; vertical-align: top; text-align: left; word-wrap: break-word; }
    .band { background: #efeaf5; font-weight: 700; text-align: center; }
    .lbl { font-weight: 700; }
    .chk { display: inline-block; margin: 1px 14px 1px 0; white-space: nowrap; }
    .sign-cell { color: #333; font-size: 11px; }
    .sign-cell u { color: #333; }
    .muted { color: #666; }
    .rep-title { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #6a5a97; padding-bottom: 6px; margin-bottom: 10px; }
    .rep-title h1 { font-size: 17px; margin: 0; color: #3a2e63; }
    .rep-title .sub { font-size: 11px; color: #555; }
    table.grid { table-layout: fixed; }
    table.grid td, table.grid th { border: 1px solid #444; padding: 5px 7px; word-wrap: break-word; }
    table.grid th { background: #f1eef7; }
    table.grid .grp { background: #f6f4fa; font-weight: 700; }
    .fu-block { border: 1px solid #999; border-radius: 4px; margin-bottom: 12px; page-break-inside: avoid; }
    .fu-h { background: #f1eef7; padding: 6px 10px; font-weight: 700; border-bottom: 1px solid #999; }
    .fu-e { padding: 7px 10px; border-bottom: 1px dashed #bbb; }
    .fu-e:last-child { border-bottom: none; }
    .tag { font-size: 10.5px; color: #444; }
    @media print { body { padding: 0; } .doc { max-width: none; } @page { size: A4; margin: 12mm; } }
  `,

  printDocument(filename, bodyHtml) {
    // The print doc is its own document, so it needs the embedded font too.
    // The iframe has no base URL of its own — resolve css/fonts.css against the
    // app's own URL so the form prints in IBM Plex Sans Thai and still works offline.
    const fontHref = new URL('css/fonts.css', document.baseURI).href;
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>${filename}</title>`
      + `<link rel="stylesheet" href="${fontHref}">`
      + `<style>${this.PRINT_CSS}</style></head><body><div class="doc">${bodyHtml}</div></body></html>`;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const cw = frame.contentWindow;
    cw.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 200));
    setTimeout(() => { cw.focus(); cw.print(); }, 450);   // small delay for the font to load
    setTimeout(() => { if (document.body.contains(frame)) frame.remove(); }, 120000);
  },

  // CMU laboratory-animal-center form header band (2-row layout as on the paper form)
  cmuHeader(formCode, pageInfo) {
    return `<table class="hd">
      <tr>
        <td class="logo" rowspan="2">ศูนย์<br>สัตว์ทดลอง<br>มช.</td>
        <td class="org" colspan="2">ศูนย์สัตว์ทดลอง (สำนักงานบริหารงานวิจัย มหาวิทยาลัยเชียงใหม่)
          <div class="en">Laboratory Animal Center (Office of Research Administration, CMU)</div></td>
      </tr>
      <tr>
        <td class="fcode">${formCode}</td>
        <td class="meta">จำนวนทั้งหมด ${pageInfo}<br>ฉบับที่ 4 Version 2023</td>
      </tr>
    </table>`;
  },

  tick(label, on) { return `<span class="chk">${on ? '☑' : '☐'} ${label}</span>`; },

  // ---- print menu ---------------------------------------------------------
  // The printable list outgrew a row of buttons: five documents side by side pushed
  // the actual work (ชั่งน้ำหนัก / ตรวจกรง / ให้สาร) off the end of the bar. One
  // button with a menu keeps printing one click away without letting paperwork
  // compete visually with the job. `items` = [{ key, icon, label, hint }].
  printMenu(id, label, items) {
    if (!items.length) return '';
    return `<div class="print-menu">
      <button class="btn" id="${id}Btn" aria-haspopup="menu" aria-expanded="false">🖨️ ${label} <span class="caret">▾</span></button>
      <div class="print-drop" id="${id}Drop" role="menu">
        ${items.map(it => `<button class="pd-item" role="menuitem" data-print="${it.key}">
          <span class="pd-ic">${it.icon}</span>
          <span class="pd-txt"><b>${it.label}</b>${it.hint ? `<i>${it.hint}</i>` : ''}</span>
        </button>`).join('')}
      </div>
    </div>`;
  },
  bindPrintMenu(id, onPick) {
    const btn = this.el(id + 'Btn'), drop = this.el(id + 'Drop');
    if (!btn || !drop) return;
    const close = () => { drop.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = !drop.classList.contains('open');
      drop.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      // The menu hangs below-right of its button. Both of those run out of room in
      // real placements — the mode bar wraps and puts the button at the left, and in
      // a modal footer there is nothing below it — so measure and flip either way.
      if (open) {
        drop.classList.remove('flip', 'up');
        const r = drop.getBoundingClientRect();
        if (r.left < 8) drop.classList.add('flip');
        if (r.bottom > window.innerHeight - 8) drop.classList.add('up');
      }
      if (open) setTimeout(() => document.addEventListener('click', function h() {
        close(); document.removeEventListener('click', h);
      }, { once: true }), 0);
    };
    drop.querySelectorAll('[data-print]').forEach(b => b.onclick = (e) => {
      e.stopPropagation(); close(); onPick(b.dataset.print);
    });
  },

  // colgroups so table-layout:fixed wraps long checkbox rows within the page width
  COLS4: '<colgroup><col style="width:23%"><col style="width:30%"><col style="width:17%"><col style="width:30%"></colgroup>',
  COLS2: '<colgroup><col style="width:24%"><col style="width:76%"></colgroup>',

  // ---- 1) Sick Case Report (LA Guide-AF 11.1-02) --------------------------
  buildSickCaseDoc(p, cage, mouse) {
    const ts = [...mouse.treatments].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
    const latest = ts[0] || {};
    const allSigns = new Set(ts.flatMap(t => t.signs || []));
    const allSupport = new Set(ts.flatMap(t => t.support || []));
    const otherSigns = [...allSigns].filter(s => !this.SICK_SIGNS.some(g => g.items.includes(s)));
    const g = Data.getGroup(p, cage.groupId);
    const blank = '<span class="chk">☐ …</span>';

    // clinical-sign rows keyed to the paper's groups (with the "- " prefix + trailing write-in box)
    const sg = (label) => this.SICK_SIGNS.find(x => x.g === label) || { items: [] };
    const line = (grpKey, prefix = '') => prefix + sg(grpKey).items.map(it => this.tick(it, allSigns.has(it))).join('') + ' ' + blank;

    // recommendations: paper wording, tick the one matching the latest record
    const reco = latest.recommend || '';
    const recoLine = (key, text, fill) =>
      `<div>${this.tick(text, reco === key)} <u>&nbsp;${fill || ''}&nbsp;</u></div>`;

    // progression from case status (paper's four options)
    const prog = !mouse.alive && mouse.death
      ? `${this.tick('Continue Tx. until', false)} &nbsp; ${this.tick('Continue monitoring until', false)}<br>${this.tick('Close case on', false)} &nbsp; ${this.tick('Euthanasia on ' + mouse.death.date, true)}`
      : mouse.careOpen
        ? `${this.tick('Continue Tx. until', false)} &nbsp; ${this.tick('Continue monitoring until …', true)}<br>${this.tick('Close case on', false)} &nbsp; ${this.tick('Euthanasia on', false)}`
        : `${this.tick('Continue Tx. until', false)} &nbsp; ${this.tick('Continue monitoring until', false)}<br>${this.tick('Close case on ' + (latest.date || ''), true)} &nbsp; ${this.tick('Euthanasia on', false)}`;

    return `
      ${this.cmuHeader('LA Guide–AF 11.1-02 Sick Case Report', '1 หน้า')}
      <div class="doc-title">รายงานอาการผิดปกติหรืออาการป่วยของสัตว์ทดลอง</div>
      <table class="form">${this.COLS4}
        <tr><td class="band" colspan="4">PROTOCOL INFORMATION</td></tr>
        <tr><td class="lbl">AR</td><td>Protocol No. &nbsp; ${p.name}</td><td class="lbl">Lot.</td><td>—</td></tr>
        <tr><td class="lbl">Case Number</td><td>${this.mouseLabel(p, cage, mouse)}</td><td class="lbl">Date / Time</td><td>${latest.date || todayISO()} &nbsp; ${latest.time || ''}</td></tr>
        <tr><td class="lbl">Cage &amp; ID</td><td colspan="3">${cage.code} · ${mouse.code} · ${g ? g.name : ''} · ${mouse.sex === 'M' ? 'Male ♂' : 'Female ♀'}</td></tr>
        <tr><td class="band" colspan="4">SICK CASE REPORT</td></tr>
        <tr><td class="lbl" colspan="4">Abnormal / Clinical Sign(s)</td></tr>
        <tr><td class="lbl">- General appearance</td><td class="sign-cell" colspan="3">${line('General appearance')}</td></tr>
        <tr><td class="lbl">- Skin</td><td class="sign-cell" colspan="3">${line('Skin')}</td></tr>
        <tr><td class="lbl">- Eye / Nose / Mouth / Ear</td><td class="sign-cell" colspan="3"><span class="muted">Lt. – Rt.</span> &nbsp; ${line('Eye / Nose / Mouth / Ear')}</td></tr>
        <tr><td class="lbl">- Digestive tract</td><td class="sign-cell" colspan="3">${line('Digestive tract')}</td></tr>
        <tr><td class="lbl">- Others</td><td class="sign-cell" colspan="3">${otherSigns.length ? otherSigns.join(', ') : blank}</td></tr>
        <tr><td class="lbl">Supportive Action</td><td class="sign-cell" colspan="3">${this.SICK_SUPPORT.map(it => this.tick(it, allSupport.has(it))).join('')} ${blank}</td></tr>
        <tr><td class="lbl">Diagnosis</td><td colspan="3">${ts.map(t => `${t.date}: ${t.diagnosis}`).join(' · ') || '—'}</td></tr>
        <tr><td class="lbl">Technician Sign/Date/Time</td><td colspan="3">${latest.vet || '__________'} &nbsp;/&nbsp; ${latest.date || ''} &nbsp;/&nbsp; ${latest.time || ''}</td></tr>
        <tr><td class="band" colspan="4">Responsible Vet. [Action Plan]</td></tr>
        <tr><td class="lbl">Recommendations</td><td class="sign-cell" colspan="3">
          ${recoLine('Tx.', 'Tx. By', latest.treatment || '')}
          ${recoLine('Continue Tx.', 'Continue Tx. at least', '')}
          ${recoLine('Continue monitoring', 'Continue monitoring at least', '')}
          ${recoLine('Euthanasia by humane endpoint', 'Euthanasia by humane endpoint should be done on', '')}
        </td></tr>
        <tr><td class="lbl">PI Communication</td><td class="sign-cell" colspan="3">${this.tick('PI', false)} &nbsp; ${this.tick('Lab member', false)} Name: __________ &nbsp; ${this.tick('Technician', false)} Name: __________</td></tr>
        <tr><td class="lbl">Vet. Sign/Date/Time</td><td colspan="3">__________ &nbsp;/&nbsp; ${latest.date || ''} &nbsp;/&nbsp; ${latest.time || ''}</td></tr>
        <tr><td class="lbl">Progression</td><td class="sign-cell" colspan="3">${prog}</td></tr>
        <tr><td class="lbl">Vet. Sign/Date/Time</td><td colspan="3">__________ &nbsp;/&nbsp; ${!mouse.alive && mouse.death ? mouse.death.date : (mouse.careOpen ? '' : latest.date || '')} &nbsp;/&nbsp; </td></tr>
      </table>
      <p class="muted" style="margin-top:8px">พิมพ์จากระบบ iLAMP · ${todayISO()} (เอกสารจำลอง prototype)</p>`;
  },

  // ---- 2) Necropsy Record (LA Guide-AF 11.3-01) ---------------------------
  buildNecropsyDoc(p, cage, mouse) {
    const n = mouse.necropsy || { results: {}, abnormal: '', avComment: '' };
    const code = (organ) => {                    // paper puts only a letter in the ID column
      const r = n.results[organ];
      if (!r || !r.v) return '';
      return r.v === 'N' ? 'N' : r.v === 'A' ? 'A' : 'Ab';
    };
    // 4 ID columns as on the paper form (only the first is filled)
    const idCols = (organ) => `<td>${code(organ)}</td><td></td><td></td><td></td>`;
    const sysRows = this.NECROPSY_SYS.map(sys => {
      const head = `<tr><td class="grp" colspan="5">${sys.en}</td></tr>`;
      const rows = sys.items.map(o => `<tr><td>- ${o}</td>${idCols(o)}</tr>`).join('');
      return head + rows;
    }).join('');

    // details/notes go into the "Abnormal finding" box (paper keeps the grid to letters only)
    const notes = Object.entries(n.results || {})
      .filter(([, r]) => r && r.v === 'X' && r.note)
      .map(([o, r]) => `${o}: ${r.note}`);
    const abnormalText = [n.abnormal, ...notes].filter(Boolean).join(' · ') || '—';

    const g = Data.getGroup(p, cage.groupId);
    const d = mouse.death || {};

    return `
      ${this.cmuHeader('LA Guide-AF 11.3-01 Necropsy Record', '2 หน้า')}
      <div class="doc-title">บันทึกการผ่าชันสูตรซากสัตว์ทดลอง</div>
      <table class="form">${this.COLS4}
        <tr><td class="band" colspan="4">PROTOCOL INFORMATION</td></tr>
        <tr><td class="lbl">Protocol No.</td><td>${p.name}</td><td class="lbl">Approved / until</td><td>—</td></tr>
        <tr><td class="band" colspan="4">ANIMAL INFORMATION</td></tr>
        <tr><td class="lbl">Animal from Cage No.</td><td>${cage.code}</td><td class="lbl">ID</td><td>${mouse.code}</td></tr>
        <tr><td class="lbl">Date / Time</td><td>${n.date || ''} ${n.time || ''}</td><td class="lbl">No. of Animals</td><td>1</td></tr>
        <tr><td class="lbl">Species</td><td>Mouse (Mus musculus)</td><td class="lbl">Sex / Age</td><td>${mouse.sex === 'M' ? 'Male ♂' : 'Female ♀'} · —</td></tr>
        <tr><td class="lbl" colspan="4">${this.tick('Found Death on', d.type === 'natural')} ${d.type === 'natural' ? (d.date || '') : '__________'} &nbsp;&nbsp; ${this.tick('Euthanasia using', d.type === 'humane')} ${d.type === 'humane' ? 'humane endpoint (' + (d.date || '') + ')' : '__________'}</td></tr>
        <tr><td class="lbl">Clinical Sign</td><td colspan="3">${d.note || '—'}</td></tr>
      </table>
      <table class="grid" style="margin-top:10px">
        <colgroup><col style="width:40%"><col style="width:15%"><col style="width:15%"><col style="width:15%"><col style="width:15%"></colgroup>
        <tr><th style="text-align:left">Examination of System / Organ(s)</th><th>ID: ${this.mouseLabel(p, cage, mouse)}</th><th>ID:</th><th>ID:</th><th>ID:</th></tr>
        ${sysRows}
      </table>
      <table class="form" style="margin-top:10px">${this.COLS2}
        <tr><td class="lbl">Abnormal finding</td><td>${abnormalText}</td></tr>
        <tr><td class="lbl">Signature / Date/Time</td><td>${n.examiner || '__________'} &nbsp;/&nbsp; ${n.date || ''} ${n.time || ''}</td></tr>
        <tr><td class="lbl">AV Comment / Sign/Date/Time</td><td>${n.avComment || '—'}</td></tr>
      </table>
      <p class="muted" style="margin-top:8px">A = Autolysis, N = Normal Finding, and Abnormal finding will be noted. &nbsp;·&nbsp; พิมพ์จากระบบ iLAMP · ${todayISO()}</p>`;
  },

  // ---- 3) Dead Report (LA Guide-AF 11.1-01) -------------------------------
  buildDeathReportDoc(p) {
    const dead = [];
    p.cages.forEach(cage => cage.mice.forEach(m => { if (!m.alive && m.death) dead.push({ m, cage }); }));
    dead.sort((a, b) => (a.m.death.date < b.m.death.date ? -1 : 1));   // chronological
    const cages = new Set(dead.map(x => x.cage.code));

    // fill actual rows; pad to 15 blank rows like the paper form
    const filled = dead.map(({ m, cage }, i) =>
      `<tr><td>${i + 1}.</td><td>${m.death.date || ''}</td><td>${m.death.time || ''}</td><td>${cage.code}</td><td>${this.mouseLabel(p, cage, m)}</td><td>${m.death.reporter || ''}</td></tr>`);
    for (let i = filled.length; i < 15; i++) filled.push(`<tr><td>${i + 1}.</td><td></td><td></td><td></td><td></td><td></td></tr>`);

    return `
      ${this.cmuHeader('LA Guide–AF 11.1-01 Dead Report', '1 หน้า')}
      <div class="doc-title">รายงานการตายของสัตว์ทดลอง</div>
      <table class="form">${this.COLS4}
        <tr><td class="band" colspan="4">PROTOCOL INFORMATION</td></tr>
        <tr><td class="lbl">Protocol No.</td><td>${p.name}</td><td class="lbl">Species</td><td>Mouse (Mus musculus)</td></tr>
        <tr><td class="lbl">Approved until</td><td>—</td><td class="lbl">Strain</td><td>—</td></tr>
        <tr><td class="lbl">Lot. / No. of Animals</td><td>— / ${dead.length}</td><td class="lbl">No. of Cage / Cage type</td><td>${cages.size} / —</td></tr>
        <tr><td class="lbl">Responsible Technician</td><td>—</td><td class="lbl">Responsible Vet.</td><td>—</td></tr>
        <tr><td class="band" colspan="4">ACTION PLAN</td></tr>
        <tr><td class="lbl" colspan="4">Management of Dead Animal(s):</td></tr>
        <tr><td colspan="4" style="height:34px"></td></tr>
        <tr><td class="lbl" colspan="4">Monitoring / Surveillance Plan:</td></tr>
        <tr><td colspan="4" style="height:34px"></td></tr>
      </table>
      <table class="grid" style="margin-top:10px">
        <colgroup><col style="width:8%"><col style="width:20%"><col style="width:14%"><col style="width:16%"><col style="width:16%"><col style="width:26%"></colgroup>
        <tr><th class="band" colspan="6" style="background:#efeaf5">DEAD REPORT</th></tr>
        <tr><th>No.</th><th>Date</th><th>Time</th><th>Cage No.</th><th>ID</th><th>Reporter</th></tr>
        ${filled.join('')}
      </table>
      <p class="muted" style="margin-top:8px">พิมพ์จากระบบ iLAMP · ${todayISO()} (เอกสารจำลอง prototype)</p>`;
  },

  // ---- 4) Monitoring Record (LA Guide-AF 11.1-03) — one per sick animal ----
  buildMonitoringForm(p, cage, mouse) {
    const entries = [...mouse.treatments].sort((a, b) => (a.date < b.date ? -1 : 1)); // chronological
    const first = entries[0] || {};
    const latest = entries[entries.length - 1] || {};
    const g = Data.getGroup(p, cage.groupId);
    const allSigns = [...new Set(entries.flatMap(t => t.signs || []))].join(', ') || '—';

    const dayCell = (n) => {
      const e = entries[n - 1];
      const dateHtml = e ? `<b>Day ${n}</b> · ${e.date}` : `<b>Day ${n}</b>`;
      const sign = e ? [...(e.signs || []), e.diagnosis].filter(Boolean).join(', ') : '';
      return { dateHtml, sign };
    };
    let dayRows = '';
    for (let i = 1; i <= 7; i++) {
      const L = dayCell(i), R = dayCell(i + 7);
      dayRows += `<tr><td>${L.dateHtml}</td><td class="sign-cell">${L.sign}</td><td>${R.dateHtml}</td><td class="sign-cell">${R.sign}</td></tr>`;
    }

    const prog = !mouse.alive && mouse.death
      ? `Euthanasia / เสียชีวิต ${mouse.death.date}`
      : mouse.careOpen ? 'อยู่ระหว่างติดตามอาการ'
      : `หายเป็นปกติ · ปิดเคส ${latest.date || ''}`;
    const euthReco = latest.recommend === 'Euthanasia by humane endpoint';

    return `
      ${this.cmuHeader('LA Guide–AF 11.1-03 Monitoring Record', '1 หน้า')}
      <div class="doc-title" style="margin-bottom:2px">Monitoring Record</div>
      <div class="doc-title" style="margin-top:0;font-size:13px">บันทึกการเฝ้าติดตามอาการผิดปกติหรืออาการป่วยของสัตว์ทดลอง</div>
      <table class="form">${this.COLS4}
        <tr><td class="band" colspan="4">PROTOCOL INFORMATION</td></tr>
        <tr><td class="lbl">AR</td><td>Protocol No. &nbsp; ${p.name}</td><td class="lbl">Lot.</td><td>—</td></tr>
        <tr><td class="lbl">Case Number</td><td>${this.mouseLabel(p, cage, mouse)}</td><td class="lbl">Date / Time</td><td>${first.date || todayISO()} &nbsp; ${first.time || ''}</td></tr>
        <tr><td class="lbl">Cage &amp; ID</td><td colspan="3">${cage.code} · ${mouse.code} · ${g ? g.name : ''} · ${mouse.sex === 'M' ? 'Male ♂' : 'Female ♀'}</td></tr>
        <tr><td class="lbl">Clinical Signs =</td><td colspan="3">${allSigns}</td></tr>
      </table>
      <table class="form" style="margin-top:10px">
        <colgroup><col style="width:15%"><col style="width:35%"><col style="width:15%"><col style="width:35%"></colgroup>
        <tr><td class="band" colspan="4">Monitoring Record (Daily)</td></tr>
        <tr><th>Date</th><th>Clinical Signs / Sign</th><th>Date</th><th>Clinical Signs / Sign</th></tr>
        ${dayRows}
        <tr><td class="lbl" colspan="4">Progression / Conclusion: &nbsp; ${prog}</td></tr>
        <tr><td class="lbl" colspan="4">Technician Sign/Date/Time: &nbsp; ${latest.vet || '__________'} / ${latest.date || ''} / ${latest.time || ''}</td></tr>
      </table>
      <table class="form" style="margin-top:10px">${this.COLS4}
        <tr><td class="band" colspan="4">Responsible Vet. [Action Plan]</td></tr>
        <tr><td class="lbl">Recommendations</td><td class="sign-cell" colspan="3">
          <div>${this.tick('Tx. By', !euthReco)} <u>&nbsp;${!euthReco ? (latest.treatment || '') : ''}&nbsp;</u></div>
          <div>${this.tick('Euthanasia by humane endpoint should be done on', euthReco)} <u>&nbsp;&nbsp;</u></div>
        </td></tr>
        <tr><td class="lbl">PI Communication</td><td class="sign-cell" colspan="3">${this.tick('PI', false)} &nbsp; ${this.tick('Lab member', false)} Name: __________ &nbsp; ${this.tick('Technician', false)} Name: __________</td></tr>
        <tr><td class="lbl">Vet. Sign/Date/Time</td><td colspan="3">__________ / ${latest.date || ''} / </td></tr>
      </table>
      <p class="muted" style="margin-top:8px">พิมพ์จากระบบ iLAMP · ${todayISO()} (เอกสารจำลอง prototype)</p>`;
  },

  // project export = one Monitoring Record per sick animal (page break between)
  buildSickReportDoc(p) {
    const sick = [];
    p.cages.forEach(cage => cage.mice.forEach(m => { if (m.treatments && m.treatments.length) sick.push({ m, cage }); }));
    const rank = m => (!m.alive ? 2 : m.careOpen ? 0 : 1);
    sick.sort((a, b) => rank(a.m) - rank(b.m));
    if (!sick.length) return '<p class="muted">ไม่มีข้อมูล</p>';
    return sick.map(({ m, cage }, i) =>
      `<div style="${i > 0 ? 'page-break-before:always' : ''}">${this.buildMonitoringForm(p, cage, m)}</div>`).join('');
  },

  // ---- 5) Humane Endpoint weekly record sheet -----------------------------
  // The paper sheet is a MATRIX, not a list: one COLUMN per animal, one ROW per
  // criterion, then Total score and Result. That shape is the point — the reviewer
  // reads across a row to see the whole colony on one parameter, and down a column
  // to see one animal. Twenty animals to a block, as on the form; past that the
  // columns stop being writable by hand, which is what the blank sheet is for.
  //
  // Landscape, because 20 columns in portrait gives ~7 mm each and nobody can
  // write a digit in that.
  HUMANE_COLS_PER_BLOCK: 20,
  HUMANE_SHEET_CSS: `
    @page { size: A4 portrait; margin: 12mm 10mm; }
    table.hsheet { table-layout: fixed; width: 100%; border-collapse: collapse; }
    table.hsheet th, table.hsheet td { border: 1px solid #333; padding: 4px 1px; text-align: center; font-size: 10px; }
    table.hsheet th.rowlbl, table.hsheet td.rowlbl { text-align: left; padding: 4px 6px; font-size: 10.5px; font-weight: 600; }
    /* หัวกรงกินสองช่อง (หนูของกรงเดียวกันอยู่ติดกัน) จึงพิมพ์ 'A-01' ได้เต็มโดยไม่ตัดคำ */
    table.hsheet .cagehd { background: #f1eef7; font-size: 10px; font-weight: 700; white-space: nowrap; }
    table.hsheet .nohd { background: #f8f6fb; font-size: 9.5px; white-space: nowrap; }
    table.hsheet .totrow td { background: #f6f4fa; font-weight: 700; }
    table.hsheet .resrow td { font-weight: 700; }
    table.hsheet td.E { background: #fde2e2; }
    table.hsheet td.D { background: #e6e6e6; }
    .hs-meta { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: flex-end; margin: 8px 0 10px; font-size: 11.5px; }
    .hs-meta .f { flex: 1 1 190px; border-bottom: 1px solid #333; padding-bottom: 2px; white-space: nowrap; }
    /* ตารางไหลต่อกันลงหน้า — 20 ตัวสูงแค่ ~55 มม. บังคับขึ้นหน้าใหม่ทุกตอนคือทิ้ง
       กระดาษเปล่าไปสามในสี่หน้า · ห้ามแค่ 'ตัดกลางตาราง' ก็พอ */
    .hs-block { page-break-inside: avoid; break-inside: avoid; margin-top: 9px; }
    .hs-rule { margin-top: 8px; font-size: 11px; }
  `,

  // '2 – 8 สิงหาคม 2569' เมื่ออยู่เดือนเดียวกัน · เต็มรูปแบบเมื่อคร่อมเดือน
  dateRange(from, to) {
    if (!from) return '';
    if (!to || from === to) return this.thaiDate(from);
    const [ay, am, ad] = from.split('-').map(Number), [by, bm] = to.split('-').map(Number);
    return (ay === by && am === bm) ? `${ad} – ${this.thaiDate(to)}` : `${this.thaiDate(from)} – ${this.thaiDate(to)}`;
  },

  // สัปดาห์ที่เท่าไรของโครงการ — นับจากวันเริ่มโครงการ (สัปดาห์ที่ 1 = 7 วันแรก)
  weekNoOf(p, iso) {
    if (!p.startDate || !iso) return 1;
    const days = Math.floor((new Date(iso) - new Date(p.startDate)) / 86400000);
    return Math.max(1, Math.floor(days / 7) + 1);
  },
  // ทุกสัปดาห์ที่มีการให้คะแนน · หนึ่งสัปดาห์ = หนึ่งแผ่น
  // ประเมินซ้ำในสัปดาห์เดียวกัน ใช้ครั้งล่าสุด (health เรียงตามวันอยู่แล้ว)
  humaneWeeks(p) {
    const map = new Map();
    p.cages.forEach(cage => cage.mice.forEach(m => (m.health || []).forEach(h => {
      if (h.total == null) return;
      const wk = this.weekNoOf(p, h.date);
      if (!map.has(wk)) map.set(wk, { week: wk, dates: new Set(), scored: new Map() });
      const w = map.get(wk);
      w.dates.add(h.date);
      w.scored.set(m.id, { cage, mouse: m, h });
    })));
    return [...map.values()].map(w => {
      const d = [...w.dates].sort();
      return { ...w, from: d[0], to: d[d.length - 1] };
    }).sort((a, b) => a.week - b.week);
  },
  // คอลัมน์ของแผ่น: ทุกตัวที่ยังอยู่ในสัปดาห์นั้น ไม่ใช่เฉพาะตัวที่ประเมินแล้ว —
  // ช่องว่างคือหลักฐานว่ามีตัวไหนตกหล่น ซึ่งเป็นสิ่งที่ผู้ตรวจมองหา
  humaneSheetMice(p, wk) {
    const out = [];
    p.cages.forEach(cage => cage.mice.forEach(m => {
      const rec = wk ? wk.scored.get(m.id) : null;
      const gone = !m.alive && m.death && m.death.date && wk && m.death.date < wk.from;
      if (rec || !gone) out.push({ cage, mouse: m, h: rec ? rec.h : null });
    }));
    return out.sort((a, b) =>
      a.cage.code.localeCompare(b.cage.code, 'en', { numeric: true }) || (a.mouse.cageNo - b.mouse.cageNo));
  },

  // หน้าเกณฑ์การให้คะแนน — แต่ละโครงการตั้งเกณฑ์เองตอนยื่นคำขอ แผ่นคะแนนจึงต้อง
  // มีเกณฑ์ของโครงการนั้นแนบไปด้วย ไม่งั้นตัวเลข 0–3 ไม่มีความหมายกับคนอ่าน
  buildHumaneCriteriaDoc(p) {
    const crit = this.humaneCriteria(p);
    const cfg = this.humaneCfg(p);
    const tables = crit.map((c, i) => {
      const lv = this.critLevels(c);
      const w = c.other ? [10, 62, 28] : [10, 90];
      return `<table class="form" style="margin-bottom:9px">
        <colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>
        <tr><td class="band" colspan="${w.length}">${i + 1}. ${this.esc(c.name)}${
          c.auto === 'weight' ? ' <span style="font-weight:400">— ระบบคำนวณให้จากน้ำหนักที่ชั่ง</span>' : ''}</td></tr>
        <tr><th style="text-align:center">Score</th><th>Criteria</th>${c.other ? '<th>Other, please specify:</th>' : ''}</tr>
        ${[0, 1, 2, 3].map(s =>
          `<tr><td style="text-align:center"><b>${s}</b></td><td>${this.esc(lv[s] || '')}</td>${c.other ? '<td></td>' : ''}</tr>`
        ).join('')}
      </table>`;
    }).join('');

    return `
      ${this.cmuHeader('Humane Endpoint — Criteria & Record', '1 หน้า')}
      <div class="doc-title" style="margin-bottom:2px">ข้อกำหนดในการหยุดการทดลองกับสัตว์ก่อนสิ้นสุดการทดลอง (Humane end-point)</div>
      <div class="doc-title" style="margin-top:0;font-size:12.5px;font-weight:400">ประเมินสัปดาห์ละ 1 ครั้ง · ${this.esc(p.name)}</div>
      <p style="margin:0 0 8px"><b>Early Endpoint Criteria using scoring system are:</b></p>
      ${tables}
      <table class="form">${this.COLS2}
        <tr><td class="lbl">Early euthanasia will be done</td>
          <td>when body weight loss ≥ <b>${cfg.weightLossPct}%</b> or:
            = <b>${crit.length}</b> Criteria &amp; Total score ≥ <b>${cfg.totalThreshold} / ${crit.length * 3}</b></td></tr>
        <tr><td class="lbl">Result</td><td>N = Normal, &nbsp; E = Euthanasia, &nbsp; D = Death</td></tr>
        ${cfg.note ? `<tr><td class="lbl">หมายเหตุ</td><td>${this.esc(cfg.note)}</td></tr>` : ''}
      </table>
      <p class="muted" style="margin-top:8px">พิมพ์จากระบบ iLAMP · ${todayISO()} (เอกสารจำลอง prototype)</p>`;
  },

  // แผ่นบันทึกหนึ่งสัปดาห์ · wk = null → แผ่นเปล่าไว้กรอกมือหน้ากรง
  buildHumaneWeekDoc(p, wk) {
    const crit = this.humaneCriteria(p);
    const cfg = this.humaneCfg(p);
    const list = this.humaneSheetMice(p, wk);
    const N = this.HUMANE_COLS_PER_BLOCK;
    const blocks = [];
    for (let i = 0; i < list.length; i += N) blocks.push(list.slice(i, i + N));
    if (!blocks.length) blocks.push([]);

    // เกณฑ์อาจถูกแก้หลังบันทึกไปแล้ว — จับคู่ด้วยชื่อก่อน แล้วค่อยถอยไปใช้ลำดับ
    const scoreOf = (h, k) => {
      if (!h || !h.scores) return '';
      const s = h.scores.find(x => x.name === crit[k].name) || h.scores[k];
      return s && s.v != null ? s.v : '';
    };
    const resultOf = (row) => {
      const m = row.mouse;
      if (wk && !m.alive && m.death && m.death.date && m.death.date >= wk.from && m.death.date <= wk.to) return 'D';
      return row.h && row.h.result ? row.h.result : '';
    };

    const sheet = (rows, bi) => {
      const pad = N - rows.length;                       // ทุกแผ่นกว้างเท่ากันเสมอ
      const blank = '<td></td>'.repeat(pad);
      const lblW = 26, colW = (100 - lblW) / N;
      // หัวคอลัมน์: รวมช่องของกรงเดียวกันเป็นเซลล์เดียว — แนวตั้งเหลือช่องละ ~7 มม.
      // เขียน 'A-01' ไม่ลง แต่พอรวมช่องของกรงเดียวกันก็พิมพ์ได้เต็มโดยไม่ตัดคำ
      const groups = [];
      rows.forEach(r => {
        const last = groups[groups.length - 1];
        if (last && last.cage.id === r.cage.id) last.n++;
        else groups.push({ cage: r.cage, n: 1 });
      });
      return `<div class="hs-block">
        <table class="hsheet">
          <colgroup><col style="width:${lblW}%">${`<col style="width:${colW}%">`.repeat(N)}</colgroup>
          <tr><th class="rowlbl" rowspan="2">Humane Endpoint parameters</th>
            ${groups.map(g => `<th class="cagehd" colspan="${g.n}">${this.esc(g.cage.code)}</th>`).join('')}${blank}</tr>
          <tr>${rows.map(r => `<th class="nohd">#${r.mouse.cageNo ?? ''}</th>`).join('')}${blank}</tr>
          ${crit.map((c, k) => `<tr>
            <td class="rowlbl">${k + 1}. ${this.esc(c.name)}</td>
            ${rows.map(r => `<td>${scoreOf(r.h, k)}</td>`).join('')}${blank}</tr>`).join('')}
          <tr class="totrow"><td class="rowlbl">Total score</td>
            ${rows.map(r => `<td>${r.h && r.h.total != null ? r.h.total : ''}</td>`).join('')}${blank}</tr>
          <tr class="resrow"><td class="rowlbl">Result</td>
            ${rows.map(r => { const v = resultOf(r); return `<td class="${v}">${v}</td>`; }).join('')}${blank}</tr>
        </table>
      </div>`;
    };

    const when = wk ? this.dateRange(wk.from, wk.to) : '';
    const evaluator = wk
      ? [...new Set([...wk.scored.values()].map(x => x.h.by).filter(Boolean))].join(', ')
      : '';

    return `<style>${this.HUMANE_SHEET_CSS}</style>
      ${this.cmuHeader('Humane Endpoint — Weekly Record', `${list.length} ตัว`)}
      <div class="doc-title" style="margin:8px 0 2px">แบบบันทึกการประเมิน Humane endpoint (รายสัปดาห์)</div>
      <div class="doc-title" style="margin-top:0;font-size:12px;font-weight:400">${this.esc(p.name)}</div>
      <div class="hs-meta">
        <span>สัปดาห์ Care &amp; Use ที่ <b>${wk ? wk.week : '&nbsp;&nbsp;&nbsp;&nbsp;'}</b></span>
        <span class="f">วันที่ / เวลา : ${when}</span>
        <span class="f">ลงชื่อผู้ประเมิน : ${this.esc(evaluator)}</span>
      </div>
      ${blocks.map(sheet).join('')}
      <p class="hs-rule">Early euthanasia will be done when body weight loss ≥ <b>${cfg.weightLossPct}%</b>
        or = <b>${crit.length}</b> Criteria &amp; Total score ≥ <b>${cfg.totalThreshold} / ${crit.length * 3}</b>
        &nbsp;·&nbsp; Result: N = Normal, E = Euthanasia, D = Death</p>
      <p class="muted" style="margin-top:6px">พิมพ์จากระบบ iLAMP · ${todayISO()} (เอกสารจำลอง prototype)</p>`;
  },

  // เลือกสัปดาห์ที่จะพิมพ์ — ทั้งหมด บางสัปดาห์ หรือแผ่นเปล่าไว้กรอกมือ
  openHumaneSheets(p) {
    const weeks = this.humaneWeeks(p);
    const sel = new Set(weeks.map(w => w.week));
    let withCriteria = true, blank = false;
    const total = p.cages.reduce((n, c) => n + c.mice.length, 0);

    const draw = () => {
      const rows = weeks.map(w => {
        const done = w.scored.size;
        const cols = this.humaneSheetMice(p, w).length;
        const e = [...w.scored.values()].filter(x => x.h.result === 'E').length;
        const when = w.from === w.to ? this.thaiDate(w.from) : `${this.thaiDate(w.from)} – ${this.thaiDate(w.to)}`;
        return `<button class="hw-row ${sel.has(w.week) ? 'on' : ''}" data-wk="${w.week}" ${blank ? 'disabled' : ''}>
          <span class="hw-no">สัปดาห์ที่ ${w.week}</span>
          <span class="hw-when">${when}</span>
          <span class="spacer" style="flex:1"></span>
          <span class="hw-n${done < cols ? ' part' : ''}">ประเมินแล้ว ${done} / ${cols} ตัว</span>
          ${e ? `<span class="hw-e">ผล E ${e}</span>` : ''}
        </button>`;
      }).join('');

      this.openModal(`
        <div class="modal-head">
          <div><h3>🩺 แผ่นบันทึก Humane endpoint</h3>
            <div class="sub">${p.name} · หนึ่งแผ่นต่อหนึ่งสัปดาห์ · A4 แนวตั้ง · ${this.HUMANE_COLS_PER_BLOCK} ตัว/แผ่น</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="cs-bar">
            <button class="btn mini" id="hwAll" ${blank ? 'disabled' : ''}>เลือกทั้งหมด</button>
            <button class="btn mini" id="hwNone" ${blank ? 'disabled' : ''}>ล้างที่เลือก</button>
            <span class="spacer" style="flex:1"></span>
            <span class="count-chip">${blank ? 'แผ่นเปล่า' : `เลือกแล้ว ${sel.size} / ${weeks.length} สัปดาห์`}</span>
          </div>
          ${weeks.length
            ? `<div class="hw-list">${rows}</div>`
            : `<p class="empty-note">ยังไม่มีการให้คะแนน Humane endpoint ในโครงการนี้ — พิมพ์แผ่นเปล่าไปกรอกที่หน้ากรงได้</p>`}
          <label class="chk hw-opt"><input type="checkbox" id="hwBlank" ${blank ? 'checked' : ''}>
            <span>พิมพ์<b>แผ่นเปล่า</b>ไว้กรอกด้วยมือ (${total} ตัว · ไม่ใส่คะแนนที่บันทึกไว้)</span></label>
          <label class="chk hw-opt"><input type="checkbox" id="hwCrit" ${withCriteria ? 'checked' : ''}>
            <span>แนบ<b>หน้าเกณฑ์การให้คะแนน</b>ของโครงการนี้ไว้หน้าแรก</span></label>
        </div>
        <div class="modal-foot">
          <button class="btn" id="hwCancel">ปิด</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary" id="hwPrint" ${blank || sel.size ? '' : 'disabled'}>🖨️ พิมพ์</button>
        </div>
      `, { wide: true });

      this.el('closeModal').onclick = () => this.closeModal();
      this.el('hwCancel').onclick = () => this.closeModal();
      this.el('hwAll').onclick = () => { weeks.forEach(w => sel.add(w.week)); draw(); };
      this.el('hwNone').onclick = () => { sel.clear(); draw(); };
      this.el('hwBlank').onclick = (e) => { blank = e.target.checked; draw(); };
      this.el('hwCrit').onclick = (e) => { withCriteria = e.target.checked; };
      document.querySelectorAll('[data-wk]').forEach(b => b.onclick = () => {
        const n = +b.dataset.wk;
        sel.has(n) ? sel.delete(n) : sel.add(n);
        draw();
      });
      this.el('hwPrint').onclick = () => {
        const chosen = blank ? [null] : weeks.filter(w => sel.has(w.week));
        if (!chosen.length) return;
        const pages = chosen.map(w => this.buildHumaneWeekDoc(p, w));
        if (withCriteria) pages.unshift(this.buildHumaneCriteriaDoc(p));
        this.closeModal();
        this.printDocument(`HumaneEndpoint_${p.name}${blank ? '_blank' : ''}`,
          pages.map((h, i) => `<div style="${i > 0 ? 'page-break-before:always' : ''}">${h}</div>`).join(''));
        this.log('Export PDF', blank ? 'แผ่นบันทึก Humane endpoint (เปล่า)'
          : `แผ่นบันทึก Humane endpoint · ${chosen.length} สัปดาห์`, p.name);
      };
    };
    draw();
  },

  // ---------------------------------------------------------
  // WEIGHING WIZARD
  //   steps: water-remaining → food-remaining → each mouse →
  //           water-added → food-added → review → save
  // ---------------------------------------------------------
  // ยืนยันก่อนออกจาก wizard ชั่งน้ำหนัก — ถ้ากดยกเลิก ต้องวาด step เดิมกลับมา
  // (confirmDialog แทนที่ overlay ของ wizard ไป)
  confirmExitWizard(warn) {
    const meta = this.wizardStepMeta();
    const atReview = this.wizard.step >= meta.review;
    this.confirmDialog({
      title: 'ออกจากการชั่งน้ำหนัก?',
      body: warn,
      okLabel: 'ออกโดยไม่บันทึก',
      onOk: () => { this.wizard = null; this.closeModal(); },
    });
    // "ยกเลิก" / ✕ / คลิกพื้นหลัง → กลับไปหน้าเดิมของ wizard
    const back = () => { if (this.wizard) (atReview ? this.renderWizardReview() : this.renderWizardStep()); };
    this.el('cfCancel').onclick = back;
    this.el('closeModal').onclick = back;
  },

  startWizard(p, cage) {
    const mice = cage.mice.filter(m => m.alive);   // dead mice are not weighed
    this.wizard = {
      p, cage, mice,
      mouseIndex: 0,
      data: {
        waterRemaining: null,
        foodRemaining: null,
        mouseWeights: mice.map(() => null),
        // ตรวจสุขภาพก่อนชั่งทีละตัว — คะแนน 0–3 ต่อข้อ ตามเกณฑ์ที่ PI ตั้งไว้
        health: mice.map(() => ({ scores: this.humaneCriteria(p).map(() => null), note: '' })),
        waterAdded: null,
        foodAdded: null,
      },
      // logical step pointer
      step: 0,
    };
    this.renderWizardStep();
  },

  // total steps = 2 (water/food remaining) + N alive mice + 2 (water/food added) + 1 review
  // Each animal takes TWO steps: look at it first, then weigh it. Sci already has
  // the mouse in hand at that moment, so the health check costs nothing extra and
  // catches things a number never would.
  wizardStepMeta() {
    const w = this.wizard;
    const n = w.mice.length;
    const block = n * 2;
    return { water0: 0, food0: 1, mouse0: 2, mouseN: 2 + block - 1,
             waterAdd: 2 + block, foodAdd: 3 + block, review: 4 + block, total: 5 + block };
  },
  // which animal a mouse-block step belongs to, and whether it is the health half
  wizardMouseAt(s) {
    const meta = this.wizardStepMeta();
    const off = s - meta.mouse0;
    return { idx: Math.floor(off / 2), health: off % 2 === 0 };
  },

  // ตรวจสุขภาพก่อนชั่ง — Normal ผ่านไปชั่งเลย · Abnormal ต้องบอกว่าเป็นอย่างไร
  // และหมายเหตุนั้นจะกลายเป็น "แจ้งผิดปกติ" ให้สัตวแพทย์ตรวจต่อ (ดู wizardSave)
  renderWizardHealth(segs) {
    const w = this.wizard;
    const { idx } = this.wizardMouseAt(w.step);
    w.mouseIndex = idx;
    const m = w.mice[idx];
    const h = w.data.health[idx];
    const crit = this.humaneCriteria(w.p);
    const cfg = this.humaneCfg(w.p);
    const max = crit.length * 3;

    // น้ำหนักของรอบนี้ยังไม่ได้ชั่ง (ขั้นชั่งอยู่ถัดไป) — ใช้ค่าล่าสุดที่มีไปก่อน
    // แล้วคิดใหม่ตอนบันทึกด้วยน้ำหนักจริงของรอบนี้
    const lossPct = this.weightLossPct(m);
    const wCrit = crit.find(c => c.auto === 'weight');
    const autoScore = this.weightScore(lossPct, wCrit);
    crit.forEach((c, i) => { if (c.auto === 'weight') h.scores[i] = autoScore ?? 0; });

    const manual = crit.map((c, i) => c.auto ? null : i).filter(i => i !== null);
    const done = manual.every(i => h.scores[i] != null);
    const total = h.scores.reduce((a, b) => a + (b || 0), 0);
    const result = done ? this.humaneResult(w.p, total, lossPct) : null;
    const escalate = result === 'E';
    const needOther = crit.some((c, i) => c.other && (h.scores[i] || 0) > 0);

    const rows = crit.map((c, i) => {
      const v = h.scores[i];
      if (c.auto === 'weight') {
        return `<div class="hsc-row auto set">
          <div class="hsc-label"><b>${i + 1}. ${this.esc(c.name)}</b>
            <span>${lossPct == null ? 'ยังไม่มีน้ำหนักให้เทียบ'
              : `น้ำหนักสูงสุดที่เคยทำได้ ${this.g(this.peakWeight(m))} g → ตอนนี้ ${this.g(Data.latestWeight(m))} g · ลด ${lossPct}%`}</span>
            <span class="hsc-lvtext">${this.esc(this.critLevels(c)[v ?? 0])}</span></div>
          <div class="hsc-btns"><span class="hsc-autoval s${v ?? 0}">${v ?? 0}</span></div>
        </div>`;
      }
      return `<div class="hsc-row ${v != null ? 'set' : ''}">
        <div class="hsc-label"><b>${i + 1}. ${this.esc(c.name)}</b>
          ${v != null ? `<span class="hsc-lvtext">${this.esc(this.critLevels(c)[v])}</span>`
            : `<span>${this.esc(this.critLevels(c)[0])}</span>`}</div>
        <div class="hsc-btns">
          ${this.HEALTH_SCALE.map(sc => `
            <button type="button" class="hsc-b s${sc.v} ${v === sc.v ? 'on' : ''}"
                    data-i="${i}" data-v="${sc.v}" title="${this.esc(this.critLevels(c)[sc.v])}">${sc.v}</button>`).join('')}
        </div>
      </div>`;
    }).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>🩺 ประเมิน Humane endpoint — ${m.code}</h3>
          <div class="sub">กรง ${w.cage.code} · หนูตัวที่ ${idx + 1} จาก ${w.mice.length} · ให้คะแนนก่อนชั่งน้ำหนัก</div></div>
        <span class="spacer"></span><button class="icon-btn" id="wizClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="wizard-steps">${segs}</div>
        ${m.flagOpen ? '<div class="wizard-flagged">มีการแจ้งผิดปกติค้างอยู่ — รอสัตวแพทย์ตรวจ</div>' : ''}
        ${m.careOpen ? '<div class="wizard-flagged care">อยู่ระหว่างการรักษาของสัตวแพทย์</div>' : ''}
        <div class="hsc-legend">${this.HEALTH_SCALE.map(sc =>
          `<span class="hsc-lg s${sc.v}"><b>${sc.v}</b> ${sc.label}</span>`).join('')}
          <span class="hsc-hint">แตะเลขเพื่อดูนิยามแต่ละระดับ</span></div>
        <div class="hsc-list">${rows}</div>
        <div class="hsc-total ${!done ? '' : escalate ? 'bad' : total > 0 ? 'warn' : 'ok'}">
          <span>Total score</span>
          <b>${done ? total : '—'}</b><span class="hsc-max">/ ${max}</span>
          ${done ? `<span class="hsc-result ${this.HUMANE_RESULT[result].tone}">${this.HUMANE_RESULT[result].full}</span>` : ''}
          <span class="spacer" style="flex:1"></span>
          <span class="hsc-th">เกณฑ์: รวม ≥ ${cfg.totalThreshold}${
            this.hasAutoWeight(w.p) ? ` · หรือน้ำหนักลด ≥ ${cfg.weightLossPct}%` : ''}</span>
        </div>
        ${cfg.note ? `<p class="empty-note" style="margin:8px 0 0">${this.esc(cfg.note)}</p>` : ''}
        ${escalate ? `<div class="hsc-alert">
          ${lossPct != null && lossPct >= cfg.weightLossPct
            ? `น้ำหนักลด <b>${lossPct}%</b> ถึงเกณฑ์ <b>${cfg.weightLossPct}%</b>`
            : `คะแนนรวมถึงเกณฑ์ <b>${cfg.totalThreshold}/${max}</b>`}
          — ผลประเมิน <b>E (Euthanasia)</b> · ระบบจะแจ้งสัตวแพทย์ทันที และต้องระบุสิ่งที่พบ</div>` : ''}
        ${done && (total > 0 || needOther) ? `
          <div class="field" style="margin-top:12px">
            <label for="wizHNote">Other, please specify ${escalate ? '<span class="req-star">*</span>' : '<span class="muted-note">(ไม่บังคับ)</span>'}</label>
            <textarea id="wizHNote" rows="2" placeholder="ระบุอาการหรือสิ่งที่พบเพิ่มเติม">${this.esc(h.note)}</textarea>
          </div>` : ''}
        <div class="wizard-nav">
          <button class="btn" id="wizBack">← ย้อนกลับ</button>
          <button class="btn btn-primary" id="wizNext" ${done ? '' : 'disabled'}>
            ${done && total === 0 ? 'N — ปกติ · ไปชั่งน้ำหนัก →' : 'ถัดไป →'}</button>
        </div>
      </div>
    `, { compact: true });

    document.querySelectorAll('.hsc-b').forEach(b => b.onclick = () => {
      const note = this.el('wizHNote'); if (note) h.note = note.value;
      h.scores[+b.dataset.i] = +b.dataset.v;
      const allDone = manual.every(i => h.scores[i] != null);
      if (allDone && h.scores.every(v => (v || 0) === 0)) return this.wizardNext();
      this.renderWizardStep();
    });
    this.el('wizNext').onclick = () => this.wizardNext();
    this.el('wizBack').onclick = () => this.wizardBack();
    this.el('wizClose').onclick = () => this.confirmExitWizard('ข้อมูลที่กรอกไว้จะไม่ถูกบันทึก');
    const note = this.el('wizHNote');
    if (note) note.focus({ preventScroll: true });
  },

  renderWizardStep() {
    const w = this.wizard;
    const meta = this.wizardStepMeta();
    const s = w.step;

    // progress bars
    const segCount = meta.total;
    const segs = Array.from({ length: segCount }, (_, i) =>
      `<div class="wstep ${i < s ? 'done' : i === s ? 'active' : ''}"></div>`).join('');

    // the health half of a mouse block is a look, not a measurement — no numpad
    if (s >= meta.mouse0 && s <= meta.mouseN && this.wizardMouseAt(s).health) {
      return this.renderWizardHealth(segs);
    }

    let title = '', hint = '', bodyExtra = '', value = '', unit = 'กรัม (g)', progress = '', icon = '⚖️';

    if (s === meta.water0) {
      icon = '💧'; title = 'น้ำหนักน้ำคงเหลือ';
      hint = `ชั่งขวดน้ำของกรง ${w.cage.code} แล้วกรอกน้ำหนักที่เหลือ`;
      value = w.data.waterRemaining ?? '';
    } else if (s === meta.food0) {
      icon = '🍚'; title = 'น้ำหนักอาหารคงเหลือ';
      hint = `ชั่งอาหารคงเหลือของกรง ${w.cage.code}`;
      value = w.data.foodRemaining ?? '';
    } else if (s >= meta.mouse0 && s <= meta.mouseN) {
      const idx = this.wizardMouseAt(s).idx;
      w.mouseIndex = idx;
      const m = w.mice[idx];
      const last = Data.latestWeight(m);
      const h = w.data.health[idx];
      icon = '🐭'; title = `ชั่งหนู ${m.code}`;
      const tag = this.mouseTag(w.p, w.cage, m);
      hint = `${tag ? tag + ' · ' : ''}เพศ ${m.sex === 'M' ? 'ผู้ ♂' : 'เมีย ♀'} · กรอกน้ำหนักปัจจุบัน`;
      progress = `<div class="mouse-progress">หนูตัวที่ ${idx + 1} จาก ${w.mice.length}</div>`;
      const hTotal = h.scores.reduce((a, b) => a + (b || 0), 0);
      const peak = this.peakWeight(m);
      bodyExtra = `${hTotal > 0
        ? `<div class="wizard-flagged">🩺 Humane score ${hTotal}/${h.scores.length * 3}${
            h.note ? ' — ' + this.esc(h.note) : ''}</div>` : ''}
        <div class="wizard-prev">น้ำหนักครั้งก่อน: <b>${this.g(last)} g</b>${
          peak != null ? ` · สูงสุดที่เคยทำได้ <b>${this.g(peak)} g</b>` : ''}</div>`;
      value = w.data.mouseWeights[idx] ?? '';
    } else if (s === meta.waterAdd) {
      icon = '💧'; title = 'น้ำหนักน้ำที่เติม';
      hint = `เติมน้ำแล้วกรอกน้ำหนักที่เติมเพิ่ม (กรอก 0 หากไม่เติม)`;
      value = w.data.waterAdded ?? '';
    } else if (s === meta.foodAdd) {
      icon = '🍚'; title = 'น้ำหนักอาหารที่เติม';
      hint = `เติมอาหารแล้วกรอกน้ำหนักที่เติมเพิ่ม (กรอก 0 หากไม่เติม)`;
      value = w.data.foodAdded ?? '';
    } else if (s === meta.review) {
      return this.renderWizardReview();
    }

    const backLabel = s === 0 ? 'ยกเลิก' : '← ย้อนกลับ';
    const nextLabel = s === meta.foodAdd ? 'ตรวจสอบ →' : 'ถัดไป →';

    this.openModal(`
      <div class="modal-head">
        <div><h3>⚖️ ชั่งน้ำหนัก — กรง ${w.cage.code}</h3><div class="sub">กรอกแล้วกด Enter เพื่อไปขั้นถัดไป</div></div>
        <span class="spacer"></span><button class="icon-btn" id="wizClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="wizard-steps">${segs}</div>
        ${progress}
        <div class="weigh-icon">${icon}</div>
        <div class="wizard-title">${title}</div>
        <div class="wizard-hint">${hint}</div>
        <input class="big-input" id="wizInput" type="text" inputmode="none" value="${value}" placeholder="0.0">
        <div class="input-unit">${unit}</div>
        ${bodyExtra}
        <div class="numpad" id="numpad">
          ${['1','2','3','4','5','6','7','8','9','.','0','back'].map(k =>
            `<button class="numkey ${k === 'back' ? 'fn' : ''}" data-k="${k}">${k === 'back' ? '⌫' : k}</button>`).join('')}
        </div>
        <div class="wizard-nav">
          <button class="btn" id="wizBack">${backLabel}</button>
          <button class="btn btn-primary" id="wizNext">${nextLabel}</button>
        </div>
      </div>
    `, { wide: false, compact: true });

    const input = this.el('wizInput');
    // drop a leading zero once a real digit follows it (e.g. "05" → "5"), keep "0" and "0.x"
    const normalize = () => { input.value = input.value.replace(/^0+(?=\d)/, ''); };
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.wizardNext(); } });
    input.addEventListener('input', normalize);
    // on-screen numpad
    this.el('numpad').addEventListener('click', (e) => {
      const btn = e.target.closest('.numkey');
      if (!btn) return;
      const k = btn.dataset.k;
      if (k === 'back') input.value = input.value.slice(0, -1);
      else if (k === '.') { if (!input.value.includes('.')) input.value += (input.value === '' ? '0.' : '.'); }
      else input.value += k;
      normalize();
      input.focus();
    });
    this.el('wizNext').onclick = () => this.wizardNext();
    this.el('wizBack').onclick = () => this.wizardBack();
    this.el('wizClose').onclick = () => this.confirmExitWizard('ข้อมูลที่กรอกไว้จะไม่ถูกบันทึก');
  },

  captureInput() {
    const w = this.wizard, meta = this.wizardStepMeta(), s = w.step;
    // health steps hold a note, not a number
    if (s >= meta.mouse0 && s <= meta.mouseN && this.wizardMouseAt(s).health) {
      const note = this.el('wizHNote');
      if (note) w.data.health[this.wizardMouseAt(s).idx].note = note.value;
      return;
    }
    const raw = this.el('wizInput')?.value;
    const val = raw === '' || raw == null ? null : parseFloat(raw);
    if (s === meta.water0) w.data.waterRemaining = val;
    else if (s === meta.food0) w.data.foodRemaining = val;
    else if (s >= meta.mouse0 && s <= meta.mouseN) w.data.mouseWeights[this.wizardMouseAt(s).idx] = val;
    else if (s === meta.waterAdd) w.data.waterAdded = val;
    else if (s === meta.foodAdd) w.data.foodAdded = val;
  },

  wizardNext() {
    const w = this.wizard, meta = this.wizardStepMeta(), s = w.step;
    // health step: needs a verdict, and Abnormal must say what is wrong
    if (s >= meta.mouse0 && s <= meta.mouseN && this.wizardMouseAt(s).health) {
      const { idx } = this.wizardMouseAt(s);
      const h = w.data.health[idx];
      const note = this.el('wizHNote');
      if (note) h.note = note.value;
      const crit = this.humaneCriteria(w.p);
      const manual = crit.map((c, i) => c.auto ? null : i).filter(i => i !== null);
      if (!manual.every(i => h.scores[i] != null)) {
        this.toast('กรุณาให้คะแนนให้ครบทุกข้อ');
        return;
      }
      const total = h.scores.reduce((a, b) => a + (b || 0), 0);
      const escalate = this.humaneResult(w.p, total, this.weightLossPct(w.mice[idx])) === 'E';
      if (escalate && !(h.note || '').trim()) {
        if (note) { note.focus(); note.style.borderColor = 'var(--red)'; }
        this.toast('ถึงเกณฑ์ต้องแจ้งสัตวแพทย์ — กรุณาระบุสิ่งที่พบ');
        return;
      }
      w.step = Math.min(s + 1, meta.review);
      return this.renderWizardStep();
    }
    const raw = this.el('wizInput')?.value;
    if ((raw === '' || raw == null) && w.step <= meta.foodAdd) {
      this.el('wizInput').focus();
      this.el('wizInput').style.borderColor = 'var(--red)';
      return;
    }
    this.captureInput();
    w.step = Math.min(w.step + 1, meta.review);
    this.renderWizardStep();
  },

  wizardBack() {
    const w = this.wizard;
    if (w.step === 0) { this.wizard = null; this.closeModal(); return; }
    this.captureInput();
    w.step -= 1;
    this.renderWizardStep();
  },

  renderWizardReview() {
    const w = this.wizard, meta = this.wizardStepMeta();
    const segs = Array.from({ length: meta.total }, (_, i) =>
      `<div class="wstep ${i < meta.review ? 'done' : 'active'}"></div>`).join('');

    const mouseRows = w.mice.map((m, i) => {
      const prev = Data.latestWeight(m);
      const nw = w.data.mouseWeights[i];
      const d = (prev != null && nw != null) ? Math.round((nw - prev) * 10) / 10 : null;
      const cls = d == null ? '' : d >= 0 ? 'up' : 'down';
      const h = w.data.health[i];
      const maxS = h.scores.length * 3;
      // คะแนนน้ำหนักคิดใหม่ด้วยน้ำหนักของรอบนี้ที่เพิ่งกรอก
      const crit = this.humaneCriteria(w.p);
      const lp = this.weightLossPct(m, nw);
      const sc = h.scores.map((v, k) => crit[k] && crit[k].auto === 'weight' ? (this.weightScore(lp, crit[k]) ?? 0) : (v || 0));
      const tot = sc.reduce((a, b) => a + b, 0);
      const res = this.humaneResult(w.p, tot, lp);
      const R = this.HUMANE_RESULT[res];
      return `<li class="${tot > 0 ? 'rv-bad' : ''}"><span class="k">🐭 ${m.code}
        <span class="hl-${R.tone === 'ok' ? 'ok' : 'bad'}">${R.label} · ${tot}/${maxS}</span></span>
        <span class="v">${this.g(nw)} g <span class="chg ${cls}">${d == null ? '' : this.gs(d)}</span></span>
        ${tot > 0 || lp > 0 ? `<div class="rv-sub">${lp != null ? `น้ำหนักลดจากจุดสูงสุด ${lp}%` : ''}${
          h.note ? ' · ' + this.esc(h.note) : ''}${
          res === 'E' ? ' — <b>ถึงเกณฑ์ E (Euthanasia) จะแจ้งสัตวแพทย์</b>' : ''}</div>` : ''}</li>`;
    }).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>✅ ตรวจสอบก่อนบันทึก — กรง ${w.cage.code}</h3><div class="sub">ตรวจความถูกต้องแล้วกดบันทึก</div></div>
        <span class="spacer"></span><button class="icon-btn" id="wizClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="wizard-steps">${segs}</div>
        <ul class="review-list">
          <li><span class="k">💧 น้ำคงเหลือ</span><span class="v">${this.g(w.data.waterRemaining)} g</span></li>
          <li><span class="k">🍚 อาหารคงเหลือ</span><span class="v">${this.g(w.data.foodRemaining)} g</span></li>
          ${mouseRows}
          <li><span class="k">💧 น้ำที่เติม</span><span class="v">+${this.g(w.data.waterAdded ?? 0)} g</span></li>
          <li><span class="k">🍚 อาหารที่เติม</span><span class="v">+${this.g(w.data.foodAdded ?? 0)} g</span></li>
        </ul>
        <div class="wizard-nav">
          <button class="btn" id="wizBack">← ย้อนกลับ</button>
          <button class="btn btn-green" id="wizSave">💾 บันทึก</button>
        </div>
      </div>
    `);
    this.el('wizBack').onclick = () => { w.step = meta.foodAdd; this.renderWizardStep(); };
    this.el('wizClose').onclick = () => this.confirmExitWizard('ค่าที่ตรวจทานไว้จะไม่ถูกบันทึก');
    this.el('wizSave').onclick = () => this.wizardSave();
  },

  wizardSave() {
    const w = this.wizard, cage = w.cage;
    const today = this.recDate();   // วันที่ของ "รอบชั่ง" — วันนี้ หรือวันที่กรอกย้อนหลัง
    // ทุกการประเมินลงไทม์ไลน์ รวมทั้งครั้งที่ผลปกติ — "ดูทุกสัปดาห์แล้วปกติ" คือ
    // หลักฐานที่ผู้ตรวจถาม เฉพาะครั้งที่ผลออกมาเป็น E เท่านั้นที่ส่งต่อเข้าสายสัตวแพทย์
    const crit = this.humaneCriteria(w.p);
    const cfg = this.humaneCfg(w.p);
    const maxScore = crit.length * 3;
    const flagged = [];
    w.mice.forEach((m, i) => {
      const h = w.data.health[i];
      const manual = crit.map((c, k) => c.auto ? null : k).filter(k => k !== null);
      if (!m.alive || !manual.every(k => h.scores[k] != null)) return;
      // คิดคะแนนน้ำหนักด้วยน้ำหนักของรอบนี้ (ตอนให้คะแนนยังไม่ได้ชั่ง)
      const nw = w.data.mouseWeights[i];
      const lossPct = this.weightLossPct(m, nw);
      const scores = h.scores.map((v, k) => crit[k].auto === 'weight' ? (this.weightScore(lossPct, crit[k]) ?? 0) : (v || 0));
      const total = scores.reduce((a, b) => a + b, 0);
      const result = this.humaneResult(w.p, total, lossPct);
      this.logHealth(m, {
        source: 'weigh',
        status: result === 'E' ? 'critical' : total === 0 ? 'normal' : 'abnormal',
        note: h.note.trim(),
        scores: crit.map((c, k) => ({ name: c.name, v: scores[k] })),
        total, max: maxScore, result, lossPct,
      });
      if (result !== 'E') return;
      if (m.flagOpen || m.careOpen || m.humaneOrder) return;   // สัตวแพทย์รับเรื่องไว้แล้ว
      m.flagOpen = true;
      const why = lossPct != null && lossPct >= cfg.weightLossPct
        ? `น้ำหนักลด ${lossPct}% (เกณฑ์ ${cfg.weightLossPct}%)`
        : `Humane score ${total}/${maxScore} (เกณฑ์ ${cfg.totalThreshold})`;
      m.flag = { by: this.user.name, note: h.note.trim() ? `${why} — ${h.note.trim()}` : why, date: today, ...this.recStamp() };
      flagged.push({ m, total, why });
      this.log('ถึงเกณฑ์ Humane endpoint', `${m.code} · ${why}`, w.p.name);
    });
    if (flagged.length) {
      this.notify({ kind: 'flag', title: '🛑 พบสัตว์ถึงเกณฑ์ Humane endpoint (ผล E)',
        detail: flagged.map(x => `${x.m.code} — ${x.why}`).join(' · '),
        project: w.p, to: this.nVets(w.p),
        link: { type: 'mouse', cageId: cage.id, mouseId: flagged[0].m.id } });
    }

    // commit new weights (alive mice only — dead mice were skipped)
    w.mice.forEach((m, i) => {
      const nw = w.data.mouseWeights[i];
      if (nw != null) this.putWeight(m, today, nw);   // one weight per day, kept in date order
    });
    // consumed = amount provided last cycle − amount measured remaining now
    const waterConsumed = Math.max(0, Math.round(((cage.water.remaining - (w.data.waterRemaining ?? 0))) * 10) / 10);
    const foodConsumed = Math.max(0, Math.round(((cage.food.remaining - (w.data.foodRemaining ?? 0))) * 10) / 10);
    cage.water.consumed = waterConsumed;
    cage.food.consumed = foodConsumed;
    // supplies: remaining + added → new total available for next cycle
    cage.water.remaining = (w.data.waterRemaining ?? 0) + (w.data.waterAdded ?? 0);
    cage.food.remaining = (w.data.foodRemaining ?? 0) + (w.data.foodAdded ?? 0);
    cage.water.added = w.data.waterAdded;
    cage.food.added = w.data.foodAdded;
    this.logSupply(cage, 'weigh');            // ลงประวัติ ไม่ใช่แค่ทับค่าล่าสุด
    cage.lastRecordDate = this.bumpDate(cage.lastRecordDate, today);
    // keep alert if any mouse has a remark, else mark done
    const hasRemark = cage.mice.some(m => m.remark);
    cage.status = hasRemark ? 'alert' : 'done';

    if (this.weighSession) this.weighSession.done.add(cage.id);  // mark weighed this round

    this.log('ชั่งน้ำหนัก', `บันทึกกรง ${cage.code}`, w.p.name);
    this.wizard = null;
    this.closeModal();
    this.toast(flagged.length
      ? `บันทึกกรง ${cage.code} — ถึงเกณฑ์ E ${flagged.length} ตัว แจ้งสัตวแพทย์แล้ว`
      : `บันทึกกรง ${cage.code} แล้ว ✓`);
    this.renderDashboard();
  },

  // ---------------------------------------------------------
  // 3b. CAGE CARE ROUND  (ACT — เจ้าหน้าที่ดูแลสัตว์ทดลอง)
  // ---------------------------------------------------------
  // Same shape as the Sci weighing round — walk the rack cage by cage, each cage
  // turns green when it is done — but the job is an INSPECTION, not a measurement.
  // Four checkpoints, each simply Normal or Abnormal. Normal ends the checkpoint;
  // Abnormal is what opens work, and the work differs per checkpoint:
  //   Animals → hand over to the existing แจ้งผิดปกติ / แจ้งหนูตาย forms, so a sick
  //             animal enters the vet chain instead of dying in a maintenance note
  //   Feed    → topping up records what went IN; replacing must also weigh what came
  //   Water     OUT first, otherwise the consumption figure silently becomes a lie
  //   Cage    → no weighing, just which kind of change was done
  CARE_ITEMS: [
    { key: 'animals', icon: '🐭', en: 'Animals', th: 'สัตว์ทดลอง',
      hint: 'ดูหนูทุกตัวในกรง — ท่าทาง การเคลื่อนไหว ขน บาดแผล และมีตัวไหนตายหรือไม่' },
    { key: 'feed', icon: '🍚', en: 'Feed', th: 'อาหาร',
      hint: 'อาหารเพียงพอหรือไม่ · ขึ้นรา เปียกชื้น หรือปนเปื้อนหรือไม่' },
    { key: 'water', icon: '💧', en: 'Water', th: 'น้ำ',
      hint: 'น้ำเพียงพอหรือไม่ · ขวดรั่ว จุกตัน หรือน้ำขุ่นหรือไม่' },
    { key: 'cage', icon: '🧹', en: 'Cage', th: 'กรง / วัสดุรองนอน',
      hint: 'วัสดุรองนอนเปียกชื้น สกปรก มีกลิ่น หรือตัวกรง/ฝากรงชำรุดหรือไม่' },
  ],
  CARE_CHANGE: {
    full:   { label: 'Full change', th: 'เปลี่ยนตัวกรง ฝากรง และวัสดุรองนอน' },
    bottom: { label: 'Change Bottom/Pan', th: 'เปลี่ยนเฉพาะวัสดุรองนอน' },
  },
  CARE_MODE: {
    add:     { icon: '➕', label: 'เติมเพิ่ม', hint: 'ของเดิมยังใช้ได้ เติมเข้าไปอีก' },
    replace: { icon: '♻️', label: 'เปลี่ยนใหม่', hint: 'เอาของเดิมออกทิ้ง แล้วใส่ของใหม่' },
  },

  startCareWizard(p, cage) {
    this.careWiz = {
      p, cage,
      step: 0,       // 0..3 = the four checkpoints · 4 = review
      sub: null,     // screen within a checkpoint (see renderCareStep)
      pending: null, // a mouse form we handed off to, so we can tell what it did
      data: {
        animals: { status: null, actions: [] },
        feed:    { status: null, mode: null, discarded: null, amount: null },
        water:   { status: null, mode: null, discarded: null, amount: null },
        cage:    { status: null, change: null },
      },
    };
    this.renderCareStep();
  },

  // escape user-typed text before it goes into a template string
  esc(v) { return String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); },

  careItem() { return this.CARE_ITEMS[this.careWiz.step]; },

  // the latest inspection, shown inside the cage popup so anyone opening a cage
  // can see when it was last checked and what was wrong
  lastCarePanel(cage) {
    const log = cage.careLog || [];
    if (!log.length) return '';
    const r = log[log.length - 1];
    const chips = this.CARE_ITEMS.map(it => {
      const d = r.items[it.key];
      const bad = d.status === 'abnormal';
      let extra = '';
      if (bad && (it.key === 'feed' || it.key === 'water')) {
        const m = this.CARE_MODE[d.mode];
        extra = m ? ` ${m.label} ${this.g(d.amount)} g` : '';
      } else if (bad && it.key === 'cage') {
        extra = ` ${(this.CARE_CHANGE[d.change] || {}).label || ''}`;
      } else if (bad && it.key === 'animals') {
        extra = ` ${d.actions.length} ตัว`;
      }
      return `<span class="care-chip ${bad ? 'bad' : 'ok'}">${it.icon} ${it.en}${bad ? '<b> !</b>' + extra : ' ✓'}</span>`;
    }).join('');
    return `<div class="care-last">
      <div class="cl-head">🧹 ตรวจดูแลกรงล่าสุด <span class="muted-note">${this.thaiDate(r.date)} ${r.time} · ${r.by}</span>${this.lateChip(r)}</div>
      <div class="cl-chips">${chips}</div>
    </div>`;
  },

  renderCareStep() {
    const w = this.careWiz;
    if (!w) return;
    if (w.step >= this.CARE_ITEMS.length) return this.renderCareReview();

    const it = this.careItem();
    const d = w.data[it.key];
    const total = this.CARE_ITEMS.length + 1;
    const segs = Array.from({ length: total }, (_, i) =>
      `<div class="wstep ${i < w.step ? 'done' : i === w.step ? 'active' : ''}"></div>`).join('');

    // ---- the sub-screens an Abnormal answer opens ----
    let body;
    if (d.status !== 'abnormal' || w.sub === null) {
      body = `
        <div class="care-ico">${it.icon}</div>
        <div class="wizard-title">${it.en} <span class="care-th">${it.th}</span></div>
        <div class="wizard-hint">${it.hint}</div>
        <div class="care-choice">
          <button class="care-btn ok ${d.status === 'normal' ? 'on' : ''}" data-st="normal">
            <b>Normal</b><span>ปกติ — ไม่ต้องทำอะไรต่อ</span></button>
          <button class="care-btn bad ${d.status === 'abnormal' ? 'on' : ''}" data-st="abnormal">
            <b>Abnormal</b><span>ผิดปกติ — ต้องดำเนินการต่อ</span></button>
        </div>`;
    } else if (it.key === 'animals') {
      body = this.careAnimalsPanel();
    } else if (it.key === 'cage') {
      body = `
        <div class="care-ico">🧹</div>
        <div class="wizard-title">เปลี่ยนวัสดุรองนอนแบบไหน</div>
        <div class="wizard-hint">เลือกให้ตรงกับที่ทำจริง — เป็นคนละงานกัน</div>
        <div class="care-choice col">
          ${Object.entries(this.CARE_CHANGE).map(([k, v]) => `
            <button class="care-btn ${d.change === k ? 'on' : ''}" data-change="${k}">
              <b>${v.label}</b><span>${v.th}</span></button>`).join('')}
        </div>`;
    } else {
      body = this.careSupplyPanel(it, d);
    }

    const canNext = this.careStepReady();
    this.openModal(`
      <div class="modal-head">
        <div><h3>🧹 ตรวจดูแลกรง — ${w.cage.code}</h3>
          <div class="sub">ชั้น ${this.shelfNameOf(w.p, w.cage)} · ${w.cage.mice.filter(m => m.alive).length} ตัว · ตรวจจุดที่ ${w.step + 1} จาก ${this.CARE_ITEMS.length}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="careClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="wizard-steps">${segs}</div>
        <div class="care-crumbs">${this.CARE_ITEMS.map((x, i) =>
          `<span class="cc-crumb ${i < w.step ? 'done' : i === w.step ? 'now' : ''}">${x.icon} ${x.en}${
            i < w.step && w.data[x.key].status === 'abnormal' ? ' <b>!</b>' : ''}</span>`).join('')}</div>
        ${body}
        <div class="wizard-nav">
          <button class="btn" id="careBack">${w.step === 0 && !w.sub ? 'ยกเลิก' : '← ย้อนกลับ'}</button>
          <button class="btn btn-primary" id="careNext" ${canNext ? '' : 'disabled'}>
            ${w.step === this.CARE_ITEMS.length - 1 && this.careSubDone() ? 'ตรวจสอบ →' : 'ถัดไป →'}</button>
        </div>
      </div>
    `, { compact: true });

    this.el('careClose').onclick = () => this.confirmDialog({
      title: 'ออกจากการตรวจกรงนี้?', body: 'สิ่งที่กรอกไว้ในกรงนี้จะไม่ถูกบันทึก',
      okLabel: 'ออก', danger: true,
      onOk: () => { this.careWiz = null; this.closeModal(); this.renderDashboard(); },
      onCancel: () => this.renderCareStep(),
    });
    this.el('careBack').onclick = () => this.careBack();
    this.el('careNext').onclick = () => this.careNext();
    this.bindCareControls();
  },

  // Animals · Abnormal → pick the animal, then hand it to the real form so the
  // sick case / death record is the official one, not a maintenance side-note
  careAnimalsPanel() {
    const w = this.careWiz;
    const done = w.data.animals.actions;
    const rows = w.cage.mice.map(m => {
      const acted = done.find(a => a.mouseId === m.id);
      const state = !m.alive ? '<span class="ca-state dead">แจ้งตายแล้ว</span>'
        : m.flagOpen ? '<span class="ca-state flag">แจ้งผิดปกติแล้ว</span>'
        : m.careOpen ? '<span class="ca-state care">อยู่ระหว่างรักษา</span>' : '';
      return `<div class="ca-row ${acted ? 'acted' : ''}">
        <div class="ca-id"><b>${m.cageNo}</b> ${m.code}${state}</div>
        ${m.alive ? `<div class="ca-acts">
          <button class="mini-btn" data-flag="${m.id}">⚠️ แจ้งผิดปกติ</button>
          <button class="mini-btn danger" data-death="${m.id}">✝ แจ้งตาย</button>
        </div>` : '<span class="muted-note">—</span>'}
      </div>`;
    }).join('') || '<p class="empty-note">กรงนี้ไม่มีหนู</p>';

    return `
      <div class="care-ico">🐭</div>
      <div class="wizard-title">พบความผิดปกติที่ตัวไหน</div>
      <div class="wizard-hint">เลือกหนูแล้วบันทึกตามอาการ — ระบบจะส่งต่อให้สัตวแพทย์เอง</div>
      <div class="ca-list">${rows}</div>
      ${done.length ? `<div class="ca-done">บันทึกแล้ว ${done.length} รายการในกรงนี้</div>`
        : '<div class="ca-hint">ต้องบันทึกอย่างน้อย 1 รายการ จึงจะไปขั้นถัดไปได้</div>'}`;
  },

  // Feed / Water · Abnormal → เติมเพิ่ม or เปลี่ยนใหม่.
  // Replacing asks for the discarded weight FIRST: the amount thrown away is real
  // consumption data that would otherwise be lost, and without it the next round's
  // "consumed" figure would count the fresh refill as eaten.
  careSupplyPanel(it, d) {
    const w = this.careWiz;
    const cur = it.key === 'feed' ? w.cage.food.remaining : w.cage.water.remaining;
    if (!d.mode) {
      return `
        <div class="care-ico">${it.icon}</div>
        <div class="wizard-title">จัดการ${it.th}อย่างไร</div>
        <div class="wizard-hint">ในระบบตอนนี้มี${it.th} <b>${this.g(cur)} g</b></div>
        <div class="care-choice col">
          ${Object.entries(this.CARE_MODE).map(([k, v]) => `
            <button class="care-btn ${d.mode === k ? 'on' : ''}" data-mode="${k}">
              <b>${v.icon} ${v.label}</b><span>${v.hint}</span></button>`).join('')}
        </div>`;
    }
    const askDiscard = d.mode === 'replace' && w.sub === 'discard';
    const label = askDiscard ? `น้ำหนัก${it.th}เดิมที่เอาออกทิ้ง`
      : d.mode === 'add' ? `น้ำหนัก${it.th}ที่เติมเพิ่ม` : `น้ำหนัก${it.th}ใหม่ที่ใส่เข้ากรง`;
    const hint = askDiscard
      ? `ชั่งของเดิมที่รื้อออกก่อนทิ้ง — ใช้คำนวณว่ากินไปเท่าไหร่จริง`
      : d.mode === 'add' ? `ชั่ง${it.th}ที่เติมเพิ่มเข้าไป` : `ชั่ง${it.th}ใหม่ที่ใส่แทนของเดิม`;
    const value = (askDiscard ? d.discarded : d.amount) ?? '';
    return `
      <div class="care-ico">${it.icon}</div>
      <div class="wizard-title">${label}</div>
      <div class="wizard-hint">${hint}</div>
      <input class="big-input" id="careInput" type="text" inputmode="none" value="${value}" placeholder="0.0">
      <div class="input-unit">กรัม (g)</div>
      <div class="numpad" id="careNumpad">
        ${['1','2','3','4','5','6','7','8','9','.','0','back'].map(k =>
          `<button class="numkey ${k === 'back' ? 'fn' : ''}" data-k="${k}">${k === 'back' ? '⌫' : k}</button>`).join('')}
      </div>`;
  },

  bindCareControls() {
    const w = this.careWiz;
    const it = this.careItem();
    const d = w.data[it.key];

    document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      d.status = b.dataset.st;
      if (d.status === 'normal') {                 // ปกติ = จบตรงนี้ ไม่ถามอะไรต่อ
        w.sub = null;
        this.careNext();
      } else {
        w.sub = it.key === 'feed' || it.key === 'water' ? 'mode' : it.key === 'cage' ? 'change' : 'pick';
        this.renderCareStep();
      }
    });
    document.querySelectorAll('[data-change]').forEach(b => b.onclick = () => {
      d.change = b.dataset.change; this.renderCareStep();
    });
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      d.mode = b.dataset.mode;
      w.sub = d.mode === 'replace' ? 'discard' : 'amount';
      this.renderCareStep();
    });
    document.querySelectorAll('[data-flag]').forEach(b => b.onclick = () => {
      const m = w.cage.mice.find(x => x.id === b.dataset.flag);
      this.careHandOff('flag', m);
    });
    document.querySelectorAll('[data-death]').forEach(b => b.onclick = () => {
      const m = w.cage.mice.find(x => x.id === b.dataset.death);
      this.careHandOff('death', m);
    });

    const input = this.el('careInput');
    if (!input) return;
    const normalize = () => { input.value = input.value.replace(/^0+(?=\d)/, ''); };
    // preventScroll: the numpad is tall, and a plain focus() scrolls the step
    // indicator and breadcrumb out of view — ACT loses track of where they are
    input.focus({ preventScroll: true }); input.select();
    input.addEventListener('input', normalize);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.careNext(); } });
    this.el('careNumpad').addEventListener('click', e => {
      const k = e.target.closest('.numkey'); if (!k) return;
      if (k.dataset.k === 'back') input.value = input.value.slice(0, -1);
      else if (k.dataset.k === '.') { if (!input.value.includes('.')) input.value += (input.value === '' ? '0.' : '.'); }
      else input.value += k.dataset.k;
      normalize(); input.focus();
    });
  },

  // hand the animal to the real vet-chain form, remembering enough to tell
  // afterwards whether the user actually recorded something or backed out
  careHandOff(kind, mouse) {
    const w = this.careWiz;
    w.pending = { mouseId: mouse.id, kind, wasFlagged: !!mouse.flagOpen, wasAlive: mouse.alive };
    if (kind === 'flag') this.openFlagForm(w.p, w.cage, mouse);
    else this.openDeathForm(w.p, w.cage, mouse);
  },

  // every mouse form returns through here: back to the care round if that is where
  // it was opened from, otherwise to the cage popup as before
  afterMouseForm(p, cage) {
    const w = this.careWiz;
    if (!w) return this.openCagePopup(p, cage);
    const pend = w.pending; w.pending = null;
    if (pend) {
      const m = cage.mice.find(x => x.id === pend.mouseId);
      const didFlag = m && !pend.wasFlagged && m.flagOpen;
      const didDie = m && pend.wasAlive && !m.alive;
      if (didFlag || didDie) {
        const kind = didDie ? 'death' : 'flag';
        const acts = w.data.animals.actions;
        if (!acts.some(a => a.mouseId === m.id && a.kind === kind)) {
          acts.push({ mouseId: m.id, mouseCode: m.code, cageNo: m.cageNo, kind });
        }
      }
    }
    this.renderCareStep();
  },

  captureCareInput() {
    const w = this.careWiz, it = this.careItem(), d = w.data[it.key];
    const raw = this.el('careInput')?.value;
    if (raw == null) return;
    const val = raw === '' ? null : parseFloat(raw);
    if (w.sub === 'discard') d.discarded = val; else d.amount = val;
  },

  // can the current screen advance?
  careStepReady() {
    const w = this.careWiz, it = this.careItem(), d = w.data[it.key];
    if (!d.status) return false;
    if (d.status === 'normal') return true;
    if (it.key === 'animals') return d.actions.length > 0;
    if (it.key === 'cage') return !!d.change;
    if (!d.mode) return false;
    return true;   // the numeric screens validate on Next (empty = ยังไม่ได้ชั่ง)
  },
  // is the whole checkpoint finished (so "ถัดไป" would leave it)?
  careSubDone() {
    const w = this.careWiz, it = this.careItem(), d = w.data[it.key];
    if (d.status !== 'abnormal') return true;
    if (it.key === 'feed' || it.key === 'water') return w.sub === 'amount';
    return true;
  },

  careNext() {
    const w = this.careWiz, it = this.careItem(), d = w.data[it.key];
    if (!this.careStepReady()) return;
    // numeric screens: require a number before moving on
    if (this.el('careInput')) {
      const raw = this.el('careInput').value;
      if (raw === '' || isNaN(parseFloat(raw))) {
        this.el('careInput').style.borderColor = 'var(--red)';
        this.el('careInput').focus();
        return;
      }
      this.captureCareInput();
      if (w.sub === 'discard') { w.sub = 'amount'; return this.renderCareStep(); }
    }
    w.sub = null;
    w.step += 1;
    if (w.step >= this.CARE_ITEMS.length) return this.renderCareReview();
    this.renderCareStep();
  },

  careBack() {
    const w = this.careWiz, it = this.careItem(), d = w.data[it.key];
    if (this.el('careInput')) this.captureCareInput();
    if (w.sub === 'amount' && d.mode === 'replace') { w.sub = 'discard'; return this.renderCareStep(); }
    if (w.sub === 'amount' || w.sub === 'discard') { d.mode = null; w.sub = 'mode'; return this.renderCareStep(); }
    if (w.sub) { w.sub = null; d.status = null; return this.renderCareStep(); }
    if (w.step === 0) { this.careWiz = null; this.closeModal(); return this.renderDashboard(); }
    w.step -= 1;
    const prev = this.careItem(), pd = w.data[prev.key];
    w.sub = pd.status === 'abnormal'
      ? (prev.key === 'animals' ? 'pick' : prev.key === 'cage' ? 'change' : 'amount') : null;
    this.renderCareStep();
  },

  renderCareReview() {
    const w = this.careWiz, cage = w.cage;
    const total = this.CARE_ITEMS.length + 1;
    const segs = Array.from({ length: total }, (_, i) =>
      `<div class="wstep ${i < total - 1 ? 'done' : 'active'}"></div>`).join('');

    const line = it => {
      const d = w.data[it.key];
      if (d.status === 'normal') {
        return `<li><span class="k">${it.icon} ${it.en}</span><span class="v ok">✓ Normal</span></li>`;
      }
      let detail = '';
      if (it.key === 'animals') {
        detail = d.actions.map(a =>
          `<div class="rv-sub">${a.kind === 'death' ? '✝ แจ้งตาย' : '⚠️ แจ้งผิดปกติ'} · ตัวที่ ${a.cageNo} (${a.mouseCode})</div>`).join('');
      } else if (it.key === 'cage') {
        const c = this.CARE_CHANGE[d.change];
        detail = `<div class="rv-sub">${c.label} — ${c.th}</div>`;
      } else {
        const m = this.CARE_MODE[d.mode];
        detail = `<div class="rv-sub">${m.icon} ${m.label}`
          + (d.mode === 'replace' ? ` · เอาออกทิ้ง ${this.g(d.discarded)} g` : '')
          + ` · ใส่เข้ากรง ${this.g(d.amount)} g</div>`;
      }
      return `<li class="rv-bad"><span class="k">${it.icon} ${it.en}</span><span class="v bad">! Abnormal</span>${detail}</li>`;
    };

    this.openModal(`
      <div class="modal-head">
        <div><h3>✅ ตรวจสอบก่อนบันทึก — กรง ${cage.code}</h3>
          <div class="sub">ผลการตรวจดูแลกรงรอบนี้</div></div>
        <span class="spacer"></span><button class="icon-btn" id="careClose">✕</button>
      </div>
      <div class="modal-body">
        <div class="wizard-steps">${segs}</div>
        <ul class="review-list care-review">${this.CARE_ITEMS.map(line).join('')}</ul>
        <div class="wizard-nav">
          <button class="btn" id="careBack">← ย้อนกลับ</button>
          <button class="btn btn-green" id="careSave">💾 บันทึกการตรวจ</button>
        </div>
      </div>
    `);
    this.el('careClose').onclick = () => this.confirmDialog({
      title: 'ออกจากการตรวจกรงนี้?', body: 'สิ่งที่กรอกไว้ในกรงนี้จะไม่ถูกบันทึก',
      okLabel: 'ออก', danger: true,
      onOk: () => { this.careWiz = null; this.closeModal(); this.renderDashboard(); },
      onCancel: () => this.renderCareReview(),
    });
    this.el('careBack').onclick = () => { w.step = this.CARE_ITEMS.length - 1; w.sub = null; this.renderCareStep(); };
    this.el('careSave').onclick = () => this.careSave();
  },

  careSave() {
    const w = this.careWiz, cage = w.cage, d = w.data;
    const time = this.recTime();

    // apply what physically changed in the cage
    const apply = (key, store) => {
      const x = d[key];
      if (x.status !== 'abnormal' || !x.mode) return 0;
      if (x.mode === 'add') {
        store.remaining = Math.round((store.remaining + (x.amount || 0)) * 10) / 10;
        store.added = x.amount;
      } else {
        // ของเดิมที่เอาออกทิ้ง = ส่วนที่เหลือจริง ๆ ที่ยังไม่ถูกกิน
        store.consumed = Math.max(0, Math.round((store.remaining - (x.discarded || 0)) * 10) / 10);
        store.remaining = x.amount || 0;
        store.added = x.amount;
      }
      return 1;
    };
    const touched = apply('feed', cage.food) | apply('water', cage.water);
    // ตรวจแล้วปกติ = ไม่ได้ชั่งอะไร จึงไม่มีตัวเลขให้ลงประวัติ — ลงเฉพาะรอบที่วัดจริง
    if (touched) this.logSupply(cage, 'care');

    cage.careLog = cage.careLog || [];
    this.pushDated(cage.careLog, {
      date: this.recDate(), time, by: this.user.name,
      items: JSON.parse(JSON.stringify(d)),
      ...this.recStamp(),
    });
    cage.lastCareDate = this.bumpDate(cage.lastCareDate, this.recDate());
    if (this.careSession) this.careSession.done.add(cage.id);

    const abnormal = this.CARE_ITEMS.filter(it => d[it.key].status === 'abnormal');
    this.log('ตรวจดูแลกรง', abnormal.length
      ? `${cage.code} · ผิดปกติ: ${abnormal.map(x => x.en).join(', ')}`
      : `${cage.code} · ปกติทุกจุด`, w.p.name);

    this.careWiz = null;
    this.closeModal();
    this.toast(abnormal.length
      ? `บันทึกกรง ${cage.code} — พบผิดปกติ ${abnormal.length} จุด`
      : `บันทึกกรง ${cage.code} — ปกติทุกจุด ✓`);
    this.renderDashboard();
  },

  // ---------------------------------------------------------
  // 3c. DOSING ROUND  (AHS — ให้สารทดสอบ / หัตถการตามโปรโตคอล)
  // ---------------------------------------------------------
  // Walks the rack like the other two rounds, but the record is PER ANIMAL, not
  // per cage: two mice in one cage can be on different arms of the protocol.
  // One layer of data — what was done — as free text, because a protocol step is
  // prose ("ป้อนสาร A 10 mg/kg", "เจาะเลือดหางข้างซ้าย") and forcing it into fields
  // would only lose detail.
  //   ประจำ  = carries forward: it reappears pre-filled next round, delete to drop it
  //   ชั่วคราว = this round only
  // Tapping a cage opens its animals; several can be selected and given the SAME
  // entry in one go, which is the normal case when a whole cage shares an arm.
  DOSE_KIND: {
    routine: { label: 'ประจำ', hint: 'ขึ้นให้อัตโนมัติในครั้งถัดไป' },
    once:    { label: 'ชั่วคราว', hint: 'ครั้งนี้ครั้งเดียว' },
  },

  // the routine items an animal carries into the next round
  routineItems(mouse) {
    const last = (mouse.doses || []).filter(d => !d.paused).slice(-1)[0];
    if (!last) return [];
    return last.items.filter(i => i.kind === 'routine').map(i => ({ ...i }));
  },
  lastDose(mouse) { return (mouse.doses || []).slice(-1)[0] || null; },

  // ---- หน้ารวมสุขภาพระดับโครงการ ----
  // ตอบคำถามเดียว: ตอนนี้สัตว์ในโครงการนี้เป็นอย่างไรบ้าง และมีตัวไหนที่วันนี้ยังไม่มีใครดู
  openHealthBoard(p) {
    const cfg = this.humaneCfg(p);
    const today = this.recDate();
    const rows = [];
    p.cages.forEach(c => c.mice.forEach(m => {
      const st = this.healthNow(m);
      const last = this.lastScored(m);
      const checkedToday = (m.health || []).some(h => h.date === today && h.source === 'weigh');
      rows.push({ c, m, st, last, checkedToday });
    }));
    const order = { critical: 0, treating: 1, abnormal: 2, dead: 3, healed: 4, normal: 5 };
    rows.sort((a, b) => (order[a.st] - order[b.st])
      || ((b.last ? b.last.total : -1) - (a.last ? a.last.total : -1))
      || a.m.code.localeCompare(b.m.code));

    const alive = rows.filter(r => r.m.alive);
    const tally = {};
    rows.forEach(r => { tally[r.st] = (tally[r.st] || 0) + 1; });
    const unchecked = alive.filter(r => !r.checkedToday).length;

    const pills = Object.entries(this.HEALTH_STATUS).map(([k, v]) =>
      tally[k] ? `<span class="hb-pill ${v.tone}">${v.label} <b>${tally[k]}</b></span>` : '').join('');

    const body = rows.map(r => {
      const v = this.HEALTH_STATUS[r.st];
      const score = r.last
        ? `<span class="hb-score ${r.last.result === 'E' ? 'bad' : r.last.total > 0 ? 'warn' : 'ok'}">${r.last.total}/${r.last.max}</span>
           ${r.last.result ? `<span class="hb-res ${this.HUMANE_RESULT[r.last.result].tone}">${r.last.result}</span>` : ''}
           <span class="hb-when">${this.thaiDate(r.last.date)}</span>`
        : '<span class="muted-note">ยังไม่เคยให้คะแนน</span>';
      return `<tr data-mid="${r.m.id}" data-cid="${r.c.id}">
        <td><b>${r.m.code}</b><br><span class="muted-note">กรง ${r.c.code}</span></td>
        <td>${this.tagChip(p, r.c, r.m)}</td>
        <td><span class="hb-st ${v.tone}">${v.label}</span></td>
        <td>${score}</td>
        <td>${!r.m.alive ? '<span class="muted-note">—</span>'
          : r.checkedToday ? '<span class="hb-ok">✓ ตรวจแล้ว</span>'
          : '<span class="hb-miss">ยังไม่ได้ตรวจ</span>'}</td>
      </tr>`;
    }).join('');

    this.openModal(`
      <div class="modal-head">
        <div><h3>🩺 สุขภาพสัตว์ทดลอง</h3>
          <div class="sub">${p.name} · ${alive.length} ตัวที่มีชีวิต · เกณฑ์ E: รวม ≥ ${cfg.totalThreshold}/${this.humaneMax(p)}${
            this.hasAutoWeight(p) ? ` หรือน้ำหนักลด ≥ ${cfg.weightLossPct}%` : ''}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="hb-summary">${pills}
          ${unchecked ? `<span class="hb-pill miss">${this.recOn() ? 'วันนั้น' : 'วันนี้'}ยังไม่ได้ตรวจ <b>${unchecked}</b></span>` : ''}</div>
        <div class="hb-items">เกณฑ์ที่ใช้: ${this.humaneCriteria(p).map((x, i) =>
          `<span>${i + 1}. ${this.esc(x.name)}${x.auto === 'weight' ? ' ⚙️' : ''}</span>`).join('')}</div>
        <div class="table-wrap">
          <table class="tbl hb-tbl">
            <thead><tr><th>หนู</th><th>กลุ่ม</th><th>สถานะ</th><th>คะแนนล่าสุด</th><th>ตรวจ${this.recOn() ? this.thaiDate(this.rec.date) : 'วันนี้'}</th></tr></thead>
            <tbody>${body || '<tr><td colspan="5"><p class="empty-note">ยังไม่มีหนูในโครงการ</p></td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" id="hbClose">ปิด</button></div>
    `, { wide: true });

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('hbClose').onclick = () => this.closeModal();
    document.querySelectorAll('.hb-tbl tbody tr[data-mid]').forEach(tr => tr.onclick = () => {
      const cage = p.cages.find(c => c.id === tr.dataset.cid);
      const m = cage && cage.mice.find(x => x.id === tr.dataset.mid);
      if (m && this.can('viewCage', p)) this.openMouseDetail(p, cage, m);
    });
  },

  // ---- ไทม์ไลน์สุขภาพรายตัว ----
  renderHealthTimeline(p, mouse) {
    const log = mouse.health || [];
    if (!log.length) return '<p class="empty-note">ยังไม่มีบันทึกสุขภาพ</p>';
    const cfg = this.humaneCfg(p);
    const rows = [...log].reverse().map(h => {
      const src = this.HEALTH_SOURCE[h.source] || { icon: '•', label: h.source };
      const st = this.HEALTH_STATUS[h.status] || { label: h.status, tone: '' };
      const bars = h.scores ? `<div class="ht-scores">${h.scores.map(s => `
        <span class="ht-sc s${s.v}" title="${this.esc(s.name)}: ${s.v}">
          <i>${this.esc(s.name)}</i><b>${s.v}</b></span>`).join('')}</div>` : '';
      const R = h.result ? this.HUMANE_RESULT[h.result] : null;
      const tot = h.total != null
        ? `<span class="ht-total ${h.result === 'E' ? 'bad' : h.total > 0 ? 'warn' : 'ok'}">${h.total}/${h.max}</span>`
          + (R ? `<span class="ht-res ${R.tone}">${R.label}</span>` : '')
          + (h.lossPct != null && h.lossPct > 0 ? `<span class="ht-loss">น้ำหนักลด ${h.lossPct}%</span>` : '')
        : '';
      return `<div class="ht-row ${st.tone}">
        <div class="ht-when">${this.thaiDate(h.date)}<br><span>${h.time}</span></div>
        <div class="ht-body">
          <div class="ht-top">
            <span class="ht-src">${src.icon} ${src.label}</span>
            <span class="ht-st ${st.tone}">${st.label}</span>${tot}
            <span class="spacer" style="flex:1"></span>
            ${this.lateChip(h)}
            <span class="ht-by">${this.esc(h.by)}</span>
          </div>
          ${h.note ? `<div class="ht-note">${this.esc(h.note)}</div>` : ''}
          ${bars}
        </div>
      </div>`;
    }).join('');
    return `<div class="ht-list">${rows}</div>`;
  },

  // newest first — what was done to this animal, round by round
  renderDoseHistory(mouse) {
    return `<div class="dose-hist">${[...(mouse.doses || [])].reverse().map(d => `
      <div class="dh-row">
        <span class="dh-when">${this.thaiDate(d.date)}<br>${d.time} · ${this.esc(d.by)}${this.lateChip(d)}</span>
        <span class="dh-what">${d.paused
          ? `<span class="dh-paused">⏸️ พักการทดสอบ</span> — ${this.esc(d.pauseReason)}`
          : d.items.map(i => `<span class="dh-item">• ${this.esc(i.text)}<span class="dh-kind">${this.DOSE_KIND[i.kind].label}</span></span>`).join('')}
        </span>
      </div>`).join('')}</div>`;
  },

  // ---- ทำเหมือนรอบที่แล้ว ----------------------------------
  // A dosing protocol is the same thing every day, so retyping it 24 times is how
  // records stop getting written at all. But one button that stamps "done" on 45
  // animals is a record nobody observed — and this system is audited.
  //
  // The middle ground: the repeat is just "apply everyone's ประจำ items", grouped
  // BY WHAT WOULD BE WRITTEN. Four arms of a study collapse to four confirmations —
  // one real decision each — instead of 24 keystroke-chores or 1 blind click.
  // Anything that needs a human to think is pulled out and never swept in.
  doseSkipReason(m) {
    if (m.humaneOrder) return 'สั่งการุณยฆาตไว้';
    if (m.careOpen) return 'กำลังรักษา — รอสัตวแพทย์';
    if (m.flagOpen) return 'แจ้งผิดปกติ รอสัตวแพทย์ตรวจ';
    const last = this.lastDose(m);
    if (last && last.date === this.recDate()) return 'บันทึกรอบนี้ไปแล้ว';
    if (last && last.paused) return 'พักการทดสอบไว้รอบก่อน';
    if (!last) return 'ยังไม่เคยมีบันทึก';
    if (!this.routineItems(m).length) return 'รอบก่อนเป็นรายการชั่วคราวล้วน';
    return null;
  },
  doseRepeatPlan(p) {
    const buckets = new Map();
    const skip = [];
    p.cages.forEach(c => c.mice.filter(m => m.alive).forEach(m => {
      const reason = this.doseSkipReason(m);
      if (reason) return skip.push({ m, cage: c, reason });
      const items = this.routineItems(m);
      const sig = JSON.stringify(items.map(i => i.text));
      if (!buckets.has(sig)) buckets.set(sig, { items, mice: [], cages: new Set(), dates: new Set(), groups: new Set() });
      const b = buckets.get(sig);
      b.mice.push(m); b.cages.add(c.code); b.dates.add(this.lastDose(m).date);
      b.groups.add((this.cageGroup(p, c) || {}).name || 'ยังไม่จัดกลุ่ม');
    }));
    return { buckets: [...buckets.values()].sort((a, b) => b.mice.length - a.mice.length), skip };
  },

  openDoseRepeat(p) {
    const draw = () => {
      const { buckets, skip } = this.doseRepeatPlan(p);
      const today = this.recDate();
      const rows = buckets.map((b, i) => {
        const dates = [...b.dates].sort();
        const newest = dates[dates.length - 1];
        const days = Math.round((new Date(today) - new Date(newest)) / 86400000);
        const stale = days > 2;
        return `<div class="rp-bucket">
          <div class="rp-hd">
            <span class="rp-count">${b.mice.length} ตัว</span>
            <span class="rp-scope">${[...b.groups].join(' · ')} <span class="muted-note">(${b.cages.size} กรง)</span></span>
            <span class="spacer" style="flex:1"></span>
            <span class="rp-from ${stale ? 'stale' : ''}">จากรอบ ${this.thaiDate(newest)}${
              stale ? ` · ผ่านมา ${days} วัน` : ''}</span>
          </div>
          <ul class="rp-items">${b.items.map(it => `<li>• ${this.esc(it.text)}</li>`).join('')}</ul>
          <div class="rp-act">
            <span class="rp-cages">${[...b.cages].join(', ')}</span>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-green mini" data-bucket="${i}">✓ ยืนยันชุดนี้</button>
          </div>
        </div>`;
      }).join('') || '<p class="empty-note">ไม่มีรายการประจำที่ทำซ้ำได้ในรอบนี้</p>';

      const skipRows = skip.length ? `
        <div class="rp-skip">
          <div class="rp-skip-hd">⚠️ ต้องตัดสินใจเอง — ไม่รวมอยู่ในการทำซ้ำ (${skip.length} ตัว)</div>
          ${skip.map(s => `<div class="rp-skip-row">
            <b>${s.m.code}</b> <span class="muted-note">กรง ${s.cage.code}</span>
            <span class="spacer" style="flex:1"></span><span class="rp-why">${s.reason}</span></div>`).join('')}
        </div>` : '';

      this.openModal(`
        <div class="modal-head">
          <div><h3>🔁 ทำเหมือนรอบที่แล้ว</h3>
            <div class="sub">${p.name} · ระบบจัดกลุ่มตามสิ่งที่จะบันทึก — ยืนยันทีละชุด</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <p class="empty-note" style="margin-top:0">ทำซ้ำเฉพาะรายการที่ทำเครื่องหมาย <b>ประจำ</b> ไว้ — รายการชั่วคราวไม่ตามมา</p>
          ${rows}
          ${skipRows}
        </div>
        <div class="modal-foot"><button class="btn" id="rpClose">ปิด</button></div>
      `, { wide: true });

      const done = () => { this.closeModal(); this.renderDashboard(); };
      this.el('closeModal').onclick = done;
      this.el('rpClose').onclick = done;
      document.querySelectorAll('[data-bucket]').forEach(btn => btn.onclick = () => {
        const b = buckets[+btn.dataset.bucket];
        const time = this.recTime();
        b.mice.forEach(m => {
          this.pushDated(m.doses, { date: today, time, by: this.user.name,
            items: b.items.map(i => ({ text: i.text, kind: 'routine' })),
            paused: false, pauseReason: '', ...this.recStamp() });
          if (this.doseSession) this.doseSession.done.add(m.id);
        });
        this.log('ให้สารทดสอบ (ทำซ้ำรอบก่อน)',
          `${b.mice.length} ตัว · ${b.items.map(i => i.text).join(' · ')}`, p.name);
        this.toast(`บันทึก ${b.mice.length} ตัวแล้ว ✓`);
        this.refreshUnderlay(p);
        draw();
      });
    };
    draw();
  },

  // ---- หน้ารวมของกรง: เลือกหนูที่จะบันทึกพร้อมกัน ----
  openDoseCage(p, cage) {
    const live = cage.mice.filter(m => m.alive);
    if (!live.length) { this.toast(`กรง ${cage.code} ไม่มีหนูที่ต้องให้สาร`); return; }
    const sel = new Set();

    const draw = () => {
      const rows = live.map(m => {
        const last = this.lastDose(m);
        const doneToday = last && last.date === this.recDate();
        const routine = this.routineItems(m);
        const state = doneToday
          ? (last.paused ? '<span class="ds-state pause">พักการทดสอบ</span>'
                         : `<span class="ds-state done">บันทึกแล้ว${this.recOn() ? ' (' + this.thaiDate(this.rec.date) + ')' : 'วันนี้'}</span>`)
          : routine.length ? `<span class="ds-state routine">มีรายการประจำ ${routine.length} ข้อ</span>` : '';
        const tag = this.tagChip(p, cage, m);
        return `<button class="ds-row ${sel.has(m.id) ? 'on' : ''} ${doneToday ? 'did' : ''}" data-mid="${m.id}">
          <span class="ds-check">${sel.has(m.id) ? '✓' : ''}</span>
          <span class="ds-id"><b>${m.cageNo}</b> ${m.code} ${tag}${state}</span>
          <span class="ds-go" data-solo="${m.id}">บันทึกตัวนี้ →</span>
        </button>`;
      }).join('');

      this.openModal(`
        <div class="modal-head">
          <div><h3>💉 ให้สารทดสอบ — กรง ${cage.code}</h3>
            <div class="sub">ชั้น ${this.shelfNameOf(p, cage)} · ${live.length} ตัว · เลือกหลายตัวเพื่อบันทึกเหมือนกันทีเดียว</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          <div class="cs-bar">
            <button class="btn mini" id="dsAll">เลือกทั้งหมด</button>
            <button class="btn mini" id="dsNone">ล้างที่เลือก</button>
            <span class="spacer" style="flex:1"></span>
            <span class="count-chip">เลือกแล้ว ${sel.size} / ${live.length} ตัว</span>
          </div>
          <div class="ds-list">${rows}</div>
        </div>
        <div class="modal-foot">
          <button class="btn" id="dsClose">ปิด</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-primary" id="dsGo" ${sel.size ? '' : 'disabled'}>
            บันทึกพร้อมกัน ${sel.size} ตัว →</button>
        </div>
      `, { wide: true });

      this.el('closeModal').onclick = () => { this.closeModal(); this.renderDashboard(); };
      this.el('dsClose').onclick = () => { this.closeModal(); this.renderDashboard(); };
      this.el('dsAll').onclick = () => { live.forEach(m => sel.add(m.id)); draw(); };
      this.el('dsNone').onclick = () => { sel.clear(); draw(); };
      document.querySelectorAll('.ds-row').forEach(b => b.onclick = (e) => {
        const solo = e.target.closest('[data-solo]');
        if (solo) return this.openDoseForm(p, [live.find(m => m.id === solo.dataset.solo)],
          { where: `กรง ${cage.code}`, back: () => this.openDoseCage(p, cage) });
        const id = b.dataset.mid;
        sel.has(id) ? sel.delete(id) : sel.add(id);
        draw();
      });
      this.el('dsGo').onclick = () => {
        if (!sel.size) return;
        this.openDoseForm(p, live.filter(m => sel.has(m.id)),
          { where: `กรง ${cage.code}`, back: () => this.openDoseCage(p, cage) });
      };
    };
    draw();
  },

  // ---- ฟอร์มกรอกรายการ (ใช้ได้ทั้งตัวเดียวและหลายตัวพร้อมกัน) ----
  // `back` is how we return when the form closes — a single cage goes back to its
  // animal list, a cross-cage selection goes back to the rack
  openDoseForm(p, mice, opts = {}) {
    const bulk = mice.length > 1;
    const back = opts.back || (() => this.renderDashboard());
    const where = opts.where || '';
    // the tag needs the cage the animal sits in — derived, because a cross-cage
    // selection has no single cage to pass in
    const cageOf = m => p.cages.find(c => c.mice.includes(m)) || null;
    // รายการประจำของตัวแรกถูกดึงขึ้นมาให้ก่อน — ลบทิ้งได้ถ้ารอบนี้ไม่ทำ
    const st = {
      items: this.routineItems(mice[0]),
      paused: false,
      reason: '',
    };
    if (!st.items.length) st.items.push({ text: '', kind: 'once' });

    const draw = () => {
      const rows = st.items.map((it, i) => `
        <div class="dz-item" data-i="${i}">
          <span class="dz-n">${i + 1}</span>
          <input class="dz-text" type="text" value="${this.esc(it.text)}" data-i="${i}"
                 placeholder="ทำอะไรกับหนูตัวนี้ เช่น ป้อนสาร A 10 mg/kg · เจาะเลือดหาง">
          <div class="dz-kind">
            ${Object.entries(this.DOSE_KIND).map(([k, v]) => `
              <button type="button" class="dz-k ${it.kind === k ? 'on' : ''}" data-kind="${k}" data-i="${i}"
                      title="${v.hint}">${v.label}</button>`).join('')}
          </div>
          <button type="button" class="mini-btn danger dz-del" data-i="${i}">ลบ</button>
        </div>`).join('');

      const who = bulk
        ? `<div class="dz-who">บันทึกพร้อมกัน <b>${mice.length} ตัว</b> — ${mice.map(m => m.code).join(' · ')}</div>`
        : `<div class="dz-who">${mice[0].code} ${this.tagChip(p, cageOf(mice[0]), mice[0])}</div>`;

      this.openModal(`
        <div class="modal-head">
          <div><h3>💉 ให้สารทดสอบ${where ? ' — ' + where : ''}</h3>
            <div class="sub">บันทึกว่าทำอะไรกับหนู — เพิ่มได้หลายรายการ</div></div>
          <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
        </div>
        <div class="modal-body">
          ${who}
          ${st.paused ? `
            <div class="dz-paused">
              <div class="dz-pt">⏸️ พักการทดสอบรอบนี้</div>
              <div class="field">
                <label for="dzReason">เหตุผลที่พัก <span class="req-star">*</span></label>
                <textarea id="dzReason" rows="3" placeholder="เช่น หนูน้ำหนักลดต่อเนื่อง รอสัตวแพทย์ประเมินก่อน">${this.esc(st.reason)}</textarea>
              </div>
              <button class="btn mini" id="dzUnpause">← กลับไปกรอกรายการ</button>
            </div>`
          : `
            <div class="dz-list">${rows}</div>
            <button class="btn mini" id="dzAdd">+ เพิ่มรายการ</button>
            <p class="empty-note" style="margin:10px 0 0">
              <b>ประจำ</b> = ครั้งถัดไปจะขึ้นให้อัตโนมัติ (ลบทิ้งได้) · <b>ชั่วคราว</b> = ครั้งนี้ครั้งเดียว</p>`}
        </div>
        <div class="modal-foot">
          <button class="btn" id="dzCancel">ยกเลิก</button>
          <span class="spacer" style="flex:1"></span>
          ${st.paused ? '' : '<button class="btn btn-warn" id="dzPause">⏸️ พักการทดสอบ</button>'}
          <button class="btn btn-green" id="dzSave">💾 บันทึก</button>
        </div>
      `, { wide: true });

      const capture = () => {
        document.querySelectorAll('.dz-text').forEach(inp => { st.items[+inp.dataset.i].text = inp.value; });
        const r = this.el('dzReason'); if (r) st.reason = r.value;
      };
      this.el('closeModal').onclick = back;
      this.el('dzCancel').onclick = back;
      if (this.el('dzAdd')) this.el('dzAdd').onclick = () => {
        capture(); st.items.push({ text: '', kind: 'once' }); draw();
      };
      if (this.el('dzPause')) this.el('dzPause').onclick = () => { capture(); st.paused = true; draw(); };
      if (this.el('dzUnpause')) this.el('dzUnpause').onclick = () => { capture(); st.paused = false; draw(); };
      document.querySelectorAll('.dz-del').forEach(b => b.onclick = () => {
        capture(); st.items.splice(+b.dataset.i, 1);
        if (!st.items.length) st.items.push({ text: '', kind: 'once' });
        draw();
      });
      document.querySelectorAll('.dz-k').forEach(b => b.onclick = () => {
        capture(); st.items[+b.dataset.i].kind = b.dataset.kind; draw();
      });
      this.el('dzSave').onclick = () => { capture(); this.saveDose(p, mice, st, opts); };
      const first = document.querySelector('.dz-text, #dzReason');
      if (first) first.focus({ preventScroll: true });
    };
    draw();
  },

  saveDose(p, mice, st, opts = {}) {
    if (st.paused) {
      if (!st.reason.trim()) { this.el('dzReason')?.focus(); this.toast('กรุณาระบุเหตุผลที่พักการทดสอบ'); return; }
    } else {
      st.items = st.items.filter(i => i.text.trim());
      if (!st.items.length) { this.toast('กรุณากรอกอย่างน้อย 1 รายการ'); return; }
    }
    const rec = {
      date: this.recDate(), time: this.recTime(), by: this.user.name,
      items: st.paused ? [] : st.items.map(i => ({ text: i.text.trim(), kind: i.kind })),
      paused: st.paused, pauseReason: st.paused ? st.reason.trim() : '',
      ...this.recStamp(),
    };
    mice.forEach(m => {
      m.doses = m.doses || [];
      this.pushDated(m.doses, JSON.parse(JSON.stringify(rec)));
      if (this.doseSession) this.doseSession.done.add(m.id);
    });

    const who = mice.length > 1 ? `${mice.length} ตัว${opts.where ? ' · ' + opts.where : ''}` : mice[0].code;
    this.log(st.paused ? 'พักการให้สารทดสอบ' : 'ให้สารทดสอบ',
      st.paused ? `${who} · ${rec.pauseReason}` : `${who} · ${rec.items.map(i => i.text).join(' · ')}`, p.name);
    if (st.paused) {
      this.notify({ kind: 'dose', title: '⏸️ พักการให้สารทดสอบ',
        detail: `${who} — ${rec.pauseReason}`, project: p,
        to: [...this.nResearchers(p), ...this.nVets(p)], link: { type: 'dashboard' } });
    }
    this.toast(st.paused ? `พักการทดสอบ ${who} แล้ว` : `บันทึก ${who} แล้ว ✓`);
    this.refreshUnderlay(p);   // ตัวนับบนแถบและสีกรงต้องขยับทันที
    (opts.back || (() => this.renderDashboard()))();
  },

  // ---------------------------------------------------------
  // 4. REPORTS
  // ---------------------------------------------------------
  // chart encoding: COLOUR = group · LINE STYLE = data type (metric) · TONE = individual mouse within a group
  PALETTE: ['#2563eb', '#16a34a', '#7c3aed', '#dc2626', '#d97706', '#0891b2', '#db2777'],
  DASH_OPTS: [{ v: '', label: 'เส้นทึบ' }, { v: '7 4', label: 'เส้นประ' }, { v: '2 4', label: 'จุดประ' }, { v: '10 4 2 4', label: 'ประ-จุด' }],
  DEFAULT_METRIC_DASH: { weight: '', water: '7 4', food: '2 4' },   // line style per data type

  // lighten a hex colour toward white by amt (0..1) → used for per-mouse tone
  lighten(hex, amt) {
    if (!amt || !hex) return hex;
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16), mix = c => Math.round(c + (255 - c) * amt);
    return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
  },

  renderReports() {
    const p = Data.getProject(this.route.projectId) || DB.projects.find(x => this.canEnter(x));
    if (!p || !this.canEnter(p)) { this.toast('ไม่มีสิทธิ์เข้าถึง'); return this.go(this.homeRoute()); }
    // graphs are the research result — oversight roles (IACUC/QA/Audit/EX) are excluded
    if (!this.can('viewReports', p)) { this.toast('ตำแหน่งของคุณไม่มีสิทธิ์ดูหน้ากราฟ'); return this.go('dashboard', p.id); }
    // state: mode · groupIds · metrics · groupColor (colour=group) · metricDash (line style=data type)
    if (!this.reportState || this.reportState.projectId !== p.id) {
      this.reportState = {
        projectId: p.id, mode: 'group', groupIds: p.groups.map(g => g.id), metrics: ['weight'],
        dietIds: this.diets(p).map(d => d.id),      // layer 1 filter — which diets are in scope
        groupColor: Object.fromEntries(p.groups.map((g, i) => [g.id, g.color || this.PALETTE[i % this.PALETTE.length]])),
        metricDash: { ...this.DEFAULT_METRIC_DASH },
      };
    }
    // make sure every current group has a colour
    p.groups.forEach((g, i) => { this.reportState.groupColor[g.id] = this.reportState.groupColor[g.id] || g.color || this.PALETTE[i % this.PALETTE.length]; });
    const st = this.reportState;

    // icon-forward pills so users scan instead of read
    const pill = (role, v, on, icon, label, extra = '') =>
      `<label class="check ${on ? 'on' : ''}" title="${label}"><input type="checkbox" data-role="${role}" value="${v}" ${on ? 'checked' : ''}><span class="ic">${icon}</span>${extra}<span class="txt">${label}</span></label>`;

    const modeChecks = [['group', '👥', 'รายกลุ่ม'], ['individual', '🐭', 'รายตัว']]
      .map(([v, ic, label]) => pill('mode', v, st.mode === v, ic, label)).join('');

    const groupChecks = p.groups.map(g =>
      pill('group', g.id, st.groupIds.includes(g.id), '', g.name, `<span class="sw" style="background:${g.color || '#94a3b8'}"></span>`)).join('');

    // layer 1 — filter which diets are in scope (a 2-factor study is read one diet at a time)
    const dietChecks = this.diets(p).map(d =>
      pill('diet', d.id, st.dietIds.includes(d.id), '', d.name, `<span class="sw" style="background:${d.color || '#94a3b8'}"></span>`)).join('');

    const metricChecks = [['weight', '⚖️', 'น้ำหนัก'], ['water', '💧', 'น้ำ'], ['food', '🍚', 'อาหาร']]
      .map(([v, ic, label]) => pill('metric', v, st.metrics.includes(v), ic, label)).join('');

    // shrink the group pills when there are many groups
    const dense = p.groups.length > 5 ? ' dense' : '';

    this.shell(
      `<a data-nav="project" data-project-id="${p.id}">${p.name}</a><span class="sep">/</span><a data-nav="reports">รายงาน</a>`,
      `<div class="page report-page">
        <div class="page-head">
          <h2>รายงาน & กราฟ</h2>
          <div class="ph-actions">
            <button class="btn" id="styleBtn">🎨 รูปแบบเส้น</button>
            <button class="btn btn-green" id="exportBtn">⬇️ Export Excel</button>
          </div>
        </div>
        <div class="report-controls${dense}" id="reportControls">
          <div class="ctrl-group">
            <div class="ctrl-label">👁️ มุมมอง</div>
            <div class="check-row">${modeChecks}</div>
          </div>
          ${this.diets(p).length > 1 ? `<div class="ctrl-group">
            <div class="ctrl-label">🍚 ชนิดอาหาร</div>
            <div class="check-row">${dietChecks}</div>
          </div>` : ''}
          <div class="ctrl-group">
            <div class="ctrl-label">💊 กลุ่มทดสอบ</div>
            <div class="check-row">${groupChecks}</div>
          </div>
          <div class="ctrl-group">
            <div class="ctrl-label">📊 ข้อมูล</div>
            <div class="check-row">${metricChecks}</div>
          </div>
        </div>
        <div class="report-canvas" id="reportCanvas"></div>
      </div>`
    );

    this.el('reportControls').addEventListener('change', (e) => {
      const inp = e.target.closest('input[type=checkbox]');
      if (!inp) return;
      const role = inp.dataset.role, val = inp.value, s = this.reportState;
      if (role === 'mode') s.mode = val;                                   // single-select
      else if (role === 'group') s.groupIds = inp.checked ? [...new Set([...s.groupIds, val])] : s.groupIds.filter(x => x !== val);
      else if (role === 'diet') s.dietIds = inp.checked ? [...new Set([...s.dietIds, val])] : s.dietIds.filter(x => x !== val);
      else if (role === 'metric') s.metrics = inp.checked ? [...new Set([...s.metrics, val])] : s.metrics.filter(x => x !== val);
      this.syncReportChecks();
      this.drawReport(p);
    });
    this.el('exportBtn').onclick = () => this.exportCSV(p);
    this.el('styleBtn').onclick = () => this.openLineStyles(p);
    this.drawReport(p);
  },

  // chart style editor: colour per group + line style per data type (applies live)
  openLineStyles(p) {
    const st = this.reportState;
    const metricLabel = { weight: 'น้ำหนัก', water: 'น้ำ', food: 'อาหาร' };

    const groupRows = p.groups.map(g => {
      const c = st.groupColor[g.id];
      const hex = /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#64748b';
      return `<div class="ls-row" data-role="color" data-g="${g.id}">
        <span class="ls-name"><span class="sw" style="background:${c}"></span>${g.name}</span>
        <input type="color" class="ls-color" value="${hex}" title="เลือกสีกลุ่ม">
      </div>`;
    }).join('');

    const metricRows = ['weight', 'water', 'food'].map(m => {
      const dash = st.metricDash[m] || '';
      return `<div class="ls-row" data-role="dash" data-m="${m}">
        <span class="ls-name">${metricLabel[m]}</span>
        <svg class="ls-prev" viewBox="0 0 64 14"><line x1="3" y1="7" x2="61" y2="7" stroke="var(--text)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${dash}"/></svg>
        <select class="ls-dash" title="ลักษณะเส้น">
          ${this.DASH_OPTS.map(o => `<option value="${o.v}" ${o.v === dash ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>`;
    }).join('');

    this.openModal(`
      <div class="modal-head"><h3>🎨 รูปแบบกราฟ</h3><button class="icon-btn" id="lsClose">✕</button></div>
      <div class="modal-body">
        <div class="ls-sec-title">สีของแต่ละกลุ่ม</div>
        <div class="ls-hint">รายตัวในกลุ่มเดียวกันจะใช้สีนี้ แต่ไล่โทนอ่อน-เข้มแยกแต่ละตัว</div>
        <div class="ls-list">${groupRows}</div>
        <div class="ls-sec-title">ลักษณะเส้นตามชนิดข้อมูล</div>
        <div class="ls-list">${metricRows}</div>
      </div>`);
    this.el('lsClose').onclick = () => this.closeModal();
    document.querySelector('.modal-body').addEventListener('input', (e) => {
      const row = e.target.closest('.ls-row'); if (!row) return;
      if (row.dataset.role === 'color') {
        st.groupColor[row.dataset.g] = e.target.value;
        row.querySelector('.ls-name .sw').style.background = e.target.value;
      } else {
        st.metricDash[row.dataset.m] = e.target.value;
        row.querySelector('.ls-prev line').setAttribute('stroke-dasharray', e.target.value);
      }
      this.drawReport(p);
    });
  },

  // reflect reportState back onto the checkboxes (also enforces single-select for mode)
  syncReportChecks() {
    const st = this.reportState;
    this.el('reportControls').querySelectorAll('input[type=checkbox]').forEach(inp => {
      const role = inp.dataset.role, val = inp.value;
      const on = role === 'mode' ? st.mode === val : role === 'group' ? st.groupIds.includes(val) : st.metrics.includes(val);
      inp.checked = on;
      inp.closest('.check').classList.toggle('on', on);
    });
  },

  // Build series for the report: any combination of metrics (weight/water/food)
  // over the selected groups. Weight is per mouse; water/food are measured per CAGE
  // (the animals share the supply) and read from cage.supplyLog — real recorded
  // rounds, matched by date.
  // No time-range picker — the x-axis is every recorded weigh-day (data is already
  // averaged to one value per day at each weighing).
  // a cage is in scope only when BOTH layers are selected (2-factor design)
  reportCages(p, groupId = null) {
    const st = this.reportState;
    const dietOk = c => !st.dietIds || st.dietIds.includes((this.cageDiet(p, c) || {}).id);
    return p.cages.filter(c => dietOk(c) && (groupId ? c.groupId === groupId : st.groupIds.includes(c.groupId)));
  },

  drawReport(p) {
    const st = this.reportState;
    const metricLabel = { weight: 'น้ำหนัก', water: 'น้ำ', food: 'อาหาร' };
    // colour = group · dash = data type (metric) · tone = individual mouse within a group
    const colorOf = gid => st.groupColor[gid] || '#64748b';
    const dashOf = m => st.metricDash[m] || '';

    const groups = p.groups.filter(g => st.groupIds.includes(g.id));
    const cages = this.reportCages(p);

    // x-axis length = longest weight history among the selected mice
    const range = Math.max(1, ...cages.flatMap(c => c.mice).map(m => m.weights.length)) - 1;
    const labels = Array.from({ length: range + 1 }, (_, i) => isoDaysAgo(range - i).slice(5));

    const multi = st.metrics.length > 1;
    const suffix = m => multi ? ` · ${metricLabel[m]}` : '';
    // น้ำ/อาหารอ่านจาก cage.supplyLog จริง ไม่ได้สร้างเส้นขึ้นมาเองอีกแล้ว
    // จับคู่ด้วย "วันที่" ไม่ใช่ตำแหน่งในอาร์เรย์ — กรงถูกชั่งคนละวันได้ และการกรอก
    // ย้อนหลังก็แทรกกลางลำดับ · วันที่ไม่มีการชั่ง = null (กราฟเว้นช่วงให้เอง)
    const axisDates = Array.from({ length: range + 1 }, (_, i) => isoDaysAgo(range - i));
    // ชั่งซ้ำในวันเดียวกันได้ (Sci ชั่งเช้า ACT เปลี่ยนน้ำบ่าย) — แต่ละรายการนับ
    // ช่วงเวลาของตัวเอง ปริมาณที่กินไป "ทั้งวัน" จึงเป็นผลรวม ไม่ใช่รายการใดรายการหนึ่ง
    const usedOn = (c, metric, iso) => {
      const day = (c.supplyLog || []).filter(x => x.date === iso && x[metric]);
      if (!day.length) return null;
      return Math.round(day.reduce((a, x) => a + (x[metric].consumed || 0), 0) * 10) / 10;
    };
    const cageSeries = (c, metric) => axisDates.map(d => usedOn(c, metric, d));
    let series = [];

    st.metrics.forEach(metric => {
      const dash = dashOf(metric);
      if (metric === 'weight' && st.mode === 'individual') {
        // per-mouse lines (every mouse in every selected group): group colour, tone spread within the group
        groups.forEach(g => {
          const base = colorOf(g.id);
          const show = this.reportCages(p, g.id).flatMap(c => c.mice);
          show.forEach((m, j) => {
            const tone = show.length > 1 ? (j / (show.length - 1)) * 0.55 : 0;
            series.push({ label: m.code + suffix(metric), color: this.lighten(base, tone), dash,
              points: this.tail(m.weights.map(w => w.weight), range + 1) });
          });
        });
      } else if (metric === 'weight') {
        groups.forEach(g => {
          const gm = this.reportCages(p, g.id).flatMap(c => c.mice).filter(m => Data.inStats(m));
          const pts = [];
          for (let d = 0; d <= range; d++) {
            const vals = gm.map(m => this.tail(m.weights.map(w => w.weight), range + 1)[d]).filter(v => v != null);
            pts.push(vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null);
          }
          series.push({ label: g.name + suffix(metric), color: colorOf(g.id), dash, points: pts });
        });
      } else if (st.mode === 'individual') {
        // water/food = amount CONSUMED that day (backend derives it by working backward from the
        // recorded "remaining" across days: consumed = prev_remaining + added − current_remaining).
        // Measured per CAGE (mice share the supply) → finest granularity is per cage.
        groups.forEach(g => {
          const base = colorOf(g.id);
          const gc = this.reportCages(p, g.id);
          gc.forEach((c, j) => {
            const tone = gc.length > 1 ? (j / (gc.length - 1)) * 0.55 : 0;
            series.push({ label: c.code + suffix(metric), color: this.lighten(base, tone), dash, points: cageSeries(c, metric) });
          });
        });
      } else {
        // ค่าเฉลี่ยต่อกรงของกลุ่ม — เฉลี่ยเฉพาะกรงที่มีการชั่งในวันนั้นจริง
        groups.forEach(g => {
          const gc = this.reportCages(p, g.id);
          if (!gc.length) return;
          const cols = gc.map(c => cageSeries(c, metric));
          const pts = axisDates.map((_, d) => {
            const vals = cols.map(col => col[d]).filter(v => v != null);
            return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
          });
          series.push({ label: g.name + suffix(metric), color: colorOf(g.id), dash, points: pts });
        });
      }
    });

    const unit = st.metrics.length === 1 ? `g (${metricLabel[st.metrics[0]]})` : 'g';
    const swatch = (color, dash) => dash ? `background:repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)` : `background:${color}`;
    let legend;
    if (st.mode === 'individual') {
      // compact legend: colour = group (each mouse/cage is a line — hover a point to identify it)
      const gLeg = groups.map(g => `<span><i style="${swatch(colorOf(g.id))}"></i> ${g.name}</span>`).join('');
      const mLeg = st.metrics.length > 1 ? '  ·  ' + st.metrics.map(m => metricLabel[m]).join(' / ') : '';
      legend = `<span class="leg-note">รายตัว — ชี้ที่จุดบนเส้นเพื่อดูรายละเอียด</span> ${gLeg}${mLeg}`;
    } else {
      legend = series.map(s => `<span><i style="${swatch(s.color, s.dash)}"></i> ${s.label}</span>`).join('');
    }
    const canvas = this.el('reportCanvas');
    canvas.innerHTML =
      this.lineChart(series, labels, { height: 340, showAxis: true, unit }) +
      `<div class="chart-legend">${legend}</div>`;
    this.wireChartTooltip(canvas);
  },

  // hover tooltip on chart points: shows "<series> · <date>: <value> g"
  wireChartTooltip(canvas) {
    const svg = canvas.querySelector('svg.chart');
    if (!svg) return;
    let tip = document.getElementById('chartTip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'chartTip'; tip.className = 'chart-tip'; document.body.appendChild(tip); }
    const show = (c) => {
      tip.innerHTML = `<b>${c.dataset.l}</b><span>${c.dataset.d} · <b>${c.dataset.v} g</b></span>`;
      tip.style.display = 'block';
    };
    svg.addEventListener('mouseover', e => { const c = e.target.closest('.pt'); if (c) show(c); });
    svg.addEventListener('mouseout', e => { if (e.target.closest('.pt')) tip.style.display = 'none'; });
    svg.addEventListener('mousemove', e => { tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; });
  },

  tail(arr, n) { return arr.slice(Math.max(0, arr.length - n)); },

  exportCSV(p) {
    const st = this.reportState;
    // both grouping layers are exported so the sheet can be pivoted either way
    const rows = [['Mouse', 'Cage', 'Diet', 'Group', 'NoInGroup', 'Tag', 'Date', 'Weight(g)']];
    const cages = this.reportCages(p);
    cages.forEach(c => {
      const g = Data.getGroup(p, c.groupId);
      const d = this.cageDiet(p, c);
      c.mice.forEach(m => m.weights.forEach(w => rows.push([
        m.code, c.code, d ? d.name : '', g ? g.name : '', m.groupNo ?? '',
        this.mouseTag(p, c, m), w.date, w.weight,
      ])));
    });
    const csv = rows.map(r => r.map(x => `"${x}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${p.name.replace(/\s+/g, '_')}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('ส่งออกไฟล์ Excel (CSV) แล้ว');
  },

  // ---------------------------------------------------------
  // 5. AUDIT LOG  (visible to everyone — transparency)
  // ---------------------------------------------------------
  ACTION_STYLE: {
    'สร้างโครงการ': 'blue', 'ชั่งน้ำหนัก': 'blue',
    'บันทึกการรักษา': 'green', 'ปิดเคส': 'green',
    'สั่ง Humane endpoint': 'red', 'บันทึกการตาย': 'red',
    'Stop (ไม่คิดเฉลี่ย)': 'amber', 'ยกเลิก Stop': 'gray',
  },

  renderAudit() {
    this.auditFilter = this.auditFilter || 'ALL';
    const actions = [...new Set(DB.auditLog.map(e => e.action))];
    const filterOpts = ['<option value="ALL">ทุกกิจกรรม</option>']
      .concat(actions.map(a => `<option value="${a}">${a}</option>`)).join('');

    // only show log entries for projects the user can access (admin sees all; system entries shown to all)
    const visibleNames = new Set(DB.projects.filter(p => this.hasAccess(p)).map(p => p.name));
    const entries = [...DB.auditLog].reverse()
      .filter(e => !e.project || this.isAdmin || visibleNames.has(e.project))
      .filter(e => this.auditFilter === 'ALL' || e.action === this.auditFilter);

    const rows = entries.length ? entries.map(e => `
      <tr>
        <td class="mono" style="white-space:nowrap">${this.formatTs(e.ts)}</td>
        <td><span class="role-tag">${e.role}</span> ${e.user}</td>
        <td><span class="audit-act ${this.ACTION_STYLE[e.action] || 'gray'}">${e.action}</span></td>
        <td>${e.detail}${this.lateChip(e)}</td>
        <td style="color:var(--text-muted)">${e.project || '—'}</td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="empty-note" style="text-align:center;padding:24px">ยังไม่มีบันทึกกิจกรรม</td></tr>`;

    this.shell(
      `<a data-nav="audit">Audit Log</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>📋 Audit Log</h2><div class="desc">บันทึกกิจกรรมทั้งหมดในระบบ — ทุกคนเข้าดูได้เพื่อความโปร่งใส</div></div>
          <div class="field" style="margin:0;min-width:200px"><label>กรองตามกิจกรรม</label>
            <select id="auditFilter">${filterOpts}</select></div>
        </div>
        <div class="report-canvas" style="padding:0;overflow:auto">
          <table class="data audit-table">
            <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>กิจกรรม</th><th>รายละเอียด</th><th>โครงการ</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="empty-note" style="margin-top:10px">แสดง ${entries.length} รายการ · เรียงจากล่าสุด</p>
      </div>`
    );
    const sel = this.el('auditFilter');
    sel.value = this.auditFilter;
    sel.addEventListener('change', () => { this.auditFilter = sel.value; this.renderAudit(); });
  },

  // ---------------------------------------------------------
  // 6. ROLE & PERMISSION  (reference matrix + my memberships)
  // ---------------------------------------------------------
  renderRoles() {
    // one matrix per tier
    const buildMatrix = (defs, keys) => {
      const list = keys.map(k => defs[k]);
      const head = list.map(r => `<th>${r.key}</th>`).join('');
      const rows = CAPABILITIES.map(c => `
        <tr>
          <td>${c.label}</td>
          ${list.map(r => `<td class="pm-cell">${r.caps.includes(c.key) ? '<span class="pm-yes">✓</span>' : '<span class="pm-no">–</span>'}</td>`).join('')}
        </tr>`).join('');
      return { head, rows };
    };
    const pos = buildMatrix(POSITIONS, POSITION_ORDER);
    const prj = buildMatrix(ROLES, ROLE_ORDER);

    // legend: what each position key means + who sees every project
    const posLegend = POSITION_ORDER.map(k => {
      const p = POSITIONS[k];
      const scope = p.scope === 'all' ? 'ทุกโครงการ' : 'เฉพาะที่ได้รับแต่งตั้ง';
      return `<tr><td><span class="role-tag">${p.key}</span></td><td>${p.label}</td><td>${scope}</td></tr>`;
    }).join('');

    // my memberships across projects
    const mine = DB.projects.filter(p => this.hasAccess(p)).map(p => {
      const roles = this.myProjectRoles(p);
      const tags = roles.length
        ? roles.map(r => `<span class="role-tag">${r}</span>`).join(' ')
        : `<span class="empty-note">เข้าถึงตามตำแหน่ง ${this.positionKey()}</span>`;
      return `<tr><td><b>${p.name}</b></td><td>${tags}</td></tr>`;
    }).join('') || `<tr><td colspan="2" class="empty-note">ยังไม่มีโครงการที่เข้าถึงได้</td></tr>`;

    this.shell(
      `<a data-nav="roles">ข้อมูลผู้ใช้</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>👤 ข้อมูลผู้ใช้ & สิทธิ์</h2><div class="desc">สิทธิ์มี 2 ชั้น — <b>ตำแหน่งระดับระบบ</b> (1 ตำแหน่งต่อบัญชี) และ <b>บทบาทในโครงการ</b> · สิทธิ์ที่ใช้จริง = <b>ตำแหน่ง + ทุกบทบาทในโครงการ</b> รวมกัน ไม่มีการหักออก</div></div>
          <button class="btn" id="myPwBtn">🔒 เปลี่ยนรหัสผ่านของฉัน</button>
        </div>

        <div class="section-title">ตำแหน่งของฉัน · เข้าใช้เป็น <b>${this.user.name}</b> — <span class="role-tag">${this.positionKey()}</span> ${this.positionLabel()}</div>
        <div class="report-canvas" style="padding:0;overflow:auto;margin-bottom:22px">
          <table class="data"><thead><tr><th>โครงการ</th><th>บทบาทในโครงการ</th></tr></thead><tbody>${mine}</tbody></table>
        </div>

        <div class="section-title">1) สิทธิ์ตามตำแหน่งระดับระบบ</div>
        <div class="report-canvas" style="padding:0;overflow:auto">
          <table class="data perm-matrix"><thead><tr><th>สิทธิ์ / การกระทำ</th>${pos.head}</tr></thead><tbody>${pos.rows}</tbody></table>
        </div>
        <div class="report-canvas" style="padding:0;overflow:auto;margin:12px 0 22px">
          <table class="data"><thead><tr><th>ตำแหน่ง</th><th>ความหมาย</th><th>มองเห็นโครงการ</th></tr></thead><tbody>${posLegend}</tbody></table>
        </div>

        <div class="section-title">2) สิทธิ์ตามบทบาทในโครงการ (ทีมวิจัย)</div>
        <div class="report-canvas" style="padding:0;overflow:auto">
          <table class="data perm-matrix"><thead><tr><th>สิทธิ์ / การกระทำ</th>${prj.head}</tr></thead><tbody>${prj.rows}</tbody></table>
        </div>
        <p class="empty-note" style="margin-top:10px">สิทธิ์ที่ใช้จริง = <b>รวมทุกตำแหน่งระบบ + ทุกบทบาทในโครงการ</b> · Sci / VET / ACT ที่ระบุในโครงการให้สิทธิ์เท่าตำแหน่งระบบชื่อเดียวกัน <b>แต่จำกัดเฉพาะโครงการนั้น</b> (คนที่ถือตำแหน่งระบบอยู่แล้วจึงเท่ากับเป็นการแต่งตั้งในนาม) · การแต่งตั้งสมาชิกทำโดย <b>หัวหน้าสัตวแพทย์ (AV)</b></p>
      </div>`
    );
    this.el('myPwBtn').onclick = () => this.openMyPassword();
  },

  // ---------------------------------------------------------
  // 7. USER MANAGEMENT (admin only)
  // ---------------------------------------------------------
  renderUsers() {
    if (!this.canManageUsers) { this.toast('เฉพาะผู้ดูแลระบบและหัวหน้าสัตวแพทย์เท่านั้น'); return this.go('projects'); }

    const rows = DB.users.map(u => {
      const self = u.id === this.user.id;
      const lastAdmin = this.isLastAdmin(u);
      return `<tr>
        <td><b>${u.name}</b>${self ? ' <span class="role-tag">คุณ</span>' : ''}</td>
        <td class="mono" style="color:var(--text-muted)">${u.email}</td>
        <td>${this.positionKeys(u).map(k => `<span class="audit-act ${k === 'ADMIN' ? 'red' : 'gray'}">${k}</span>`).join(' ')}
            <span style="color:var(--text-muted);font-size:12px">${this.positionLabel(u)}</span></td>
        <td style="white-space:nowrap">
          <button class="mini-btn" data-edit="${u.id}">แก้ไข</button>
          <button class="mini-btn danger" data-del="${u.id}" ${self || lastAdmin ? 'disabled title="ลบไม่ได้"' : ''}>ลบ</button>
        </td>
      </tr>`;
    }).join('');

    this.shell(
      `<a data-nav="users">จัดการผู้ใช้</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>👤 จัดการผู้ใช้</h2><div class="desc">เพิ่ม แก้ไข ลบบัญชีผู้ใช้ และกำหนดตำแหน่งระดับระบบ · บุคคลภายนอกต้องให้ผู้ดูแลระบบหรือหัวหน้าสัตวแพทย์เปิดบัญชี <b>External</b> ให้ก่อน · มีผู้ดูแลระบบ ${this.adminCount()} คน</div></div>
          <button class="btn btn-primary" id="addUserBtn"><span class="ico-plus">+</span> เพิ่มผู้ใช้</button>
        </div>
        <div class="report-canvas" style="padding:0;overflow:auto">
          <table class="data">
            <thead><tr><th>ชื่อ-สกุล</th><th>อีเมล</th><th>สิทธิ์ระบบ</th><th>จัดการ</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="empty-note" style="margin-top:10px">admin ลดสิทธิ์/ลบตัวเองไม่ได้ และต้องมี admin อย่างน้อย 1 คนเสมอ</p>
      </div>`
    );

    this.el('addUserBtn').onclick = () => this.openUserForm(null);
    document.querySelectorAll('[data-edit]').forEach(b => {
      b.onclick = () => this.openUserForm(DB.users.find(u => u.id === b.dataset.edit));
    });
    document.querySelectorAll('[data-del]').forEach(b => {
      if (b.disabled) return;
      b.onclick = () => {
        const u = DB.users.find(x => x.id === b.dataset.del);
        if (u.id === this.user.id) { this.toast('ลบบัญชีตัวเองไม่ได้'); return; }
        if (this.isLastAdmin(u)) { this.toast('ต้องมี admin อย่างน้อย 1 คน'); return; }
        const inProjects = DB.projects.filter(p => (p.members || []).some(m => m.userId === u.id)).length;
        this.confirmDialog({
          title: `ลบผู้ใช้ ${u.name}?`,
          body: `${u.email} · ตำแหน่ง ${this.positionLabel(u)}${inProjects ? `<br>จะถูกถอดออกจาก <b>${inProjects} โครงการ</b> ที่ได้รับแต่งตั้งไว้` : ''}`,
          okLabel: '🗑️ ลบผู้ใช้',
          onOk: () => {
            DB.users = DB.users.filter(x => x.id !== u.id);
            DB.projects.forEach(p => { if (p.members) p.members = p.members.filter(m => m.userId !== u.id); });
            this.log('ลบผู้ใช้', `${u.name} (${u.email})`, '');
            this.renderUsers();
          },
        });
      };
    });
  },

  openUserForm(user) {
    const isNew = !user;
    const u = user || { firstName: '', lastName: '', email: '', password: '', position: 'SCI' };
    const self = user && user.id === this.user.id;
    const held = u.position;                    // exactly one system position
    const lockRole = self && held === 'ADMIN';  // admin can't demote self
    // only a full admin may hand out the ADMIN position
    const posChoices = POSITION_ORDER.filter(k => k !== 'ADMIN' || this.isAdmin);

    this.openModal(`
      <div class="modal-head">
        <div><h3>${isNew ? 'เพิ่มผู้ใช้ใหม่' : 'แก้ไขผู้ใช้'}</h3><div class="sub">${isNew ? 'ตั้งค่าบัญชีเริ่มต้น' : u.email}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="two-col">
          <div class="field"><label>ชื่อ <span style="color:var(--red)">*</span></label><input id="uFirst" value="${u.firstName}"></div>
          <div class="field"><label>สกุล</label><input id="uLast" value="${u.lastName}"></div>
        </div>
        <div class="field"><label>อีเมล <span style="color:var(--red)">*</span></label><input id="uEmail" type="email" value="${u.email}"></div>
        <div class="field"><label>รหัสผ่าน ${isNew ? '<span style="color:var(--red)">*</span>' : '<span style="font-weight:400;color:var(--text-muted)">(เว้นว่างหากไม่เปลี่ยน)</span>'}</label>
          <input id="uPass" type="text" value="${isNew ? u.password : ''}" placeholder="${isNew ? 'อย่างน้อย 6 ตัวอักษร' : '••••••'}"></div>
        <div class="field"><label>ตำแหน่งระดับระบบ <span style="color:var(--red)">*</span>
            <span style="font-weight:400;color:var(--text-muted)">— เลือก 1 ตำแหน่งต่อบัญชี</span></label>
          <div class="pos-grid" id="uRole">
            ${posChoices.map(k => `<button type="button" class="role-sys ${held === k ? 'sel' : ''}" data-r="${k}" ${lockRole && k !== 'ADMIN' ? 'disabled' : ''} title="${POSITIONS[k].label}">${k}</button>`).join('')}
          </div>
          <p class="empty-note" id="posHint">${POSITIONS[held] ? POSITIONS[held].label : 'ยังไม่ได้เลือกตำแหน่ง'}</p>
          ${lockRole ? '<p class="empty-note">ผู้ดูแลระบบเปลี่ยนตำแหน่งของตัวเองไม่ได้</p>' : ''}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="uCancel">ยกเลิก</button>
        <button class="btn btn-primary" id="uSave">${isNew ? 'สร้างผู้ใช้' : 'บันทึก'}</button>
      </div>
    `);

    // single-select: exactly one system position
    let chosen = held;
    this.el('uRole').querySelectorAll('.role-sys').forEach(b => {
      b.onclick = () => {
        if (b.disabled) return;
        if (lockRole) return;   // self-admin can't switch
        chosen = b.dataset.r;
        this.el('uRole').querySelectorAll('.role-sys').forEach(x => x.classList.toggle('sel', x === b));
        this.el('posHint').textContent = POSITIONS[chosen] ? POSITIONS[chosen].label : '';
      };
    });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('uCancel').onclick = () => this.closeModal();
    this.el('uSave').onclick = () => {
      const firstName = this.el('uFirst').value.trim();
      const lastName = this.el('uLast').value.trim();
      const email = this.el('uEmail').value.trim();
      const pass = this.el('uPass').value;
      if (!firstName) { this.el('uFirst').focus(); this.toast('กรุณากรอกชื่อ'); return; }
      if (!/^\S+@\S+\.\S+$/.test(email)) { this.el('uEmail').focus(); this.toast('อีเมลไม่ถูกต้อง'); return; }
      if (DB.users.some(x => x.email.toLowerCase() === email.toLowerCase() && (!user || x.id !== user.id))) { this.toast('อีเมลนี้ถูกใช้แล้ว'); return; }
      if (isNew && pass.length < 6) { this.el('uPass').focus(); this.toast('รหัสผ่านอย่างน้อย 6 ตัวอักษร'); return; }
      if (!isNew && pass && pass.length < 6) { this.el('uPass').focus(); this.toast('รหัสผ่านอย่างน้อย 6 ตัวอักษร'); return; }
      if (!chosen) { this.toast('กรุณาเลือกตำแหน่ง'); return; }
      // last-admin safety net (the position is locked for a self-admin anyway)
      if (user && user.position === 'ADMIN' && chosen !== 'ADMIN' && this.isLastAdmin(user)) { this.toast('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน'); return; }

      if (isNew) {
        DB.users.push({ id: 'u_' + Date.now().toString(36), firstName, lastName, email, password: pass, position: chosen, projectRole: null, name: `${firstName} ${lastName}`.trim() });
        this.log('เพิ่มผู้ใช้', `${firstName} ${lastName} (${email}) · ${chosen}`, '');
      } else {
        user.firstName = firstName; user.lastName = lastName; user.email = email;
        user.name = `${firstName} ${lastName}`.trim();
        user.position = chosen;
        if (pass) user.password = pass;
        this.log('แก้ไขผู้ใช้', `${user.name} (${email}) · ${chosen}`, '');
      }
      this.closeModal();
      this.toast('บันทึกผู้ใช้แล้ว');
      this.renderUsers();
    };
  },

  // self-service password change (any user)
  openMyPassword() {
    const u = this.user;
    this.openModal(`
      <div class="modal-head">
        <div><h3>🔒 เปลี่ยนรหัสผ่าน</h3><div class="sub">${u.name} · ${u.email}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><label>รหัสผ่านปัจจุบัน</label><input id="pwCur" type="password" placeholder="รหัสผ่านเดิม"></div>
        <div class="field"><label>รหัสผ่านใหม่</label><input id="pwNew" type="password" placeholder="อย่างน้อย 6 ตัวอักษร"></div>
        <div class="field"><label>ยืนยันรหัสผ่านใหม่</label><input id="pwNew2" type="password"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="pwCancel">ยกเลิก</button>
        <button class="btn btn-primary" id="pwSave">บันทึกรหัสผ่าน</button>
      </div>
    `, { compact: true });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('pwCancel').onclick = () => this.closeModal();
    this.el('pwSave').onclick = () => {
      const cur = this.el('pwCur').value, nw = this.el('pwNew').value, nw2 = this.el('pwNew2').value;
      if (cur !== u.password) { this.el('pwCur').focus(); this.toast('รหัสผ่านปัจจุบันไม่ถูกต้อง'); return; }
      if (nw.length < 6) { this.el('pwNew').focus(); this.toast('รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร'); return; }
      if (nw !== nw2) { this.el('pwNew2').focus(); this.toast('ยืนยันรหัสผ่านไม่ตรงกัน'); return; }
      u.password = nw;
      this.log('เปลี่ยนรหัสผ่าน', 'เปลี่ยนรหัสผ่านของตนเอง', '');
      this.closeModal();
      this.toast('เปลี่ยนรหัสผ่านแล้ว');
    };
  },

  // ---------------------------------------------------------
  // Member & role management for a project (PI / admin)
  // ---------------------------------------------------------
  openMembers(p) {
    if (!this.can('manageMembers', p)) { this.toast('ไม่มีสิทธิ์จัดการสมาชิก'); return; }
    p.members = p.members || [];

    const rows = p.members.map(m => {
      const u = DB.users.find(x => x.id === m.userId);
      const chips = ROLE_ORDER.map(rk =>
        `<button type="button" class="role-chip ${m.roles.includes(rk) ? 'on' : ''}" data-uid="${m.userId}" data-role="${rk}" title="${ROLES[rk].label}">${rk}</button>`).join('');
      return `<tr>
        <td><b>${u ? u.name : m.userId}</b> <span style="color:var(--text-muted);font-size:12px">${u ? this.positionKeys(u).join(' + ') : ''}</span></td>
        <td><div class="role-chips">${chips}</div></td>
        <td><button class="icon-btn" data-remove="${m.userId}" title="เอาออกจากโครงการ">🗑️</button></td>
      </tr>`;
    }).join('');

    // admins are system-wide superusers, not assignable as ordinary project members
    const nonMembers = DB.users.filter(u => u.position !== 'ADMIN' && !p.members.some(m => m.userId === u.id));
    const addOpts = nonMembers.length
      ? `<select id="addUser">${nonMembers.map(u => `<option value="${u.id}">${u.name} · ${this.positionKeys(u).join(' + ')}</option>`).join('')}</select>
         <button class="btn btn-primary btn-sm" id="addMemberBtn">+ เพิ่มเป็นสมาชิก</button>`
      : `<span class="empty-note">เพิ่มผู้ใช้ครบทุกคนแล้ว</span>`;

    this.openModal(`
      <div class="modal-head">
        <div><h3>👥 สมาชิก & สิทธิ์ — ${p.name}</h3><div class="sub">คลิกบทบาทเพื่อเปิด/ปิด (1 คนถือได้หลายบทบาท)</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <table class="data"><thead><tr><th>ผู้ใช้</th><th>บทบาทในโครงการ</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="add-member">${addOpts}</div>
        <p class="empty-note"><b>ทีมวิจัย</b> — PI และ CoPI สิทธิ์เท่ากัน (แก้ผังกรง · สั่ง Stop · ดูกราฟ) · AHS ให้สารทดสอบและดูกราฟ<br><b>ผู้ดูแลประจำโครงการ</b> — Sci / VET / ACT ได้สิทธิ์เท่าตำแหน่งระบบชื่อเดียวกัน <b>แต่เฉพาะในโครงการนี้</b> จึงใช้แต่งตั้งบุคคลภายนอกให้ทำงานเฉพาะโครงการได้</p>
      </div>
      <div class="modal-foot"><button class="btn" id="closeMembers">เสร็จสิ้น</button></div>
    `, { wide: true });

    const refresh = () => { this.closeModal(); this.openMembers(p); };
    this.el('closeModal').onclick = () => { this.closeModal(); this.renderDashboard(); };
    this.el('closeMembers').onclick = () => { this.closeModal(); this.renderDashboard(); };
    document.querySelectorAll('[data-role]').forEach(b => {
      b.onclick = () => {
        const m = p.members.find(x => x.userId === b.dataset.uid);
        const rk = b.dataset.role;
        if (m.roles.includes(rk)) m.roles = m.roles.filter(r => r !== rk);
        else m.roles.push(rk);
        this.log('จัดการสมาชิก', `${DB.users.find(u => u.id === m.userId)?.name}: ${m.roles.join('/') || 'ไม่มีบทบาท'}`, p.name);
        refresh();
      };
    });
    document.querySelectorAll('[data-remove]').forEach(b => {
      b.onclick = () => {
        const uid = b.dataset.remove;
        p.members = p.members.filter(m => m.userId !== uid);
        this.log('จัดการสมาชิก', `เอา ${DB.users.find(u => u.id === uid)?.name} ออกจากโครงการ`, p.name);
        refresh();
      };
    });
    if (nonMembers.length) this.el('addMemberBtn').onclick = () => {
      const uid = this.el('addUser').value;
      p.members.push({ userId: uid, roles: ['AHS'] });   // start as the basic operator role
      this.log('จัดการสมาชิก', `เพิ่ม ${DB.users.find(u => u.id === uid)?.name} (AHS)`, p.name);
      this.notify({ kind: 'member', title: 'คุณถูกเพิ่มเข้าโครงการ',
        detail: 'บทบาท AHS', project: p, to: [uid], link: { type: 'dashboard' } });
      refresh();
    };
  },

  // ---------------------------------------------------------
  // SVG line chart
  // ---------------------------------------------------------
  lineChart(series, labels, opts = {}) {
    const W = 680, H = opts.height || 220, padL = 42, padR = 12, padT = 14, padB = 26;
    const allVals = series.flatMap(s => s.points).filter(v => v != null);
    if (!allVals.length) return `<div class="empty-note">ไม่มีข้อมูลสำหรับแสดงผล</div>`;
    let min = Math.min(...allVals), max = Math.max(...allVals);
    const pad = (max - min) * 0.15 || 1;
    min = Math.floor(min - pad); max = Math.ceil(max + pad);
    const n = labels.length;
    const x = i => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
    const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));

    // gridlines + y labels
    let grid = '';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const val = min + (max - min) * t / ticks;
      const yy = y(val);
      grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${Math.round(val)}</text>`;
    }
    // x labels (thin out)
    let xlab = '';
    const stepEvery = Math.ceil(n / 8);
    labels.forEach((lb, i) => {
      if (i % stepEvery === 0 || i === n - 1) {
        xlab += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#94a3b8">${lb}</text>`;
      }
    });

    const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const paths = series.map(s => {
      let d = '', started = false;
      s.points.forEach((v, i) => {
        if (v == null) return;
        d += (started ? ' L' : 'M') + ` ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        started = true;
      });
      // each point is a hover target → tooltip shows series label · date · value
      const dots = s.points.map((v, i) => v == null ? '' :
        `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${s.color}" data-l="${esc(s.label)}" data-d="${esc(labels[i])}" data-v="${v}"/>`).join('');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>${dots}`;
    }).join('');

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${grid}${paths}${xlab}</svg>`;
  },

  // ---------------------------------------------------------
  // Modal + toast utilities
  // ---------------------------------------------------------
  openModal(html, opts = {}) {
    this.closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = 'overlay';
    overlay.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''} ${opts.compact ? 'compact' : ''}">${html}</div>`;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !this.wizard && !this.careWiz) this.closeModal();
    });
    document.body.appendChild(overlay);
  },
  // In-app replacement for window.confirm() so destructive prompts match the app's
  // modal styling. `onOk` runs only when confirmed. Never use native confirm().
  // Pass `requireText` to demand the user TYPE that exact phrase first — used when
  // an already-made decision is being changed (see CONFIRM_PHRASE).
  confirmDialog({ title, body, okLabel = 'ยืนยัน', danger = true, requireText = null, onOk }) {
    this.openModal(`
      <div class="modal-head"><div><h3>${title}</h3></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button></div>
      <div class="modal-body">
        <p class="confirm-body">${body}</p>
        ${requireText ? `<div class="confirm-type">
            <label>พิมพ์ <code>${requireText}</code> เพื่อยืนยันการแก้ไข</label>
            <input id="cfText" autocomplete="off" placeholder="${requireText}">
          </div>` : ''}
      </div>
      <div class="modal-foot">
        <span class="spacer" style="flex:1"></span>
        <button class="btn" id="cfCancel">ยกเลิก</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfOk" ${requireText ? 'disabled' : ''}>${okLabel}</button>
      </div>`, { compact: true });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('cfCancel').onclick = () => this.closeModal();
    const ok = this.el('cfOk');
    ok.onclick = () => { if (ok.disabled) return; this.closeModal(); onOk(); };
    if (requireText) {
      const inp = this.el('cfText');
      const check = () => { ok.disabled = inp.value.trim().toLowerCase() !== requireText.toLowerCase(); };
      inp.addEventListener('input', check);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); ok.click(); } });
      inp.focus();
    }
  },

  // replace the current modal's contents in place (used by re-rendering dialogs
  // like the populate-cage editor) — keeps the same overlay, no flicker
  setModal(html) {
    const o = this.el('overlay');
    const m = o && o.querySelector('.modal');
    if (m) m.innerHTML = html; else this.openModal(html, { compact: true });
  },
  closeModal() {
    const o = this.el('overlay');
    if (o) o.remove();
  },
  // Repaint the page UNDER an open modal.
  // Every recording action (แจ้งตาย · จัดการซาก · แจ้งผิดปกติ · เปิด/ปิดเคส ·
  // humane · stop · ชันสูตร) ends by re-opening the cage popup or the mouse
  // detail — but that only redraws the modal, so the cage card, its colour, the
  // badges and the counters stayed stale until you left the project and came
  // back. Calling this from the two popup openers means every one of those
  // paths refreshes, and any future action gets it for free.
  // Safe because the overlay is appended to <body>, NOT inside #root: rewriting
  // #root cannot close the modal that is currently open.
  refreshUnderlay(p) {
    if (this.route.name !== 'dashboard') return;          // nothing to repaint
    if (p && this.route.projectId !== p.id) return;       // never redraw a different project
    const y = window.scrollY;
    this.renderDashboard();
    window.scrollTo(0, y);                                // keep the user where they were
  },
  toast(msg) {
    const old = this.el('toast'); if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast'; t.id = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
