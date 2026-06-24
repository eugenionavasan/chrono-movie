/* ============================================================
   CHRONO·MOVIE — a movie timeline guessing game
   Movie data is imported from src/data/movies.json
   ============================================================ */

import MOVIES from '../data/movies.json';

// ---------- Config ----------
const TARGET_TIMELINE = 10;   // total movies needed on the axis to win (incl. reference)
const MAX_ATTEMPTS = 20;      // attempts available
const ROUND_SECONDS = 30;     // trailer playback time per round

// Mobile browsers block autoplay WITH sound; only muted video may autoplay.
// On these devices we start muted so the trailer always plays, and the user
// can tap the 🔊 button (a user gesture, which is allowed) to enable sound.
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ||
  (('ontouchstart' in window) && window.matchMedia('(max-width: 900px)').matches);

// ---------- State ----------
let pool = [];        // shuffled movies not yet used
let seen = new Set(); // titles already shown this game — never repeat them
let timeline = [];    // placed movies, kept sorted ascending by year
let current = null;   // movie being guessed this round
let attempts = 0;
let muted = IS_MOBILE;      // start muted on mobile so autoplay is allowed
let userUnmuted = false;    // once the user enables sound, keep it on for the rest
let roundTimer = null;     // interval id for the countdown
let secondsLeft = 0;
let player = null;         // YouTube IFrame player
let ytReady = false;
let pendingVideoId = null; // queued while player API loads

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  start: $('screen-start'),
  countdown: $('screen-countdown'),
  game: $('screen-game'),
  end: $('screen-end'),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ---------- YouTube IFrame API ----------
// The API calls this global when ready.
window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('yt-player', {
    width: '100%',
    height: '100%',
    playerVars: {
      autoplay: 1,
      mute: muted ? 1 : 0, // muted autoplay is required on mobile
      controls: 0,      // hide controls
      disablekb: 1,     // no keyboard
      fs: 0,            // no fullscreen button
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      playsinline: 1,
    },
    events: {
      onReady: () => {
        ytReady = true;
        if (pendingVideoId) {
          loadVideo(pendingVideoId);
          pendingVideoId = null;
        }
      },
      onStateChange: onPlayerStateChange,
    },
  });
};

