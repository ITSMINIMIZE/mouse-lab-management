/* ============================================================
 * Mouse Laboratory Management System — Prototype v0.1
 * App controller: routing, rendering, weighing workflow
 * (Pure front-end mockup — no backend / no database)
 * ============================================================ */

const App = {
  route: { name: 'login', projectId: null },
  weighing: false,            // whole-system weighing mode toggle
  wizard: null,               // active weighing wizard state

  el(id) { return document.getElementById(id); },

  // format grams to exactly 1 decimal place ( '–' when empty )
  g(v) { return (v == null || isNaN(v)) ? '–' : Number(v).toFixed(1); },
  // signed 1-decimal ( '+2.3' / '-1.0' )
  gs(v) { return (v == null || isNaN(v)) ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(1); },
  // mouse-level treatment marker (nurse/medical symbol) if the mouse has any record
  treatMark(m) { return m.treatments && m.treatments.length ? '<span class="treat-mark" title="มีประวัติการรักษา">+</span>' : ''; },

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
  // cage-level status → 'care' (open vet case / endpoint order) | 'normal'
  cageStatus(cage) {
    const care = cage.mice.some(m => m.alive && (m.careOpen || m.humaneOrder));
    return care ? 'care' : 'normal';
  },

  init() {
    this.renderLogin();
    this.el('root').addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t) { e.preventDefault(); this.handleNav(t.dataset.nav, t.dataset); }
    });
  },

  get user() { return DB.users.find(u => u.id === DB.currentUserId) || DB.users[0]; },
  get isAdmin() { return this.user.systemRole === 'admin'; },

  // roles the current user holds in a project (array of role keys)
  myRoles(project) {
    if (!project) return [];
    const m = (project.members || []).find(x => x.userId === this.user.id);
    return m ? m.roles : [];
  },
  // capability check — admin can do anything; otherwise union of held roles
  can(cap, project) {
    if (this.isAdmin) return true;
    return this.myRoles(project).some(r => ROLES[r] && ROLES[r].caps.includes(cap));
  },
  // can the current user see/open this project at all?
  hasAccess(project) {
    return this.isAdmin || this.myRoles(project).length > 0;
  },
  myRoleLabel(project) {
    if (this.isAdmin) return 'ADMIN';
    const roles = this.myRoles(project);
    return roles.length ? roles.join(' + ') : '—';
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
      case 'logout':   this.go('login'); break;
    }
  },

  go(name, projectId = null) {
    this.route = { name, projectId };
    this.weighing = false;
    this.editing = false;
    window.scrollTo(0, 0);
    if (name === 'login') return this.renderLogin();
    if (name === 'projects') return this.renderProjects();
    if (name === 'create') return this.renderCreateProject();
    if (name === 'dashboard') return this.renderDashboard();
    if (name === 'reports') return this.renderReports();
    if (name === 'audit') return this.renderAudit();
    if (name === 'roles') return this.renderRoles();
  },

  // ---- audit log (append-only, visible to everyone) ----
  log(action, detail, projectName = '') {
    const proj = DB.projects.find(p => p.name === projectName);
    const role = this.isAdmin ? 'ADMIN' : (proj && this.myRoles(proj).join('/')) || 'USER';
    DB.auditLog.push({ ts: Date.now(), user: this.user.name, role, action, detail, project: projectName });
  },
  formatTs(ts) {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // ---------------------------------------------------------
  // Shell + header
  // ---------------------------------------------------------
  shell(crumbsHTML, bodyHTML) {
    const userOptions = DB.users
      .map(u => `<option value="${u.id}" ${u.id === this.user.id ? 'selected' : ''}>${u.name} · ${u.systemRole === 'admin' ? 'admin' : 'user'}</option>`)
      .join('');
    // show the current user's role in the project being viewed (if any)
    const proj = Data.getProject(this.route.projectId);
    const projRole = proj && !this.isAdmin ? this.myRoleLabel(proj) : (this.isAdmin ? 'ADMIN' : '');
    this.el('root').innerHTML = `
      <div id="app-shell">
        <header class="appbar">
          <div class="brand"><span class="mark">🐭</span> Mouse Lab</div>
          <nav class="crumbs">${crumbsHTML}</nav>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-nav="audit">📋 Audit Log</button>
          <button class="btn btn-ghost" data-nav="roles">🔑 สิทธิ์</button>
          <div class="role-switch">
            ${projRole ? `<span class="role-badge" title="บทบาทในโครงการนี้">${projRole}</span>` : ''}
            <span style="font-size:12px;color:var(--text-muted)">เข้าใช้เป็น</span>
            <select id="userSelect" title="สลับผู้ใช้เพื่อทดสอบสิทธิ์">${userOptions}</select>
          </div>
          <button class="btn btn-ghost" data-nav="logout">ออกจากระบบ</button>
        </header>
        <main>${bodyHTML}</main>
      </div>`;
    this.el('userSelect').addEventListener('change', (e) => {
      DB.currentUserId = e.target.value;
      // re-render; if the new identity can't see the current project, bounce to project list
      const cur = Data.getProject(this.route.projectId);
      if (this.route.projectId && cur && !this.hasAccess(cur)) this.go('projects');
      else this.go(this.route.name, this.route.projectId);
    });
  },

  // ---------------------------------------------------------
  // 1. LOGIN
  // ---------------------------------------------------------
  renderLogin() {
    const userOptions = DB.users
      .map(u => `<option value="${u.id}" ${u.id === DB.currentUserId ? 'selected' : ''}>${u.name} · ${u.systemRole === 'admin' ? 'admin' : 'user'}</option>`)
      .join('');
    this.el('root').innerHTML = `
      <div id="view-login">
        <form class="login-card" id="loginForm">
          <div class="login-logo">🐭</div>
          <h1>Mouse Lab Management</h1>
          <p class="sub">ระบบบริหารจัดการสัตว์ทดลอง · Prototype v0.1</p>
          <div class="field">
            <label>เข้าใช้เป็น (สำหรับทดสอบสิทธิ์)</label>
            <select id="loginUser">${userOptions}</select>
          </div>
          <div class="field">
            <label>รหัสผ่าน</label>
            <input type="password" value="demo1234">
          </div>
          <button class="btn btn-primary btn-block btn-lg" type="submit">เข้าสู่ระบบ</button>
          <p class="login-hint">โหมดสาธิต — ไม่เชื่อมต่อฐานข้อมูลจริง<br>สิทธิ์เป็นรายโครงการ · สลับผู้ใช้ได้ทุกเมื่อจากมุมขวาบน</p>
        </form>
      </div>`;
    this.el('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      DB.currentUserId = this.el('loginUser').value;
      this.go('projects');
    });
  },

  // ---------------------------------------------------------
  // 2. PROJECT LIST
  // ---------------------------------------------------------
  renderProjects() {
    // only projects the current user has a role in (admin sees all)
    const visible = DB.projects.filter(p => this.hasAccess(p));
    const cards = visible.map(p => {
      const closed = p.status === 'closed';
      const mice = p.cages.reduce((s, c) => s + c.mice.length, 0);
      const roleLabel = this.myRoleLabel(p);
      return `
        <div class="project-card ${closed ? 'closed' : ''}" ${closed ? '' : `data-nav="project" data-project-id="${p.id}"`}>
          <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
            <h3>${p.name}</h3>
            <span class="pill ${closed ? 'closed' : 'active'}">${closed ? 'ปิดแล้ว' : 'กำลังดำเนิน'}</span>
          </div>
          <p class="p-desc">${p.description}</p>
          <div class="project-meta">
            <span>📅 เริ่ม ${p.startDate}</span>
            <span>📦 ${p.cages.length} กรง</span>
            <span>🐭 ${mice} ตัว</span>
            <span class="role-tag">${roleLabel}</span>
          </div>
        </div>`;
    }).join('') || `<p class="empty-note">คุณยังไม่มีโครงการที่เข้าถึงได้ — สร้างโครงการใหม่เพื่อเริ่มต้น (คุณจะเป็น PI ของโครงการนั้น)</p>`;

    this.shell(
      `<a data-nav="projects">โครงการ</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>โครงการของฉัน</h2><div class="desc">แสดงเฉพาะโครงการที่คุณมีบทบาท · เข้าใช้เป็น <b>${this.user.name}</b></div></div>
          <button class="btn btn-primary" data-nav="create">➕ สร้างโครงการ</button>
        </div>
        <div class="project-grid">${cards}</div>
      </div>`
    );
  },

  // ---------------------------------------------------------
  // 2b. CREATE PROJECT
  // ---------------------------------------------------------
  GROUP_PALETTE: ['#64748b', '#2563eb', '#7c3aed', '#16a34a', '#dc2626', '#d97706', '#0891b2', '#db2777'],

  SHELF_LETTERS: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],

  renderCreateProject() {
    if (!this.draft) {
      this.draft = {
        groups: [
          { name: 'Control', color: '#64748b', isControl: true, desc: 'กลุ่มควบคุม — อาหารปกติ' },
          { name: 'Treatment-1', color: '#2563eb', isControl: false, desc: '' },
        ],
        layout: { shelves: 3, cols: 6 },
        cells: {},        // "shelf_pos" -> { g: groupIndex, mice: count }
      };
    }

    this.shell(
      `<a data-nav="projects">โครงการ</a><span class="sep">/</span><a data-nav="create">สร้างโครงการ</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>สร้างโครงการใหม่</h2><div class="desc">กำหนดข้อมูล กลุ่มทดลอง แล้วจัดผังกรงและหนูในหน้านี้ (แก้ไขภายหลังได้)</div></div>
        </div>
        <div class="create-wrap">
          <div class="create-grid">
            <div class="create-col">
              <div class="form-card">
                <div class="form-card-title">ข้อมูลโครงการ</div>
                <div class="field"><label>ชื่อโครงการ <span style="color:var(--red)">*</span></label>
                  <input id="cpName" placeholder="เช่น NAFLD Diet Study"></div>
                <div class="field"><label>รายละเอียด</label>
                  <textarea id="cpDesc" rows="2" placeholder="วัตถุประสงค์ / คำอธิบายโครงการ"></textarea></div>
                <div class="two-col">
                  <div class="field"><label>วันที่เริ่ม</label><input id="cpDate" type="date" value="${todayISO()}"></div>
                  <div class="field"><label>สถานะ</label>
                    <select id="cpStatus"><option value="active">กำลังดำเนิน</option><option value="closed">ปิดแล้ว</option></select></div>
                </div>
              </div>
            </div>

            <div class="create-col">
              <div class="form-card">
                <div class="form-card-title">กลุ่มทดลอง
                  <button class="btn btn-ghost btn-sm" id="cpAddGroup" style="margin-left:auto">+ เพิ่มกลุ่ม</button>
                </div>
                <div id="cpGroups"></div>
                <p class="empty-note">เลือกได้ 1 กลุ่มเป็นกลุ่มควบคุม (Control)</p>
              </div>
            </div>
          </div>

          <div class="form-card">
            <div class="form-card-title">ผังกรง & ตั้งค่ากรง/หนู</div>
            <div class="layout-controls">
              <div class="field"><label>จำนวนชั้น</label><input id="cpShelves" type="number" min="1" max="10" value="${this.draft.layout.shelves}"></div>
              <div class="field"><label>กรงต่อชั้น</label><input id="cpCols" type="number" min="1" max="12" value="${this.draft.layout.cols}"></div>
            </div>
            <label class="preview-label">คลิกกรงเพื่อกำหนดกลุ่มและจำนวนหนู (กรงว่างเว้นไว้ได้)</label>
            <div id="cpGrid" class="cage-editor"></div>
          </div>

          <div class="create-actions">
            <button class="btn" data-nav="projects">ยกเลิก</button>
            <button class="btn btn-primary" id="cpCreate">สร้างโครงการ</button>
          </div>
        </div>
      </div>`
    );

    this.renderDraftGroups();
    this.renderCageEditor();

    const onLayout = () => {
      this.draft.layout.shelves = Math.max(1, Math.min(10, +this.el('cpShelves').value || 1));
      this.draft.layout.cols = Math.max(1, Math.min(12, +this.el('cpCols').value || 1));
      // drop cells that fall outside the new grid
      Object.keys(this.draft.cells).forEach(k => {
        const [s, p] = k.split('_').map(Number);
        if (s > this.draft.layout.shelves || p > this.draft.layout.cols) delete this.draft.cells[k];
      });
      this.renderCageEditor();
    };
    this.el('cpShelves').addEventListener('input', onLayout);
    this.el('cpCols').addEventListener('input', onLayout);

    this.el('cpAddGroup').onclick = () => {
      this.captureDraftGroups();
      const i = this.draft.groups.length;
      this.draft.groups.push({ name: `Treatment-${i}`, color: this.GROUP_PALETTE[i % this.GROUP_PALETTE.length], isControl: false, desc: '' });
      this.renderDraftGroups();
    };
    this.el('cpCreate').onclick = () => this.submitCreateProject();
  },

  renderDraftGroups() {
    const rows = this.draft.groups.map((g, i) => `
      <div class="group-item">
        <div class="group-row">
          <input type="color" class="g-color" value="${g.color}" data-i="${i}">
          <input class="g-name" value="${g.name}" placeholder="ชื่อกลุ่ม" data-i="${i}">
          <label class="g-ctrl"><input type="radio" name="cpControl" ${g.isControl ? 'checked' : ''} data-i="${i}"> Control</label>
          <button class="icon-btn g-del" data-i="${i}" title="ลบกลุ่ม" ${this.draft.groups.length <= 1 ? 'disabled' : ''}>🗑️</button>
        </div>
        <input class="g-desc" value="${g.desc || ''}" placeholder="คำอธิบายกลุ่ม เช่น อาหารไขมันสูง + ยา" data-i="${i}">
      </div>`).join('');
    this.el('cpGroups').innerHTML = rows;
    this.el('cpGroups').querySelectorAll('.g-del').forEach(btn => {
      btn.onclick = () => {
        this.captureDraftGroups();
        this.draft.groups.splice(+btn.dataset.i, 1);
        if (!this.draft.groups.some(g => g.isControl) && this.draft.groups.length) this.draft.groups[0].isControl = true;
        this.draft.cells = {};             // group indices shifted → clear assigned cages
        this.renderDraftGroups();
        this.renderCageEditor();
      };
    });
    // keep colour/name in sync with the cage grid live
    this.el('cpGroups').querySelectorAll('.g-color, .g-name').forEach(inp => {
      inp.addEventListener('input', () => { this.captureDraftGroups(); this.renderCageEditor(); });
    });
    this.el('cpGroups').querySelectorAll('input[name="cpControl"]').forEach(r => {
      r.onchange = () => { this.captureDraftGroups(); };
    });
  },

  // read the editable group rows back into the draft (before any re-render)
  captureDraftGroups() {
    const container = this.el('cpGroups');
    if (!container) return;
    container.querySelectorAll('.group-item').forEach((row, i) => {
      if (!this.draft.groups[i]) return;
      this.draft.groups[i].name = row.querySelector('.g-name').value;
      this.draft.groups[i].color = row.querySelector('.g-color').value;
      this.draft.groups[i].desc = row.querySelector('.g-desc').value;
      this.draft.groups[i].isControl = row.querySelector('input[name="cpControl"]').checked;
    });
  },

  renderCageEditor() {
    const { shelves, cols } = this.draft.layout;
    let assigned = 0, mice = 0;
    let html = '';
    for (let s = 1; s <= shelves; s++) {
      let cells = '';
      for (let p = 1; p <= cols; p++) {
        const cell = this.draft.cells[`${s}_${p}`];
        const code = `${this.SHELF_LETTERS[s - 1]}-${String(p).padStart(2, '0')}`;
        if (cell) {
          assigned++; mice += cell.mice;
          const g = this.draft.groups[cell.g];
          const color = g ? g.color : '#94a3b8';
          const sexIcon = cell.sex === 'F'
            ? '<span class="ce-sex female">♀</span>'
            : '<span class="ce-sex male">♂</span>';
          cells += `<button class="ce-cell filled" data-cell="${s}_${p}" style="border-left-color:${color}">
              <span class="ce-code">${code} ${sexIcon}</span>
              <span class="ce-grp" style="color:${color}">${g ? g.name : ''}</span>
              <span class="ce-mice">🐭 ${cell.mice}</span>
            </button>`;
        } else {
          cells += `<button class="ce-cell empty" data-cell="${s}_${p}"><span class="ce-code">${code}</span><span class="ce-add">+</span></button>`;
        }
      }
      html += `<div class="ce-shelf">
        <div class="ce-shelf-head"><span>ชั้น ${s}</span><button class="btn btn-ghost btn-sm" data-shelf="${s}">ทั้งชั้น</button></div>
        <div class="ce-row" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
      </div>`;
    }
    html += `<div class="cpv-total">กำหนดแล้ว ${assigned}/${shelves * cols} กรง · รวม ${mice} ตัว</div>`;
    this.el('cpGrid').innerHTML = html;

    this.el('cpGrid').querySelectorAll('[data-cell]').forEach(c => {
      c.onclick = () => this.openCageConfig({ cell: c.dataset.cell });
    });
    this.el('cpGrid').querySelectorAll('[data-shelf]').forEach(b => {
      b.onclick = () => this.openCageConfig({ shelf: +b.dataset.shelf });
    });
  },

  // Wizard: choose group + mice count for a single cage (or a whole shelf)
  openCageConfig(target) {
    const isShelf = target.shelf != null;
    const current = isShelf ? null : this.draft.cells[target.cell];
    const label = isShelf
      ? `ตั้งค่าทั้งชั้น ${target.shelf}`
      : `ตั้งค่ากรง ${this.SHELF_LETTERS[(+target.cell.split('_')[0]) - 1]}-${String(+target.cell.split('_')[1]).padStart(2, '0')}`;
    let selG = current ? current.g : (isShelf ? null : 0);
    let selSex = current ? current.sex : 'M';
    const curMice = current ? current.mice : null;
    const otherPreset = curMice != null && curMice > 5;

    const groupChoices = this.draft.groups.map((g, i) =>
      `<button type="button" class="choice cage-grp-choice ${selG === i ? 'sel' : ''}" data-g="${i}">
         <span class="sw" style="background:${g.color}"></span>${g.name || 'กลุ่ม ' + (i + 1)}
       </button>`).join('');

    const countCards = [1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="count-card ${curMice === n ? 'sel' : ''}" data-count="${n}">${n}</button>`).join('')
      + `<button type="button" class="count-card other ${otherPreset ? 'sel' : ''}" data-count="other">อื่นๆ</button>`;

    this.openModal(`
      <div class="modal-head">
        <div><h3>${label}</h3><div class="sub">${isShelf ? 'ใช้กับทุกกรงในชั้นนี้' : 'เลือกกลุ่ม แล้วเลือกจำนวนหนู'}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><label>1. กลุ่มทดลอง</label><div class="choice-row wrap" id="cageGrp">${groupChoices}</div></div>
        <div class="field"><label>2. เพศ (ทั้งกรง)</label>
          <div class="sex-row" id="cageSex">
            <button type="button" class="sex-btn male ${selSex === 'M' ? 'sel' : ''}" data-sex="M">♂</button>
            <button type="button" class="sex-btn female ${selSex === 'F' ? 'sel' : ''}" data-sex="F">♀</button>
          </div>
        </div>
        <div class="field"><label>3. จำนวนหนูในกรง</label>
          <div class="count-cards" id="cageCount">${countCards}</div>
          <div class="count-other ${otherPreset ? '' : 'hidden'}" id="cageOtherWrap">
            <input id="cageMice" type="number" min="1" max="99" value="${otherPreset ? curMice : ''}" placeholder="ระบุจำนวน">
            <button class="btn btn-primary" id="cageOtherSave">บันทึก</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        ${current ? `<button class="btn btn-danger" id="cageClear">ลบกรง</button>` : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="btn" id="cageCancel">ยกเลิก</button>
      </div>
    `, { compact: true });

    const commit = (mice) => {
      if (selG == null) { this.toast('กรุณาเลือกกลุ่มก่อน'); return; }
      const cell = { g: selG, mice, sex: selSex };
      if (isShelf) {
        for (let p = 1; p <= this.draft.layout.cols; p++) this.draft.cells[`${target.shelf}_${p}`] = { ...cell };
      } else {
        this.draft.cells[target.cell] = cell;
      }
      this.closeModal(); this.renderCageEditor();
    };

    this.el('cageGrp').querySelectorAll('.cage-grp-choice').forEach(b => {
      b.onclick = () => {
        selG = +b.dataset.g;
        this.el('cageGrp').querySelectorAll('.cage-grp-choice').forEach(x => x.classList.toggle('sel', x === b));
      };
    });
    this.el('cageSex').querySelectorAll('.sex-btn').forEach(b => {
      b.onclick = () => {
        selSex = b.dataset.sex;
        this.el('cageSex').querySelectorAll('.sex-btn').forEach(x => x.classList.toggle('sel', x === b));
      };
    });
    this.el('cageCount').querySelectorAll('.count-card').forEach(b => {
      b.onclick = () => {
        if (b.dataset.count === 'other') {
          this.el('cageCount').querySelectorAll('.count-card').forEach(x => x.classList.toggle('sel', x === b));
          this.el('cageOtherWrap').classList.remove('hidden');
          this.el('cageMice').focus();
        } else {
          commit(+b.dataset.count);   // 1–5 → save immediately
        }
      };
    });
    this.el('cageOtherSave').onclick = () => {
      const mice = Math.max(1, Math.min(99, +this.el('cageMice').value || 0));
      if (!mice) { this.el('cageMice').focus(); return; }
      commit(mice);
    };
    this.el('cageMice').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.el('cageOtherSave').click(); } });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('cageCancel').onclick = () => this.closeModal();
    if (current) this.el('cageClear').onclick = () => {
      delete this.draft.cells[target.cell];
      this.closeModal(); this.renderCageEditor();
    };
  },

  // build a brand-new mouse (single starting weight today, no history)
  freshMouse(code, sex = 'M') {
    return {
      id: 'M' + Math.random().toString(36).slice(2, 9),
      code, sex,
      weights: [{ date: todayISO(), weight: Math.round((25 + rand(-2, 2)) * 10) / 10 }],
      remark: '', treatments: [], excluded: false, alive: true, death: null, careOpen: false, humaneOrder: null,
    };
  },

  submitCreateProject() {
    this.captureDraftGroups();
    const name = this.el('cpName').value.trim();
    if (!name) { this.el('cpName').focus(); this.toast('กรุณากรอกชื่อโครงการ'); return; }
    if (this.draft.groups.some(g => !g.name.trim())) { this.toast('กรุณาตั้งชื่อให้ครบทุกกลุ่ม'); return; }
    if (!this.draft.groups.some(g => g.isControl)) this.draft.groups[0].isControl = true;

    const pid = 'P' + Date.now();
    const groups = this.draft.groups.map((g, i) => ({ id: `${pid}-G${i + 1}`, name: g.name.trim(), isControl: g.isControl, color: g.color, desc: (g.desc || '').trim() }));

    // build cages from painted cells
    const cages = [];
    let cageSeq = 0;
    for (let s = 1; s <= this.draft.layout.shelves; s++) {
      for (let p = 1; p <= this.draft.layout.cols; p++) {
        const cell = this.draft.cells[`${s}_${p}`];
        if (!cell) continue;
        const code = `${this.SHELF_LETTERS[s - 1]}-${String(p).padStart(2, '0')}`;
        const mice = Array.from({ length: cell.mice }, (_, k) => this.freshMouse(`${code}-${k + 1}`, cell.sex || 'M'));
        cages.push({
          id: `${pid}-C${++cageSeq}`, code, groupId: groups[cell.g].id, shelf: s, position: p, mice,
          water: { remaining: 300, added: null, consumed: 0 },
          food: { remaining: 100, added: null, consumed: 0 },
          status: 'pending', lastRecordDate: todayISO(),
        });
      }
    }

    DB.projects.push({
      id: pid, name,
      description: this.el('cpDesc').value.trim() || '—',
      startDate: this.el('cpDate').value || todayISO(),
      status: this.el('cpStatus').value,
      shelves: this.draft.layout.shelves,
      cagesPerShelf: this.draft.layout.cols,
      groups, cages,
      // creator becomes PI of the new project (admins are superusers regardless)
      members: [{ userId: this.user.id, roles: ['PI'] }],
    });
    this.log('สร้างโครงการ', `${name} · ${this.draft.layout.shelves}×${this.draft.layout.cols} · ${cages.length} กรง`, name);
    this.draft = null;
    this.toast(`สร้างโครงการ "${name}" แล้ว`);
    this.go('dashboard', pid);
  },

  // ---------------------------------------------------------
  // 3. DASHBOARD
  // ---------------------------------------------------------
  renderDashboard() {
    const p = Data.getProject(this.route.projectId);
    if (!p) return this.go('projects');
    if (!this.hasAccess(p)) { this.toast('คุณไม่มีสิทธิ์เข้าถึงโครงการนี้'); return this.go('projects'); }

    const canWeigh = this.can('weigh', p);
    const canEdit = this.can('editProject', p);
    const canMembers = this.can('manageMembers', p);
    if (this.editing && !canEdit) this.editing = false;
    if (this.weighing && !canWeigh) this.weighing = false;

    // tallest cage drives a uniform box height across the whole project
    const maxMice = p.cages.reduce((m, c) => Math.max(m, c.mice.length), 1);

    const shelves = [];
    for (let s = 1; s <= p.shelves; s++) {
      const cells = [];
      for (let pos = 1; pos <= p.cagesPerShelf; pos++) {
        const cage = p.cages.find(c => c.shelf === s && c.position === pos);
        cells.push(cage ? this.cageCard(p, cage, maxMice) : this.emptyCell(maxMice, this.editing, s, pos));
      }
      shelves.push(`
        <div class="shelf">
          <div class="shelf-label">ชั้นที่ ${s}</div>
          <div class="cage-row" style="--cols:${p.cagesPerShelf}">${cells.join('')}</div>
        </div>`);
    }

    const modeBar = this.weighing
      ? `<div class="weighing-banner">
           <span>⚖️ <b>โหมดชั่งน้ำหนัก</b> — แตะกรงที่ต้องการเริ่มบันทึก (กรงสีเขียว = บันทึกแล้ว)</span>
           <span class="spacer"></span>
           <button class="btn" id="exitWeighing">ออกจากโหมด</button>
         </div>`
      : this.editing
      ? `<div class="edit-banner">
           <span>✏️ <b>โหมดจัดการกรง</b> — แตะกรงว่างเพื่อเพิ่ม · แตะกรงเพื่อแก้ไข/ลบ</span>
           <span class="spacer"></span>
           <label class="edit-num">ชั้น <input id="edShelves" type="number" min="1" max="10" value="${p.shelves}"></label>
           <label class="edit-num">กรง/ชั้น <input id="edCols" type="number" min="1" max="12" value="${p.cagesPerShelf}"></label>
           <button class="btn" id="exitEditing">เสร็จสิ้น</button>
         </div>`
      : `<div class="mode-bar">
           <div class="legend">
             <b style="color:var(--text)">กรง:</b>
             <span><i class="dot normal"></i> ปกติ</span>
             <span><i class="dot care"></i> กำลังรักษา/ดูแล</span>
             <span style="width:1px;height:16px;background:var(--border)"></span>
             <b style="color:var(--text)">หนู:</b>
             <span><i class="dot good"></i> น้ำหนักขึ้นปกติ</span>
             <span><i class="dot warn"></i> ขึ้นน้อยกว่ากำหนด</span>
             <span><i class="dot bad"></i> ลด/ไม่เพิ่ม</span>
           </div>
           <span style="flex:1"></span>
           ${canMembers ? `<button class="btn" id="manageMembers">👥 สมาชิก</button>` : ''}
           ${canEdit ? `<button class="btn" id="startEditing">✏️ จัดการกรง</button>` : ''}
           <button class="btn" data-nav="reports">📈 รายงาน</button>
           ${canWeigh ? `<button class="btn btn-primary" id="startWeighing">⚖️ ชั่งน้ำหนัก</button>` : ''}
         </div>`;

    this.shell(
      `<a data-nav="projects">โครงการ</a><span class="sep">/</span><a data-nav="project" data-project-id="${p.id}">${p.name}</a>`,
      `<div class="page wide">
        <div class="page-head">
          <div><h2>${p.name}</h2><div class="desc">${p.description}</div></div>
        </div>
        ${modeBar}
        ${shelves.join('')}
      </div>`
    );

    if (canWeigh && !this.weighing && !this.editing) {
      this.el('startWeighing').addEventListener('click', () => {
        this.weighing = true;
        this.weighSession = { done: new Set() };   // no cage weighed yet this round
        this.renderDashboard();
      });
    }
    if (this.weighing) {
      this.el('exitWeighing').addEventListener('click', () => {
        this.weighing = false;
        this.weighSession = null;
        this.renderDashboard();
      });
    }
    if (canEdit && !this.weighing && !this.editing) {
      this.el('startEditing').addEventListener('click', () => { this.editing = true; this.renderDashboard(); });
    }
    if (canMembers && !this.weighing && !this.editing) {
      this.el('manageMembers').addEventListener('click', () => this.openMembers(p));
    }
    if (this.editing) {
      this.el('exitEditing').addEventListener('click', () => { this.editing = false; this.renderDashboard(); });
      // layout resize — clamp so existing cages are never orphaned
      const applyLayout = () => {
        const minShelves = p.cages.reduce((m, c) => Math.max(m, c.shelf), 1);
        const minCols = p.cages.reduce((m, c) => Math.max(m, c.position), 1);
        const shelves = Math.max(minShelves, Math.min(10, +this.el('edShelves').value || minShelves));
        const cols = Math.max(minCols, Math.min(12, +this.el('edCols').value || minCols));
        if (shelves !== p.shelves || cols !== p.cagesPerShelf) {
          p.shelves = shelves; p.cagesPerShelf = cols;
          this.log('แก้ผังโครงการ', `${shelves} ชั้น × ${cols} กรง/ชั้น`, p.name);
        }
        this.renderDashboard();
      };
      this.el('edShelves').addEventListener('change', applyLayout);
      this.el('edCols').addEventListener('change', applyLayout);
      document.querySelectorAll('[data-empty]').forEach(elm => {
        elm.addEventListener('click', () => this.openCageEditor(p, +elm.dataset.shelf, +elm.dataset.pos, null));
      });
    }
    // cage clicks
    document.querySelectorAll('[data-cage]').forEach(elm => {
      elm.addEventListener('click', () => {
        const cage = Data.getCage(p, elm.dataset.cage);
        if (this.editing) this.openCageEditor(p, cage.shelf, cage.position, cage);
        else if (this.weighing) this.startWizard(p, cage);
        else this.openCagePopup(p, cage);
      });
    });
  },

  cageCard(p, cage, maxMice = cage.mice.length) {
    const group = Data.getGroup(p, cage.groupId);

    const n = cage.mice.length || 1;
    // In weighing mode, a cage's values stay cleared (gray) until it has been weighed this round
    const weighed = !this.weighing || (this.weighSession && this.weighSession.done.has(cage.id));

    // per-mouse weight list — status shown by the coloured change value only
    const mouseList = cage.mice.map(m => {
      const cur = Data.latestWeight(m);
      const chg = Data.weightChange(m);
      const st = this.mouseStatus(m);
      const dead = !m.alive;
      const arrow = (dead || !weighed || chg == null) ? '' : `${chg >= 0 ? '▲' : '▼'}${this.g(Math.abs(chg))}`;
      return `<div class="mrow ${dead ? 'dead' : m.excluded ? 'stop' : ''}">
        <span class="mid">${m.code.split('-').slice(-1)[0]}${this.treatMark(m)}</span>
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

    // status colour: weighing mode → gray (not weighed) / green (done); otherwise care/normal
    const cageStatus = this.weighing ? (weighed ? 'done' : 'normal') : this.cageStatus(cage);
    return `
      <div class="cage ${cageStatus} ${this.weighing ? 'selectable' : ''}" style="--maxmice:${maxMice}" data-cage="${cage.id}">
        <div class="cage-top">
          <span class="cage-code">${cage.code}</span>
          <span class="cage-grp">${group ? group.name : ''}</span>
        </div>
        <div class="cage-main">
          <div class="cage-mice">${mouseList || '<span class="empty-note">ไม่มีหนู</span>'}</div>
          <div class="cage-supply">
            ${supply('💧', cage.water.consumed, cage.water.consumed / n)}
            ${supply('🍚', cage.food.consumed, cage.food.consumed / n)}
          </div>
        </div>
      </div>`;
  },

  emptyCell(maxMice = 1, editing = false, shelf = 0, pos = 0) {
    if (editing) {
      return `<div class="cage empty editable" style="--maxmice:${maxMice}" data-empty data-shelf="${shelf}" data-pos="${pos}">
        <div class="empty-mark">＋ เพิ่มกรง</div></div>`;
    }
    return `<div class="cage empty" style="--maxmice:${maxMice}"><div class="empty-mark">ว่าง</div></div>`;
  },

  // Edit-mode: add a new cage, or edit/delete an existing one (group + sex + mice count)
  openCageEditor(p, shelf, pos, cage) {
    const code = cage ? cage.code : `${this.SHELF_LETTERS[shelf - 1]}-${String(pos).padStart(2, '0')}`;
    let selG = cage ? Math.max(0, p.groups.findIndex(g => g.id === cage.groupId)) : 0;
    let selSex = cage && cage.mice[0] ? cage.mice[0].sex : 'M';
    const curMice = cage ? cage.mice.length : null;
    const otherPreset = curMice != null && curMice > 5;

    const groupChoices = p.groups.map((g, i) =>
      `<button type="button" class="choice cage-grp-choice ${selG === i ? 'sel' : ''}" data-g="${i}">
         <span class="sw" style="background:${g.color}"></span>${g.name}
       </button>`).join('');
    // editing an existing cage: can only ADD mice, never reduce (removal is per-mouse: move/death)
    const countCards = [1, 2, 3, 4, 5].map(n => {
      const locked = curMice != null && n < curMice;
      return `<button type="button" class="count-card ${curMice === n ? 'sel' : ''}" data-count="${n}" ${locked ? 'disabled' : ''}>${n}</button>`;
    }).join('')
      + `<button type="button" class="count-card other ${otherPreset ? 'sel' : ''}" data-count="other">อื่นๆ</button>`;

    this.openModal(`
      <div class="modal-head">
        <div><h3>${cage ? 'แก้ไขกรง' : 'เพิ่มกรง'} ${code}</h3><div class="sub">ชั้น ${shelf} · ตำแหน่ง ${pos}${cage ? ` · ปัจจุบัน ${cage.mice.length} ตัว (เพิ่มได้เท่านั้น)` : ''}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><label>1. กลุ่มทดลอง</label><div class="choice-row wrap" id="cageGrp">${groupChoices}</div></div>
        <div class="field"><label>2. เพศ (ทั้งกรง)</label>
          <div class="sex-row" id="cageSex">
            <button type="button" class="sex-btn male ${selSex === 'M' ? 'sel' : ''}" data-sex="M">♂</button>
            <button type="button" class="sex-btn female ${selSex === 'F' ? 'sel' : ''}" data-sex="F">♀</button>
          </div>
        </div>
        <div class="field"><label>3. จำนวนหนูในกรง</label>
          <div class="count-cards" id="cageCount">${countCards}</div>
          <div class="count-other ${otherPreset ? '' : 'hidden'}" id="cageOtherWrap">
            <input id="cageMice" type="number" min="1" max="99" value="${otherPreset ? curMice : ''}" placeholder="ระบุจำนวน">
            <button class="btn btn-primary" id="cageOtherSave">บันทึก</button>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        ${cage ? `<button class="btn btn-danger" id="cageDelete">ลบกรง</button>` : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="btn" id="cageCancel">ยกเลิก</button>
      </div>
    `, { compact: true });

    const commit = (mice) => {
      if (selG == null) { this.toast('กรุณาเลือกกลุ่มก่อน'); return; }
      const groupId = p.groups[selG].id;
      if (cage) {
        // increase-only: reducing headcount must go through per-mouse move/death, not silent deletion
        if (mice < cage.mice.length) { this.toast('ลดจำนวนไม่ได้ — ต้องเอาหนูออกทีละตัว (ย้าย/บันทึกการตาย)'); return; }
        cage.groupId = groupId;
        cage.mice.forEach(m => { if (m.alive) m.sex = selSex; });
        let nextN = cage.mice.reduce((mx, m) => Math.max(mx, parseInt(m.code.split('-').pop()) || 0), 0);
        while (cage.mice.length < mice) { nextN++; cage.mice.push(this.freshMouse(`${cage.code}-${nextN}`, selSex)); }
        this.log('แก้ไขกรง', `${cage.code} · ${p.groups[selG].name} · ${mice} ตัว (${selSex === 'M' ? '♂' : '♀'})`, p.name);
      } else {
        const newMice = Array.from({ length: mice }, (_, k) => this.freshMouse(`${code}-${k + 1}`, selSex));
        p.cages.push({
          id: `${p.id}-C${Date.now().toString(36)}`, code, groupId, shelf, position: pos, mice: newMice,
          water: { remaining: 300, added: null, consumed: 0 },
          food: { remaining: 100, added: null, consumed: 0 },
          status: 'pending', lastRecordDate: todayISO(),
        });
        this.log('เพิ่มกรง', `${code} · ${p.groups[selG].name} · ${mice} ตัว (${selSex === 'M' ? '♂' : '♀'})`, p.name);
      }
      this.closeModal(); this.renderDashboard();
    };

    this.el('cageGrp').querySelectorAll('.cage-grp-choice').forEach(b => {
      b.onclick = () => { selG = +b.dataset.g; this.el('cageGrp').querySelectorAll('.cage-grp-choice').forEach(x => x.classList.toggle('sel', x === b)); };
    });
    this.el('cageSex').querySelectorAll('.sex-btn').forEach(b => {
      b.onclick = () => { selSex = b.dataset.sex; this.el('cageSex').querySelectorAll('.sex-btn').forEach(x => x.classList.toggle('sel', x === b)); };
    });
    this.el('cageCount').querySelectorAll('.count-card').forEach(b => {
      b.onclick = () => {
        if (b.dataset.count === 'other') {
          this.el('cageCount').querySelectorAll('.count-card').forEach(x => x.classList.toggle('sel', x === b));
          this.el('cageOtherWrap').classList.remove('hidden');
          this.el('cageMice').focus();
        } else commit(+b.dataset.count);
      };
    });
    this.el('cageOtherSave').onclick = () => {
      const mice = Math.max(1, Math.min(99, +this.el('cageMice').value || 0));
      if (!mice) { this.el('cageMice').focus(); return; }
      commit(mice);
    };
    this.el('cageMice').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.el('cageOtherSave').click(); } });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('cageCancel').onclick = () => this.closeModal();
    if (cage) this.el('cageDelete').onclick = () => {
      if (!confirm(`ลบกรง ${cage.code} และหนูทั้งหมดในกรง?`)) return;
      const i = p.cages.indexOf(cage);
      if (i >= 0) p.cages.splice(i, 1);
      this.log('ลบกรง', `${cage.code}`, p.name);
      this.closeModal(); this.renderDashboard();
    };
  },

  // ---------------------------------------------------------
  // Cage popup (normal mode)
  // ---------------------------------------------------------
  openCagePopup(p, cage) {
    const group = Data.getGroup(p, cage.groupId);
    const controlChange = Data.controlAvgChange(p);
    const canTreat = this.can('treat', p);
    const canDeathStop = this.can('deathStop', p);

    const rows = cage.mice.map(m => {
      const cur = Data.latestWeight(m);
      const chg = Data.weightChange(m);
      const chgClass = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      const chgTxt = chg == null ? '–' : `${this.gs(chg)}g`;
      let vsControl = '–';
      if (chg != null && controlChange != null && !group.isControl) {
        vsControl = `${this.gs(chg - controlChange)}g`;
      } else if (group.isControl) {
        vsControl = '(กลุ่มควบคุม)';
      }
      const dead = !m.alive;
      const badges =
        (dead ? `<span class="m-badge dead">ตาย</span>` : '') +
        (!dead && m.humaneOrder ? `<span class="m-badge humane">สั่งการุณยฆาต</span>` : '') +
        (m.excluded && !dead ? `<span class="m-badge stop">ไม่คิดเฉลี่ย</span>` : '');
      const actions = dead
        ? `<span class="empty-note" style="font-size:12px">${m.death ? this.deathLabel(m.death) : 'ตาย'}</span>`
        : canDeathStop
        ? `<div class="kebab-wrap">
             <button class="mini-btn kebab" data-act="menu" data-mid="${m.id}">⋯</button>
             <div class="kebab-menu" id="menu-${m.id}">
               <button class="menu-item stop" data-act="stop" data-mid="${m.id}">${m.excluded ? 'รวมกลับเข้าค่าเฉลี่ย' : 'Stop (ไม่คิดเฉลี่ย)'}</button>
               <button class="menu-item death" data-act="death" data-mid="${m.id}">Death (บันทึกการตาย)</button>
             </div>
           </div>`
        : `<span style="color:var(--text-muted)">—</span>`;
      return `
        <tr class="${dead ? 'row-dead' : m.excluded ? 'row-stop' : ''}">
          <td data-mouse="${m.id}"><b>${m.code}</b> ${this.treatMark(m)}<span class="mono" style="color:var(--text-muted)"> (${m.sex === 'M' ? '♂' : '♀'})</span> ${badges}</td>
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
          <div class="sub">${group.name} · บันทึกล่าสุด ${cage.lastRecordDate}</div>
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
        <table class="data">
          <thead><tr><th>หนู</th><th>น้ำหนักล่าสุด</th><th>เปลี่ยนแปลง</th><th>เทียบกลุ่มควบคุม</th><th>ดำเนินการ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="empty-note">แตะที่หนูเพื่อดูกราฟน้ำหนัก ประวัติ${canTreat ? ' และเพิ่มการรักษา' : ' และการรักษา'}</p>
      </div>
      <div class="modal-foot">
        <button class="btn" id="closeModal2">ปิด</button>
      </div>
    `);

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('closeModal2').onclick = () => this.closeModal();
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

  // short summary label for a recorded death
  deathLabel(d) {
    const t = d.type === 'humane' ? 'Humane endpoint' : 'ตายเอง';
    const disp = d.disposition === 'necropsy' ? 'ชันสูตร/เก็บตัวอย่าง' : 'ทำลายซาก';
    return `${t} · ${disp}`;
  },

  // Death recording dialog
  openDeathForm(p, cage, mouse) {
    const d = mouse.death || {};
    this.openModal(`
      <div class="modal-head">
        <div><h3>✝ บันทึกการตาย — ${mouse.code}</h3><div class="sub">กรง ${cage.code}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>ลักษณะการตาย</label>
          <div class="choice-row" id="deathType">
            <button type="button" class="choice ${d.type === 'natural' ? 'sel' : ''}" data-v="natural">🕊️ ตายเอง</button>
            <button type="button" class="choice ${d.type === 'humane' ? 'sel' : ''}" data-v="humane">💉 สั่งให้ตาย (Humane endpoint)</button>
          </div>
        </div>
        <div class="field">
          <label>การจัดการซาก</label>
          <div class="choice-row" id="deathDisp">
            <button type="button" class="choice ${d.disposition === 'dispose' ? 'sel' : ''}" data-v="dispose">🗑️ ทำลายซาก</button>
            <button type="button" class="choice ${d.disposition === 'necropsy' ? 'sel' : ''}" data-v="necropsy">🔬 ชันสูตร / เก็บตัวอย่าง</button>
          </div>
        </div>
        <div class="field">
          <label>รายละเอียด / หมายเหตุ</label>
          <textarea id="deathNote" rows="3" placeholder="เช่น พบตายในกรงตอนเช้า, อาการก่อนตาย, ตัวอย่างที่เก็บ ฯลฯ">${d.note || ''}</textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelDeath">ยกเลิก</button>
        <button class="btn btn-danger" id="saveDeath">💾 บันทึกการตาย</button>
      </div>
    `);

    let sel = { type: d.type || null, disposition: d.disposition || null };
    const wire = (id, key) => {
      this.el(id).querySelectorAll('.choice').forEach(b => {
        b.onclick = () => {
          sel[key] = b.dataset.v;
          this.el(id).querySelectorAll('.choice').forEach(x => x.classList.toggle('sel', x === b));
        };
      });
    };
    wire('deathType', 'type');
    wire('deathDisp', 'disposition');

    this.el('closeModal').onclick = () => this.openCagePopup(p, cage);
    this.el('cancelDeath').onclick = () => this.openCagePopup(p, cage);
    this.el('saveDeath').onclick = () => {
      if (!sel.type) { this.toast('กรุณาเลือกลักษณะการตาย'); return; }
      if (!sel.disposition) { this.toast('กรุณาเลือกการจัดการซาก'); return; }
      mouse.alive = false;
      mouse.excluded = true;   // dead → out of stats automatically
      mouse.careOpen = false;
      mouse.humaneOrder = null; // order fulfilled once death is recorded
      mouse.death = {
        type: sel.type,
        disposition: sel.disposition,
        note: this.el('deathNote').value.trim(),
        date: todayISO(),
      };
      this.log('บันทึกการตาย', `${mouse.code} · ${this.deathLabel(mouse.death)}`, p.name);
      this.toast(`บันทึกการตายของ ${mouse.code} แล้ว`);
      this.openCagePopup(p, cage);
    };
  },

  // ---------------------------------------------------------
  // Mouse detail (chart + history + treatment)
  // ---------------------------------------------------------
  openMouseDetail(p, cage, mouse) {
    const canTreat = this.can('treat', p);
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

    const treatments = mouse.treatments.length
      ? mouse.treatments.map(t => `
          <div class="treat-item">
            <div class="t-top"><span>📅 ${t.date}</span><span>${t.vet}</span></div>
            <div class="t-dx">${t.diagnosis}</div>
            <div class="t-rx">${t.treatment}</div>
          </div>`).join('')
      : `<p class="empty-note">ยังไม่มีบันทึกการรักษา</p>`;

    this.openModal(`
      <div class="modal-head">
        <div>
          <h3>หนู ${mouse.code} ${this.treatMark(mouse)}</h3>
          <div class="sub">กรง ${cage.code} · เพศ ${mouse.sex === 'M' ? 'ผู้ ♂' : 'เมีย ♀'}</div>
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
            <div class="section-title">การรักษา</div>
            ${treatments}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="backCage">← กลับ</button>
        <span class="spacer" style="flex:1"></span>
        ${canTreat && mouse.alive ? `<button class="btn btn-primary" id="addTreat">💊 เพิ่มการรักษา</button>` : ''}
        ${canTreat && mouse.alive && mouse.careOpen ? `<button class="btn btn-green" id="closeCase">✓ ปิดเคส</button>` : ''}
        ${canTreat && mouse.alive && !mouse.humaneOrder ? `<button class="btn btn-danger" id="humaneBtn">Humane endpoint</button>` : ''}
      </div>
    `);

    this.el('closeModal').onclick = () => this.closeModal();
    this.el('backCage').onclick = () => this.openCagePopup(p, cage);
    if (canTreat && mouse.alive) this.el('addTreat').onclick = () => this.openTreatForm(p, cage, mouse);
    if (canTreat && mouse.alive && mouse.careOpen) {
      this.el('closeCase').onclick = () => {
        mouse.careOpen = false;
        mouse.remark = '';
        this.log('ปิดเคส', `${mouse.code} · รักษาเสร็จสิ้น`, p.name);
        this.toast(`ปิดเคสของ ${mouse.code} แล้ว`);
        this.openMouseDetail(p, cage, mouse);
      };
    }
    if (canTreat && mouse.alive && !mouse.humaneOrder) {
      this.el('humaneBtn').onclick = () => this.openHumaneForm(p, cage, mouse);
    }
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
      mouse.humaneOrder = { reason, vet: this.el('humaneVet').value.trim(), date: todayISO() };
      mouse.careOpen = true;
      this.log('สั่ง Humane endpoint', `${mouse.code} · ${reason}`, p.name);
      this.toast(`ออกคำสั่ง Humane endpoint สำหรับ ${mouse.code}`);
      this.openMouseDetail(p, cage, mouse);
    };
  },

  openTreatForm(p, cage, mouse) {
    this.openModal(`
      <div class="modal-head">
        <div><h3>เพิ่มการรักษา — ${mouse.code}</h3><div class="sub">กรง ${cage.code}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button>
      </div>
      <div class="modal-body">
        <div class="field"><label>วันที่</label><input id="tDate" value="${todayISO()}"></div>
        <div class="field"><label>ผู้บันทึก (Vet)</label><input id="tVet" value="${this.user.name} (Vet)"></div>
        <div class="field"><label>การวินิจฉัย</label><input id="tDx" placeholder="เช่น สงสัยติดเชื้อทางเดินหายใจ"></div>
        <div class="field"><label>การรักษา / คำสั่ง</label><input id="tRx" placeholder="เช่น ให้ยาปฏิชีวนะ + ติดตามอาการ"></div>
        <div class="field"><label>อัปเดตหมายเหตุของหนู (จะแสดงในตารางกรง)</label><input id="tRemark" value="${mouse.remark}"></div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="cancelTreat">ยกเลิก</button>
        <button class="btn btn-primary" id="saveTreat">บันทึกการรักษา</button>
      </div>
    `);
    this.el('closeModal').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('cancelTreat').onclick = () => this.openMouseDetail(p, cage, mouse);
    this.el('saveTreat').onclick = () => {
      const dx = this.el('tDx').value.trim();
      if (!dx) { this.el('tDx').focus(); return; }
      mouse.treatments.unshift({
        date: this.el('tDate').value,
        vet: this.el('tVet').value,
        diagnosis: dx,
        treatment: this.el('tRx').value.trim() || '—',
      });
      mouse.remark = this.el('tRemark').value.trim();
      mouse.careOpen = true;   // adding a treatment opens/keeps the case open
      this.log('บันทึกการรักษา', `${mouse.code} · ${dx}`, p.name);
      this.toast('บันทึกการรักษาแล้ว');
      this.openMouseDetail(p, cage, mouse);
    };
  },

  // ---------------------------------------------------------
  // WEIGHING WIZARD
  //   steps: water-remaining → food-remaining → each mouse →
  //           water-added → food-added → review → save
  // ---------------------------------------------------------
  startWizard(p, cage) {
    const mice = cage.mice.filter(m => m.alive);   // dead mice are not weighed
    this.wizard = {
      p, cage, mice,
      mouseIndex: 0,
      data: {
        waterRemaining: null,
        foodRemaining: null,
        mouseWeights: mice.map(() => null),
        waterAdded: null,
        foodAdded: null,
      },
      // logical step pointer
      step: 0,
    };
    this.renderWizardStep();
  },

  // total steps = 2 (water/food remaining) + N alive mice + 2 (water/food added) + 1 review
  wizardStepMeta() {
    const w = this.wizard;
    const n = w.mice.length;
    return { water0: 0, food0: 1, mouse0: 2, mouseN: 2 + n - 1, waterAdd: 2 + n, foodAdd: 3 + n, review: 4 + n, total: 5 + n };
  },

  renderWizardStep() {
    const w = this.wizard;
    const meta = this.wizardStepMeta();
    const s = w.step;

    // progress bars
    const segCount = meta.total;
    const segs = Array.from({ length: segCount }, (_, i) =>
      `<div class="wstep ${i < s ? 'done' : i === s ? 'active' : ''}"></div>`).join('');

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
      const idx = s - meta.mouse0;
      w.mouseIndex = idx;
      const m = w.mice[idx];
      const last = Data.latestWeight(m);
      icon = '🐭'; title = `ชั่งหนู ${m.code}`;
      hint = `เพศ ${m.sex === 'M' ? 'ผู้ ♂' : 'เมีย ♀'} · กรอกน้ำหนักปัจจุบัน`;
      progress = `<div class="mouse-progress">หนูตัวที่ ${idx + 1} จาก ${w.mice.length}</div>`;
      bodyExtra = `<div class="wizard-prev">น้ำหนักครั้งก่อน: <b>${this.g(last)} g</b></div>`;
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
        <input class="big-input" id="wizInput" type="text" inputmode="decimal" value="${value}" placeholder="0.0">
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
    this.el('wizClose').onclick = () => { if (confirm('ออกจากการชั่งน้ำหนัก? ข้อมูลที่กรอกจะไม่ถูกบันทึก')) { this.wizard = null; this.closeModal(); } };
  },

  captureInput() {
    const w = this.wizard, meta = this.wizardStepMeta(), s = w.step;
    const raw = this.el('wizInput')?.value;
    const val = raw === '' || raw == null ? null : parseFloat(raw);
    if (s === meta.water0) w.data.waterRemaining = val;
    else if (s === meta.food0) w.data.foodRemaining = val;
    else if (s >= meta.mouse0 && s <= meta.mouseN) w.data.mouseWeights[s - meta.mouse0] = val;
    else if (s === meta.waterAdd) w.data.waterAdded = val;
    else if (s === meta.foodAdd) w.data.foodAdded = val;
  },

  wizardNext() {
    const w = this.wizard, meta = this.wizardStepMeta();
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
      return `<li><span class="k">🐭 ${m.code}</span><span class="v">${this.g(nw)} g <span class="chg ${cls}">${d == null ? '' : this.gs(d)}</span></span></li>`;
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
    this.el('wizClose').onclick = () => { if (confirm('ออกจากการชั่งน้ำหนัก?')) { this.wizard = null; this.closeModal(); } };
    this.el('wizSave').onclick = () => this.wizardSave();
  },

  wizardSave() {
    const w = this.wizard, cage = w.cage;
    const today = todayISO();
    // commit new weights (alive mice only — dead mice were skipped)
    w.mice.forEach((m, i) => {
      const nw = w.data.mouseWeights[i];
      if (nw != null) {
        // if last entry is today, overwrite; else append
        const last = m.weights[m.weights.length - 1];
        if (last && last.date === today) last.weight = nw;
        else m.weights.push({ date: today, weight: nw });
      }
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
    cage.lastRecordDate = today;
    // keep alert if any mouse has a remark, else mark done
    const hasRemark = cage.mice.some(m => m.remark);
    cage.status = hasRemark ? 'alert' : 'done';

    if (this.weighSession) this.weighSession.done.add(cage.id);  // mark weighed this round

    this.log('ชั่งน้ำหนัก', `บันทึกกรง ${cage.code}`, w.p.name);
    this.wizard = null;
    this.closeModal();
    this.toast(`บันทึกกรง ${cage.code} แล้ว ✓`);
    this.renderDashboard();
  },

  // ---------------------------------------------------------
  // 4. REPORTS
  // ---------------------------------------------------------
  renderReports() {
    const p = Data.getProject(this.route.projectId) || DB.projects.find(x => this.hasAccess(x));
    if (!p || !this.hasAccess(p)) { this.toast('ไม่มีสิทธิ์เข้าถึง'); return this.go('projects'); }
    this.reportState = this.reportState || { mode: 'group', groupId: 'ALL', metric: 'weight', range: 14 };

    const groupOpts = ['<option value="ALL">ทุกกลุ่ม</option>']
      .concat(p.groups.map(g => `<option value="${g.id}">${g.name}</option>`)).join('');

    this.shell(
      `<a data-nav="projects">โครงการ</a><span class="sep">/</span><a data-nav="project" data-project-id="${p.id}">${p.name}</a><span class="sep">/</span><a data-nav="reports">รายงาน</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>รายงาน & กราฟ</h2><div class="desc">แสดงแนวโน้มน้ำหนัก อาหาร และน้ำ เปรียบเทียบระหว่างกลุ่ม</div></div>
          <button class="btn btn-green" id="exportBtn">⬇️ Export Excel</button>
        </div>
        <div class="report-controls">
          <div class="field"><label>มุมมอง</label>
            <select id="rMode">
              <option value="group">เฉลี่ยรายกลุ่ม</option>
              <option value="individual">รายตัว</option>
              <option value="all">ทั้งหมด</option>
            </select>
          </div>
          <div class="field"><label>กลุ่ม</label><select id="rGroup">${groupOpts}</select></div>
          <div class="field"><label>ข้อมูล</label>
            <select id="rMetric">
              <option value="weight">น้ำหนัก (Weight)</option>
              <option value="water">น้ำ (Water)</option>
              <option value="food">อาหาร (Food)</option>
            </select>
          </div>
          <div class="field"><label>ช่วงเวลา</label>
            <select id="rRange">
              <option value="7">7 วันล่าสุด</option>
              <option value="14" selected>14 วันล่าสุด</option>
            </select>
          </div>
        </div>
        <div class="report-canvas" id="reportCanvas"></div>
      </div>`
    );

    ['rMode', 'rGroup', 'rMetric', 'rRange'].forEach(id => {
      const elm = this.el(id);
      if (id === 'rMode') elm.value = this.reportState.mode;
      if (id === 'rGroup') elm.value = this.reportState.groupId;
      if (id === 'rMetric') elm.value = this.reportState.metric;
      if (id === 'rRange') elm.value = this.reportState.range;
      elm.addEventListener('change', () => {
        this.reportState = {
          mode: this.el('rMode').value,
          groupId: this.el('rGroup').value,
          metric: this.el('rMetric').value,
          range: parseInt(this.el('rRange').value, 10),
        };
        this.drawReport(p);
      });
    });
    this.el('exportBtn').onclick = () => this.exportCSV(p);
    this.drawReport(p);
  },

  // Build series for the report based on state, only weight has per-mouse history;
  // water/food are simulated as a gentle series from current remaining values.
  drawReport(p) {
    const st = this.reportState;
    const range = st.range;
    const labels = Array.from({ length: range + 1 }, (_, i) => isoDaysAgo(range - i).slice(5));
    const palette = ['#2563eb', '#16a34a', '#7c3aed', '#dc2626', '#d97706', '#0891b2', '#db2777'];
    let series = [];

    const cages = st.groupId === 'ALL' ? p.cages : p.cages.filter(c => c.groupId === st.groupId);

    if (st.metric === 'weight') {
      if (st.mode === 'individual' || st.mode === 'all') {
        const mice = cages.flatMap(c => c.mice);
        series = mice.slice(0, 12).map((m, i) => ({
          label: m.code,
          color: palette[i % palette.length],
          points: this.tail(m.weights.map(w => w.weight), range + 1),
        }));
      } else {
        // average by group
        const groups = st.groupId === 'ALL' ? p.groups : p.groups.filter(g => g.id === st.groupId);
        series = groups.map((g, i) => {
          const gm = p.cages.filter(c => c.groupId === g.id).flatMap(c => c.mice).filter(m => Data.inStats(m));
          const pts = [];
          for (let d = 0; d <= range; d++) {
            const vals = gm.map(m => this.tail(m.weights.map(w => w.weight), range + 1)[d]).filter(v => v != null);
            pts.push(vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null);
          }
          return { label: g.name, color: g.color || palette[i % palette.length], points: pts };
        });
      }
    } else {
      // water / food — simulate a declining-then-refilled series per group from current remaining
      const groups = st.groupId === 'ALL' ? p.groups : p.groups.filter(g => g.id === st.groupId);
      series = groups.map((g, i) => {
        const gc = p.cages.filter(c => c.groupId === g.id);
        if (!gc.length) return { label: g.name, color: g.color, points: [] };
        const base = gc.reduce((s, c) => s + (st.metric === 'water' ? c.water.remaining : c.food.remaining), 0) / gc.length;
        const pts = [];
        for (let d = 0; d <= range; d++) {
          const cycle = (d % 3);
          pts.push(Math.round((base + (2 - cycle) * base * 0.18 + rand(-5, 5)) * 10) / 10);
        }
        return { label: g.name, color: g.color || palette[i % palette.length], points: pts };
      });
    }

    const unit = st.metric === 'weight' ? 'g (น้ำหนัก)' : st.metric === 'water' ? 'g (น้ำ)' : 'g (อาหาร)';
    const legend = series.map(s => `<span><i style="background:${s.color}"></i> ${s.label}</span>`).join('');
    this.el('reportCanvas').innerHTML =
      this.lineChart(series, labels, { height: 340, showAxis: true, unit }) +
      `<div class="chart-legend">${legend}</div>`;
  },

  tail(arr, n) { return arr.slice(Math.max(0, arr.length - n)); },

  exportCSV(p) {
    const st = this.reportState;
    const rows = [['Mouse', 'Group', 'Date', 'Weight(g)']];
    const cages = st.groupId === 'ALL' ? p.cages : p.cages.filter(c => c.groupId === st.groupId);
    cages.forEach(c => {
      const g = Data.getGroup(p, c.groupId);
      c.mice.forEach(m => m.weights.forEach(w => rows.push([m.code, g.name, w.date, w.weight])));
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
        <td>${e.detail}</td>
        <td style="color:var(--text-muted)">${e.project || '—'}</td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="empty-note" style="text-align:center;padding:24px">ยังไม่มีบันทึกกิจกรรม</td></tr>`;

    this.shell(
      `<a data-nav="projects">โครงการ</a><span class="sep">/</span><a data-nav="audit">Audit Log</a>`,
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
    const roleList = ROLE_ORDER.map(k => ROLES[k]);
    const head = roleList.map(r => `<th>${r.label.split(' ')[0]}</th>`).join('');
    const matrix = CAPABILITIES.map(c => `
      <tr>
        <td>${c.label}</td>
        ${roleList.map(r => `<td class="pm-cell">${r.caps.includes(c.key) ? '<span class="pm-yes">✓</span>' : '<span class="pm-no">–</span>'}</td>`).join('')}
      </tr>`).join('');

    // my memberships across projects
    const mine = DB.projects.filter(p => this.hasAccess(p)).map(p => `
      <tr>
        <td><b>${p.name}</b></td>
        <td>${this.isAdmin ? '<span class="role-tag">ADMIN</span>' : this.myRoles(p).map(r => `<span class="role-tag">${r}</span>`).join(' ') || '—'}</td>
      </tr>`).join('') || `<tr><td colspan="2" class="empty-note">ยังไม่มีโครงการที่เข้าถึงได้</td></tr>`;

    this.shell(
      `<a data-nav="projects">โครงการ</a><span class="sep">/</span><a data-nav="roles">บทบาท & สิทธิ์</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>🔑 บทบาท & สิทธิ์</h2><div class="desc">สิทธิ์เป็นรายโครงการ · ระดับระบบมี admin (ทำได้ทุกอย่าง) และ user · 1 คนถือได้หลายบทบาทต่อโครงการ (สิทธิ์รวมกัน)</div></div>
        </div>

        <div class="section-title">บทบาทของฉันในแต่ละโครงการ · เข้าใช้เป็น <b>${this.user.name}</b> (${this.isAdmin ? 'admin' : 'user'})</div>
        <div class="report-canvas" style="padding:0;overflow:auto;margin-bottom:22px">
          <table class="data"><thead><tr><th>โครงการ</th><th>บทบาท</th></tr></thead><tbody>${mine}</tbody></table>
        </div>

        <div class="section-title">ตารางสิทธิ์รายบทบาท (Permission Matrix)</div>
        <div class="report-canvas" style="padding:0;overflow:auto">
          <table class="data perm-matrix"><thead><tr><th>สิทธิ์ / การกระทำ</th>${head}</tr></thead><tbody>${matrix}</tbody></table>
        </div>
        <p class="empty-note" style="margin-top:10px">การจัดสมาชิก/มอบสิทธิทำได้จากปุ่ม “👥 สมาชิก” ในหน้าโครงการ (เฉพาะ PI และ admin)</p>
      </div>`
    );
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
        `<button type="button" class="role-chip ${m.roles.includes(rk) ? 'on' : ''}" data-uid="${m.userId}" data-role="${rk}">${rk === 'STOCK' ? 'AHS' : rk}</button>`).join('');
      return `<tr>
        <td><b>${u ? u.name : m.userId}</b> <span style="color:var(--text-muted);font-size:12px">${u ? u.systemRole : ''}</span></td>
        <td><div class="role-chips">${chips}</div></td>
        <td><button class="icon-btn" data-remove="${m.userId}" title="เอาออกจากโครงการ">🗑️</button></td>
      </tr>`;
    }).join('');

    const nonMembers = DB.users.filter(u => !p.members.some(m => m.userId === u.id));
    const addOpts = nonMembers.length
      ? `<select id="addUser">${nonMembers.map(u => `<option value="${u.id}">${u.name} · ${u.systemRole}</option>`).join('')}</select>
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
        <p class="empty-note">EC=ดูอย่างเดียว · PI=จัดการกรง/สมาชิก · AHS/นักวิทย์=ชั่งน้ำหนัก · Vet=รักษา · (ทุกบทบาทยกเว้น EC บันทึกตาย/Stop ได้)</p>
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
      p.members.push({ userId: uid, roles: ['EC'] });   // start as view-only
      this.log('จัดการสมาชิก', `เพิ่ม ${DB.users.find(u => u.id === uid)?.name} (EC)`, p.name);
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

    const paths = series.map(s => {
      let d = '', started = false;
      s.points.forEach((v, i) => {
        if (v == null) return;
        d += (started ? ' L' : 'M') + ` ${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        started = true;
      });
      const dots = s.points.map((v, i) => v == null ? '' :
        `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${s.color}"/>`).join('');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}`;
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
      if (e.target === overlay && !this.wizard) this.closeModal();
    });
    document.body.appendChild(overlay);
  },
  closeModal() {
    const o = this.el('overlay');
    if (o) o.remove();
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
