// ================================================================
// 통사POP — game.js (게임 로직 / 교사가 건드리지 않는 파일)
// ================================================================
"use strict";

/* ================================================================
   0. Firebase 초기화
================================================================ */
let db = null;
let auth = null;
let firebaseEnabled = false;
let authReadyPromise = null;
try {
  const cfg = (window.APP_CONFIG && window.APP_CONFIG.firebaseConfig) || {};
  if (cfg.apiKey && cfg.apiKey !== "PASTE_YOUR_FIREBASE_CONFIG_HERE") {
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    auth = firebase.auth();
    firebaseEnabled = true;
  } else {
    console.warn("[통사POP] firebaseConfig가 설정되지 않아 실시간 연동 없이 동작합니다.");
  }
} catch (e) {
  console.error("[통사POP] Firebase 초기화 실패", e);
  firebaseEnabled = false;
}

async function ensureAuth() {
  if (!firebaseEnabled || !auth) return false;
  if (auth.currentUser) return true;
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = auth.signInAnonymously()
    .then(() => true)
    .catch((error) => {
      console.error("[통사POP] 익명 로그인 실패", error);
      return false;
    });
  return authReadyPromise;
}

function authUid() {
  return auth && auth.currentUser ? auth.currentUser.uid : null;
}

function setConnectionStatus(type, message) {
  const el = $("connectionStatus");
  if (!el) return;
  el.className = "connection-status" + (type ? " " + type : "");
  el.textContent = message;
}

/* ================================================================
   1. 공통 유틸
================================================================ */
function $(id) { return document.getElementById(id); }

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandomN(arr, n) {
  const copy = shuffleInPlace(arr.slice());
  return copy.slice(0, Math.min(n, copy.length));
}

function generateId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1);
}

function formatMs(ms) {
  return (ms / 1000).toFixed(1) + "초";
}

function getTopicById(id) {
  return (window.GAME_SETS || []).find((t) => t.id === id) || null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

/* ================================================================
   2. 화면 전환 / 모달 헬퍼
================================================================ */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  const target = $("screen-" + id);
  if (target) target.classList.add("active");
  window.scrollTo(0, 0);
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

let confirmCallback = null;
function showConfirm(message, onYes) {
  $("confirmMessage").textContent = message;
  confirmCallback = onYes;
  openModal("confirmModal");
}
$("btnConfirmYes").addEventListener("click", () => {
  closeModal("confirmModal");
  const cb = confirmCallback;
  confirmCallback = null;
  if (cb) cb();
});
$("btnConfirmNo").addEventListener("click", () => {
  closeModal("confirmModal");
  confirmCallback = null;
});

let feedbackTimeoutId = null;
const FEEDBACK_MS = { correct: 1100, wrong: 1900, notice: 1500 };
function showFeedback(type, message) {
  const bar = $("feedbackBar");
  clearTimeout(feedbackTimeoutId);
  bar.textContent = message;
  bar.className = "feedback-bar show type-" + type;
  feedbackTimeoutId = setTimeout(() => {
    bar.classList.remove("show");
  }, FEEDBACK_MS[type] || 1200);
}

/* ================================================================
   3. 데이터 검증
================================================================ */
function validateGameSets(gameSets) {
  const errors = [];
  if (!Array.isArray(gameSets) || gameSets.length === 0) {
    errors.push("gameSets가 비어있거나 배열이 아닙니다. data.js를 확인하세요.");
    return { valid: false, errors };
  }
  const seenIds = new Set();
  gameSets.forEach((topic, ti) => {
    const label = topic && topic.title ? `"${topic.title}"` : `${ti + 1}번째 주제`;
    if (!topic || !topic.id) {
      errors.push(`${label}: id가 없습니다.`);
    } else if (seenIds.has(topic.id)) {
      errors.push(`${label}: id "${topic.id}"가 다른 주제와 중복되었습니다.`);
    } else {
      seenIds.add(topic.id);
    }
    if (!topic || !topic.title) errors.push(`${label}: title이 없습니다.`);

    if (!topic || !Array.isArray(topic.categories) || topic.categories.length < 2) {
      errors.push(`${label}: 개념 유형(categories)이 2개 이상이어야 합니다.`);
      return;
    }
    const catNames = new Set();
    topic.categories.forEach((cat, ci) => {
      const catLabel = `${label} > ${(cat && cat.name) || `${ci + 1}번째 유형`}`;
      if (!cat || !cat.name) {
        errors.push(`${catLabel}: 유형 이름이 없습니다.`);
      } else if (catNames.has(cat.name)) {
        errors.push(`${catLabel}: 유형 이름이 중복되었습니다.`);
      } else {
        catNames.add(cat.name);
      }
      if (!cat || !Array.isArray(cat.cards) || cat.cards.length < 6) {
        errors.push(`${catLabel}: 카드가 최소 6개 이상이어야 합니다. (현재 ${cat && cat.cards ? cat.cards.length : 0}개)`);
      } else {
        const seenCards = new Set();
        cat.cards.forEach((card) => {
          const trimmed = (card || "").trim();
          if (!trimmed) {
            errors.push(`${catLabel}: 빈 카드 문장이 있습니다.`);
          } else if (seenCards.has(trimmed)) {
            errors.push(`${catLabel}: 카드 문장 "${trimmed}"가 중복되었습니다.`);
          } else {
            seenCards.add(trimmed);
          }
        });
      }
    });
  });
  return { valid: errors.length === 0, errors };
}

/* ================================================================
   4. 로컬 저장(랭킹 폴백 / 화면 설정)
================================================================ */
const LS_KEYS = {
  results: "tongsaBoom_localResults",
  visualPrefs: "tongsaBoom_visualPrefs",
  teacherSession: "tongsaBoom_teacherSession",
  studentProgress: "tongsaBoom_studentProgress",
};

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (e) {
    return null;
  }
}
function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("로컬 저장 실패", e);
  }
}
function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.error("로컬 저장 삭제 실패", e);
  }
}

