window.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const SUPABASE_URL = 'https://pkueqeuekzgflllcqbpn.supabase.co';
  // Publishable browser key: safe to expose. Database access is protected by RLS.
  const SUPABASE_KEY = 'sb_publishable_CH9djxKRhyteSI6uDCieww_UXnSCzyX';
  const MODEL_URL = 'https://teachablemachine.withgoogle.com/models/ntnF1BdqT/';
  const THRESHOLD = 0.85;
  const OBSERVE_MS = 3000;
  const IDLE_MS = 2 * 60 * 1000;
  const REWARD_RATES = { book: 20, bottle: 10, pen: 9 };
  const REWARD_CATALOG = {
    a4_notebook: { label: 'A4-size notebook', cost: 40 },
    pen: { label: 'Pen', cost: 5 },
    pencil: { label: 'Pencil', cost: 4 },
    pocket_diary: { label: 'Pocket-size diary', cost: 15 },
    sketch_pens: { label: 'Sketch pens', cost: 25 },
    transparent_folder: { label: 'Transparent folder', cost: 15 }
  };
  const $ = (id) => document.getElementById(id);

  const e = {
    welcome: $('welcome-screen'), beginSession: $('begin-session'), backToWelcome: $('back-to-welcome'),
    authGate: $('auth-gate'), app: $('app-content'), account: $('account'),
    accountName: $('account-name'), accountId: $('account-id'), signOut: $('sign-out'),
    headerPoints: $('header-points'),
    workflowEyebrow: $('workflow-eyebrow'), workflowTitle: $('workflow-title'), workflowHelp: $('workflow-help'),
    loginTab: $('login-tab'), registerTab: $('register-tab'), loginForm: $('login-form'),
    registerForm: $('register-form'), loginUid: $('login-uid'), loginPassword: $('login-password'),
    loginError: $('login-error'), registerUid: $('register-uid'), registerName: $('register-name'),
    registerDepartment: $('register-department'), registerPassword: $('register-password'),
    registerPasswordConfirm: $('register-password-confirm'), registerError: $('register-error'),
    video: $('video'), stage: $('stage'), placeholder: $('placeholder'), roi: $('roi'),
    weightModal: $('weight-modal'), openWeightModal: $('open-weight-modal'), closeWeightModal: $('close-weight-modal'),
    rewardsModal: $('rewards-modal'), openRewardsModal: $('open-rewards-modal'), closeRewardsModal: $('close-rewards-modal'),
    redeemBalance: $('redeem-balance'), lastRedemption: $('last-redemption'), redemptionConfirm: $('redemption-confirm'),
    redeemConfirmTitle: $('redeem-confirm-title'), redeemConfirmCopy: $('redeem-confirm-copy'),
    cancelRedemption: $('cancel-redemption'), confirmRedemption: $('confirm-redemption'),
    cameraPill: $('camera-pill'), objectPill: $('object-pill'), objectResult: $('object-result'),
    objectIcon: $('object-icon'), objectOverline: $('object-overline'), objectName: $('object-name'),
    objectHelp: $('object-help'),
    preview: $('weight-preview'), weightPill: $('weight-pill'), weightNumber: $('weight-number'),
    weightUnit: $('weight-unit'), ocrStatus: $('ocr-status'), manual: $('manual-weight'),
    manualUnit: $('manual-unit'), reviewObject: $('review-object'), reviewWeight: $('review-weight'),
    reviewReward: $('review-reward'), depositPill: $('deposit-pill'), confirm: $('confirm'),
    clear: $('clear'), weightLedger: $('weight-ledger'), accountHistory: $('account-history'),
    statItems: $('stat-items'), statPoints: $('stat-points'), sessionWeight: $('session-weight'), system: $('system-status'),
    systemLabel: $('system-label'), toast: $('toast'), x: $('roi-x'), y: $('roi-y'),
    w: $('roi-w'), h: $('roi-h'), threshold: $('threshold'), invert: $('invert'), unit: $('unit')
  };

  const s = {
    session: null, profile: null, transactions: [], redemptions: [], pointsBalance: 0, sessionTransactions: [], idleTimer: null, phase: 'scan',
    stream: null, model: null, running: false, predicting: false, lastPrediction: 0,
    candidate: '', startedAt: 0, elapsed: 0, approved: null, pendingDepositId: null,
    awaitingRemoval: false, removalStartedAt: 0, emptyFrames: 0,
    worker: null, ocrReady: false, ocrBusy: false, lastOcr: 0, ocrReadings: [],
    autoWeight: 0, manualWeight: 0, selectedReward: '', redeeming: false, exitTarget: 'welcome'
  };
  let roiDrag = null;

  if (!window.supabase?.createClient) {
    showAuthError(e.loginError, 'Account service did not load. Check the internet connection and refresh.');
    system('Account service unavailable');
    return;
  }

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function pct(v) { return Math.round((+v || 0) * 100) + '%'; }
  function pill(el, text, tone = '') { el.textContent = text; el.className = 'pill' + (tone ? ' ' + tone : ''); }
  function toast(text) { e.toast.textContent = text; e.toast.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.toast.classList.remove('show'), 3200); }
  function system(text, live = false) { e.systemLabel.textContent = text; e.system.classList.toggle('live', live); }
  function norm(x) { return String(x || '').toLowerCase().replace(/[_-]+/g, ' ').trim(); }
  function normalizeUid(value) { return String(value || '').trim().toUpperCase().replace(/\s+/g, ''); }
  function kind(label) { const v = norm(label); if (/empty|no object|nothing|background|blank/.test(v)) return 'empty'; if (/invalid|other|reject|unknown|extra|not accepted/.test(v)) return 'invalid'; if (/bottle|can|tin|juice|container/.test(v)) return 'bottle'; if (/pen|pencil|stationery|marker/.test(v)) return 'pen'; if (/book|notebook|paper|note|copy/.test(v)) return 'book'; return 'invalid'; }
  function accepted(k) { return ['bottle', 'pen', 'book'].includes(k); }
  function reward(k, w) { if (!accepted(k) || w <= 0) return 0; return Math.round(((w / 1000) * REWARD_RATES[k] + Number.EPSILON) * 1000) / 1000; }
  function formatPoints(value) { const points = Math.round((+value || 0) * 1000) / 1000; return points.toFixed(3).replace(/\.?0+$/, ''); }
  function currentWeight() { return s.autoWeight || s.manualWeight || 0; }
  function categoryName(k) { return ({ bottle: 'Bottles & cans', pen: 'Pens & pencils', book: 'Books & paper' })[k] || 'Other'; }
  function weightIssue(k, w) {
    if (!w) return '';
    const ranges = { bottle: [5, 3000], pen: [1, 1000], book: [10, 5000] };
    const range = ranges[k];
    if (!range || (w >= range[0] && w <= range[1])) return '';
    return `Weight looks unusual for ${categoryName(k).toLowerCase()}. Reposition the scale display or use the manual fallback.`;
  }

  function setPhase(phase, title, help) {
    const defaults = {
      scan: ['Step 1 of 3', 'Scanner starting', 'Place one accepted object and its weighing scale inside the camera view.'],
      identify: ['Step 2 of 3', 'Keep one object still', 'The same valid category must stay above 85% confidence for three seconds.'],
      weigh: ['Step 2 of 3', 'Reading object and weight', 'Keep the item still while the scanner captures the scale display automatically.'],
      deposit: ['Step 3 of 3', 'Review and confirm', 'Check the approved object, stable weight, and estimated reward before confirming.']
    };
    const copy = defaults[phase] || defaults.scan;
    s.phase = phase;
    e.workflowEyebrow.textContent = copy[0];
    e.workflowTitle.textContent = title || copy[1];
    e.workflowHelp.textContent = help || copy[2];
    const visiblePhase = phase === 'weigh' ? 'identify' : phase;
    document.querySelectorAll('.step-dot').forEach((node) => node.classList.toggle('active', node.dataset.step === visiblePhase));
  }

  async function authEmailForId(value) {
    const id = normalizeUid(value);
    const bytes = new TextEncoder().encode('the-last-bin:' + id);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `student-${hex.slice(0, 48)}@accounts.thelastbin.app`;
  }

  function showAuthError(el, message = '') {
    el.textContent = message;
    el.hidden = !message;
  }

  function setAuthBusy(form, busy) {
    form.classList.toggle('auth-busy', busy);
    [...form.elements].forEach((el) => { el.disabled = busy; });
  }

  function switchAuth(mode) {
    const login = mode === 'login';
    e.loginTab.classList.toggle('active', login);
    e.registerTab.classList.toggle('active', !login);
    e.loginForm.hidden = !login;
    e.registerForm.hidden = login;
    showAuthError(e.loginError);
    showAuthError(e.registerError);
    setTimeout(() => (login ? e.loginUid : e.registerUid).focus(), 0);
  }

  function showWelcome() {
    e.welcome.hidden = false;
    e.authGate.hidden = true;
    e.app.hidden = true;
    e.account.hidden = true;
    e.loginForm.reset();
    e.registerForm.reset();
    showAuthError(e.loginError);
    showAuthError(e.registerError);
  }

  function openAccess() {
    e.welcome.hidden = true;
    e.app.hidden = true;
    e.authGate.hidden = false;
    switchAuth('login');
  }

  function showLogin() {
    e.welcome.hidden = true;
    e.app.hidden = true;
    e.account.hidden = true;
    e.authGate.hidden = false;
    e.loginForm.reset();
    e.registerForm.reset();
    switchAuth('login');
  }

  function openWeightSettings() {
    if (!s.session) return;
    e.rewardsModal.hidden = true;
    e.weightModal.hidden = false;
    e.closeWeightModal.focus();
  }

  function closeWeightSettings() {
    e.weightModal.hidden = true;
    if (!e.app.hidden) e.openWeightModal.focus();
  }

  function openRewards() {
    if (!s.session) return;
    e.weightModal.hidden = true;
    cancelRedemption();
    renderRewards();
    e.rewardsModal.hidden = false;
    e.closeRewardsModal.focus();
  }

  function closeRewards() {
    cancelRedemption();
    e.rewardsModal.hidden = true;
    if (!e.app.hidden) e.openRewardsModal.focus();
  }

  async function login(event) {
    event.preventDefault();
    showAuthError(e.loginError);
    const uid = normalizeUid(e.loginUid.value);
    const password = e.loginPassword.value;
    if (uid.length < 3 || password.length < 8) {
      showAuthError(e.loginError, 'Enter a valid UID and password.');
      return;
    }
    setAuthBusy(e.loginForm, true);
    try {
      const email = await authEmailForId(uid);
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await enterApp(data.session);
      e.loginForm.reset();
    } catch (error) {
      console.error(error);
      showAuthError(e.loginError, 'UID or password is incorrect. Check both and try again.');
    } finally {
      setAuthBusy(e.loginForm, false);
    }
  }

  async function register(event) {
    event.preventDefault();
    showAuthError(e.registerError);
    const uid = normalizeUid(e.registerUid.value);
    const fullName = e.registerName.value.trim();
    const department = e.registerDepartment.value.trim();
    const password = e.registerPassword.value;
    if (uid.length < 3 || fullName.length < 2 || department.length < 2) {
      showAuthError(e.registerError, 'Complete your UID, name and department.');
      return;
    }
    if (password.length < 8 || password.length > 72) {
      showAuthError(e.registerError, 'Your password must contain at least eight characters.');
      return;
    }
    if (password !== e.registerPasswordConfirm.value) {
      showAuthError(e.registerError, 'The two password entries do not match.');
      return;
    }
    setAuthBusy(e.registerForm, true);
    try {
      const { data, error } = await db.functions.invoke('register-student', {
        body: { uid, fullName, department, password }
      });
      if (error) {
        let message = 'Registration failed. This UID may already be registered.';
        try { const detail = await error.context?.json(); if (detail?.error) message = detail.error; } catch { /* keep safe message */ }
        throw new Error(message);
      }
      if (!data?.ok) throw new Error(data?.error || 'Registration could not be completed.');
      const email = await authEmailForId(uid);
      const signIn = await db.auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
      await enterApp(signIn.data.session);
      e.registerForm.reset();
      toast('Registration complete. Your personal history is ready.');
    } catch (error) {
      console.error(error);
      showAuthError(e.registerError, error.message || 'Registration failed. Please try again.');
    } finally {
      setAuthBusy(e.registerForm, false);
    }
  }

  async function enterApp(session) {
    if (!session) return leaveApp();
    s.session = session;
    s.exitTarget = 'welcome';
    s.sessionTransactions = [];
    e.welcome.hidden = true;
    e.authGate.hidden = true;
    e.app.hidden = false;
    e.account.hidden = false;
    system('Loading your account…');
    await loadStudentData();
    clearScan(false);
    setPhase('scan');
    resetIdleTimer();
    system('Starting scanner…');
    void startCamera();
  }

  function leaveApp(target = 'welcome') {
    clearTimeout(s.idleTimer);
    if (s.running) stopCamera();
    e.weightModal.hidden = true;
    e.rewardsModal.hidden = true;
    s.session = null;
    s.profile = null;
    s.transactions = [];
    s.redemptions = [];
    s.pointsBalance = 0;
    s.sessionTransactions = [];
    s.selectedReward = '';
    s.redeeming = false;
    e.accountName.textContent = 'Student';
    e.accountId.textContent = 'UID verified';
    renderHistory();
    system('Touch start to begin');
    switchAuth('login');
    if (target === 'login') showLogin();
    else showWelcome();
  }

  async function loadStudentData() {
    const userId = s.session?.user?.id;
    if (!userId) return;
    const [profileResult, transactionResult, redemptionResult, balanceResult] = await Promise.all([
      db.from('profiles').select('full_name,student_id,department').eq('id', userId).single(),
      db.from('transactions').select('deposit_id,item_type,item_label,weight_g,confidence,points,status,created_at').order('created_at', { ascending: false }).limit(100),
      db.from('redemptions').select('redeem_id,reward_item,item_label,points_cost,status,created_at').order('created_at', { ascending: false }).limit(20),
      db.rpc('get_my_points_balance')
    ]);
    if (profileResult.error) throw profileResult.error;
    if (transactionResult.error) throw transactionResult.error;
    if (redemptionResult.error) throw redemptionResult.error;
    if (balanceResult.error) throw balanceResult.error;
    s.profile = profileResult.data;
    s.transactions = transactionResult.data || [];
    s.redemptions = redemptionResult.data || [];
    s.pointsBalance = Math.max(0, +(balanceResult.data || 0));
    e.accountName.textContent = s.profile.full_name || 'Student';
    const id = String(s.profile.student_id || '');
    const department = String(s.profile.department || '');
    e.accountId.textContent = id ? `UID ••••${id.slice(-4)}${department ? ` · ${department}` : ''}` : 'UID verified';
    renderHistory();
  }

  async function refreshPointBalance() {
    const { data, error } = await db.rpc('get_my_points_balance');
    if (error) throw error;
    s.pointsBalance = Math.max(0, +(data || 0));
    renderHistory();
  }

  function resetIdleTimer() {
    if (!s.session) return;
    clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(async () => {
      toast('Session ended after two minutes of inactivity.');
      await db.auth.signOut();
      leaveApp();
    }, IDLE_MS);
  }

  function weightParts(v) {
    const g = Math.max(0, +v || 0);
    if (e.unit.value === 'kg') {
      const value = (g / 1000).toFixed(3).replace(/\.?0+$/, '');
      return { value: value || '0', short: 'kg', long: 'kilograms' };
    }
    return { value: Math.round(g).toLocaleString(), short: 'g', long: 'grams' };
  }
  function displayWeight(v) { const p = weightParts(v); return p.value + ' ' + p.short; }
  function renderCurrentWeight() { const p = weightParts(currentWeight()); e.weightNumber.textContent = p.value; e.weightUnit.textContent = p.long; }
  function syncUnitUi() { const p = weightParts(s.manualWeight); e.manual.max = e.unit.value === 'kg' ? '5' : '5000'; e.manual.step = e.unit.value === 'kg' ? '0.001' : '1'; e.manualUnit.textContent = e.unit.value; if (s.manualWeight) e.manual.value = p.value; renderCurrentWeight(); updateReview(); renderHistory(); updateRoi(); }
  function result(tone, icon, over, name, help) { e.objectResult.className = 'result' + (tone ? ' ' + tone : ''); e.objectIcon.textContent = icon; e.objectOverline.textContent = over; e.objectName.textContent = name; e.objectHelp.textContent = help; }
  function resetObservation() { s.candidate = ''; s.startedAt = 0; s.elapsed = 0; }

  async function startCamera() {
    if (!s.session) return toast('Sign in before starting the scanner.');
    if (s.running) return;
    try {
      if (!window.tmImage) throw Error('AI library did not load. Check the internet connection.');
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera access requires HTTPS and a supported browser.');
      pill(e.cameraPill, 'Loading', 'warn');
      s.model = s.model || await tmImage.load(MODEL_URL + 'model.json', MODEL_URL + 'metadata.json');
      s.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' }, audio: false });
      e.video.srcObject = s.stream;
      await e.video.play();
      s.running = true;
      e.placeholder.hidden = true;
      e.roi.hidden = false;
      pill(e.cameraPill, 'Camera live', 'good');
      pill(e.objectPill, 'Waiting');
      system('Scanner active', true);
      setPhase('identify');
      result('', '○', 'Scanner ready', 'No object detected', 'Place one object in view and keep it still.');
      requestAnimationFrame(loop);
      void enableOcr();
    } catch (error) {
      console.error(error);
      const message = error.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access in the browser address bar, then end the session and sign in again.' : error.message;
      pill(e.cameraPill, 'Camera error', 'bad');
      result('bad', '!', 'Unable to start', 'Camera or model error', message);
      setPhase('scan', 'Camera needs attention', message);
      toast(message);
    }
  }

  function stopCamera() {
    s.running = false;
    (s.stream?.getTracks() || []).forEach((track) => track.stop());
    s.stream = null;
    e.video.srcObject = null;
    e.placeholder.hidden = false;
    e.roi.hidden = true;
    pill(e.cameraPill, 'Camera off');
    system(s.session ? 'Ready to start' : 'Sign in to begin');
    clearScan(false);
  }

  async function loop(now) {
    if (!s.running) return;
    drawCrop();
    if (!s.predicting && now - s.lastPrediction > 180) {
      s.lastPrediction = now;
      s.predicting = true;
      s.model.predict(e.video, false).then(checkObject).catch(console.error).finally(() => { s.predicting = false; });
    }
    if (s.ocrReady && s.approved && accepted(s.approved.kind) && !s.ocrBusy && now - s.lastOcr > 1100) {
      s.lastOcr = now;
      void readWeight();
    }
    requestAnimationFrame(loop);
  }

  function checkObject(predictions) {
    if (!predictions?.length) return;
    const top = [...predictions].sort((a, b) => b.probability - a.probability)[0];
    const k = kind(top.className);
    const now = performance.now();
    if (s.awaitingRemoval) {
      const clearView = k === 'empty' || k === 'invalid' || top.probability < THRESHOLD;
      if (now - s.removalStartedAt > 800 && clearView) s.emptyFrames += 1;
      else if (!clearView) s.emptyFrames = 0;
      if (s.emptyFrames >= 3) {
        s.awaitingRemoval = false;
        s.emptyFrames = 0;
        pill(e.objectPill, 'Waiting');
        result('', '○', 'Scanner ready', 'No object detected', 'Place one object in view and keep it still.');
        if (s.ocrReady) e.ocrStatus.textContent = 'Waiting for an approved object and stable weight.';
        system('Scanner active', true);
        setPhase('identify');
      }
      return;
    }
    if (s.approved) return;
    if (top.probability < THRESHOLD) {
      resetObservation(); pill(e.objectPill, 'Searching', 'warn');
      result('warn', '…', 'Watching camera', 'Keep object steady', 'The timer starts only above 85% confidence.');
      setPhase('identify');
      return;
    }
    if (k === 'empty') {
      resetObservation(); pill(e.objectPill, 'Waiting');
      result('', '○', 'Scanner ready', 'No object detected', 'Place one exchange object in view.');
      setPhase('identify');
      return;
    }
    if (s.candidate !== top.className) { s.candidate = top.className; s.startedAt = now; s.elapsed = 0; }
    else s.elapsed = now - s.startedAt;
    if (s.elapsed < OBSERVE_MS) {
      pill(e.objectPill, 'Observing', 'warn');
      result('', '⌛', 'Observing object', 'Checking eligibility…', 'Keep the same object still for ' + ((OBSERVE_MS - s.elapsed) / 1000).toFixed(1) + ' more seconds.');
      setPhase('identify');
      return;
    }
    s.approved = { label: top.className, kind: k, confidence: top.probability };
    s.pendingDepositId = crypto.randomUUID();
    if (accepted(k)) {
      pill(e.objectPill, 'Approved', 'good');
      result('good', '✓', 'The object to exchange is:', top.className, 'Approved after three continuous seconds.');
      setPhase('weigh');
      toast(top.className + ' approved.');
      if (!s.ocrReady) e.ocrStatus.textContent = 'Object approved. The automatic weight reader is still loading; manual entry remains available.';
    } else {
      pill(e.objectPill, 'Rejected', 'bad');
      result('bad', '×', 'Result', 'Object not exchangeable', 'Accepted here: books/paper, bottles/cans, and pens/pencils. Remove this item to continue.');
      setPhase('identify', 'Remove the unsupported object', 'This station accepts only books/paper, bottles/cans, and pens/pencils.');
      toast('Object not exchangeable.');
    }
    updateReview();
  }

  function roiValues() { return { x: +e.x.value, y: +e.y.value, w: +e.w.value, h: +e.h.value }; }
  function updateRoi() { const r = roiValues(); e.roi.style.setProperty('--x', r.x + '%'); e.roi.style.setProperty('--y', r.y + '%'); e.roi.style.setProperty('--w', r.w + '%'); e.roi.style.setProperty('--h', r.h + '%'); $('x-out').textContent = r.x + '%'; $('y-out').textContent = r.y + '%'; $('w-out').textContent = r.w + '%'; $('h-out').textContent = r.h + '%'; $('threshold-out').textContent = e.threshold.value; localStorage.setItem('last-bin-roi', JSON.stringify({ ...r, t: +e.threshold.value, inv: e.invert.checked, unit: e.unit.value })); }
  function startRoiDrag(event) { if (!s.running) return; const box = e.stage.getBoundingClientRect(); const r = roiValues(); roiDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, box, left: r.x, top: r.y, width: r.w, height: r.h }; e.roi.classList.add('dragging'); e.roi.setPointerCapture(event.pointerId); event.preventDefault(); }
  function moveRoiDrag(event) { if (!roiDrag || event.pointerId !== roiDrag.pointerId) return; const dx = (event.clientX - roiDrag.startX) / roiDrag.box.width * 100; const dy = (event.clientY - roiDrag.startY) / roiDrag.box.height * 100; e.x.value = Math.round(clamp(roiDrag.left + dx, 0, 100 - roiDrag.width)); e.y.value = Math.round(clamp(roiDrag.top + dy, 0, 100 - roiDrag.height)); updateRoi(); event.preventDefault(); }
  function endRoiDrag(event) { if (!roiDrag || event.pointerId !== roiDrag.pointerId) return; e.roi.classList.remove('dragging'); if (e.roi.hasPointerCapture(event.pointerId)) e.roi.releasePointerCapture(event.pointerId); roiDrag = null; }
  function drawCrop() { if (!s.running || !e.video.videoWidth) return; const r = roiValues(); const vw = e.video.videoWidth; const vh = e.video.videoHeight; const sx = vw * r.x / 100; const sy = vh * r.y / 100; const sw = vw * r.w / 100; const sh = vh * r.h / 100; const ctx = e.preview.getContext('2d', { willReadFrequently: true }); ctx.drawImage(e.video, sx, sy, sw, sh, 0, 0, e.preview.width, e.preview.height); const img = ctx.getImageData(0, 0, e.preview.width, e.preview.height); const d = img.data; const threshold = +e.threshold.value; const inv = e.invert.checked; for (let i = 0; i < d.length; i += 4) { const gray = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; let v = gray > threshold ? 255 : 0; if (inv) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; } ctx.putImageData(img, 0, 0); }

  async function enableOcr() {
    if (s.ocrReady) return;
    if (!window.Tesseract) {
      pill(e.weightPill, 'OCR unavailable', 'bad');
      e.ocrStatus.textContent = 'Automatic detection could not load. Use the optional manual override or retry.';
      toast('OCR library did not load. Check the internet connection.');
      return;
    }
    pill(e.weightPill, 'Loading OCR', 'warn'); e.ocrStatus.textContent = 'Loading digit reader automatically…';
    try {
      s.worker = await Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status) e.ocrStatus.textContent = m.status + (m.progress ? ` ${Math.round(m.progress * 100)}%` : ''); } });
      await s.worker.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: '7' });
      s.ocrReady = true; pill(e.weightPill, 'OCR ready', 'good'); e.ocrStatus.textContent = 'Waiting for an approved object and stable weight.'; toast('Automatic weight reader is ready.');
    } catch (error) {
      console.error(error); pill(e.weightPill, 'OCR error', 'bad'); e.ocrStatus.textContent = 'Automatic detection failed. Use the optional manual override.';
    }
  }

  async function readWeight() {
    if (!s.worker || s.ocrBusy) return;
    s.ocrBusy = true;
    try {
      drawCrop();
      const out = await s.worker.recognize(e.preview);
      const raw = String(out.data.text || '').replace(',', '.').replace(/[^0-9.]/g, '');
      const match = raw.match(/\d+(?:\.\d+)?/);
      if (!match) { e.ocrStatus.textContent = 'Digits not clear — adjust the yellow box or threshold.'; return; }
      let value = parseFloat(match[0]);
      if (e.unit.value === 'kg') value *= 1000;
      if (!Number.isFinite(value) || value <= 0 || value > 5000) { e.ocrStatus.textContent = 'Reading ignored: ' + raw; return; }
      s.ocrReadings.push(value); s.ocrReadings = s.ocrReadings.slice(-4);
      e.ocrStatus.textContent = 'Reading ' + displayWeight(value) + ' — checking stability…';
      if (s.ocrReadings.length === 4) {
        const min = Math.min(...s.ocrReadings); const max = Math.max(...s.ocrReadings); const avg = s.ocrReadings.reduce((a, b) => a + b, 0) / 4; const tolerance = Math.max(2, avg * .02);
        if (max - min <= tolerance) { s.autoWeight = Math.round(avg); renderCurrentWeight(); pill(e.weightPill, 'Weight stable', 'good'); e.ocrStatus.textContent = 'Automatically captured from the scale display.'; updateReview(); }
      }
    } catch (error) {
      console.error(error); e.ocrStatus.textContent = 'Could not read digits. Adjust calibration or use manual weight.';
    } finally { s.ocrBusy = false; }
  }

  function updateReview() {
    const ok = s.approved && accepted(s.approved.kind); const w = currentWeight(); const issue = ok ? weightIssue(s.approved.kind, w) : ''; const ready = ok && w > 0 && !issue; const points = ready ? reward(s.approved.kind, w) : 0;
    e.reviewObject.textContent = s.approved ? (ok ? s.approved.label : 'Object not exchangeable') : 'Not approved';
    e.reviewWeight.textContent = w ? (issue ? `${displayWeight(w)} · recheck` : displayWeight(w)) : '—';
    e.reviewReward.textContent = ready ? formatPoints(points) + ' point' + (points === 1 ? '' : 's') : '— points';
    e.confirm.disabled = !ready;
    if (s.approved && !ok) pill(e.depositPill, 'Rejected', 'bad');
    else if (issue) { pill(e.depositPill, 'Recheck weight', 'bad'); setPhase('weigh', 'Check the weight reading', issue); }
    else if (ready) { pill(e.depositPill, 'Ready', 'good'); setPhase('deposit'); }
    else if (ok) pill(e.depositPill, 'Add weight', 'warn');
    else pill(e.depositPill, 'Not ready');
  }

  function clearScan(showToast = true) {
    s.approved = null; s.pendingDepositId = null; s.awaitingRemoval = false; s.removalStartedAt = 0; s.emptyFrames = 0; s.autoWeight = 0; s.manualWeight = 0; s.ocrReadings = []; e.manual.value = ''; renderCurrentWeight(); resetObservation(); pill(e.objectPill, 'Waiting'); pill(e.depositPill, 'Not ready'); result('', '○', s.running ? 'Scanner ready' : 'Waiting for scanner', s.running ? 'No object detected' : 'No object approved', s.running ? 'Place one object in view and keep it still.' : 'The scanner starts automatically after sign-in. If camera permission is blocked, allow it and sign in again.'); if (s.ocrReady) { pill(e.weightPill, 'OCR ready', 'good'); e.ocrStatus.textContent = 'Waiting for an approved object and stable weight.'; } updateReview(); setPhase(s.running ? 'identify' : 'scan'); if (showToast) toast('Ready for the next object.');
  }

  async function confirmDeposit() {
    const w = currentWeight();
    if (!s.session || !s.approved || !accepted(s.approved.kind) || w <= 0) return;
    const originalText = e.confirm.textContent;
    e.confirm.disabled = true; e.confirm.textContent = 'Saving deposit…'; pill(e.depositPill, 'Saving', 'warn');
    const depositId = s.pendingDepositId || crypto.randomUUID();
    s.pendingDepositId = depositId;
    try {
      const { data, error } = await db.from('transactions').insert({
        deposit_id: depositId,
        item_type: s.approved.kind,
        item_label: s.approved.label,
        weight_g: Math.round(w),
        confidence: s.approved.confidence
      }).select('deposit_id,item_type,item_label,weight_g,confidence,points,status,created_at').single();
      if (error) throw error;
      s.transactions.unshift(data);
      s.transactions = s.transactions.slice(0, 100);
      s.sessionTransactions.unshift(data);
      renderHistory();
      await endSession(`Deposit confirmed: ${data.item_label}, ${displayWeight(data.weight_g)}, +${formatPoints(data.points)} points. The next student may now sign in.`, 'login');
    } catch (error) {
      console.error(error);
      pill(e.depositPill, 'Save failed', 'bad');
      toast('Deposit was not saved. Check the internet connection and try again.');
      updateReview();
    } finally {
      e.confirm.textContent = originalText;
      if (s.approved && currentWeight() > 0) e.confirm.disabled = false;
    }
  }

  function renderRewards() {
    const balance = Math.max(0, +s.pointsBalance || 0);
    e.redeemBalance.textContent = formatPoints(balance);
    const last = s.redemptions[0];
    e.lastRedemption.textContent = last
      ? `Last redeemed: ${last.item_label} · ${formatPoints(last.points_cost)} points · ref ${String(last.redeem_id).slice(-8).toUpperCase()}`
      : 'Choose a reward below when you have enough points.';
    document.querySelectorAll('.redeem-option').forEach((button) => {
      const item = REWARD_CATALOG[button.dataset.reward];
      if (!item) return;
      button.disabled = s.redeeming || !s.session || balance < item.cost;
      button.title = balance < item.cost ? `You need ${formatPoints(item.cost - balance)} more points.` : `Redeem ${item.label} for ${item.cost} points.`;
    });
  }

  function chooseReward(rewardItem) {
    const item = REWARD_CATALOG[rewardItem];
    const balance = Math.max(0, +s.pointsBalance || 0);
    if (!s.session || !item || balance < item.cost || s.redeeming) return;
    s.selectedReward = rewardItem;
    e.redeemConfirmTitle.textContent = `Redeem ${item.label} for ${item.cost} points?`;
    e.redeemConfirmCopy.textContent = `Your remaining balance will be ${formatPoints(balance - item.cost)} points. This redemption will be recorded immediately.`;
    e.redemptionConfirm.hidden = false;
    e.confirmRedemption.focus();
  }

  function cancelRedemption() {
    s.selectedReward = '';
    e.redemptionConfirm.hidden = true;
    e.confirmRedemption.disabled = false;
    e.confirmRedemption.textContent = 'Confirm redemption';
  }

  async function redeemSelectedReward() {
    const rewardItem = s.selectedReward;
    const item = REWARD_CATALOG[rewardItem];
    if (!s.session || !item || s.redeeming) return;
    s.redeeming = true;
    e.confirmRedemption.disabled = true;
    e.confirmRedemption.textContent = 'Redeeming…';
    renderRewards();
    try {
      const { data, error } = await db.from('redemptions').insert({
        redeem_id: crypto.randomUUID(),
        reward_item: rewardItem
      }).select('redeem_id,reward_item,item_label,points_cost,status,created_at').single();
      if (error) throw error;
      s.redemptions.unshift(data);
      s.redemptions = s.redemptions.slice(0, 20);
      s.pointsBalance = Math.max(0, s.pointsBalance - (+data.points_cost || item.cost));
      cancelRedemption();
      renderHistory();
      try { await refreshPointBalance(); } catch (balanceError) { console.error(balanceError); }
      toast(`${data.item_label} redeemed for ${formatPoints(data.points_cost)} points. Reference: ${String(data.redeem_id).slice(-8).toUpperCase()}.`);
    } catch (error) {
      console.error(error);
      const insufficient = /insufficient points/i.test(String(error.message || ''));
      toast(insufficient ? 'You no longer have enough points for this reward.' : 'Redemption could not be completed. Check the connection and try again.');
      if (insufficient) {
        try { await refreshPointBalance(); } catch (balanceError) { console.error(balanceError); }
      }
    } finally {
      s.redeeming = false;
      e.confirmRedemption.disabled = false;
      e.confirmRedemption.textContent = 'Confirm redemption';
      renderRewards();
    }
  }

  function renderHistory() {
    e.weightLedger.innerHTML = ''; e.accountHistory.innerHTML = '';
    const lifetimeWeight = s.transactions.reduce((sum, transaction) => sum + (+transaction.weight_g || 0), 0);

    const weightByType = new Map();
    s.transactions.forEach((transaction) => weightByType.set(transaction.item_type, (weightByType.get(transaction.item_type) || 0) + (+transaction.weight_g || 0)));
    ['book', 'bottle', 'pen'].forEach((type) => {
      const row = document.createElement('tr');
      [categoryName(type), displayWeight(weightByType.get(type) || 0)].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
      e.weightLedger.appendChild(row);
    });

    s.transactions.slice(0, 2).forEach((transaction) => {
      const row = document.createElement('tr');
      [new Date(transaction.created_at).toLocaleDateString(), transaction.item_label, '+' + formatPoints(transaction.points)].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
      e.accountHistory.appendChild(row);
    });
    if (!s.transactions.length) {
      const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = 3; cell.className = 'mini-empty'; cell.textContent = s.session ? 'No previous deposits' : 'Sign in to view account history'; row.appendChild(cell); e.accountHistory.appendChild(row);
    }

    e.statItems.textContent = s.transactions.length;
    e.statPoints.textContent = formatPoints(s.pointsBalance);
    e.sessionWeight.textContent = displayWeight(lifetimeWeight);
    e.headerPoints.textContent = formatPoints(s.pointsBalance);
    renderRewards();
  }

  async function endSession(message = 'Session finished. Your account is safely signed out.', target = 'welcome') {
    s.exitTarget = target;
    e.signOut.disabled = true;
    try { await db.auth.signOut(); }
    finally {
      leaveApp(target);
      e.signOut.disabled = false;
      toast(message);
    }
  }

  e.beginSession.addEventListener('click', openAccess);
  e.backToWelcome.addEventListener('click', showWelcome);
  e.loginTab.addEventListener('click', () => switchAuth('login'));
  e.registerTab.addEventListener('click', () => switchAuth('register'));
  e.loginForm.addEventListener('submit', login);
  e.registerForm.addEventListener('submit', register);
  e.signOut.addEventListener('click', () => endSession());
  e.openWeightModal.addEventListener('click', openWeightSettings);
  e.closeWeightModal.addEventListener('click', closeWeightSettings);
  e.weightModal.addEventListener('pointerdown', (event) => { if (event.target === e.weightModal) closeWeightSettings(); });
  e.openRewardsModal.addEventListener('click', openRewards);
  e.closeRewardsModal.addEventListener('click', closeRewards);
  e.rewardsModal.addEventListener('pointerdown', (event) => { if (event.target === e.rewardsModal) closeRewards(); });
  document.querySelectorAll('.redeem-option').forEach((button) => button.addEventListener('click', () => chooseReward(button.dataset.reward)));
  e.cancelRedemption.addEventListener('click', cancelRedemption);
  e.confirmRedemption.addEventListener('click', redeemSelectedReward);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!e.weightModal.hidden) closeWeightSettings();
    else if (!e.rewardsModal.hidden) closeRewards();
  });
  ['pointerdown', 'keydown', 'touchstart'].forEach((name) => document.addEventListener(name, resetIdleTimer, { passive: true }));
  [e.x, e.y, e.w, e.h, e.threshold, e.invert].forEach((el) => el.addEventListener('input', updateRoi));
  e.unit.addEventListener('change', syncUnitUi);
  e.roi.addEventListener('pointerdown', startRoiDrag); e.roi.addEventListener('pointermove', moveRoiDrag); e.roi.addEventListener('pointerup', endRoiDrag); e.roi.addEventListener('pointercancel', endRoiDrag);
  e.manual.addEventListener('input', () => { const entered = +e.manual.value || 0; s.manualWeight = clamp(e.unit.value === 'kg' ? entered * 1000 : entered, 0, 5000); if (s.manualWeight) { s.autoWeight = 0; pill(e.weightPill, 'Manual weight', 'warn'); } renderCurrentWeight(); updateReview(); });
  e.confirm.addEventListener('click', confirmDeposit); e.clear.addEventListener('click', () => clearScan(true));

  try {
    const saved = JSON.parse(localStorage.getItem('last-bin-roi') || 'null');
    if (saved) { e.x.value = saved.x; e.y.value = saved.y; e.w.value = saved.w; e.h.value = saved.h; e.threshold.value = saved.t || 155; e.invert.checked = !!saved.inv; e.unit.value = saved.unit || 'g'; }
  } catch { /* use defaults */ }
  localStorage.removeItem('last-bin-ocr-transactions-v1');
  syncUnitUi();
  renderHistory();

  db.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { const target = s.exitTarget; setTimeout(() => leaveApp(target), 0); }
    else if (event === 'SIGNED_IN' && !s.session) setTimeout(() => enterApp(session).catch((error) => { console.error(error); toast('Could not load your account.'); }), 0);
  });

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    try { await enterApp(session); }
    catch (error) { console.error(error); await db.auth.signOut(); leaveApp(); showAuthError(e.loginError, 'Your account could not be loaded. Please sign in again.'); }
  } else leaveApp();
});