function injectYouTubeAPI() {
  if (document.getElementById('yt-api')) return;
  const tag = document.createElement('script');
  tag.id = 'yt-api';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

function onPlayerStateChange(e) {
  // Keep the video playing & muted-state in sync; never let it sit paused
  // (a paused YouTube video can reveal the title overlay).
  if (e.data === YT.PlayerState.PAUSED) {
    try { player.playVideo(); } catch (_) {}
  }
}

function extractVideoId(url) {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? m[1] : null;
}

function loadVideo(videoId) {
  if (!ytReady || !player || !player.loadVideoById) {
    pendingVideoId = videoId;
    return;
  }
  // start a little into the clip to skip intros/black frames
  player.loadVideoById({ videoId, startSeconds: 8 });
  if (muted) player.mute(); else player.unMute();
  player.setVolume(60);
  try { player.playVideo(); } catch (_) {}

  // Safety net: if the browser blocked autoplay the player won't be PLAYING
  // shortly after. If the user already enabled sound we respect it and just
  // retry (most mobile browsers allow it after that first gesture); otherwise
  // we fall back to muted playback so the trailer always runs.
  setTimeout(() => {
    try {
      if (player.getPlayerState && player.getPlayerState() !== YT.PlayerState.PLAYING) {
        if (!userUnmuted) {
          muted = true;
          player.mute();
          updateMuteButton();
        }
        player.playVideo();
      }
    } catch (_) {}
  }, 1200);
}

// ---------- Utilities ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Game flow ----------
function startGame() {
  // Reset state
  pool = shuffle(MOVIES);
  seen = new Set();
  timeline = [];
  attempts = 0;
  current = null;
  // Keep sound on if the user already enabled it; otherwise start muted on mobile.
  muted = IS_MOBILE && !userUnmuted;
  updateMuteButton();

  // Reference movie = first of shuffled pool
  const reference = pool.shift();
  seen.add(reference.title);
  timeline.push(reference);

  updateHud();
  renderTimeline();
  $('feedback').textContent = '';

  injectYouTubeAPI();
  runCountdown(() => {
    showScreen('game');
    nextRound();
  });
}

function runCountdown(done) {
  showScreen('countdown');
  const el = $('countdown-number');
  const steps = ['3', '2', '1'];
  let i = 0;

  const tick = () => {
    if (i < steps.length) {
      el.className = 'countdown-number';
      el.innerHTML = `<div class="cd-count">${steps[i]}</div>`;
      i++;
      setTimeout(tick, 1000);
    } else {
      el.innerHTML = `<div class="cd-action">¡ACCIÓN!</div>`;
      setTimeout(done, 1100);
    }
  };
  tick();
}

function nextRound() {
  // Win check
  if (timeline.length >= TARGET_TIMELINE) return endGame(true);
  // Lose check
  if (attempts >= MAX_ATTEMPTS) return endGame(false);
  // Draw the next unseen movie (a title never repeats within a game).
  let next = null;
  while (pool.length > 0) {
    const candidate = pool.shift();
    if (!seen.has(candidate.title)) { next = candidate; break; }
  }
  if (!next) return endGame(timeline.length >= TARGET_TIMELINE);

  current = next;
  seen.add(current.title);
  $('feedback').textContent = '';
  $('feedback').className = 'feedback';

  renderTimeline(); // enable slot buttons
  setSlotsEnabled(true);

  const vid = extractVideoId(current.trailer_url);
  if (vid) loadVideo(vid);

  startTimer();
}

function startTimer() {
  clearInterval(roundTimer);
  secondsLeft = ROUND_SECONDS;
  const fill = $('timer-fill');
  const bar = fill.parentElement;
  const txt = $('timer-text');

  bar.classList.remove('low');
  // reset instantly then animate down
  fill.style.transition = 'none';
  fill.style.transform = 'scaleX(1)';
  // force reflow
  void fill.offsetWidth;
  fill.style.transition = `transform ${ROUND_SECONDS}s linear`;
  fill.style.transform = 'scaleX(0)';
  txt.textContent = secondsLeft;

  roundTimer = setInterval(() => {
    secondsLeft--;
    txt.textContent = Math.max(secondsLeft, 0);
    if (secondsLeft <= 8) bar.classList.add('low');
    if (secondsLeft <= 0) {
      clearInterval(roundTimer);
      handleTimeout();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(roundTimer);
}

// ---------- Placement logic ----------
// A slot index `s` sits between timeline[s-1] and timeline[s].
// It is CORRECT if inserting `current` there keeps the years non-decreasing.
// Ties (==) on either neighbour count as correct, per the rules.
function isSlotCorrect(slotIndex, year) {
  const leftYear = slotIndex > 0 ? timeline[slotIndex - 1].year : -Infinity;
  const rightYear = slotIndex < timeline.length ? timeline[slotIndex].year : Infinity;
  return leftYear <= year && year <= rightYear;
}

function handleSlotClick(slotIndex) {
  if (!current) return;
  stopTimer();
  setSlotsEnabled(false);
  attempts++;

  const correct = isSlotCorrect(slotIndex, current.year);

  if (correct) {
    // Insert in true sorted position (stable for ties).
    let insertAt = timeline.findIndex((m) => m.year > current.year);
    if (insertAt === -1) insertAt = timeline.length;
    const placed = current;
    timeline.splice(insertAt, 0, placed);
    current = null;
    updateHud();
    renderTimeline(insertAt); // highlight the freshly placed card
    showFeedback(true, `✔ ¡Correcto! ${placed.title} — ${placed.year}`);
  } else {
    const missed = current;
    current = null;
    updateHud();
    showFeedback(false, `✗ Fallo. Era ${missed.title} — ${missed.year}`);
    renderTimeline();
  }

  setTimeout(nextRound, 1700);
}

function handleTimeout() {
  setSlotsEnabled(false);
  attempts++;
  const missed = current;
  current = null;
  updateHud();
  showFeedback(false, `⏱ Tiempo agotado. Era ${missed.title} — ${missed.year}`);
  renderTimeline();
  setTimeout(nextRound, 1700);
}

function showFeedback(ok, msg) {
  const f = $('feedback');
  f.textContent = msg;
  f.className = 'feedback ' + (ok ? 'ok' : 'bad');
}

// ---------- Rendering ----------
function updateHud() {
  $('placed-count').textContent = timeline.length;
  $('attempts-count').textContent = attempts;
}

function setSlotsEnabled(enabled) {
  document.querySelectorAll('.slot-btn').forEach((b) => {
    b.disabled = !enabled;
  });
}

function renderTimeline(highlightCardIndex = -1) {
  const tl = $('timeline');
  tl.innerHTML = '';
  const roundActive = !!current;

  // slot, card, slot, card, ... , slot
  for (let i = 0; i <= timeline.length; i++) {
    // insertion slot before card i
    const slot = document.createElement('button');
    slot.className = 'slot-btn';
    slot.innerHTML = '＋';
    slot.title = 'Colocar aquí';
    slot.disabled = !roundActive;
    slot.addEventListener('click', () => handleSlotClick(i));
    tl.appendChild(slot);

    if (i < timeline.length) {
      tl.appendChild(buildCard(timeline[i], i === 0, i === highlightCardIndex));
    }
  }

  if (highlightCardIndex >= 0) {
    // scroll the new card into view
    const cards = tl.querySelectorAll('.card');
    const target = cards[highlightCardIndex];
    if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function buildCard(movie, isReference, justPlaced) {
  const card = document.createElement('div');
  card.className = 'card' + (isReference ? ' reference' : '') + (justPlaced ? ' just-placed' : '');
  card.innerHTML = `
    ${isReference ? '<span class="ref-tag">REFERENCIA</span>' : ''}
    <img class="poster" src="${movie.poster_url}" alt="" loading="lazy"
         onerror="this.style.display='none'">
    <div class="year">${movie.year}</div>
    <div class="title">${movie.title}</div>
  `;
  return card;
}

// ---------- End ----------
function endGame(won) {
  stopTimer();
  current = null;
  try { if (player && player.stopVideo) player.stopVideo(); } catch (_) {}

  const title = $('end-title');
  const sub = $('end-sub');
  if (won) {
    title.textContent = '¡HAS GANADO, CINÉFILO HISTÓRICO!';
    title.className = 'end-title win';
    sub.textContent = `¡Eje cronológico completado con ${timeline.length} películas en ${attempts} intentos!`;
  } else {
    title.textContent = '¡HAS PERDIDO, ¿!PERO TU CUANTAS PELICULAS HAS VISTO EN TU VIDA!?';
    title.className = 'end-title lose';
    sub.textContent = `Colocaste ${timeline.length} de ${TARGET_TIMELINE} películas. ¡Vuelve a intentarlo!`;
  }
  showScreen('end');
}

function goHome() {
  stopTimer();
  current = null;
  try { if (player && player.stopVideo) player.stopVideo(); } catch (_) {}
  showScreen('start');
}

function updateMuteButton() {
  const btn = $('btn-mute');
  btn.textContent = muted ? '🔇' : '🔊';
  btn.title = muted ? 'Toca para activar el sonido' : 'Silenciar';
}

function toggleMute() {
  muted = !muted;
  // Remember the user's intent: once they turn sound on, keep it on for the
  // following trailers; if they deliberately mute, stop forcing sound.
  userUnmuted = !muted;
  updateMuteButton();
  if (player) {
    if (muted) player.mute(); else { player.unMute(); player.setVolume(60); }
  }
}

// ---------- Wire up ----------
updateMuteButton(); // reflect initial muted state (muted on mobile)
$('btn-start').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-home').addEventListener('click', goHome);
$('btn-mute').addEventListener('click', toggleMute);