function getLocalResults() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEYS.results)) || [];
  } catch (e) {
    return [];
  }
}
function saveLocalResult(result) {
  try {
    const list = getLocalResults();
    list.push(result);
    localStorage.setItem(LS_KEYS.results, JSON.stringify(list));
  } catch (e) {
    console.error("로컬 결과 저장 실패", e);
  }
}
function resetLocalRanking() {
  try {
    localStorage.removeItem(LS_KEYS.results);
  } catch (e) {
    console.error(e);
  }
}

const DEFAULT_VISUAL_PREFS = { theme: "premium-blue", cardSize: "medium", float: true, particles: true };
function getVisualPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEYS.visualPrefs));
    return Object.assign({}, DEFAULT_VISUAL_PREFS, raw || {});
  } catch (e) {
    return Object.assign({}, DEFAULT_VISUAL_PREFS);
  }
}
function saveVisualPrefs(prefs) {
  try {
    localStorage.setItem(LS_KEYS.visualPrefs, JSON.stringify(prefs));
  } catch (e) {
    console.error(e);
  }
}

/* ================================================================
   5. Firestore 연동 (실패해도 게임 진행에는 영향 없음)
================================================================ */
async function fsCreateSession(topicId, topicTitle, className) {
  if (!(await ensureAuth())) return null;
  const sessionId = generateId();
  try {
    await db.collection("sessions").doc(sessionId).set({
      topicId,
      topicTitle,
      className,
      teacherUid: authUid(),
      status: "active",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return sessionId;
  } catch (e) {
    console.error("[Firestore] 세션 생성 실패", e);
    return null;
  }
}

async function fsCreatePlayer(sessionId, playerId, nickname, totalCount) {
  if (!(await ensureAuth())) return false;
  try {
    await db.collection("sessions").doc(sessionId).collection("players").doc(playerId).set({
      nickname,
      ownerUid: authUid(),
      status: "playing",
      totalCount,
      remainingCount: totalCount,
      wrongCount: 0,
      clearMs: null,
      penaltyMs: null,
      finalMs: null,
      joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("[Firestore] 플레이어 생성 실패", e);
    return false;
  }
}

async function fsGetPlayer(sessionId, playerId) {
  if (!(await ensureAuth())) return null;
  try {
    const snap = await db.collection("sessions").doc(sessionId).collection("players").doc(playerId).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error("[Firestore] 플레이어 확인 실패", e);
    return null;
  }
}

async function fsGetSession(sessionId) {
  if (!(await ensureAuth())) return null;
  try {
    const snap = await db.collection("sessions").doc(sessionId).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error("[Firestore] 세션 확인 실패", e);
    return null;
  }
}

async function fsCloseSession(sessionId) {
  if (!(await ensureAuth())) return false;
  try {
    await db.collection("sessions").doc(sessionId).update({
      status: "closed",
      closedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("[Firestore] 세션 종료 실패", e);
    return false;
  }
}

async function fsUpdateProgress(sessionId, playerId, remainingCount, wrongCount) {
  if (!(await ensureAuth())) return;
  try {
    await db.collection("sessions").doc(sessionId).collection("players").doc(playerId).update({
      remainingCount,
      wrongCount,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("[Firestore] 진행 상황 갱신 실패", e);
  }
}

async function fsFinishPlayer(sessionId, playerId, data) {
  if (!(await ensureAuth())) return;
  try {
    await db.collection("sessions").doc(sessionId).collection("players").doc(playerId).update({
      status: "finished",
      clearMs: data.clearMs,
      penaltyMs: data.penaltyMs,
      finalMs: data.finalMs,
      wrongCount: data.wrongCount,
      remainingCount: 0,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("sessions").doc(sessionId).collection("results").add({
      playerId,
      ownerUid: authUid(),
      nickname: data.nickname,
      className: data.className,
      topicId: data.topicId,
      topicTitle: data.topicTitle,
      clearMs: data.clearMs,
      wrongCount: data.wrongCount,
      penaltyMs: data.penaltyMs,
      finalMs: data.finalMs,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error("[Firestore] 결과 저장 실패", e);
  }
}

let liveUnsubscribe = null;
function fsSubscribeLive(sessionId) {
  fsUnsubscribeLive();
  if (!firebaseEnabled || !authUid()) return;
  try {
    liveUnsubscribe = db
      .collection("sessions")
      .doc(sessionId)
      .collection("players")
      .onSnapshot(
        (snapshot) => {
          const players = [];
          snapshot.forEach((doc) => players.push(Object.assign({ id: doc.id }, doc.data())));
          renderLivePlayers(players);
        },
        (err) => console.error("[Firestore] 실시간 구독 오류", err)
      );
  } catch (e) {
    console.error("[Firestore] 실시간 구독 실패", e);
  }
}
function fsUnsubscribeLive() {
  if (liveUnsubscribe) {
    liveUnsubscribe();
    liveUnsubscribe = null;
  }
}

async function fetchRanking(topicId, className) {
  if (await ensureAuth()) {
    try {
      const snap = await db
        .collection("sessions").doc(state.sessionId).collection("results")
        .orderBy("finalMs", "asc")
        .limit(10)
        .get();
      return { source: "firebase", items: snap.docs.map((d) => d.data()) };
    } catch (e) {
      console.error("[Firestore] 랭킹 조회 실패 (인덱스가 필요할 수 있습니다) — 로컬 기록으로 대체합니다.", e);
    }
  }
  const local = getLocalResults()
    .filter((r) => r.sessionId === state.sessionId)
    .sort((a, b) => a.finalMs - b.finalMs)
    .slice(0, 10);
  return { source: "local", items: local };
}

/* ================================================================
   6. 전역 상태
================================================================ */
const state = {
  mode: null, // 'teacher' | 'student'
  selectedTopicId: null,
  selectedClass: null,

  topicId: null,
  topicTitle: null,
  className: null,
  sessionId: null,
  sessionStatus: null,
  playerId: null,
  nickname: null,

  round: null, // { categories, cards, selectedCategory, remainingCount, totalCount, wrongCount, wrongAttempts }
  inputLocked: false,
  gameFinished: false,

  timer: { startTime: null, intervalId: null, elapsedMs: 0 },
  visualPrefs: getVisualPrefs(),
};

function saveTeacherSession() {
  writeStored(LS_KEYS.teacherSession, {
    sessionId: state.sessionId,
    topicId: state.topicId,
    topicTitle: state.topicTitle,
    className: state.className,
  });
}

function saveStudentProgress() {
  if (state.gameFinished || !state.playerId || !state.round) return;
  const elapsedMs = state.timer.startTime ? Date.now() - state.timer.startTime : state.timer.elapsedMs;
  writeStored(LS_KEYS.studentProgress, {
    sessionId: state.sessionId,
    topicId: state.topicId,
    className: state.className,
    playerId: state.playerId,
    nickname: state.nickname,
    round: state.round,
    elapsedMs,
  });
}

function clearStudentProgress() {
  removeStored(LS_KEYS.studentProgress);
}

/* ================================================================
   7. 배경 장식 풍선
================================================================ */
function renderBgBalloons() {
  const wrap = $("bgBalloons");
  const colors = ["var(--balloon-1)", "var(--balloon-2)", "var(--balloon-3)", "var(--balloon-4)", "var(--balloon-5)", "var(--balloon-6)"];
  let html = "";
  for (let i = 0; i < 14; i++) {
    const size = 40 + Math.round(Math.random() * 70);
    const left = Math.round(Math.random() * 100);
    const duration = 14 + Math.random() * 12;
    const delay = Math.random() * -20;
    const color = colors[i % colors.length];
    html += `<div class="bg-balloon" style="width:${size}px;height:${size}px;left:${left}%;background:${color};animation-duration:${duration}s;animation-delay:${delay}s;"></div>`;
  }
  wrap.innerHTML = html;
}

/* ================================================================
   8. 화면 설정 적용
================================================================ */
const THEME_LIST = [
  { id: "premium-blue", label: "프리미엄 블루", swatch: "linear-gradient(135deg,#60a5fa,#2563eb)" },
  { id: "sunset-festa", label: "선셋 페스타", swatch: "linear-gradient(135deg,#fb923c,#f2622e)" },
  { id: "galaxy-pop", label: "갤럭시 팝", swatch: "linear-gradient(135deg,#a78bfa,#6d28d9)" },
];
const CARD_SIZE_LIST = [
  { id: "small", label: "작게" },
  { id: "medium", label: "보통" },
  { id: "large", label: "크게" },
];

function applyVisualPrefs() {
  const prefs = state.visualPrefs;
  document.documentElement.setAttribute("data-theme", prefs.theme);
  $("app").setAttribute("data-card-size", prefs.cardSize);
  $("app").classList.toggle("no-float", !prefs.float);
}

function renderSettingsPanel() {
  const prefs = state.visualPrefs;
  const themeWrap = $("themeOptions");
  themeWrap.innerHTML = THEME_LIST.map(
    (t) => `<button type="button" class="theme-swatch${prefs.theme === t.id ? " selected" : ""}" style="background:${t.swatch}" data-theme-id="${t.id}" title="${t.label}"></button>`
  ).join("");
  themeWrap.querySelectorAll(".theme-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.visualPrefs.theme = btn.dataset.themeId;
      saveVisualPrefs(state.visualPrefs);
      applyVisualPrefs();
      renderSettingsPanel();
    });
  });

  const sizeWrap = $("cardSizeOptions");
  sizeWrap.innerHTML = CARD_SIZE_LIST.map(
    (s) => `<button type="button" class="pill-option${prefs.cardSize === s.id ? " selected" : ""}" data-size-id="${s.id}">${s.label}</button>`
  ).join("");
  sizeWrap.querySelectorAll(".pill-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.visualPrefs.cardSize = btn.dataset.sizeId;
      saveVisualPrefs(state.visualPrefs);
      applyVisualPrefs();
      renderSettingsPanel();
    });
  });

  $("toggleFloat").checked = prefs.float;
  $("toggleParticles").checked = prefs.particles;
}

$("toggleFloat").addEventListener("change", (e) => {
  state.visualPrefs.float = e.target.checked;
  saveVisualPrefs(state.visualPrefs);
  applyVisualPrefs();
});
$("toggleParticles").addEventListener("change", (e) => {
  state.visualPrefs.particles = e.target.checked;
  saveVisualPrefs(state.visualPrefs);
});

$("btnSettingsPanel").addEventListener("click", () => {
  renderSettingsPanel();
  openModal("settingsModal");
});
$("btnCloseSettings").addEventListener("click", () => closeModal("settingsModal"));
$("btnGuide").addEventListener("click", () => openModal("guideModal"));
$("btnCloseGuide").addEventListener("click", () => closeModal("guideModal"));

/* ================================================================
   9. 파티클(풍선 터짐 효과)
================================================================ */
const particleCanvas = $("particleCanvas");
const pctx = particleCanvas.getContext("2d");
function resizeCanvas() {
  particleCanvas.width = window.innerWidth;
  particleCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let particles = [];
let particleLoopRunning = false;
const PARTICLE_COLORS = ["#60a5fa", "#f472b6", "#facc15", "#4ade80", "#c084fc", "#22d3ee"];

function spawnParticles(x, y) {
  if (!state.visualPrefs.particles) return;
  for (let i = 0; i < 22; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 7,
      vy: -Math.random() * 6 - 1,
      life: 1,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      size: Math.random() * 4 + 2,
      rot: Math.random() * Math.PI,
    });
  }
  if (!particleLoopRunning) runParticleLoop();
}

function runParticleLoop() {
  particleLoopRunning = true;
  function frame() {
    pctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;
      p.life -= 0.018;
    });
    particles = particles.filter((p) => p.life > 0);
    particles.forEach((p) => {
      pctx.globalAlpha = Math.max(p.life, 0);
      pctx.fillStyle = p.color;
      pctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 1.6);
    });
    pctx.globalAlpha = 1;
    if (particles.length > 0) {
      requestAnimationFrame(frame);
    } else {
      particleLoopRunning = false;
    }
  }
  requestAnimationFrame(frame);
}

/* ================================================================
   10. 교사 모드 — 시작 화면
================================================================ */
let dataValidation = { valid: false, errors: [] };

function renderDataErrors() {
  dataValidation = validateGameSets(window.GAME_SETS);
  const block = $("dataErrorBlock");
  if (dataValidation.valid) {
    block.hidden = true;
  } else {
    block.hidden = false;
    $("dataErrorList").innerHTML = dataValidation.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  }
}

function renderTopics() {
  const wrap = $("topicList");
  const topics = Array.isArray(window.GAME_SETS) ? window.GAME_SETS : [];
  wrap.innerHTML = topics
    .map(
      (t) => `<button type="button" class="topic-item${state.selectedTopicId === t.id ? " selected" : ""}" data-topic-id="${escapeHtml(t.id)}">
        <div class="topic-item-title">${escapeHtml(t.title)}</div>
        ${t.description ? `<div class="topic-item-desc">${escapeHtml(t.description)}</div>` : ""}
      </button>`
    )
    .join("");
  wrap.querySelectorAll(".topic-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedTopicId = btn.dataset.topicId;
      renderTopics();
      updateGenerateBtn();
    });
  });
}

