/* ============================================================
 * iLAMP — Intelligent Laboratory Animal Management Platform (Prototype)
 * App controller: routing, rendering, weighing workflow
 * (Pure front-end mockup — no backend / no database)
 * ============================================================ */

const App = {
  route: { name: 'login', projectId: null },
  weighing: false,            // whole-system weighing mode toggle
  wizard: null,               // active weighing wizard state

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

  // format grams to exactly 1 decimal place ( '–' when empty )
  g(v) { return (v == null || isNaN(v)) ? '–' : Number(v).toFixed(1); },
  // signed 1-decimal ( '+2.3' / '-1.0' )
  gs(v) { return (v == null || isNaN(v)) ? '–' : (v >= 0 ? '+' : '') + Number(v).toFixed(1); },
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
    this.renderLogin();
    this.el('root').addEventListener('click', (e) => {
      const t = e.target.closest('[data-nav]');
      if (t) { e.preventDefault(); this.handleNav(t.dataset.nav, t.dataset); }
    });
  },

  // ---- identity: POSITIONS (system, may be several) + PROJECT ROLES -------
  // See the permission-model comment at the top of data.js. Effective
  // capability = every position's caps ∪ every project role's caps, additive.
  // Gate through can() — never test a position or role key directly.
  get user() { return DB.users.find(u => u.id === DB.currentUserId) || DB.users[0]; },
  positionKeys(u) {
    const x = u || this.user;
    return (x.positions && x.positions.length) ? x.positions : ['EXTERNAL'];
  },
  get positions() { return this.positionKeys().map(k => POSITIONS[k]).filter(Boolean); },
  positionLabel(u) {
    return this.positionKeys(u).map(k => (POSITIONS[k] ? POSITIONS[k].label : k)).join(' + ');
  },
  // caps granted by the positions alone (no project involved)
  hasPositionCap(cap) { return this.positions.some(p => p.caps.includes(cap)); },
  get isAdmin() { return this.positionKeys().includes('ADMIN'); },
  get isAV() { return this.positionKeys().includes('AV'); },        // หัวหน้าสัตวแพทย์
  get canReview() { return this.hasPositionCap('approve'); },       // approve/reject a project
  get canManageUsers() { return this.hasPositionCap('manageUsers'); },
  // any position with facility-wide scope lets the user see every project
  get seesAllProjects() { return this.positions.some(p => p.scope === 'all'); },
  // legacy aliases kept so older call sites keep printing something sensible
  positionKey(u) { return this.positionKeys(u).join(' + '); },
  sysRoleLabel(u) { return this.positionKey(u); },

  // Is this project "live"? Project roles only take effect once AV has approved
  // it — before that the project does not exist yet and only its creator may
  // touch it (see myProjectRoles).
  isApproved(project) { return (project.approval || 'approved') === 'approved'; },
  isCreator(project) { return !!project && project.createdBy === this.user.id; },

  // project roles the current user holds (array of ROLES keys).
  // A DEMO persona (user.projectRole set) holds that role in every project so a
  // client can compare views. Real deployment: project.members drives it.
  myProjectRoles(project) {
    if (!project) return [];
    // waiting / rejected: nobody is appointed yet — only the creator acts, as PI
    if (!this.isApproved(project)) return this.isCreator(project) ? ['PI'] : [];
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
    if (['projects', 'dashboard', 'reports', 'create', 'cagecare', 'dosing', 'ochreport'].includes(name)) return 'projects';
    return '';
  },
  // where to land after login / when a route is not permitted
  homeRoute() {
    const t = this.visibleTabs()[0];
    return t ? t.key : 'roles';
  },
  roleKeyLabel(k) { return k; },
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
      case 'cagecare':
      case 'dosing':
      case 'ochreport': this.go(name, ds.projectId || this.route.projectId); break;
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
    cagecare: { icon: '🧹', title: 'บันทึกการดูแลกรง', cap: 'cageCare',
                desc: 'บันทึกรายกรงว่าวันนั้นทำอะไรไปบ้าง — เปลี่ยน/เติมวัสดุรองนอน ทำความสะอาด' },
    dosing:   { icon: '💉', title: 'การให้สารทดสอบ',   cap: 'dosing',
                desc: 'ชนิดสาร/ยา ปริมาณ วิธีให้ และหัตถการตามโปรโตคอลการทดลอง' },
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
  adminCount() { return DB.users.filter(u => (u.positions || []).includes('ADMIN')).length; },
  isLastAdmin(u) { return (u.positions || []).includes('ADMIN') && this.adminCount() <= 1; },

  // ---- audit log (append-only, visible to everyone) ----
  log(action, detail, projectName = '') {
    const proj = DB.projects.find(p => p.name === projectName);
    const role = (proj && this.myProjectRoles(proj).join('/')) || this.positionKey();
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

    this.el('root').innerHTML = `
      <div id="app-shell">
        <header class="appbar">
          <div class="brand"><span class="mark">🐭</span> iLAMP</div>
          <nav class="main-tabs">${tabsHTML}</nav>
          <nav class="crumbs">${crumbsHTML}</nav>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-nav="audit">📋 Audit Log</button>
          ${this.canManageUsers ? `<button class="btn btn-ghost" data-nav="users">👤 จัดการผู้ใช้</button>` : ''}
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
  renderLogin() {
    this.el('root').innerHTML = `
      <div id="view-login">
        <div class="login-main">
          <form class="login-card" id="loginForm">
            <div class="login-logo-slot"><span class="li-ico">🏛️</span><span class="li-txt">LOGO</span></div>
            <h1 class="login-sys">iLAMP</h1>
            <p class="login-sysfull">Intelligent Laboratory Animal Management Platform</p>
            <div class="field">
              <label>Username</label>
              <input type="text" id="loginEmail" placeholder="name@cmu.ac.th" autocomplete="username">
            </div>
            <div class="field">
              <label>Password</label>
              <input type="password" id="loginPass" placeholder="••••••••" autocomplete="current-password">
            </div>
            <button class="btn btn-primary btn-block btn-lg" type="submit">เข้าสู่ระบบ</button>
          </form>
        </div>
        <footer class="login-owner">Preclinical Laboratory Animal Center, Faculty of Medicine, Chiang Mai University&nbsp;: PLAC</footer>
      </div>`;
    this.el('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      // demo: match the typed e-mail to a seeded user; blank / unknown → a regular user
      // (switch identity/role for testing from the floating demo panel, bottom-right)
      const email = (this.el('loginEmail').value || '').trim().toLowerCase();
      const match = DB.users.find(u => (u.email || '').toLowerCase() === email);
      DB.currentUserId = match ? match.id : 'u_pi';
      // land on the first tab this position is entitled to (GM starts at งานคลัง)
      this.go(this.homeRoute());
    });
  },

  // ---------------------------------------------------------
  // 2. PROJECT LIST
  // ---------------------------------------------------------
  renderProjects() {
    // positions without `view` (GM) have no โครงการ tab at all
    if (!this.can('view')) { this.toast('คุณไม่มีสิทธิ์เข้าถึงหน้าโครงการ'); return this.go(this.homeRoute()); }
    // members see their own projects (admin & AV reviewer see all)
    const visible = DB.projects.filter(p => this.hasAccess(p) || this.canReview);
    const cards = visible.map(p => {
      const approval = p.approval || 'approved';
      const closed = p.status === 'closed';
      const mice = p.cages.reduce((s, c) => s + c.mice.length, 0);
      const roleLabel = this.myRoleLabel(p);
      const iAmOwner = this.can('editProject', p) || this.can('manageMembers', p);   // PI / admin

      const badge = approval === 'waiting'
        ? '<span class="pill waiting">⏳ รอตรวจสอบ</span>'
        : approval === 'rejected'
        ? '<span class="pill rejected">✗ ไม่อนุมัติ</span>'
        : `<span class="pill ${closed ? 'closed' : 'active'}">${closed ? 'ปิดแล้ว' : 'กำลังดำเนิน'}</span>`;

      // top-right actions menu (owner only): ข้อมูลโครงการ / จัดการกรง / จัดการสมาชิก
      const ownerMenu = iAmOwner ? `
        <div class="card-menu">
          <button class="card-menu-btn" data-menu="${p.id}" title="การดำเนินการ" aria-label="การดำเนินการ">⋯</button>
          <div class="card-menu-list" data-menulist="${p.id}">
            <button class="cm-item" data-act="info" data-pid="${p.id}">ข้อมูลโครงการ</button>
            <button class="cm-item" data-act="cages" data-pid="${p.id}">จัดการกรง</button>
            <button class="cm-item" data-act="members" data-pid="${p.id}">จัดการสมาชิก</button>
          </div>
        </div>` : '';

      // per-state action strip
      let strip = '';
      if (approval === 'waiting' && this.canReview) {
        strip = `<div class="card-actions"><button class="btn btn-sm btn-primary" data-act="review" data-pid="${p.id}">🔍 ตรวจสอบเพื่ออนุมัติ</button></div>`;
      } else if (approval === 'waiting') {
        strip = `<div class="card-note waiting-note">⏳ รอการตรวจสอบจาก AV (สัตวแพทย์ผู้ควบคุม)</div>`;
      } else if (approval === 'rejected') {
        strip = `<div class="card-note rejected-note"><b>ไม่อนุมัติ:</b> ${p.rejectReason || '—'}</div>`;
        if (iAmOwner) strip += `<div class="card-actions">
            <button class="btn btn-sm" data-act="edit" data-pid="${p.id}">✏️ แก้ไข</button>
            <button class="btn btn-sm btn-primary" data-act="resubmit" data-pid="${p.id}">↻ ส่งตรวจอีกครั้ง</button>
            <button class="btn btn-sm danger" data-act="delete" data-pid="${p.id}">🗑 ลบ</button>
          </div>`;
      }

      return `
        <div class="project-card card-open ${closed ? 'closed' : ''} ${approval === 'rejected' ? 'rejected' : ''} ${approval === 'waiting' ? 'waiting' : ''}" data-pid="${p.id}">
          <div class="pc-head">
            <h3>${p.name}</h3>
            <div class="pc-right">${badge}${ownerMenu}</div>
          </div>
          <p class="p-desc">${p.description}</p>
          <div class="project-meta">
            <span>📅 เริ่ม ${p.startDate}</span>
            <span>📦 ${p.cages.length} กรง</span>
            <span>🐭 ${mice} ตัว</span>
            <span class="role-tag">${roleLabel}</span>
          </div>
          ${strip}
        </div>`;
    }).join('') || `<p class="empty-note">คุณยังไม่มีโครงการที่เข้าถึงได้ — สร้างโครงการใหม่เพื่อเริ่มต้น (คุณจะเป็น PI ของโครงการนั้น)</p>`;

    // what the list is showing depends on the POSITION's scope, not on approval rights
    const who = `เข้าใช้เป็น <b>${this.user.name}</b> (${this.positionKey()})`;
    const sub = this.canReview
      ? `${who} · เห็นทุกโครงการเพื่อตรวจสอบ/อนุมัติ`
      : this.seesAllProjects
        ? `${who} · เห็นทุกโครงการตามหน้าที่ของตำแหน่ง`
        : `${who} · แสดงเฉพาะโครงการที่คุณได้รับแต่งตั้ง`;

    this.shell(
      '',   // the active tab already says "โครงการ"
      `<div class="page">
        <div class="page-head">
          <div><h2>โครงการ${this.canReview ? '' : 'ของฉัน'}</h2><div class="desc">${sub}</div></div>
          <button class="btn btn-primary" id="newProjectBtn"><span class="ico-plus">+</span> สร้างโครงการ</button>
        </div>
        <div class="project-grid">${cards}</div>
      </div>`
    );

    // "new project" always starts a fresh draft (never resumes a stale edit-draft)
    this.el('newProjectBtn').onclick = () => { this.draft = null; this.go('create'); };

    // open a project by clicking the card (members → dashboard · reviewer → info modal).
    // buttons/menu inside the card call stopPropagation, so they never trigger this.
    document.querySelectorAll('.card-open').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.card-menu') || e.target.closest('[data-act]')) return;
        const p = Data.getProject(el.dataset.pid);
        if (p) this.openProject(p);
      });
    });
    // owner actions menu (⋯)
    document.querySelectorAll('.card-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = document.querySelector(`[data-menulist="${btn.dataset.menu}"]`);
        const wasOpen = list.classList.contains('open');
        document.querySelectorAll('.card-menu-list.open').forEach(x => x.classList.remove('open'));
        if (!wasOpen) list.classList.add('open');
      });
    });
    // all action buttons (menu items + state strip)
    document.querySelectorAll('[data-act][data-pid]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.card-menu-list.open').forEach(x => x.classList.remove('open'));
        const p = Data.getProject(b.dataset.pid);
        if (!p) return;
        switch (b.dataset.act) {
          case 'info': this.openProjectInfo(p); break;
          case 'cages':
            if ((p.approval || 'approved') !== 'approved') this.editProject(p);   // not real yet → edit page
            else { this.go('dashboard', p.id); this.editing = true; this.renderDashboard(); }
            break;
          case 'members': this.openMembers(p); break;
          case 'edit': this.editProject(p); break;
          case 'review': this.openProjectInfo(p); break;
          case 'resubmit': this.resubmitProject(p); this.renderProjects(); break;
          case 'delete': this.confirmDeleteProject(p); break;
        }
      });
    });
    // close any open card menu when clicking elsewhere
    if (this._cardMenuDocHandler) document.removeEventListener('click', this._cardMenuDocHandler);
    this._cardMenuDocHandler = (e) => {
      if (!e.target.closest('.card-menu')) document.querySelectorAll('.card-menu-list.open').forEach(x => x.classList.remove('open'));
    };
    document.addEventListener('click', this._cardMenuDocHandler);
  },

  // route a card click by approval state. Waiting/rejected projects are "not real yet":
  // nobody enters the dashboard — PI edits via the create/edit page, AV reviews via the
  // popup, everyone else (even members) is blocked.
  openProject(p) {
    // OCH inspects on site: a card click opens the safety report, never the dashboard
    if (!this.can('enterProject', p) && this.can('ochReport', p)) {
      return this.go('ochreport', p.id);
    }
    const approval = p.approval || 'approved';
    if (approval === 'waiting' || approval === 'rejected') {
      // nobody is appointed yet — only the creator may edit and resubmit
      if (this.isCreator(p) || this.isAdmin) this.editProject(p);
      else if (this.canReview) this.openProjectInfo(p);           // AV → review popup
      else this.toast('โครงการนี้ยังไม่ได้รับอนุมัติ — ยังเข้าใช้งานไม่ได้');
      return;
    }
    if (this.canEnter(p)) this.go('dashboard', p.id);             // approved (incl. closed) → dashboard
    else if (this.canReview) this.openProjectInfo(p);
    else this.toast('คุณไม่มีสิทธิ์เข้าไปในโครงการนี้');
  },

  // load an existing (non-approved) project into the create wizard for editing
  editProject(p) {
    const idx = {};
    const groups = p.groups.map((g, i) => { idx[g.id] = i; return { name: g.name, color: g.color, isControl: g.isControl, desc: g.desc || '' }; });
    const cells = {};
    p.cages.forEach(c => { cells[`${c.shelf}_${c.position}`] = { g: idx[c.groupId] ?? 0, mice: c.mice.length, sex: (c.mice[0] && c.mice[0].sex) || 'M' }; });
    this.draft = {
      editId: p.id,
      meta: { name: p.name, desc: p.description === '—' ? '' : p.description, date: p.startDate },
      groups,
      layout: { shelves: p.shelves, cols: p.cagesPerShelf },
      cells,
    };
    this.go('create');
  },

  // ---- project approval workflow --------------------------------------
  approveProject(p) {
    p.approval = 'approved'; p.rejectReason = ''; p.reviewedBy = this.user.name; p.reviewedAt = todayISO();
    this.log('อนุมัติโครงการ', p.name, p.name);
    this.toast(`อนุมัติโครงการ "${p.name}" แล้ว`);
  },
  rejectProject(p, reason) {
    p.approval = 'rejected'; p.rejectReason = reason; p.reviewedBy = this.user.name; p.reviewedAt = todayISO();
    this.log('ไม่อนุมัติโครงการ', `${p.name} · ${reason}`, p.name);
    this.toast(`ส่งกลับให้แก้ไข: ${p.name}`);
  },
  resubmitProject(p) {
    p.approval = 'waiting'; p.rejectReason = '';
    this.log('ส่งโครงการตรวจสอบอีกครั้ง', p.name, p.name);
    this.toast('ส่งโครงการเพื่อรอตรวจสอบอีกครั้ง');
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

  // project info modal — read-only detail + review (AV/admin) + fix (PI on rejected)
  openProjectInfo(p) {
    const approval = p.approval || 'approved';
    const mice = p.cages.reduce((s, c) => s + c.mice.length, 0);
    const canReview = this.canReview && (approval === 'waiting' || approval === 'rejected');
    const ownerFix = this.can('editProject', p) && approval === 'rejected';
    const statusText = approval === 'waiting' ? '⏳ รอตรวจสอบ'
      : approval === 'rejected' ? '✗ ไม่อนุมัติ'
      : (p.status === 'closed' ? 'ปิดแล้ว' : 'อนุมัติแล้ว · กำลังดำเนิน');

    const groups = p.groups.map(gr => `<div class="pi-grp"><i class="sw" style="background:${gr.color}"></i><b>${gr.name}</b>${gr.isControl ? ' <span class="muted">(control)</span>' : ''}${gr.desc ? ` — ${gr.desc}` : ''}</div>`).join('');
    const members = (p.members || []).map(m => {
      const u = DB.users.find(x => x.id === m.userId);
      return `<div class="pi-mem"><b>${u ? u.name : m.userId}</b> ${(m.roles || []).map(r => `<span class="role-tag">${this.roleKeyLabel(r)}</span>`).join(' ')}</div>`;
    }).join('') || '<span class="muted">—</span>';
    const docs = (p.documents || []).length
      ? p.documents.map(d => `<div class="pi-doc"><span>📄 ${d.name} <span class="muted">· ${this.fileSize(d.size)} · ${d.category}</span></span><button class="mini-btn pidoc-open" data-id="${d.id}">เปิด</button></div>`).join('')
      : '<span class="muted">ไม่มีเอกสารแนบ</span>';

    const head = ownerFix
      ? `<div class="field"><label>ชื่อโครงการ</label><input id="piName" value="${p.name}"></div>
         <div class="field"><label>รายละเอียด</label><textarea id="piDesc" rows="2">${p.description}</textarea></div>`
      : `<h4 class="pi-name">${p.name}</h4><p class="pi-descread">${p.description}</p>`;

    this.openModal(`
      <div class="modal-head"><div><h3>ข้อมูลโครงการ</h3><div class="sub">${statusText}</div></div>
        <span class="spacer"></span><button class="icon-btn" id="closeModal">✕</button></div>
      <div class="modal-body">
        ${approval === 'rejected' ? `<div class="reject-banner"><b>ไม่อนุมัติ</b> — ${p.rejectReason || '—'}<div class="muted" style="font-size:12px;margin-top:3px">โดย ${p.reviewedBy || '—'} · ${p.reviewedAt || ''}</div></div>` : ''}
        ${head}
        <div class="pi-grid">
          <div><span class="pi-k">วันที่เริ่ม</span> ${p.startDate}</div>
          <div><span class="pi-k">สถานะ</span> ${statusText}</div>
          <div><span class="pi-k">ผังกรง</span> ${p.shelves} ชั้น × ${p.cagesPerShelf} กรง</div>
          <div><span class="pi-k">รวม</span> ${p.cages.length} กรง · ${mice} ตัว</div>
        </div>
        <div class="section-title">กลุ่มทดลอง</div>${groups || '<span class="muted">—</span>'}
        <div class="section-title">สมาชิก</div>${members}
        <div class="section-title">เอกสารแนบ</div><div class="pi-docs">${docs}</div>
        ${canReview ? `<div class="field reject-box" id="rejectBox" style="display:none"><label>เหตุผลที่ไม่อนุมัติ <span style="color:var(--red)">*</span></label><textarea id="rejectReason" rows="3" placeholder="ระบุสิ่งที่ต้องแก้ไข"></textarea></div>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn" id="piClose">ปิด</button>
        ${this.can('editProject', p) ? `<button class="btn" id="piDocs">📎 จัดการเอกสาร</button>` : ''}
        <span class="spacer" style="flex:1"></span>
        ${ownerFix ? `<button class="btn btn-danger" id="piDelete">🗑 ลบ</button><button class="btn btn-primary" id="piResubmit">↻ บันทึก & ส่งตรวจอีกครั้ง</button>` : ''}
        ${canReview ? `<button class="btn btn-danger" id="piReject">✗ ไม่อนุมัติ</button><button class="btn btn-green" id="piApprove">✓ อนุมัติ</button>` : ''}
      </div>`);
    if (this.can('editProject', p)) this.el('piDocs').onclick = () => this.openDocuments(p);

    document.querySelectorAll('.pidoc-open').forEach(b => b.onclick = () => {
      const d = (p.documents || []).find(x => x.id === b.dataset.id);
      if (d && d.url) window.open(d.url, '_blank'); else this.toast('ไฟล์ตัวอย่าง (เมตาดาต้า)');
    });
    this.el('closeModal').onclick = () => this.closeModal();
    this.el('piClose').onclick = () => this.closeModal();

    if (ownerFix) {
      this.el('piDelete').onclick = () => { this.closeModal(); this.confirmDeleteProject(p); };
      this.el('piResubmit').onclick = () => {
        p.name = this.el('piName').value.trim() || p.name;
        p.description = this.el('piDesc').value.trim() || p.description;
        this.resubmitProject(p);
        this.closeModal(); this.renderProjects();
      };
    }
    if (canReview) {
      const rb = this.el('rejectBox');
      this.el('piApprove').onclick = () => { this.approveProject(p); this.closeModal(); this.renderProjects(); };
      this.el('piReject').onclick = () => {
        if (rb.style.display === 'none') { rb.style.display = ''; this.el('rejectReason').focus(); this.toast('ระบุเหตุผล แล้วกด "ไม่อนุมัติ" อีกครั้ง'); return; }
        const reason = this.el('rejectReason').value.trim();
        if (!reason) { this.el('rejectReason').focus(); return; }
        this.rejectProject(p, reason); this.closeModal(); this.renderProjects();
      };
    }
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
    const isEdit = !!this.draft.editId;
    const meta = this.draft.meta || {};

    this.shell(
      `<a data-nav="create">${isEdit ? 'แก้ไขโครงการ' : 'สร้างโครงการ'}</a>`,
      `<div class="page">
        <div class="page-head">
          <div><h2>${isEdit ? 'แก้ไขโครงการ' : 'สร้างโครงการใหม่'}</h2><div class="desc">กำหนดข้อมูล กลุ่มทดลอง แล้วจัดผังกรงและหนูในหน้านี้ (แก้ไขภายหลังได้)</div></div>
        </div>
        <div class="create-wrap">
          <div class="create-grid">
            <div class="create-col">
              <div class="form-card">
                <div class="form-card-title">ข้อมูลโครงการ</div>
                <div class="field"><label>ชื่อโครงการ <span style="color:var(--red)">*</span></label>
                  <input id="cpName" placeholder="เช่น NAFLD Diet Study" value="${(meta.name || '').replace(/"/g, '&quot;')}"></div>
                <div class="field"><label>รายละเอียด</label>
                  <textarea id="cpDesc" rows="2" placeholder="วัตถุประสงค์ / คำอธิบายโครงการ">${meta.desc || ''}</textarea></div>
                <div class="field"><label>วันที่เริ่ม</label><input id="cpDate" type="date" value="${meta.date || todayISO()}"></div>
                <p class="empty-note" style="margin:2px 0 0">${isEdit ? 'บันทึกแล้วโครงการจะกลับไปสถานะ <b>รอตรวจสอบ</b> เพื่อให้ AV อนุมัติอีกครั้ง' : 'เมื่อสร้างแล้ว โครงการจะอยู่สถานะ <b>รอตรวจสอบ</b> เพื่อให้ AV (สัตวแพทย์ผู้ควบคุม) อนุมัติก่อนเริ่มใช้งาน'}</p>
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
            <button class="btn btn-primary" id="cpCreate">${isEdit ? '💾 บันทึก & ส่งตรวจอีกครั้ง' : 'สร้างโครงการ'}</button>
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

    const editId = this.draft.editId;
    const pid = editId || ('P' + Date.now());
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

    const desc = this.el('cpDesc').value.trim() || '—';
    const startDate = this.el('cpDate').value || todayISO();

    // editing an existing (non-approved) project → update in place + resubmit for review
    if (editId) {
      const p = Data.getProject(editId);
      Object.assign(p, {
        name, description: desc, startDate,
        shelves: this.draft.layout.shelves, cagesPerShelf: this.draft.layout.cols,
        groups, cages, approval: 'waiting', rejectReason: '',
      });
      this.log('แก้ไขโครงการ', `${name} · ${cages.length} กรง · ส่งตรวจอีกครั้ง`, name);
      this.draft = null;
      this.toast(`บันทึกการแก้ไข "${name}" แล้ว — ส่งให้ AV ตรวจสอบอีกครั้ง`);
      return this.go('projects');
    }

    DB.projects.push({
      id: pid, name,
      description: desc,
      startDate,
      status: 'active',      // operational status; approval gate below governs go-live
      shelves: this.draft.layout.shelves,
      cagesPerShelf: this.draft.layout.cols,
      groups, cages,
      documents: [],
      approval: 'waiting',   // must be reviewed by AV before it goes live
      // creator becomes PI of the new project (admins are superusers regardless)
      members: [{ userId: this.user.id, roles: ['PI'] }],
    });
    this.log('สร้างโครงการ', `${name} · ${this.draft.layout.shelves}×${this.draft.layout.cols} · ${cages.length} กรง · รอตรวจสอบ`, name);
    this.draft = null;
    this.toast(`สร้างโครงการ "${name}" แล้ว — ส่งให้ AV ตรวจสอบเพื่ออนุมัติ`);
    this.go('projects');
  },

  // ---------------------------------------------------------
  // 3. DASHBOARD
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
    const canEdit = !closed && this.can('editProject', p);
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
           <span style="flex:1"></span>
           <button class="btn" id="sickReport">🩺 ติดตามอาการป่วย</button>
           <button class="btn" id="deathReport">✝ รายงานการตาย</button>
           ${this.can('viewReports', p) ? `<button class="btn" data-nav="reports">📈 กราฟ</button>` : ''}
           ${operational && this.can('cageCare', p) ? `<button class="btn" data-nav="cagecare" data-project-id="${p.id}">🧹 ดูแลกรง</button>` : ''}
           ${operational && this.can('dosing', p) ? `<button class="btn" data-nav="dosing" data-project-id="${p.id}">💉 ให้สารทดสอบ</button>` : ''}
           ${canWeigh ? `<button class="btn btn-primary" id="startWeighing">⚖️ ชั่งน้ำหนัก</button>` : ''}
         </div>`;

    this.shell(
      `<a data-nav="project" data-project-id="${p.id}">${p.name}</a>`,
      `<div class="page wide">
        <div class="page-head">
          <div><h2>${p.name} ${closed ? '<span class="pill closed">ปิดแล้ว</span>' : ''}</h2><div class="desc">${p.description}${closed ? ' · โครงการปิดแล้ว (ดูอย่างเดียว)' : ''}</div></div>
        </div>
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
        </div>
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
    if (!this.weighing && !this.editing) {
      this.el('sickReport').addEventListener('click', () => this.openSickReport(p));
      this.el('deathReport').addEventListener('click', () => this.openDeathReport(p));
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

    // reserve a dedicated badge lane only when this cage has a treatment mark,
    // so the weight column keeps full width in every other cage
    const hasMarks = cage.mice.some(m => (m.treatments && m.treatments.length) || m.flagOpen);

    // per-mouse weight list — status shown by the coloured change value only
    const mouseList = cage.mice.map(m => {
      const cur = Data.latestWeight(m);
      const chg = Data.weightChange(m);
      const st = this.mouseStatus(m);
      const dead = !m.alive;
      const arrow = (dead || !weighed || chg == null) ? '' : `${chg >= 0 ? '▲' : '▼'}${this.g(Math.abs(chg))}`;
      return `<div class="mrow ${dead ? 'dead' : m.excluded ? 'stop' : ''}">
        <span class="mid">${m.code.split('-').slice(-1)[0]}${this.treatMark(m)}${this.flagMark(m)}</span>
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
          <div class="cage-mice${hasMarks ? ' has-marks' : ''}">${mouseList || '<span class="empty-note">ไม่มีหนู</span>'}</div>
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
      if (chg != null && controlChange != null && !group.isControl) {
        vsControl = `${this.gs(chg - controlChange)}g`;
      } else if (group.isControl) {
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
    this.el('closeModal').onclick = () => this.openCagePopup(p, cage);
    this.el('cancelFlag').onclick = () => this.openCagePopup(p, cage);
    this.el('saveFlag').onclick = () => {
      const note = this.el('flagNote').value.trim();
      if (!note) { this.el('flagNote').focus(); this.toast('กรุณาระบุลักษณะที่ผิดปกติ'); return; }
      mouse.flagOpen = true;
      mouse.flag = { by: this.el('flagBy').value.trim() || this.user.name, note, date: todayISO() };
      this.log('แจ้งหนูผิดปกติ', `${mouse.code} · ${note}`, p.name);
      this.toast(`ปักธงผิดปกติที่ ${mouse.code} — รอ VET ตรวจสอบ`);
      this.openCagePopup(p, cage);
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
          <div class="field"><label>วันที่ (Date)</label><input id="deathDate" value="${d.date || todayISO()}"></div>
          <div class="field"><label>เวลา (Time)</label><input id="deathTime" value="${d.time || nowHM()}"></div>
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

    this.el('closeModal').onclick = () => this.openCagePopup(p, cage);
    this.el('cancelDeath').onclick = () => this.openCagePopup(p, cage);
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
        date: this.el('deathDate').value || todayISO(),
        time: this.el('deathTime').value.trim(),
        reporter: this.el('deathReporter').value.trim(),
        handledBy: '', handledAt: '',
      };
      this.log('แจ้งหนูตาย', `${mouse.code} · ${this.deathLabel(mouse.death)}`, p.name);
      this.toast(`บันทึกแล้ว — ซากของ ${mouse.code} อยู่ระหว่างแช่แข็ง รอ Sci/VET จัดการ`);
      this.openCagePopup(p, cage);
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
          <div class="field"><label>วันที่</label><input id="carcassAt" value="${todayISO()}"></div>
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
      mouse.death.handledAt = this.el('carcassAt').value || todayISO();
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
    const operational = this.isOperational(p);        // no recording actions on waiting/rejected/closed
    const canTreat = this.can('treat', p) && operational;
    const canNecropsy = this.can('handleCarcass', p) && operational;   // SCI/VET perform the gross exam
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
            <div class="t-top"><span>📅 ${t.date}${t.time ? ' · ' + t.time : ''}</span><span>${t.vet}</span></div>
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
          <h3>หนู ${mouse.code} ${this.treatMark(mouse)}${this.flagMark(mouse)}</h3>
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
          ${!mouse.alive && mouse.death && mouse.death.disposition === 'necropsy' ? `
          <div>
            <div class="section-title">🔬 ผลการชันสูตร (Necropsy Record)</div>
            ${mouse.necropsy ? this.renderNecropsy(mouse.necropsy) : `<p class="empty-note">ยังไม่ได้บันทึกผลการชันสูตร</p>`}
          </div>` : ''}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="backCage">← กลับ</button>
        ${mouse.treatments.length ? `<button class="btn" id="exportSick">🖨️ ฟอร์มป่วย</button>` : ''}
        ${mouse.treatments.length ? `<button class="btn" id="exportMonitor">🖨️ ฟอร์มติดตาม</button>` : ''}
        ${mouse.necropsy ? `<button class="btn" id="exportNec">🖨️ ฟอร์มชันสูตร</button>` : ''}
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
    if (mouse.treatments.length) {
      this.el('exportSick').onclick = () => {
        this.printDocument(`SickCaseReport_${mouse.code}`, this.buildSickCaseDoc(p, cage, mouse));
        this.log('Export PDF', `Sick Case Report · ${mouse.code}`, p.name);
      };
      this.el('exportMonitor').onclick = () => {
        this.printDocument(`MonitoringRecord_${mouse.code}`, this.buildMonitoringForm(p, cage, mouse));
        this.log('Export PDF', `Monitoring Record · ${mouse.code}`, p.name);
      };
    }
    if (mouse.necropsy) {
      this.el('exportNec').onclick = () => {
        this.printDocument(`Necropsy_${mouse.code}`, this.buildNecropsyDoc(p, cage, mouse));
        this.log('Export PDF', `Necropsy Record · ${mouse.code}`, p.name);
      };
    }
    if (canTreat && mouse.alive) this.el('addTreat').onclick = () => this.openTreatForm(p, cage, mouse);
    if (canTreat && mouse.alive && mouse.flagOpen) {
      this.el('clearFlagBtn').onclick = () => {
        mouse.flagOpen = false; mouse.flag = null;
        this.log('ยกเลิกแจ้งผิดปกติ (ปกติ)', `${mouse.code}`, p.name);
        this.toast(`${mouse.code} — ระบุว่าปกติ กลับสถานะเดิม`);
        this.openMouseDetail(p, cage, mouse);
      };
    }
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
    const n = mouse.necropsy || { results: {}, abnormal: '', avComment: '', examiner: this.user.name, date: todayISO(), time: nowHM() };
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
          <div class="field"><label>วันที่</label><input id="nDate" value="${n.date || todayISO()}"></div>
          <div class="field"><label>เวลา</label><input id="nTime" value="${n.time || nowHM()}"></div>
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
      };
      this.log('บันทึกผลชันสูตร', `${mouse.code}${mouse.necropsy.abnormal ? ' · ' + mouse.necropsy.abnormal : ''}`, p.name);
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
      mouse.humaneOrder = { reason, vet: this.el('humaneVet').value.trim(), date: todayISO() };
      mouse.careOpen = true;
      mouse.flagOpen = false; mouse.flag = null;   // abnormal flag resolved → humane order issued
      this.log('สั่ง Humane endpoint', `${mouse.code} · ${reason}`, p.name);
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
          <div class="field"><label>วันที่</label><input id="tDate" value="${todayISO()}"></div>
          <div class="field"><label>เวลา</label><input id="tTime" value="${nowHM()}"></div>
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
      mouse.treatments.unshift({
        date: this.el('tDate').value,
        time: this.el('tTime').value,
        vet: this.el('tVet').value,
        signs,
        support,
        diagnosis: dx,
        treatment: this.el('tRx').value.trim() || '—',
        recommend: this.el('tReco').value,
        note: '',
      });
      mouse.remark = this.el('tRemark').value.trim();
      mouse.careOpen = true;   // adding a treatment opens/keeps the case open
      mouse.flagOpen = false; mouse.flag = null;   // abnormal flag resolved → case opened
      this.log('รายงานอาการป่วย', `${mouse.code} · ${dx}`, p.name);
      this.toast('บันทึกรายงานอาการป่วยแล้ว');
      this.openMouseDetail(p, cage, mouse);
    };
  },

  // ---------------------------------------------------------
  // SUMMARY REPORTS (project-level)
  // ---------------------------------------------------------
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
        <td>${m.death.date}</td><td>${m.death.time || '—'}</td><td>${cage.code}</td>
        <td><b>${m.code}</b></td><td>${g ? g.name : '—'}</td><td>${m.death.reporter || '—'}</td>
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
        <div class="fu-head"><b>${m.code}</b> · กรง ${cage.code} · ${g ? g.name : '—'} ${status}
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
          if (p.documents[i].url) URL.revokeObjectURL(p.documents[i].url);
          p.documents.splice(i, 1);
          this.log('ลบเอกสาร', name, p.name);
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
        <tr><td class="lbl">Case Number</td><td>${mouse.code}</td><td class="lbl">Date / Time</td><td>${latest.date || todayISO()} &nbsp; ${latest.time || ''}</td></tr>
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
        <tr><th style="text-align:left">Examination of System / Organ(s)</th><th>ID: ${mouse.code}</th><th>ID:</th><th>ID:</th><th>ID:</th></tr>
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
      `<tr><td>${i + 1}.</td><td>${m.death.date || ''}</td><td>${m.death.time || ''}</td><td>${cage.code}</td><td>${m.code}</td><td>${m.death.reporter || ''}</td></tr>`);
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
        <tr><td class="lbl">Case Number</td><td>${mouse.code}</td><td class="lbl">Date / Time</td><td>${first.date || todayISO()} &nbsp; ${first.time || ''}</td></tr>
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
          <div class="ctrl-group">
            <div class="ctrl-label">🎨 กลุ่ม</div>
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
  // over the selected groups. Only weight has per-mouse history; water/food are
  // simulated as a gentle series from current remaining values.
  // No time-range picker — the x-axis is every recorded weigh-day (data is already
  // averaged to one value per day at each weighing).
  drawReport(p) {
    const st = this.reportState;
    const metricLabel = { weight: 'น้ำหนัก', water: 'น้ำ', food: 'อาหาร' };
    // colour = group · dash = data type (metric) · tone = individual mouse within a group
    const colorOf = gid => st.groupColor[gid] || '#64748b';
    const dashOf = m => st.metricDash[m] || '';

    const groups = p.groups.filter(g => st.groupIds.includes(g.id));
    const cages = p.cages.filter(c => st.groupIds.includes(c.groupId));

    // x-axis length = longest weight history among the selected mice
    const range = Math.max(1, ...cages.flatMap(c => c.mice).map(m => m.weights.length)) - 1;
    const labels = Array.from({ length: range + 1 }, (_, i) => isoDaysAgo(range - i).slice(5));

    const multi = st.metrics.length > 1;
    const suffix = m => multi ? ` · ${metricLabel[m]}` : '';
    // water/food have no real history → simulate a gentle declining-then-refilled series from a base value
    const simSeries = base => {
      const pts = [];
      for (let d = 0; d <= range; d++) { const cycle = d % 3; pts.push(Math.round((base + (2 - cycle) * base * 0.18 + rand(-5, 5)) * 10) / 10); }
      return pts;
    };
    let series = [];

    st.metrics.forEach(metric => {
      const dash = dashOf(metric);
      if (metric === 'weight' && st.mode === 'individual') {
        // per-mouse lines (every mouse in every selected group): group colour, tone spread within the group
        groups.forEach(g => {
          const base = colorOf(g.id);
          const show = p.cages.filter(c => c.groupId === g.id).flatMap(c => c.mice);
          show.forEach((m, j) => {
            const tone = show.length > 1 ? (j / (show.length - 1)) * 0.55 : 0;
            series.push({ label: m.code + suffix(metric), color: this.lighten(base, tone), dash,
              points: this.tail(m.weights.map(w => w.weight), range + 1) });
          });
        });
      } else if (metric === 'weight') {
        groups.forEach(g => {
          const gm = p.cages.filter(c => c.groupId === g.id).flatMap(c => c.mice).filter(m => Data.inStats(m));
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
        const val = c => metric === 'water' ? c.water.consumed : c.food.consumed;
        groups.forEach(g => {
          const base = colorOf(g.id);
          const gc = p.cages.filter(c => c.groupId === g.id);
          gc.forEach((c, j) => {
            const tone = gc.length > 1 ? (j / (gc.length - 1)) * 0.55 : 0;
            series.push({ label: c.code + suffix(metric), color: this.lighten(base, tone), dash, points: simSeries(val(c)) });
          });
        });
      } else {
        // group average of daily consumption per group
        groups.forEach(g => {
          const gc = p.cages.filter(c => c.groupId === g.id);
          if (!gc.length) return;
          const base = gc.reduce((a, c) => a + (metric === 'water' ? c.water.consumed : c.food.consumed), 0) / gc.length;
          series.push({ label: g.name + suffix(metric), color: colorOf(g.id), dash, points: simSeries(base) });
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
    const rows = [['Mouse', 'Group', 'Date', 'Weight(g)']];
    const cages = p.cages.filter(c => st.groupIds.includes(c.groupId));
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
          <div><h2>👤 ข้อมูลผู้ใช้ & สิทธิ์</h2><div class="desc">สิทธิ์มี 2 ชั้น — <b>ตำแหน่งระดับระบบ</b> (ถือได้มากกว่า 1) และ <b>บทบาทในโครงการ</b> · สิทธิ์ที่ใช้จริง = <b>รวมกันทุกตำแหน่งและทุกบทบาท</b> ไม่มีการหักออก</div></div>
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
        if (!confirm(`ลบผู้ใช้ ${u.name}? (จะถูกเอาออกจากทุกโครงการด้วย)`)) return;
        DB.users = DB.users.filter(x => x.id !== u.id);
        DB.projects.forEach(p => { if (p.members) p.members = p.members.filter(m => m.userId !== u.id); });
        this.log('ลบผู้ใช้', `${u.name} (${u.email})`, '');
        this.renderUsers();
      };
    });
  },

  openUserForm(user) {
    const isNew = !user;
    const u = user || { firstName: '', lastName: '', email: '', password: '', positions: ['SCI'] };
    const self = user && user.id === this.user.id;
    const held = [...(u.positions || [])];
    const lockRole = self && held.includes('ADMIN');   // admin can't demote self
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
            <span style="font-weight:400;color:var(--text-muted)">— เลือกได้มากกว่า 1 สิทธิ์จะรวมกัน</span></label>
          <div class="pos-grid" id="uRole">
            ${posChoices.map(k => `<button type="button" class="role-sys ${held.includes(k) ? 'sel' : ''}" data-r="${k}" ${lockRole && k === 'ADMIN' ? 'disabled' : ''} title="${POSITIONS[k].label}">${k}</button>`).join('')}
          </div>
          <p class="empty-note" id="posHint">${held.map(k => POSITIONS[k] && POSITIONS[k].label).filter(Boolean).join(' + ') || 'ยังไม่ได้เลือกตำแหน่ง'}</p>
          ${lockRole ? '<p class="empty-note">ผู้ดูแลระบบถอดตำแหน่ง ADMIN ของตัวเองไม่ได้</p>' : ''}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" id="uCancel">ยกเลิก</button>
        <button class="btn btn-primary" id="uSave">${isNew ? 'สร้างผู้ใช้' : 'บันทึก'}</button>
      </div>
    `);

    // multi-select: a person may hold several positions and their caps add up
    const chosen = new Set(held);
    this.el('uRole').querySelectorAll('.role-sys').forEach(b => {
      b.onclick = () => {
        if (b.disabled) return;
        const k = b.dataset.r;
        if (chosen.has(k)) chosen.delete(k); else chosen.add(k);
        b.classList.toggle('sel', chosen.has(k));
        this.el('posHint').textContent =
          [...chosen].map(x => POSITIONS[x].label).join(' + ') || 'ยังไม่ได้เลือกตำแหน่ง';
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
      const roles = [...chosen];
      if (!roles.length) { this.toast('ต้องเลือกอย่างน้อย 1 ตำแหน่ง'); return; }
      // last-admin safety net (the ADMIN button is already disabled for self-admin)
      if (user && (user.positions || []).includes('ADMIN') && !roles.includes('ADMIN') && this.isLastAdmin(user)) { this.toast('ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน'); return; }

      if (isNew) {
        DB.users.push({ id: 'u_' + Date.now().toString(36), firstName, lastName, email, password: pass, positions: roles, projectRole: null, name: `${firstName} ${lastName}`.trim() });
        this.log('เพิ่มผู้ใช้', `${firstName} ${lastName} (${email}) · ${roles.join(' + ')}`, '');
      } else {
        user.firstName = firstName; user.lastName = lastName; user.email = email;
        user.name = `${firstName} ${lastName}`.trim();
        user.positions = roles;
        if (pass) user.password = pass;
        this.log('แก้ไขผู้ใช้', `${user.name} (${email}) · ${roles.join(' + ')}`, '');
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
    const nonMembers = DB.users.filter(u => !(u.positions || []).includes('ADMIN') && !p.members.some(m => m.userId === u.id));
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