function renderClasses() {
  const wrap = $("classList");
  const classes = (window.APP_CONFIG && window.APP_CONFIG.classes) || [];
  wrap.innerHTML = classes
    .map((c) => `<button type="button" class="class-chip${state.selectedClass === c ? " selected" : ""}" data-class="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");
  wrap.querySelectorAll(".class-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedClass = btn.dataset.class;
      renderClasses();
      updateGenerateBtn();
    });
  });
}

function updateGenerateBtn() {
  $("btnGenerateQr").disabled = !(dataValidation.valid && state.selectedTopicId && state.selectedClass && authUid());
}

$("btnGenerateQr").addEventListener("click", async () => {
  if ($("btnGenerateQr").disabled) return;
  const topic = getTopicById(state.selectedTopicId);
  if (!topic) return;
  $("btnGenerateQr").disabled = true;
  const sessionId = await fsCreateSession(topic.id, topic.title, state.selectedClass);
  if (!sessionId) {
    setConnectionStatus("error", "수업 연결에 실패했어요. 인터넷과 Firebase 설정을 확인하세요.");
    updateGenerateBtn();
    return;
  }
  state.topicId = topic.id;
  state.topicTitle = topic.title;
  state.className = state.selectedClass;
  state.sessionId = sessionId;
  state.sessionStatus = "active";
  saveTeacherSession();
  renderQrScreen();
  showScreen("qr");
  updateGenerateBtn();
});

/* ================================================================
   11. QR 화면
================================================================ */
function renderQrScreen() {
  $("qrTopicBadge").textContent = "📚 " + state.topicTitle;
  $("qrClassBadge").textContent = "🏫 " + state.className;

  const baseUrl = (window.APP_CONFIG && window.APP_CONFIG.gameBaseUrl) ||
    (window.location && window.location.protocol && window.location.protocol.startsWith("http")
      ? window.location.origin + window.location.pathname
      : "");
  const warning = $("qrUrlWarning");
  const imgWrap = $("qrImageWrap");
  const img = $("qrImage");
  const fallback = $("qrFallbackMsg");

  if (!baseUrl) {
    warning.hidden = false;
    imgWrap.hidden = true;
    $("qrUrlText").value = "";
    $("qrDirectLink").href = "#";
    $("qrDirectLink").style.pointerEvents = "none";
    return;
  }

  warning.hidden = true;
  imgWrap.hidden = false;
  fallback.hidden = true;
  img.hidden = false;

  const studentUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}topic=${encodeURIComponent(state.topicId)}&class=${encodeURIComponent(state.className)}&session=${encodeURIComponent(state.sessionId)}`;

  img.onerror = () => {
    img.hidden = true;
    fallback.hidden = false;
  };
  img.onload = () => {
    fallback.hidden = true;
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(studentUrl)}`;

  $("qrUrlText").value = studentUrl;
  const link = $("qrDirectLink");
  link.href = studentUrl;
  link.style.pointerEvents = "auto";
}

$("btnQrBack").addEventListener("click", () => {
  showScreen("start");
});
$("btnCopyLink").addEventListener("click", async () => {
  const url = $("qrUrlText").value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showFeedback("correct", "학생용 링크를 복사했어요.");
  } catch (e) {
    $("qrUrlText").focus();
    $("qrUrlText").select();
    showFeedback("notice", "링크를 선택했어요. 복사해 주세요.");
  }
});
$("btnCloseSession").addEventListener("click", () => {
  showConfirm("이 수업을 종료할까요? 종료 후에는 학생이 새로 참여하거나 기록을 저장할 수 없습니다.", async () => {
    if (await fsCloseSession(state.sessionId)) {
      state.sessionStatus = "closed";
      showFeedback("correct", "수업을 종료했어요. 새 참여는 막혔고, 최종 현황판은 계속 볼 수 있어요.");
      $("btnCloseSession").disabled = true;
    } else {
      showFeedback("wrong", "수업 종료에 실패했어요. 교사가 만든 기기에서 다시 시도하세요.");
    }
  });
});
$("btnGoLive").addEventListener("click", () => {
  fsSubscribeLive(state.sessionId);
  renderLivePlayers([]);
  showScreen("live");
});
$("btnLiveBack").addEventListener("click", () => {
  fsUnsubscribeLive();
  showScreen("qr");
});

/* ================================================================
   12. 실시간 현황판
================================================================ */
function renderLivePlayers(players) {
  $("liveTopicBadge").textContent = "📚 " + state.topicTitle;
  $("liveClassBadge").textContent = "🏫 " + state.className;
  $("liveHeading").textContent = state.sessionStatus === "closed" ? "📊 수업 최종 현황판" : "📊 실시간 참여 현황판";

  const tbody = $("livePlayerTbody");
  const emptyMsg = $("liveEmptyMsg");

  if (!players || players.length === 0) {
    $("liveJoinedCount").textContent = "0";
    $("livePlayingCount").textContent = "0";
    $("liveFinishedCount").textContent = "0";
    $("liveCompletionRate").textContent = "0%";
    $("liveAverageWrong").textContent = "-";
    tbody.innerHTML = "";
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  const finished = players.filter((p) => p.status === "finished").sort((a, b) => (a.finalMs || 0) - (b.finalMs || 0));
  const playing = players.filter((p) => p.status !== "finished").sort((a, b) => (a.nickname || "").localeCompare(b.nickname || ""));
  const ordered = finished.concat(playing);
  $("liveJoinedCount").textContent = players.length;
  $("livePlayingCount").textContent = playing.length;
  $("liveFinishedCount").textContent = finished.length;
  $("liveCompletionRate").textContent = `${Math.round((finished.length / players.length) * 100)}%`;
  const averageWrong = finished.length
    ? (finished.reduce((sum, p) => sum + (p.wrongCount || 0), 0) / finished.length).toFixed(1)
    : null;
  $("liveAverageWrong").textContent = averageWrong === null ? "-" : `${averageWrong}회`;

  tbody.innerHTML = ordered
    .map((p) => {
      const isFinished = p.status === "finished";
      const total = p.totalCount || 0;
      const remaining = p.remainingCount != null ? p.remainingCount : total;
      const progressPct = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
      return `<tr class="${isFinished ? "player-finished" : ""}">
        <td>${escapeHtml(p.nickname || "-")}</td>
        <td><span class="status-pill ${isFinished ? "finished" : "playing"}">${isFinished ? "완료" : "플레이 중"}</span></td>
        <td>${isFinished ? "100%" : `${progressPct}% (${remaining}개 남음)`}</td>
        <td>${p.wrongCount || 0}</td>
        <td>${isFinished ? formatMs(p.finalMs || 0) : "-"}</td>
      </tr>`;
    })
    .join("");
}

/* ================================================================
   12.5 랜덤 닉네임 배정 (실명 입력 방지 — 귀여운 포켓몬 이름 자동 부여)
================================================================ */
const NICKNAME_POOL = [
  "피카츄", "라이츄", "파이리", "리자드", "리자몽", "꼬부기", "어니부기", "거북왕",
  "이상해씨", "이상해풀", "이상해꽃", "버터플리", "캐터피", "뿔충이", "구구", "피죤",
  "피죤투", "꼬렛", "레트라", "아보", "아보크", "모래두지", "고지", "냐옹",
  "페르시안", "고라파덕", "골덕", "망키", "성원숭", "삐삐", "픽시", "식스테일",
  "나인테일", "푸린", "푸크린", "또가스", "캥카", "슬리프", "슬리퍼", "잠만보",
  "망나뇽", "미뇽", "신뇽", "토게피", "토게틱", "피츄", "이브이", "뮤", "뮤츠", "메타몽",
];

async function assignRandomNickname(sessionId) {
  let taken = new Set();
  if (firebaseEnabled) {
    try {
      const snap = await db.collection("sessions").doc(sessionId).collection("players").get();
      snap.forEach((doc) => {
        const n = doc.data().nickname;
        if (n) taken.add(n);
      });
    } catch (e) {
      console.error("[Firestore] 기존 참여자 닉네임 조회 실패 — 중복 확인 없이 배정합니다.", e);
    }
  }

  const available = shuffleInPlace(NICKNAME_POOL.filter((n) => !taken.has(n)));
  if (available.length > 0) return available[0];

  // 반 인원이 이름 풀보다 많을 때: 이름 뒤에 번호를 붙여서라도 계속 유니크하게 배정한다.
  const base = NICKNAME_POOL[Math.floor(Math.random() * NICKNAME_POOL.length)];
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/* ================================================================
   13. 학생 모드 진입
================================================================ */
async function detectMode() {
  const params = new URLSearchParams(window.location.search);
  const topic = params.get("topic");
  const cls = params.get("class");
  const session = params.get("session");

  if (topic && cls && session) {
    const topicObj = getTopicById(topic);
    if (!topicObj) {
      state.mode = "student";
      $("teacherPanel").hidden = true;
      $("studentPanel").hidden = false;
      $("studentJoinBlock").hidden = true;
      $("studentInvalidMsg").hidden = false;
      return;
    }
    state.mode = "student";
    state.topicId = topic;
    state.topicTitle = topicObj.title;
    state.className = cls;
    state.sessionId = session;

    $("teacherPanel").hidden = true;
    $("studentPanel").hidden = false;
    $("studentInvalidMsg").hidden = true;
    $("studentTopicBadge").textContent = "📚 " + topicObj.title;
    $("studentClassBadge").textContent = "🏫 " + cls;

    const sessionData = await fsGetSession(session);
    if (!sessionData || sessionData.status !== "active" || sessionData.topicId !== topic || sessionData.className !== cls) {
      $("studentJoinBlock").hidden = true;
      $("studentInvalidMsg").hidden = false;
      return;
    }

    const saved = readStored(LS_KEYS.studentProgress);
    if (saved && saved.sessionId === session && saved.topicId === topic && saved.className === cls && saved.playerId && saved.round) {
      const player = await fsGetPlayer(session, saved.playerId);
      if (player && player.ownerUid === authUid() && player.status === "playing") {
        state.playerId = saved.playerId;
        state.nickname = saved.nickname;
        state.round = saved.round;
        state.inputLocked = false;
        renderGameHeader();
        renderCategoryBar();
        renderCardGrid();
        updateStatChips();
        startTimer(saved.elapsedMs || 0);
        showScreen("game");
        showFeedback("notice", "이전 진행 상황을 이어서 시작합니다.");
        return;
      }
      clearStudentProgress();
    }

    assignRandomNickname(session).then((nickname) => {
      state.nickname = nickname;
      $("assignedNicknameText").textContent = nickname;
      $("btnStartGame").disabled = false;
    });
  } else {
    state.mode = "teacher";
    $("teacherPanel").hidden = false;
    $("studentPanel").hidden = true;
    renderDataErrors();
    renderTopics();
    renderClasses();
    setConnectionStatus("", "수업 연결을 준비하고 있어요…");
    if (await ensureAuth()) {
      setConnectionStatus("ready", "실시간 수업 연결이 준비되었습니다.");
      const saved = readStored(LS_KEYS.teacherSession);
      if (saved && saved.sessionId) {
        const sessionData = await fsGetSession(saved.sessionId);
        if (sessionData && sessionData.teacherUid === authUid()) {
          state.topicId = sessionData.topicId;
          state.topicTitle = sessionData.topicTitle;
          state.className = sessionData.className;
          state.sessionId = saved.sessionId;
          state.sessionStatus = sessionData.status;
          renderQrScreen();
          $("btnCloseSession").disabled = sessionData.status === "closed";
          showScreen("qr");
          return;
        }
        removeStored(LS_KEYS.teacherSession);
      }
    } else {
      setConnectionStatus("error", "실시간 연결을 준비하지 못했어요. Firebase 익명 로그인을 확인하세요.");
    }
    updateGenerateBtn();
  }
}

$("btnStartGame").addEventListener("click", async () => {
  if (!state.nickname) return; // 닉네임 배정이 아직 끝나지 않음 (버튼도 비활성화되어 있어 정상적으론 도달하지 않음)

  state.playerId = generateId();
  state.gameFinished = false;

  const topic = getTopicById(state.topicId);
  state.round = buildRound(topic);

  if (!(await fsCreatePlayer(state.sessionId, state.playerId, state.nickname, state.round.totalCount))) {
    showFeedback("wrong", "수업 연결에 실패했어요. QR을 다시 스캔하거나 선생님께 알려주세요.");
    return;
  }

  saveStudentProgress();

  renderGameHeader();
  renderCategoryBar();
  renderCardGrid();
  updateStatChips();
  startTimer();
  showScreen("game");
});

/* ================================================================
   14. 라운드 구성
================================================================ */
// 한 판에 뿌릴 풍선(카드) 총 개수. 유형별 비교와 반복 학습을 위해 15개를 사용한다.
const TOTAL_BALLOON_COUNT = 15;

function buildRound(topic) {
  const n = topic.categories.length;
  const base = Math.floor(TOTAL_BALLOON_COUNT / n);
  const remainder = TOTAL_BALLOON_COUNT % n;
  // 나머지는 매 판 무작위로 다른 유형에 배분해, 특정 유형이 항상 더 많이 나오지 않도록 한다.
  const extraIdx = new Set(shuffleInPlace(topic.categories.map((_, i) => i)).slice(0, remainder));

  const categories = topic.categories.map((cat, idx) => {
    const count = base + (extraIdx.has(idx) ? 1 : 0);
    const cardTexts = pickRandomN(cat.cards, count);
    return { name: cat.name, cardTexts, remaining: cardTexts.length, total: cardTexts.length, done: false };
  });

  const cards = [];
  categories.forEach((cat) => {
    cat.cardTexts.forEach((text) => {
      cards.push({ id: generateId(), text, categoryName: cat.name, popped: false });
    });
  });
  shuffleInPlace(cards);

  return {
    categories,
    cards,
    selectedCategory: null,
    remainingCount: cards.length,
    totalCount: cards.length,
    wrongCount: 0,
    wrongAttempts: [],
  };
}

/* ================================================================
   15. 게임 화면 렌더링
================================================================ */
function renderGameHeader() {
  $("gameTopicTitle").textContent = state.topicTitle;
  $("gameClassBadge").textContent = "🏫 " + state.className;
}

function renderCategoryBar() {
  const wrap = $("categoryBar");
  wrap.innerHTML = state.round.categories
    .map((cat) => {
      const selected = state.round.selectedCategory === cat.name;
      const done = cat.done;
      return `<button type="button" class="category-btn${selected ? " selected" : ""}${done ? " done" : ""}" data-cat="${escapeHtml(cat.name)}" ${done ? "disabled" : ""}>
        <span>${escapeHtml(cat.name)}</span><span class="cat-count">${cat.remaining}</span>
      </button>`;
    })
    .join("");
  wrap.querySelectorAll(".category-btn").forEach((btn) => {
    btn.addEventListener("click", () => onCategoryClick(btn.dataset.cat));
  });
}

const BALLOON_CLASS_COUNT = 6;
function renderCardGrid() {
  const wrap = $("cardGrid");
  wrap.innerHTML = state.round.cards
    .map((card, idx) => {
      const colorClass = "balloon-c" + ((idx % BALLOON_CLASS_COUNT) + 1);
      const duration = (3.4 + Math.random() * 2.4).toFixed(2);
      const delay = (Math.random() * -4).toFixed(2);
      return `<button type="button" class="balloon-card ${colorClass}" data-id="${card.id}" style="--float-duration:${duration}s;--float-delay:${delay}s;">
        <span class="balloon-text">${escapeHtml(card.text)}</span>
      </button>`;
    })
    .join("");
  wrap.querySelectorAll(".balloon-card").forEach((el) => {
    el.addEventListener("click", () => onCardClick(el.dataset.id, el));
  });
}

function updateStatChips() {
  $("statWrong").textContent = state.round.wrongCount;
  $("statRemaining").textContent = state.round.remainingCount;
}

/* ================================================================
   16. 개념 유형 선택
================================================================ */
function onCategoryClick(catName) {
  const cat = state.round.categories.find((c) => c.name === catName);
  if (!cat || cat.done) return;
  state.round.selectedCategory = state.round.selectedCategory === catName ? null : catName;
  renderCategoryBar();
}

/* ================================================================
   17. 카드 클릭 판정
================================================================ */
const ANIM_MS = { pop: 520, shake: 520 };

function onCardClick(cardId, el) {
  if (state.inputLocked) return;
  const card = state.round.cards.find((c) => c.id === cardId && !c.popped);
  if (!card) return;

  if (!state.round.selectedCategory) {
    showFeedback("notice", "먼저 개념 유형을 선택하세요!");
    return;
  }

  state.inputLocked = true;
  const selectedCategory = state.round.selectedCategory;
  const correct = card.categoryName === selectedCategory;

  if (correct) {
    handleCorrect(card, el, selectedCategory);
  } else {
    handleWrong(card, el, selectedCategory);
  }
}

function handleCorrect(card, el, selectedCategory) {
  card.popped = true;
  const rect = el.getBoundingClientRect();
  spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
  el.classList.add("popping");
  showFeedback("correct", `정답! "${selectedCategory}" 풍선을 터뜨렸어요. 🎈`);

  const cat = state.round.categories.find((c) => c.name === selectedCategory);
  cat.remaining -= 1;
  state.round.remainingCount -= 1;
  if (cat.remaining <= 0) {
    cat.done = true;
    if (state.round.selectedCategory === selectedCategory) {
      state.round.selectedCategory = null;
    }
  }

  updateStatChips();
  renderCategoryBar();
  fsUpdateProgress(state.sessionId, state.playerId, state.round.remainingCount, state.round.wrongCount);
  saveStudentProgress();

  setTimeout(() => {
    // DOM에서 제거하지 않고 그대로 둔다 — 터진 풍선 자리는 빈 공간으로 남고
    // (popping 애니메이션이 opacity:0으로 고정) 나머지 풍선은 그리드에서 움직이지 않는다.
    state.inputLocked = false;
    if (state.round.remainingCount <= 0) {
      finishGame();
    }
  }, ANIM_MS.pop);
}

function handleWrong(card, el, selectedCategory) {
  state.round.wrongCount += 1;
  if (!Array.isArray(state.round.wrongAttempts)) state.round.wrongAttempts = [];
  state.round.wrongAttempts.push({
    cardText: card.text,
    selectedCategory,
    correctCategory: card.categoryName,
  });
  el.classList.add("shaking");
  showFeedback("wrong", `오답! 선택한 유형은 "${selectedCategory}"인데, 이 풍선은 "${card.categoryName}"예요. (+3초)`);
  updateStatChips();
  fsUpdateProgress(state.sessionId, state.playerId, state.round.remainingCount, state.round.wrongCount);
  saveStudentProgress();

  setTimeout(() => {
    el.classList.remove("shaking");
    state.inputLocked = false;
  }, ANIM_MS.shake);
}

/* ================================================================
   18. 타이머
================================================================ */
function startTimer(initialElapsedMs = 0) {
  stopTimer();
  state.timer.startTime = Date.now() - initialElapsedMs;
  state.timer.elapsedMs = initialElapsedMs;
  $("statTimer").textContent = formatSeconds(initialElapsedMs);
  state.timer.intervalId = setInterval(() => {
    state.timer.elapsedMs = Date.now() - state.timer.startTime;
    $("statTimer").textContent = formatSeconds(state.timer.elapsedMs);
  }, 100);
}
function stopTimer() {
  if (state.timer.intervalId) {
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = null;
  }
  if (state.timer.startTime) {
    state.timer.elapsedMs = Date.now() - state.timer.startTime;
  }
}

/* ================================================================
   19. 재시작 / 새 라운드
================================================================ */
async function startNewRound() {
  const topic = getTopicById(state.topicId);
  state.round = buildRound(topic);
  state.inputLocked = false;
  state.gameFinished = false;
  renderCategoryBar();
  renderCardGrid();
  updateStatChips();
  startTimer();
  await fsCreatePlayer(state.sessionId, state.playerId, state.nickname, state.round.totalCount);
  saveStudentProgress();
}

$("btnRestart").addEventListener("click", () => {
  showConfirm("정말 다시 시작할까요? 진행 상황이 초기화됩니다.", () => {
    startNewRound();
  });
});

/* ================================================================
   20. 결과 처리
================================================================ */
async function finishGame() {
  stopTimer();
  const clearMs = state.timer.elapsedMs;
  const penaltyMs = state.round.wrongCount * 3000;
  const finalMs = clearMs + penaltyMs;

  const resultData = {
    sessionId: state.sessionId,
    nickname: state.nickname,
    className: state.className,
    topicId: state.topicId,
    topicTitle: state.topicTitle,
    clearMs,
    wrongCount: state.round.wrongCount,
    penaltyMs,
    finalMs,
    createdAt: Date.now(),
  };

  saveLocalResult(resultData);
  await fsFinishPlayer(state.sessionId, state.playerId, resultData);
  state.gameFinished = true;
  clearStudentProgress();
  await showResultScreen(resultData);
}

window.addEventListener("pagehide", () => {
  if (state.mode === "student" && state.round && state.playerId) saveStudentProgress();
});

async function showResultScreen(resultData) {
  $("resultNickname").textContent = resultData.nickname;
  $("resultTopic").textContent = resultData.topicTitle;
  $("resultClass").textContent = resultData.className;
  $("resultClearTime").textContent = formatMs(resultData.clearMs);
  $("resultWrongCount").textContent = resultData.wrongCount + "회";
  $("resultPenalty").textContent = "+" + formatMs(resultData.penaltyMs);
  $("resultFinalTime").textContent = formatMs(resultData.finalMs);

  renderWrongReview();
  renderConceptAccordion();
  showScreen("result");
  await renderRanking(resultData);
}

async function renderRanking(currentResult) {
  const listEl = $("rankingList");
  const noteEl = $("rankingSourceNote");
  listEl.innerHTML = `<li class="ranking-empty">랭킹을 불러오는 중...</li>`;
  noteEl.textContent = "";

  const { source, items } = await fetchRanking(currentResult.topicId, currentResult.className);

  noteEl.textContent = source === "firebase" ? "실시간 랭킹 (Firebase)" : "오프라인 로컬 랭킹 (이 기기에만 저장됨)";

  if (!items || items.length === 0) {
    listEl.innerHTML = `<li class="ranking-empty">아직 기록이 없습니다. 첫 기록의 주인공이 되어보세요!</li>`;
    return;
  }

  listEl.innerHTML = items
    .map((item, idx) => {
      const isCurrent =
        item.nickname === currentResult.nickname &&
        item.finalMs === currentResult.finalMs &&
        item.wrongCount === currentResult.wrongCount;
      return `<li class="ranking-item${isCurrent ? " current" : ""}">
        <span class="ranking-rank">${idx + 1}</span>
        <span class="ranking-name">${escapeHtml(item.nickname)}</span>
        <span class="ranking-time">${formatMs(item.finalMs)}</span>
      </li>`;
    })
    .join("");
}

function renderConceptAccordion() {
  const wrap = $("conceptAccordion");
  const topic = getTopicById(state.topicId);
  const categories = topic ? topic.categories : [];
  wrap.innerHTML = categories
    .map(
      (cat, idx) => `<div class="accordion-item" data-idx="${idx}">
        <button type="button" class="accordion-head">
          <span>${escapeHtml(cat.name)}</span><span class="chev">▾</span>
        </button>
        <div class="accordion-body">
          <ul class="accordion-body-inner">
            ${cat.cards.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
        </div>
      </div>`
    )
    .join("");

  wrap.querySelectorAll(".accordion-item").forEach((item) => {
    item.querySelector(".accordion-head").addEventListener("click", () => {
      item.classList.toggle("open");
    });
  });
}

/* ================================================================
   21. 결과 화면 버튼
================================================================ */
$("btnRetry").addEventListener("click", async () => {
  await startNewRound();
  showScreen("game");
});

$("btnBackToTopics").addEventListener("click", () => {
  showScreen("start");
});

$("btnResetRanking").addEventListener("click", () => {
  showConfirm("이 기기에 저장된 로컬 랭킹 기록을 모두 삭제할까요? (Firebase에 저장된 기록은 삭제되지 않습니다)", () => {
    resetLocalRanking();
    showFeedback("correct", "로컬 랭킹이 초기화되었습니다.");
    if (state.topicId && state.className) {
      fetchRanking(state.topicId, state.className).then(({ source, items }) => {
        const noteEl = $("rankingSourceNote");
        if (noteEl) noteEl.textContent = source === "firebase" ? "실시간 랭킹 (Firebase)" : "오프라인 로컬 랭킹 (이 기기에만 저장됨)";
        const listEl = $("rankingList");
        if (listEl) {
          listEl.innerHTML =
            items && items.length
              ? items.map((item, idx) => `<li class="ranking-item"><span class="ranking-rank">${idx + 1}</span><span class="ranking-name">${escapeHtml(item.nickname)}</span><span class="ranking-time">${formatMs(item.finalMs)}</span></li>`).join("")
              : `<li class="ranking-empty">아직 기록이 없습니다.</li>`;
        }
      });
    }
  });
});

/* ================================================================
   22. 초기화
================================================================ */
async function init() {
  applyVisualPrefs();
  renderBgBalloons();
  await detectMode();
}

function renderWrongReview() {
  const block = $("wrongReviewBlock");
  const list = $("wrongReviewList");
  const attempts = state.round && Array.isArray(state.round.wrongAttempts) ? state.round.wrongAttempts : [];
  const unique = [];
  const seen = new Set();
  attempts.forEach((item) => {
    const key = `${item.cardText}__${item.selectedCategory}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });
  block.hidden = unique.length === 0;
  list.innerHTML = unique
    .map(
      (item) => `<li class="wrong-review-item">
        <p class="wrong-review-text">${escapeHtml(item.cardText)}</p>
        <p class="wrong-review-answer">선택: ${escapeHtml(item.selectedCategory)} <span>→</span> 정답: <b>${escapeHtml(item.correctCategory)}</b></p>
      </li>`
    )
    .join("");
}

init();
