'use strict';

import * as Web3 from './web3.js';
import { db } from './firebase.js';
import { doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit, where } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const Game = (() => {

  /* ═══════════════════════════════════════════
     CONFIG
  ═══════════════════════════════════════════ */
  const CFG = {
    gravity:           1100,      // Even more floaty and relaxed
    trailLength:       20,
    trailFadeMs:       120,
    spawnIntervalBase: 1300,      // Slower baseline
    spawnIntervalMin:  850,       // Keep it from getting too crowded
    coinsPerWaveBase:  1,
    coinsPerWaveMax:   3,         // Maximum items at any time
    difficultyStep:    30000,
    bombRatio:         5,         // Bombs appear even less frequently
    maxDiffLevel:      6,
    particleCount:     16,
    coinRadius:        38,
    bombRadius:        34,
    scoreCommon:       1,
    scoreRareMin:      2,
    scoreRareMax:      5,
    rareChance:        0.12,
  };

  const ADMIN_WALLET = '0xd448777940dFaBF65FD259fA8a9903e60E1FF178';

  /* ═══════════════════════════════════════════
     FRIENDS PROFILE DATA
  ═══════════════════════════════════════════ */
  const PROFILE_IMAGES = [
    'aashir.jpg', 'abdul.jpg', 'abhay.jpg', 'abiiix.jpg', 'acolous.jpg', 'akash.jpg', 'alvin.jpg', 
    'amelia.jpg', 'ankit.jpg', 'anya.jpg', 'beamnxw.jpg', 'bigbella.jpg', 'biswa.jpg', 'bitbull.jpg', 
    'blurryface.jpg', 'cantonboy.jpg', 'cipherr.jpg', 'cj.jpg', 'danny.jpg', 'dex.jpg', 'elora.jpg', 
    'finopps.jpg', 'harry.jpg', 'hush.jpg', 'jay.jpg', 'karakot.jpg', 'kingsman.jpg', 'krishna.jpg', 
    'leoo.jpg', 'leviop.jpg', 'licht.jpg', 'luka.jpg', 'malewicz.jpg', 'mayank.jpg', 'nobita.jpg', 
    'numaa.jpg', 'prakash.jpg', 'prashant.jpg', 'prateek.jpg', 'prithboy.jpg', 'prity.jpg', 'rahul.jpg', 
    'reeb.jpg', 'rio.jpg', 'riyaz.jpg', 'rjjax.jpg', 'rosaa.jpg', 'sakuna.jpg', 'shux.jpg', 'siluu.jpg', 'somrat.jpg', 
    'starfish.jpg', 'sukanto.jpg', 'suraj.jpg', 'susmita.jpg', 'timister.jpg', 'toji.jpg', 'trung.jpg', 'virus.jpg', 'yakson.jpg',
    'comrade.jpg', 'fluxio.jpg', '0x_art.jpg', 'hash.jpg', 'maddy.jpg', 'raj.jpg'
  ];

  const FALLBACK_COINS = PROFILE_IMAGES.map(name => ({
    id: name.split('.')[0],
    symbol: name.split('.')[0].toUpperCase().slice(0, 4),
    name: name.split('.')[0],
    color: '#FFD700',
    img: `/friends_profiles/${name}`
  }));

  /* ═══════════════════════════════════════════
     STATE
  ═══════════════════════════════════════════ */
  let canvas, ctx;
  let W, H;
  let rafId;
  let lastTime   = 0;
  let playerName = '';
  let score      = 0;
  let diffLevel  = 1;
  let missedCoins = 0;
  let bombStrikes = 0;
  let timeLeft    = 60;      // Changed from 120s to 60s
  const gameDuration = 60;
  let coinSpawnCounter = 0;   // for bomb ratio
  let spawnInterval;          // current ms between spawns
  let coinsPerWave;
  let nextSpawnTime = 0;
  let diffTimer    = 0;
  let isPlaying    = false;
  let isGameOver   = false;
  let isPaused     = false;
  let hasSubmittedRunScore = false;
  let lastPausedTime = 0;
  let totalPauseTime = 0;
  let isMuted      = false;

  const objects   = [];       // live coins + bombs
  const halves    = [];       // sliced halves
  const particles = [];       // burst particles

  // Swipe trail
  const trail = [];

  // Loaded images cache
  const imgCache = {};
  let coinDefs = [];
  let coinQueue = [];         // Sequential spawning set

  // Shake
  let shakeFrames  = 0;
  let shakeMagnitude = 0;

  // Combo tracking
  let recentSliceTimes = [];   // timestamps of recent coin slices
  let comboBannerTimer = null;

  /* ═══════════════════════════════════════════
     AUDIO (simple Web Audio beeps)
  ═══════════════════════════════════════════ */
  let audioCtx;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
  }
  function playTone(freq, type, duration, gain=0.18) {
    if (isMuted) return;
    ensureAudio(); if(!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      o.start(); o.stop(audioCtx.currentTime + duration);
    } catch(e){}
  }
  function sfxSlice() {
    if (isMuted) return;
    if (weeeAudioEl) {
      const clone = weeeAudioEl.cloneNode();
      clone.volume = 0.5;
      clone.play().catch(e => playTone(880,'sawtooth',0.12,0.12));
    } else {
      playTone(880,'sawtooth',0.12,0.12);
    }
  }
  function sfxScore()  { playTone(1200,'sine',0.08,0.1); }
  function sfxMiss()   {}

  // Sounds
  let bombAudioEl = null;
  let weeeAudioEl = null;

  function initAudio() {
    ensureAudio();
    // Use import.meta.url so Vite resolves the correct asset URL in both dev and prod
    try {
      bombAudioEl = new Audio('/fahhh.mp3');
      bombAudioEl.volume = 1.0;

      weeeAudioEl = new Audio('/weee.mp3');
      weeeAudioEl.volume = 0.5;
    } catch(e) {
      console.warn("Audio load error:", e);
    }
  }

  function sfxBomb() {
    if (isMuted) return;
    if (bombAudioEl) {
      const clone = bombAudioEl.cloneNode();
      clone.volume = 1.0;
      clone.play().catch(e => synthFahhhh());
    } else {
      synthFahhhh();
    }
  }

  function synthFahhhh() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // Low rumble
      const rumble = audioCtx.createOscillator();
      const rumbleGain = audioCtx.createGain();
      rumble.type = 'sawtooth';
      rumble.frequency.setValueAtTime(200, audioCtx.currentTime);
      rumble.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.6);
      rumbleGain.gain.setValueAtTime(0.6, audioCtx.currentTime);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.65);
      rumble.connect(rumbleGain); rumbleGain.connect(audioCtx.destination);
      rumble.start(); rumble.stop(audioCtx.currentTime + 0.65);
      // Voiced "Fahhhh"
      const bufSize = audioCtx.sampleRate * 0.7;
      const buf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, audioCtx.currentTime);
      bp.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.55);
      bp.Q.value = 4;
      const nGain = audioCtx.createGain();
      nGain.gain.setValueAtTime(0.8, audioCtx.currentTime);
      nGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
      noise.connect(bp); bp.connect(nGain); nGain.connect(audioCtx.destination);
      noise.start(); noise.stop(audioCtx.currentTime + 0.7);
    } catch(e){}
  }

  // COMBO sounds
  function sfxCombo2() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // "Com-bo!" two-note ding
      [660, 990].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, audioCtx.currentTime + i*0.12);
        g.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + i*0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i*0.12 + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i*0.12);
        o.stop(audioCtx.currentTime + i*0.12 + 0.25);
      });
    } catch(e){}
  }

  function sfxCombo3() {
    if (isMuted) return;
    ensureAudio(); if (!audioCtx) return;
    try {
      // "Triple!" rising three-note fanfare
      [523, 659, 1047].forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0, audioCtx.currentTime + i*0.1);
        g.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + i*0.1 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i*0.1 + 0.28);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i*0.1);
        o.stop(audioCtx.currentTime + i*0.1 + 0.32);
      });
    } catch(e){}
  }

  /* ═══════════════════════════════════════════
     ASSET LOADER
  ═══════════════════════════════════════════ */
  function loadImages(coins) {
    return Promise.all(coins.map(coin => new Promise(resolve => {
      if (imgCache[coin.id]) { resolve(); return; }
      const img = new Image();
      // img.crossOrigin = 'anonymous'; // Removed for local assets to prevent load failures
      img.onload  = () => { imgCache[coin.id] = img; resolve(); };
      img.onerror = () => { 
        console.error("Failed to load image:", coin.img);
        imgCache[coin.id] = null; 
        resolve(); 
      };
      img.src = coin.img;
    })));
  }

  async function fetchCoinData() {
    return FALLBACK_COINS;
  }

  /* ═══════════════════════════════════════════
     SCREEN MANAGER
  ═══════════════════════════════════════════ */
  function showScreen(id) {
    // 1. Mark all NOT active
    const screens = document.querySelectorAll('.screen');
    screens.forEach(s => {
      s.classList.remove('active');
    });
    
    // 2. Mark target active
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
    }
  }

  function showToast(msg, icon = '💡') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <span>${msg}</span>`;
    
    container.appendChild(toast);
    
    // Remove after animation (3s total per CSS)
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) container.remove();
    }, 3200);
  }

  /* ═══════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════ */
  async function init() {
    canvas = document.getElementById('gameCanvas');
    ctx    = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    initAudio();
    tryAutoBindFromURL(); // Check for ?ref= URL param

    drawLoadingScreen();

    // Load assets
    coinDefs = await fetchCoinData();
    await loadImages(coinDefs);

    // Input
    canvas.addEventListener('mousemove',  onMouseMove, { passive: false });
    canvas.addEventListener('mousedown',  onPointerDown, { passive: false });
    canvas.addEventListener('mouseup',    onPointerUp, { passive: false });
    canvas.addEventListener('mouseleave', onPointerUp, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchend',   onPointerUp, { passive: false });

    showScreen('screen-home');
    
    // Auto-Connect previously approved wallets
    Web3.autoConnectWallet().then(addr => {
      if (addr) updatePlayButtonState();
    });
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function drawLoadingScreen() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Let CSS background show
    ctx.fillStyle = '#2D1060';
    ctx.font = 'bold 20px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Loading meme coins... 🚀', (canvas.width||320)/2, (canvas.height||600)/2);
  }

  /* ═══════════════════════════════════════════
     GAME FLOW
  ═══════════════════════════════════════════ */
  function startGame() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;

    const profile = getProfileData(addr);
    if (!profile.name || profile.name.trim() === '') {
      showToast("Please set username to start the game", "👤");
      showProfile();
      return;
    }
    playerName = profile.name;

    window.scrollTo(0, 0);

    ensureAudio();
    resetGameState();
    showScreen('screen-hud');
    isPlaying = true;
    lastTime  = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  }

  async function handleWalletAction() {
    const btn = document.getElementById('btn-connect');
    
    if (Web3.getConnectedAddress()) {
      await Web3.disconnectWallet();
      updatePlayButtonState();
      return;
    }

    // Open modal — don't block the button; let watchAccount handle state update
    try {
      Web3.connectWallet().then(() => {
        updatePlayButtonState();
      }).catch((err) => {
        console.error('Wallet connection error:', err);
        updatePlayButtonState();
      });
    } catch (err) {
      console.error('Wallet action error:', err);
      updatePlayButtonState();
    }
  }

  let lastSyncedAddress = null;
  async function syncFromCloud(addr) {
    if (!addr) return;
    try {
      const snap = await getDoc(doc(db, 'users', addr.toLowerCase()));
      if (snap.exists()) {
        const data = snap.data();
        if (data.profile) localStorage.setItem(`meme_smash_profile_${addr.toLowerCase()}`, JSON.stringify(data.profile));
        if (data.refData) localStorage.setItem(`meme_smash_ref_${addr.toLowerCase()}`, JSON.stringify(data.refData));
        if (data.binding) localStorage.setItem(`meme_smash_binding_${addr.toLowerCase()}`, JSON.stringify(data.binding));
        if (data.fees) localStorage.setItem(`meme_smash_fees_${addr.toLowerCase()}`, JSON.stringify(data.fees));
        if (data.checkin) localStorage.setItem(`meme_smash_checkin_${addr.toLowerCase()}`, JSON.stringify(data.checkin));
      }
    } catch(e) {
      console.warn("Cloud sync error:", e);
    }
  }

  function syncToCloud(addr) {
    if (!addr) return;
    try {
      const profileInfo = JSON.parse(localStorage.getItem(`meme_smash_profile_${addr.toLowerCase()}`) || 'null');
      const refDataInfo = JSON.parse(localStorage.getItem(`meme_smash_ref_${addr.toLowerCase()}`) || 'null');
      const bindingInfo = JSON.parse(localStorage.getItem(`meme_smash_binding_${addr.toLowerCase()}`) || 'null');
      const feesInfo = JSON.parse(localStorage.getItem(`meme_smash_fees_${addr.toLowerCase()}`) || 'null');
      const checkinInfo = JSON.parse(localStorage.getItem(`meme_smash_checkin_${addr.toLowerCase()}`) || 'null');
      
      const payload = {};
      if (profileInfo) payload.profile = profileInfo;
      if (refDataInfo) payload.refData = refDataInfo;
      if (bindingInfo) payload.binding = bindingInfo;
      if (feesInfo) payload.fees = feesInfo;
      if (checkinInfo) payload.checkin = checkinInfo;

      setDoc(doc(db, 'users', addr.toLowerCase()), payload, { merge: true }).catch(e=>console.warn("Cloud write err:", e));
    } catch(e){}
  }

  function updatePlayButtonState() {
    const address = Web3.getConnectedAddress();
    const isConnected = !!address;
    const btnStart = document.getElementById('btn-start');
    const btnConnect = document.getElementById('btn-connect');
    const btnProfile = document.getElementById('btn-profile');
    const addrEl = document.getElementById('user-address');

    if (isConnected) {
      // Sync on first connection
      if (address !== lastSyncedAddress) {
        lastSyncedAddress = address;
        syncFromCloud(address).then(() => {
          refreshProfileUI(address);
        });
      }

      btnStart.disabled = false;
      btnStart.style.opacity = '1';
      btnStart.style.filter = 'none';
      btnStart.textContent = 'Play Now';
      
      btnProfile.disabled = false;
      btnProfile.style.opacity = '1';
      btnProfile.style.filter = 'none';

      btnConnect.textContent = 'Disconnect';
      addrEl.textContent = `${address.slice(0,6)}...${address.slice(-4)}`;
      addrEl.style.display = 'block';
    } else {
      btnStart.disabled = true;
      btnStart.style.opacity = '0.5';
      btnStart.style.filter = 'grayscale(1)';
      btnStart.textContent = 'Play Now (Connect Wallet First)';

      btnProfile.disabled = true;
      btnProfile.style.opacity = '0.5';
      btnProfile.style.filter = 'grayscale(1)';
      
      btnConnect.textContent = 'Connect Wallet';
      addrEl.style.display = 'none';
    }
    // Admin pill visibility
    const adminPill = document.getElementById('btn-admin-pill');
    if (adminPill) adminPill.style.display = isAdminWallet(address) ? 'inline-flex' : 'none';
    // Auto-apply pending referral once per session
    if (address) checkAndApplyPendingRef(address);

    // Task button visibility
    const taskBtn = document.getElementById('btn-tasks');
    if (taskBtn) taskBtn.style.display = isConnected ? 'block' : 'none';
  }

  /* ═══════════════════════════════════════════
     PROFILE & LOCAL DATA
  ═══════════════════════════════════════════ */
  function getProfileData(address) {
    const fresh = { 
      name: '', 
      cumulativeScore: 0, 
      altAddresses: [],
      taskStats: {
        dailyPlays: 0,
        dailyRevives: 0,
        lastResetDay: 0,
        claims: {}
      },
      socials: { twitter: '', telegram: '' }
    };
    if (!address) return fresh;
    const key = `meme_smash_profile_${address.toLowerCase()}`;
    const data = localStorage.getItem(key);
    if (!data) return fresh;

    try {
      const parsed = JSON.parse(data);
      return {
        ...fresh,
        ...parsed,
        taskStats: { ...fresh.taskStats, ...(parsed.taskStats || {}) }
      };
    } catch(e) {
      console.warn("Error parsing profile data:", e);
      return fresh;
    }
  }

  function saveProfileData(address, data) {
    if (!address) return;
    const key = `meme_smash_profile_${address.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(data));
    syncToCloud(address);
  }

  function refreshProfileUI(address) {
    const profile = getProfileData(address);
    const addrEl = document.getElementById('profile-connected-address');
    
    if (address && address.length >= 42) {
      addrEl.textContent = `${address.slice(0, 10)}...${address.slice(-8)}`;
      addrEl.dataset.full = address;
      document.getElementById('btn-copy-primary').style.display = 'block';
    } else {
      addrEl.textContent = 'Not Connected';
      addrEl.dataset.full = '';
      document.getElementById('btn-copy-primary').style.display = 'none';
    }
    
    document.getElementById('profile-cumulative-score').textContent = profile.cumulativeScore;
    document.getElementById('playerName').value = profile.name;
    document.getElementById('hud-career-score').textContent = profile.cumulativeScore;
    
    // Socials
    if (document.getElementById('profile-twitter')) {
      document.getElementById('profile-twitter').value = profile.socials?.twitter || '';
    }
    if (document.getElementById('profile-telegram')) {
      document.getElementById('profile-telegram').value = profile.socials?.telegram || '';
    }
    
    const list = document.getElementById('saved-addresses-list');
    list.innerHTML = '';
    
    if (profile.altAddresses.length === 0) {
      list.innerHTML = '<div style="font-size:12px; color:rgba(255,255,255,0.5);">No secondary addresses saved yet.</div>';
    } else {
      profile.altAddresses.forEach((alt, i) => {
        const item = document.createElement('div');
        item.className = 'alt-wallet-card';
        item.innerHTML = `
          <div class="alt-wallet-info">
            <span class="alt-wallet-desc">${alt.desc}</span>
            <span class="alt-wallet-addr">${alt.address.slice(0,10)}...${alt.address.slice(-8)}</span>
          </div>
          <div style="display:flex; gap: 5px;">
            <button class="alt-wallet-copy-btn" onclick="Game.copyAddress('${alt.address}', this)">Copy</button>
            <button class="alt-wallet-del-btn" onclick="Game.removeAlternativeAddress(${i})">✕</button>
          </div>
        `;
        list.appendChild(item);
      });
    }
  }

  function showProfile() {
    refreshProfileUI(Web3.getConnectedAddress());
    showScreen('screen-profile');

    // Auto-focus name field for new users
    setTimeout(() => {
      const input = document.getElementById('playerName');
      if (input) {
        input.focus();
        input.select();
      }
    }, 300);
  }

  function saveProfileName() {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    const profile = getProfileData(address);
    profile.name = document.getElementById('playerName').value.trim();
    saveProfileData(address, profile);
    alert('Ninja Name Saved!');
  }

  function addAlternativeAddress() {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    const altAddr = document.getElementById('alt-address-input').value.trim();
    const altDesc = document.getElementById('alt-desc-input').value.trim() || 'Additional';
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(altAddr)) {
      alert("Invalid EVM Address");
      return;
    }

    const profile = getProfileData(address);
    profile.altAddresses.push({ address: altAddr, desc: altDesc });
    saveProfileData(address, profile);
    refreshProfileUI(address);
    document.getElementById('alt-address-input').value = '';
    document.getElementById('alt-desc-input').value = '';
  }

  function removeAlternativeAddress(index) {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    if (!confirm("Are you sure you want to remove this address?")) return;
    const profile = getProfileData(address);
    profile.altAddresses.splice(index, 1);
    saveProfileData(address, profile);
    refreshProfileUI(address);
  }

  function saveSocials() {
    const address = Web3.getConnectedAddress();
    if (!address) return;
    const profile = getProfileData(address);
    if (!profile.socials) profile.socials = { twitter: '', telegram: '' };
    profile.socials.twitter = document.getElementById('profile-twitter').value.trim();
    profile.socials.telegram = document.getElementById('profile-telegram').value.trim();
    saveProfileData(address, profile);
    showToast('Social connections updated!');
  }

  function _getSocialUrl(platform, handle) {
    const clean = handle.startsWith('@') ? handle.slice(1) : handle;
    if (platform === 'twitter') return `https://twitter.com/${clean}`;
    if (platform === 'telegram') return `https://t.me/${clean}`;
    return handle;
  }

  function copySocialExternal(platform, type) {
    const handle = platform === 'twitter' ? window._activeSocials?.twitter : window._activeSocials?.telegram;
    if (!handle) return;
    const textToCopy = type === 'uid' ? handle : _getSocialUrl(platform, handle);
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('Copied to clipboard!');
    });
  }

  function copyAddress(addr, btnEl) {
    navigator.clipboard.writeText(addr).then(() => {
      const old = btnEl.textContent;
      btnEl.textContent = 'Copied!';
      btnEl.style.background = '#4CAF50';
      setTimeout(() => {
        btnEl.textContent = old;
        btnEl.style.background = '';
      }, 1500);
    }).catch(e => console.error(e));
  }

  async function reviveMenu() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }

    const btn = document.getElementById('btn-revive');
    const originalText = btn.textContent;
    try {
      // Direct trigger for mobile compatibility (avoids popup blockage)
      btn.disabled = true;
      btn.textContent = 'Opening Wallet...';
      
      await Web3.payToRevive();
      
      // Track fee for referral system
      const feeAddr = Web3.getConnectedAddress();
      if (feeAddr) {
        recordFeePayment(feeAddr, 'revive', 0.05);
        recordTaskAction('revive');
      }
      
      btn.textContent = 'Success!';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
        resetForRevive();
        showScreen('screen-hud');
        isPlaying = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(gameLoop);
      }, 1000);
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = e.message.includes('User rejected') ? 'Cancelled' : 'Payment Failed';
      setTimeout(() => btn.textContent = originalText, 2500);
    }
  }

  function resetForRevive() {
    // Keep score and level, but clear objects and reset health
    objects.length = 0;
    missedCoins = 0;
    bombStrikes = 0;
    
    // If times was up, reset it. If bombs were up, keep the same time.
    if (timeLeft <= 0) {
      timeLeft = gameDuration;
    }
    
    isPlaying = true;
    isGameOver = false;
    updateHUD();
  }

  async function submitScoreMenu() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }

    const btn = document.getElementById('btn-submit-score');
    const origText = btn.textContent;
    try {
      btn.disabled = true;
      btn.textContent = 'Waiting for Wallet...';
      
      await Web3.payToSubmitScore();
      btn.textContent = 'Score Submitted!';
      
      recordTaskAction('play');

      hasSubmittedRunScore = true;
      
      // Add to Career Score
      const addr = Web3.getConnectedAddress();
      if (addr) {
        const profile = getProfileData(addr);
        profile.cumulativeScore += score;
        saveProfileData(addr, profile);
        refreshProfileUI(addr);
        recordFeePayment(addr, 'submit', 0.01); // Track for referral system
      }

      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = origText;
        showLeaderboard();
      }, 1500);

    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = e.message.includes('User rejected') ? 'Cancelled' : 'Submit Failed';
      setTimeout(() => btn.textContent = origText, 2500);
    }
  }

  function restartGame() {
    if (playerName && playerName !== '') {
      resetGameState();
      showScreen('screen-hud');
      isPlaying = true;
      lastTime  = performance.now();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(gameLoop);
    } else {
      goHome();
    }
  }

  function resetGameState() {
    objects.length    = 0;
    halves.length     = 0;
    particles.length  = 0;
    trail.length      = 0;
    recentSliceTimes  = [];
    score             = 0;
    diffLevel         = 1;
    missedCoins       = 0;
    bombStrikes       = 0;
    coinSpawnCounter  = 0;
    spawnInterval     = CFG.spawnIntervalBase;
    coinsPerWave      = CFG.coinsPerWaveBase;
    timeLeft          = gameDuration;
    nextSpawnTime     = 0;
    diffTimer         = 0;
    diffLevel         = 1;
    isGameOver        = false;
    hasSubmittedRunScore = false;
    shakeFrames       = 0;

    // Reset spawning queue
    coinQueue = [];

    // Ensure revive button is visible for the next game
    const rb = document.getElementById('btn-revive');
    if (rb) rb.style.display = 'block';

    updateHUD();
  }

  function gameOver(isTimeout = false) {
    isPlaying  = false;
    isGameOver = true;
    cancelAnimationFrame(rafId);
    
    // Hide revive button if game ended due to timeout
    const rb = document.getElementById('btn-revive');
    if (rb) rb.style.display = isTimeout ? 'none' : 'block';

    if (!isTimeout) {
      sfxBomb();
      triggerBombFlash();
      triggerShake(18, 22);
    }
    
    const addr = Web3.getConnectedAddress();
    if (addr) {
      const profile = getProfileData(addr);
      if (score > (profile.topScore || 0)) {
        profile.topScore = score;
        saveProfileData(addr, profile);
      }
    }

    setTimeout(() => {
      document.getElementById('gameover-name').textContent = playerName;
      document.getElementById('final-score').textContent   = score;
      showScreen('screen-gameover');
    }, 900);
  }

  function showLeaderboard() {
    renderLeaderboard();
    showScreen('screen-leaderboard');
  }

  function goHome() {
    if ((isPlaying || isGameOver) && score > 0 && !hasSubmittedRunScore) {
      showScreen('modal-leave-confirm');
      return;
    }
    confirmLeave();
  }

  function confirmLeave() {
    if (rafId) cancelAnimationFrame(rafId);
    isPlaying = false;
    isGameOver = false;
    isPaused = false;
    objects.length = 0; halves.length = 0; particles.length = 0; trail.length = 0;
    showScreen('screen-home');
  }

  function cancelLeave() {
    if (isGameOver) {
      showScreen('screen-gameover');
    } else if (isPaused) {
      showScreen('screen-settings');
    } else {
      showScreen('screen-hud');
    }
  }

  function leaveAndSubmit() {
    showScreen(isGameOver ? 'screen-gameover' : 'screen-hud');
    submitScoreMenu();
  }

  function toggleSettings() {
    if (!isPlaying || isGameOver) return;
    if (!isPaused) {
      isPaused = true;
      lastPausedTime = performance.now();
      showScreen('screen-settings');
    }
  }

  function resumeGame() {
    if (isPaused) {
      totalPauseTime += (performance.now() - lastPausedTime);
      isPaused = false;
      showScreen('screen-hud');
    }
  }

  function toggleMute() {
    isMuted = !isMuted;
    const txt = document.getElementById('text-mute-state');
    const icon = document.getElementById('icon-mute-state');
    if (isMuted) {
      txt.textContent = 'Unmute Sound';
      icon.innerHTML = '<use href="#ico-vol-off" />';
    } else {
      txt.textContent = 'Mute Sound';
      icon.innerHTML = '<use href="#ico-vol-on" />';
    }
  }

  function goHomeFromPause() {
    goHome();
  }

  /* ═══════════════════════════════════════════
     GAME LOOP
  ═══════════════════════════════════════════ */
  function gameLoop(now) {
    if (isPaused) {
      render(now);
      if (isPlaying) rafId = requestAnimationFrame(gameLoop);
      return;
    }

    const gameNow = now - totalPauseTime;
    const dt = Math.min((gameNow - lastTime) / 1000, 0.05);
    lastTime = gameNow;

    update(dt, gameNow);
    render(now);

    if (isPlaying) rafId = requestAnimationFrame(gameLoop);
  }

  /* ═══════════════════════════════════════════
     UPDATE
  ═══════════════════════════════════════════ */
  function update(dt, now) {
    // Game Timer
    if (isPlaying && !isPaused) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        updateHUD();
        gameOver(true);
        return;
      }
    }

    // Difficulty progression based on timer
    const elapsed = gameDuration - timeLeft;
    const progress = Math.min(elapsed / gameDuration, 1);
    
    // Scale difficulty levels (1 to 6) optimized for a 60-second session
    const newLevel = 1 + Math.floor(progress * 5);
    if (newLevel > diffLevel) {
      diffLevel = newLevel;
      // Faster but smoother scaling for 60s intensity
      spawnInterval = Math.max(CFG.spawnIntervalMin, CFG.spawnIntervalBase * (1 - progress * 0.3));
      coinsPerWave  = Math.min(CFG.coinsPerWaveMax, CFG.coinsPerWaveBase + Math.floor(progress * 2));
      document.getElementById('hud-level').textContent = diffLevel;
    }

    // Spawn
    if (now >= nextSpawnTime) {
      nextSpawnTime = now + spawnInterval + (Math.random() - 0.5) * spawnInterval * 0.4;
      spawnWave();
    }

    // Physics: objects
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      o.vy += CFG.gravity * dt;
      o.x  += o.vx * dt;
      o.y  += o.vy * dt;
      o.angle += o.spin * dt;

      // Wall Bouncing: Ensure items stay within the visible frame (4-Way Bouncing)
      
      // Left/Right
      if (o.x < o.radius) {
        o.x = o.radius;
        o.vx = Math.abs(o.vx) * 0.85; // slightly higher bounce for more life
      } else if (o.x > W - o.radius) {
        o.x = W - o.radius;
        o.vx = -Math.abs(o.vx) * 0.85;
      }

      // Top/Bottom (Full Frame Containment)
      if (o.y < o.radius) {
        o.y = o.radius;
        o.vy = Math.abs(o.vy) * 0.8; // bounce down
      } else if (o.y > H - o.radius) {
        // Instead of falling off, items now bounce back up!
        o.y = H - o.radius;
        o.vy = -Math.abs(o.vy) * 0.85; 
        
        // Slightly nudge VX to keep it dynamic
        o.vx += (Math.random() - 0.5) * 60;
      }


      // Age-based removal to prevent overcrowding since they never "fall off"
      // Reduced from 15s to 5s at user request
      o.age = (o.age || 0) + dt;
      if (o.age > 5) {
        objects.splice(i, 1);
      }
    }



    // Halves physics
    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.vy += CFG.gravity * 1.2 * dt;
      h.x  += h.vx * dt;
      h.y  += h.vy * dt;
      h.angle += h.spin * dt;
      h.life  -= dt;
      if (h.life <= 0 || h.y > H + 120) halves.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 600 * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Shake decay
    if (shakeFrames > 0) shakeFrames--;

    // Slice detection
    if (trail.length >= 2) {
      checkSlices(now);
    }
  }

  /* ═══════════════════════════════════════════
     SPAWN
  ═══════════════════════════════════════════ */
  function spawnWave() {
    const count = coinsPerWave + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      // Stagger spawns slightly
      setTimeout(() => {
        if (!isPlaying) return;
        coinSpawnCounter++;
        const spawnBomb = (coinSpawnCounter % CFG.bombRatio === 0) && Math.random() < 0.75;
        if (spawnBomb) spawnObject('bomb');
        else           spawnObject('coin');
      }, i * (180 + Math.random() * 200));
    }
  }

  function spawnObject(type) {
    const radius  = type === 'bomb' ? CFG.bombRadius : CFG.coinRadius;
    const x       = radius + Math.random() * (W - radius * 2);
    const y       = H + radius;
    // Extremely subtle speed increase for consistent "fun" feel
    const speed   = (900 + Math.random() * 400) * (1 + (diffLevel - 1) * 0.04);
    const angle   = -Math.PI / 2 + (Math.random() - 0.5) * 0.45; // reduced spread to keep items closer to center
    const vx      = Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1) * 0.15;
    const vy      = -speed;
    const spin    = (Math.random() - 0.5) * 4;

    if (type === 'bomb') {
      objects.push({ type:'bomb', x, y, vx, vy, angle:0, spin, radius, sliced:false });
    } else {
      // Manage sequential queue to avoid duplicates and ensure all profiles are shown
      if (coinQueue.length === 0 && coinDefs.length > 0) {
        coinQueue = [...coinDefs];
        shuffleArray(coinQueue);
      }
      
      const coin = coinQueue.length > 0 ? coinQueue.pop() : coinDefs[0];
      const isRare = Math.random() < CFG.rareChance;
      const pts    = isRare
        ? CFG.scoreRareMin + Math.floor(Math.random() * (CFG.scoreRareMax - CFG.scoreRareMin + 1))
        : CFG.scoreCommon;
      objects.push({ type:'coin', x, y, vx, vy, angle:0, spin, radius, coin, pts, isRare, sliced:false });
    }
  }

  /* ═══════════════════════════════════════════
     SLICE DETECTION
  ═══════════════════════════════════════════ */
  function checkSlices(now) {
    const recent = trail.filter(p => now - p.t < CFG.trailFadeMs * 1.5);
    if (recent.length < 2) return;

    for (let oi = objects.length - 1; oi >= 0; oi--) {
      const o = objects[oi];
      if (o.sliced) continue;

      for (let ti = 0; ti < recent.length - 1; ti++) {
        const a = recent[ti], b = recent[ti + 1];
        if (segmentCircleIntersects(a.x, a.y, b.x, b.y, o.x, o.y, o.radius * 0.85)) {
          o.sliced = true;
          objects.splice(oi, 1);
          handleSlice(o);
          break;
        }
      }
    }
  }

  function segmentCircleIntersects(ax, ay, bx, by, cx, cy, r) {
    const dx = bx - ax, dy = by - ay;
    const fx = ax - cx, fy = ay - cy;
    const a_ = dx*dx + dy*dy;
    if (a_ === 0) return Math.hypot(fx,fy) <= r;
    const b_ = 2*(fx*dx + fy*dy);
    const c_ = fx*fx + fy*fy - r*r;
    let disc  = b_*b_ - 4*a_*c_;
    if (disc < 0) return false;
    disc = Math.sqrt(disc);
    const t0 = (-b_ - disc) / (2*a_);
    const t1 = (-b_ + disc) / (2*a_);
    return (t0 >= 0 && t0 <= 1) || (t1 >= 0 && t1 <= 1) || (t0 < 0 && t1 > 1);
  }

  function handleSlice(o) {
    if (o.type === 'bomb') {
      sfxBomb();
      triggerBombFlash();
      triggerShake(15, 12);
      bombStrikes++;
      updateHUD();
      if (bombStrikes >= 3) {
        gameOver(false);
      }
      return;
    }
    // Coin sliced!
    o.sliced = true;
    score += o.pts;
    updateHUD();
    sfxSlice();
    if (o.pts > 1) sfxScore();
    spawnParticles(o.x, o.y, o.coin.color, CFG.particleCount);
    spawnHalves(o);
    showFloatingScore(o.x, o.y, o.pts);
    checkCombo();
  }

  function checkCombo() {
    const now = performance.now();
    recentSliceTimes.push(now);
    // Keep only slices within 600ms window
    recentSliceTimes = recentSliceTimes.filter(t => now - t < 600);
    const count = recentSliceTimes.length;
    if (count === 2) {
      sfxCombo2();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-fire"/></svg>COMBO!', '#FF3DAE');
    } else if (count === 3) {
      sfxCombo3();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-star"/></svg>TRIPLE SLICE!', '#FFD700');
    } else if (count >= 4) {
      sfxCombo3();
      showComboBanner('<svg class="combo-icon-svg" viewBox="0 0 48 48"><use href="#ico-rocket"/></svg>UNSTOPPABLE!', '#7FE82A');
    }
  }

  function showComboBanner(htmlContent, color) {
    const el = document.getElementById('combo-banner');
    el.innerHTML = htmlContent;
    el.style.background = '';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (comboBannerTimer) clearTimeout(comboBannerTimer);
    comboBannerTimer = setTimeout(() => {
      el.classList.remove('show');
    }, 900);
  }

  /* ═══════════════════════════════════════════
     HALVES
  ═══════════════════════════════════════════ */
  function spawnHalves(o) {
    const speed = 220 + Math.random() * 140;
    for (let side = 0; side < 2; side++) {
      const dir  = side === 0 ? -1 : 1;
      halves.push({
        x: o.x, y: o.y,
        vx: dir * (speed + Math.random()*80),
        vy: -(80 + Math.random()*120),
        angle: o.angle,
        spin: dir * (3 + Math.random()*3),
        radius: o.radius,
        life: 0.8,
        side,
        coin: o.coin,
        isRare: o.isRare,
      });
    }
  }

  /* ═══════════════════════════════════════════
     PARTICLES
  ═══════════════════════════════════════════ */
  function spawnParticles(x, y, color, count, extraColors) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 350;
      const colors = extraColors || [color, '#FFD700', '#fff'];
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 100,
        life: 0.4 + Math.random() * 0.35,
        maxLife: 0.75,
        size: 3 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  /* ═══════════════════════════════════════════
     FLOATING SCORE TEXT
  ═══════════════════════════════════════════ */
  const floatingTexts = [];
  function showFloatingScore(x, y, pts) {
    floatingTexts.push({ x, y, pts, life:1.0 });
  }

  /* ═══════════════════════════════════════════
     EFFECTS
  ═══════════════════════════════════════════ */
  function triggerShake(frames, mag) {
    shakeFrames    = frames;
    shakeMagnitude = mag;
  }
  function triggerBombFlash() {
    const el = document.getElementById('bomb-flash');
    el.classList.add('active');
    setTimeout(() => el.classList.remove('active'), 400);
  }

  /* ═══════════════════════════════════════════
     HUD
  ═══════════════════════════════════════════ */
  function updateHUD() {
    document.getElementById('hud-score').textContent = score;
    document.getElementById('hud-level').textContent = diffLevel;
    // document.getElementById('hud-missed').textContent = `${missedCoins}/50`; // Hidden
    
    // Timer display
    const mins = Math.floor(timeLeft / 60);
    const secs = Math.floor(timeLeft % 60);
    document.getElementById('hud-timer').textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const strikesContainer = document.getElementById('bomb-strikes');
    strikesContainer.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const x = document.createElement('div');
      x.className = 'strike-slot ' + (i < bombStrikes ? 'strike-active' : 'strike-inactive');
      if (i < bombStrikes) {
        x.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><use href="#ico-x"/></svg>';
      } else {
        x.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><use href="#ico-circle"/></svg>';
      }
      strikesContainer.appendChild(x);
    }
  }

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  function render(now) {
    ctx.save();

    // Screen shake
    if (shakeFrames > 0) {
      const sx = (Math.random() - 0.5) * shakeMagnitude;
      const sy = (Math.random() - 0.5) * shakeMagnitude;
      ctx.translate(sx, sy);
    }

    // Bright Sky gradient (No Green)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   '#38bdf8');   // deep sky
    bg.addColorStop(0.45,'#7dd3fc');   // light sky
    bg.addColorStop(0.75,'#bae6fd');   // lighter sky
    bg.addColorStop(1,   '#e0f2fe');   // very light horizon
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Dynamic, slow-moving fluffy clouds and sparkles
    drawClouds(now);

    // Objects
    for (const o of objects) drawObject(o, now);

    // Halves
    for (const h of halves) drawHalf(h, now);

    // Particles
    for (const p of particles) drawParticle(p);

    // Floating scores
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.life -= 0.025;
      ft.y    -= 1.5;
      if (ft.life <= 0) { floatingTexts.splice(i,1); continue; }
      ctx.globalAlpha = ft.life;
      ctx.font = `bold ${20 + ft.pts * 3}px Orbitron, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = ft.pts > 1 ? '#FFD700' : '#fff';
      ctx.shadowBlur = 12;
      ctx.shadowColor = ft.pts > 1 ? '#FFD700' : '#00F7FF';
      ctx.fillText(`+${ft.pts}`, ft.x, ft.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Slice trail
    drawTrail(now);

    ctx.restore();
  }

  /* Dynamic continuous clouds */
  function drawClouds(now) {
    const t = now * 0.00004;

    // Background Layer Clouds
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 0.25 + t * 1.5) % 1.5) - 0.25;
      const cy = Math.sin(i * 3) * 0.15 + 0.15;
      const r = 90 + Math.sin(i*2)*20;
      drawCloudBlob(cx * W, cy * H, r);
    }
    
    // Mid Layer Clouds (Puffier, faster)
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 0.3 + t * 2.8) % 1.5) - 0.25;
      const cy = Math.sin(i * 5) * 0.1 + 0.08;
      const r = 70 + Math.sin(i*7)*15;
      drawCloudBlob(cx * W, cy * H, r);
    }

    // Foreground Accent Clouds (Slightly larger, dynamic drifting)
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 0.4 + t * 4.2) % 1.5) - 0.25;
      const cy = Math.sin(i * 11) * 0.05 + 0.05;
      const r = 85 + Math.sin(i*3)*10;
      drawCloudBlob(cx * W, cy * H, r);
    }
    
    ctx.globalAlpha = 1;
  }
  
  function drawCloudBlob(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.arc(x + r*0.6, y + r*0.15, r*0.75, 0, Math.PI*2);
    ctx.arc(x - r*0.55, y + r*0.12, r*0.65, 0, Math.PI*2);
    ctx.arc(x + r*0.3, y - r*0.4, r*0.6, 0, Math.PI*2);
    ctx.fill();
  }

  /* Draw coin or bomb */
  function drawObject(o, now) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);

    if (o.type === 'bomb') {
      drawBomb(o);
    } else {
      drawCoin(o, now);
    }
    ctx.restore();
  }

  function drawCoin(o, now) {
    const r = o.radius;
    // Rare glow
    if (o.isRare) {
      ctx.shadowBlur  = 24;
      ctx.shadowColor = '#FFD700';
    }

    // Outer ring
    const ringGrad = ctx.createRadialGradient(0, 0, r*0.6, 0, 0, r+5);
    ringGrad.addColorStop(0, o.isRare ? '#FFD700' : (o.coin.color || '#888'));
    ringGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r+3, 0, Math.PI*2);
    ctx.fillStyle = ringGrad;
    ctx.fill();

    // Coin circle clip
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.save();
    ctx.clip();

    // Draw image or fallback
    const img = imgCache[o.coin.id];
    if (img) {
      ctx.drawImage(img, -r, -r, r*2, r*2);
    } else {
      // Fallback gradient circle
      const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
      grad.addColorStop(0, lighten(o.coin.color, 60));
      grad.addColorStop(1, o.coin.color);
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r*2, r*2);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r*0.55}px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.coin.symbol.slice(0,4), 0, 0);
    }
    ctx.restore(); // unclip

    // Shine overlay
    const shine = ctx.createLinearGradient(-r, -r, r, r*0.3);
    shine.addColorStop(0, 'rgba(255,255,255,0.28)');
    shine.addColorStop(0.5,'rgba(255,255,255,0.06)');
    shine.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.strokeStyle = o.isRare ? '#FFD700' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = o.isRare ? 3 : 1.5;
    ctx.stroke();

    ctx.shadowBlur = 0;
  }

  function drawBomb(o) {
    const r = o.radius;

    // Pulsing red glow
    ctx.shadowBlur  = 20 + 10 * Math.sin(Date.now() * 0.006);
    ctx.shadowColor = '#FF2020';

    // Body
    const grad = ctx.createRadialGradient(-r*0.25, -r*0.25, 0, 0, 0, r);
    grad.addColorStop(0, '#3a3a3a');
    grad.addColorStop(1, '#111');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Shine
    const shine = ctx.createLinearGradient(-r, -r, 0, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = shine;
    ctx.fill();

    // Border
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Fuse
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r*0.1, -r);
    ctx.quadraticCurveTo(r*0.5, -r*1.4, r*0.2, -r*1.7);
    ctx.stroke();

    // Spark
    ctx.shadowBlur  = 8;
    ctx.shadowColor = '#FF8800';
    ctx.fillStyle   = '#FFAA00';
    ctx.beginPath();
    ctx.arc(r*0.2, -r*1.7, 4, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Skull crossbones — pure canvas, no emoji
    const sk = r * 0.32;
    ctx.shadowBlur = 6;
    ctx.shadowColor = '#ff4444';
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = r * 0.14;
    ctx.lineCap = 'round';
    // X cross
    ctx.beginPath(); ctx.moveTo(-sk, -sk); ctx.lineTo(sk, sk); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sk, -sk); ctx.lineTo(-sk, sk); ctx.stroke();
    // Small circle in center
    ctx.beginPath(); ctx.arc(0, 0, r*0.1, 0, Math.PI*2); ctx.fillStyle='#ff2222'; ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawHalf(h, now) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    ctx.globalAlpha = Math.min(h.life / 0.4, 1);

    const r = h.radius;

    ctx.save();
    ctx.beginPath();
    if (h.side === 0) {
      ctx.arc(0, 0, r, Math.PI, 0); // top half
    } else {
      ctx.arc(0, 0, r, 0, Math.PI); // bottom half
    }
    ctx.closePath();
    ctx.clip();

    const img = imgCache[h.coin?.id];
    if (img) {
      ctx.drawImage(img, -r, -r, r*2, r*2);
    } else {
      const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
      grad.addColorStop(0, lighten(h.coin?.color||'#888', 60));
      grad.addColorStop(1, h.coin?.color||'#888');
      ctx.fillStyle = grad;
      ctx.fillRect(-r, -r, r*2, r*2);
    }
    // Juice drip (vertical gradient overlay)
    const juice = ctx.createLinearGradient(0, -r, 0, r);
    juice.addColorStop(0, 'rgba(255,200,0,0.25)');
    juice.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = juice;
    ctx.fillRect(-r, -r, r*2, r*2);

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawParticle(p) {
    const alpha = p.life / 0.75;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI*2);
    ctx.fillStyle = p.color;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = p.color;
    ctx.fill();
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
  }

  function toggleRefInfo() {
    const box = document.getElementById('ref-info-box');
    const trigger = document.getElementById('ref-info-trigger');
    if (!box || !trigger) return;
    const isHidden = box.style.display === 'none';
    box.style.display = isHidden ? 'block' : 'none';
    trigger.textContent = isHidden ? 'Close Info' : 'How it works?';
  }

  /* ── Cloud Sync ── */
  /* ── Slice Trail ── */
  function drawTrail(now) {
    if (trail.length < 2) return;
    const recent = trail.filter(p => now - p.t < CFG.trailFadeMs);
    if (recent.length < 2) return;

    // Build a smooth path using interpolation to avoid "segment" artifacts
    // and create a tapered "comet" look.
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Glow Pass (Outer Red heat)
    ctx.shadowBlur  = 0;
    ctx.globalCompositeOperation = 'screen';
    
    for (let i = 1; i < recent.length; i++) {
      const p1 = recent[i-1];
      const p2 = recent[i];
      const age  = (now - p2.t) / CFG.trailFadeMs;
      const alpha = (1 - age);
      const w     = (1 - age) * 22 + 4;

      // Draw segment with heavy red glow
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineWidth   = w;
      ctx.strokeStyle = `rgba(255, 30, 0, ${alpha * 0.4})`;
      ctx.stroke();
      
      // Extra fuzzy glow
      ctx.lineWidth   = w * 1.8;
      ctx.strokeStyle = `rgba(255, 50, 0, ${alpha * 0.15})`;
      ctx.stroke();
    }

    // Fire Core Pass (Yellow to Red Taper)
    for (let i = 1; i < recent.length; i++) {
      const p1 = recent[i-1];
      const p2 = recent[i];
      const age  = (now - p2.t) / CFG.trailFadeMs;
      const alpha = (1 - age);
      const w     = (1 - age) * 14 + 2;

      const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      grad.addColorStop(0, `rgba(255, 230, 100, ${alpha})`); // Hot Yellow/White head
      grad.addColorStop(1, `rgba(255, 80, 0, ${alpha * 0.8})`); // Orange/Red tail

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineWidth   = w;
      ctx.strokeStyle = grad;
      ctx.stroke();
    }

    // Bright White Internal Core
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(recent[0].x, recent[0].y);
    for (let i = 1; i < recent.length; i++) {
      ctx.lineTo(recent[i].x, recent[i].y);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /* ═══════════════════════════════════════════
     INPUT HANDLING
  ═══════════════════════════════════════════ */
  let pointerDown = false;

  function onPointerDown(e) {
    if (isPaused || !isPlaying) return;
    pointerDown = true;
    trail.length = 0;
    const pt = getEventPos(e);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
  }
  function onPointerUp() {
    pointerDown = false;
    trail.length = 0;
  }
  function onMouseMove(e) {
    if (!pointerDown || !isPlaying || isPaused) return;
    e.preventDefault();
    const pt = getEventPos(e);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
    if (trail.length > CFG.trailLength) trail.shift();
  }
  function onTouchStart(e) {
    if (isPaused || !isPlaying) return;
    e.preventDefault();
    pointerDown = true;
    trail.length = 0;
    const pt = getTouchPos(e.touches[0]);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
  }
  function onTouchMove(e) {
    if (!isPlaying || isPaused) return;
    e.preventDefault();
    const pt = getTouchPos(e.touches[0]);
    trail.push({ x:pt.x, y:pt.y, t:performance.now() });
    if (trail.length > CFG.trailLength) trail.shift();
  }
  function getEventPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function getTouchPos(t) {
    const r = canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  /* ═══════════════════════════════════════════
     DUAL LEADERBOARD & PUBLIC PROFILE
  ═══════════════════════════════════════════ */
  let lbMode = 'score'; // 'score' or 'points'

  function setLeaderboardMode(mode) {
    lbMode = mode;
    document.getElementById('btn-lb-score').style.background = mode === 'score' ? 'var(--hot-pink)' : '';
    document.getElementById('btn-lb-points').style.background = mode === 'points' ? 'var(--hot-pink)' : '';
    renderLeaderboard();
  }

  async function fetchLeaderboardFromCloud() {
    try {
      const board = [];
      const field = lbMode === 'score' ? 'profile.topScore' : 'profile.cumulativeScore';
      const q = query(collection(db, 'users'), orderBy(field, 'desc'), limit(100));
      const snap = await getDocs(q);
      snap.forEach(docSnap => {
        const addr = docSnap.id;
        const profile = docSnap.data().profile || {};
        // Only show users who have an active name AND a score/point value > 0
        // This ensures the leaderboard remains empty after an Admin Reset
        const hasScore = (profile.topScore > 0 || profile.cumulativeScore > 0);
        if (profile.name && hasScore) {
          board.push({
            address: addr,
            name: profile.name || 'Ninja',
            topScore: profile.topScore || 0,
            points: profile.cumulativeScore || 0,
            altAddresses: profile.altAddresses || []
          });
        }
      });
      return board;
    } catch(e) {
      console.warn("Cloud leaderboard err:", e);
      return [];
    }
  }

  async function renderLeaderboard() {
    const list  = document.getElementById('leaderboard-list');
    const adminPanel = document.getElementById('admin-lb-controls');
    if (!list) return;

    // Admin UI visibility
    const connectedAddr = Web3.getConnectedAddress();
    if (adminPanel) {
      adminPanel.style.display = isAdminWallet(connectedAddr) ? 'flex' : 'none';
    }

    list.innerHTML = '<li class="lb-empty">Loading Global Scores...</li>';

    let board = await fetchLeaderboardFromCloud();

    list.innerHTML = '';

    if (board.length === 0) {
      list.innerHTML = '<li class="lb-empty">No scores yet!</li>';
      return;
    }

    const medals = [
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal1"/></svg>',
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal2"/></svg>',
      '<svg viewBox="0 0 36 40" xmlns="http://www.w3.org/2000/svg"><use href="#ico-medal3"/></svg>'
    ];
    board.forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = i < 3 ? `rank-${i+1}` : '';
      li.style.cursor = 'pointer';
      li.onclick = () => showPublicProfile(entry.address);
      
      const val = lbMode === 'score' ? entry.topScore : entry.points;
      
      li.innerHTML = `
        <span class="lb-rank">${i+1}</span>
        <span class="lb-name">${escHtml(entry.name)}</span>
        <span class="lb-score">${val}</span>
        <span class="lb-medal">${medals[i] || ''}</span>
      `;
      list.appendChild(li);
    });
  }

  async function showPublicProfile(addr) {
    try {
      const snap = await getDoc(doc(db, 'users', addr));
      if (!snap.exists()) return;
      const p = snap.data().profile || {};
      document.getElementById('pub-name').textContent = p.name || 'Unknown';
      document.getElementById('pub-score').textContent = p.topScore || 0;
      document.getElementById('pub-points').textContent = p.cumulativeScore || 0;
      document.getElementById('pub-primary').textContent = addr;
      
      const altList = document.getElementById('pub-alt-list');
      altList.innerHTML = '';
      const alts = p.altAddresses || [];
      if (alts.length === 0) {
        altList.innerHTML = '<div style="font-size:12px; opacity:0.5;">No additional addresses.</div>';
      } else {
        alts.forEach(alt => {
          altList.innerHTML += `<div style="font-size:11px; font-family:monospace; margin-bottom:4px; padding:5px; background:rgba(0,0,0,0.1); border-radius:4px; border: 1px solid rgba(0,0,0,0.05);"><b>${escHtml(alt.desc)}</b>: <span style="user-select:all;">${escHtml(alt.address)}</span></div>`;
        });
      }

      // Socials render
      window._activeSocials = p.socials || { twitter: '', telegram: '' };
      const tw = window._activeSocials.twitter;
      const tg = window._activeSocials.telegram;
      
      document.getElementById('pub-twitter-handle').textContent = tw ? tw : '@NotAvailable';
      document.getElementById('pub-twitter-handle').className = tw ? 'pub-social-handle' : 'pub-social-notav';
      document.getElementById('pub-twitter-actions').style.display = tw ? 'flex' : 'none';

      document.getElementById('pub-telegram-handle').textContent = tg ? tg : '@NotAvailable';
      document.getElementById('pub-telegram-handle').className = tg ? 'pub-social-handle' : 'pub-social-notav';
      document.getElementById('pub-telegram-actions').style.display = tg ? 'flex' : 'none';

      // Admin Power
      const viewerAddr = Web3.getConnectedAddress();
      const adminSec = document.getElementById('pub-admin-socials');
      if (isAdminWallet(viewerAddr)) {
        adminSec.style.display = 'block';
        document.getElementById('pub-admin-twitter').value = tw || '';
        document.getElementById('pub-admin-telegram').value = tg || '';
        document.getElementById('pub-admin-save').onclick = () => adminSaveSocials(addr);
      } else {
        adminSec.style.display = 'none';
      }
      
      document.getElementById('modal-public-profile').classList.add('active');
    } catch(e) {
      console.warn("Error fetching public profile:", e);
    }
  }

  function closePublicProfile() {
    document.getElementById('modal-public-profile').classList.remove('active');
    window._activeSocials = null;
  }

  async function adminSaveSocials(targetAddr) {
    const viewerAddr = Web3.getConnectedAddress();
    if (!isAdminWallet(viewerAddr)) return;

    const tw = document.getElementById('pub-admin-twitter').value.trim();
    const tg = document.getElementById('pub-admin-telegram').value.trim();
    
    const btn = document.getElementById('pub-admin-save');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving...';
    
    try {
      // Update cloud directly for the target user
      await setDoc(doc(db, 'users', targetAddr), {
        profile: { socials: { twitter: tw, telegram: tg } }
      }, { merge: true });
      
      showToast('User socials updated by Admin!');
      showPublicProfile(targetAddr); // refresh
    } catch(e) {
      console.error(e);
      alert('Admin save failed: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  window._adminSearchFilter = null;

  async function adminSearchUser() {
    const viewerAddr = Web3.getConnectedAddress();
    if (!isAdminWallet(viewerAddr)) return;

    const input = document.getElementById('admin-user-search-input');
    const queryStr = (input?.value || '').trim().toLowerCase();
    
    if (!queryStr) {
      // If empty, reset filter and show all
      window._adminSearchFilter = null;
      renderAdminPanel();
      return;
    }

    const btn = document.querySelector('.admin-search-wrap button.btn-primary');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '...';

    try {
      let foundAddr = null;

      // 1. Check if it's a direct address
      if (/^0x[a-fA-F0-9]{40}$/.test(queryStr)) {
        const snap = await getDoc(doc(db, 'users', queryStr));
        if (snap.exists()) {
          foundAddr = queryStr;
        }
      }

      // 2. Search by Twitter/Telegram handle if not found by address
      if (!foundAddr) {
        const cleanHandle = queryStr.startsWith('@') ? queryStr : '@' + queryStr;
        const qTwitter = query(collection(db, 'users'), where('profile.socials.twitter', '==', cleanHandle), limit(1));
        const qTelegram = query(collection(db, 'users'), where('profile.socials.telegram', '==', cleanHandle), limit(1));
        
        const [snapTw, snapTg] = await Promise.all([getDocs(qTwitter), getDocs(qTelegram)]);
        
        if (!snapTw.empty) foundAddr = snapTw.docs[0].id;
        else if (!snapTg.empty) foundAddr = snapTg.docs[0].id;
      }

      if (foundAddr) {
        window._adminSearchFilter = foundAddr;
        renderAdminPanel(); // List will now be filtered
      } else {
        showToast('User not found!');
      }
    } catch(e) {
      console.error("Admin search error:", e);
      alert("Search failed: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  /* ── Admin Rankings Tools ── */
  async function resetGlobalLeaderboard() {
    const addr = Web3.getConnectedAddress();
    if (!isAdminWallet(addr)) return;
    
    if (!confirm("⚠️ CAUTION: This will RESET ALL GLOBAL RANKINGS to 0 for everyone. This action cannot be undone. Are you absolutely sure?")) return;
    if (!confirm("FINAL CONFIRMATION: Wipe all global scores now?")) return;

    try {
      const btn = document.querySelector('#admin-lb-controls button:last-child');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Wiping...';

      const snap = await getDocs(collection(db, 'users'));
      const promises = [];
      snap.forEach(docSnap => {
        promises.push(setDoc(doc(db, 'users', docSnap.id), {
          profile: { topScore: 0, cumulativeScore: 0 }
        }, { merge: true }));
      });
      
      await Promise.all(promises);
      alert('Global rankings have been reset successfully!');
      renderLeaderboard();
      btn.textContent = origText;
      btn.disabled = false;
    } catch(e) {
      console.error(e);
      alert('Reset failed: ' + e.message);
    }
  }

  async function copyLeaderboardData() {
    try {
      const board = await fetchLeaderboardFromCloud();
      if (!board.length) { alert('Leaderboard is empty.'); return; }

      const title = lbMode === 'score' ? 'TOP SCORE RANKINGS' : 'TOP POINTS RANKINGS';
      let text = `🏆 MEME SMASH - ${title}\n(Fetched: ${new Date().toLocaleString()})\n\n`;
      
      board.forEach((entry, i) => {
        const val = lbMode === 'score' ? entry.topScore : entry.points;
        text += `${i+1} - ${entry.name} - address(${entry.address}) - ${val}\n`;
      });

      await navigator.clipboard.writeText(text);
      
      const btn = document.querySelector('#admin-lb-controls button:first-child');
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = orig, 2000);
    } catch(e) {
      console.error(e);
      alert('Copy failed: ' + e.message);
    }
  }

  /* ═══════════════════════════════════════════
     UTILS
  ═══════════════════════════════════════════ */
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function lighten(hex, amount) {
    let c = hex.replace('#','');
    if (c.length === 3) c = c.split('').map(x=>x+x).join('');
    const r = Math.min(255, parseInt(c.slice(0,2),16)+amount);
    const g = Math.min(255, parseInt(c.slice(2,4),16)+amount);
    const b = Math.min(255, parseInt(c.slice(4,6),16)+amount);
    return `rgb(${r},${g},${b})`;
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  /* ═══════════════════════════════════════════
     DAILY CHECK-IN SYSTEM
  ═══════════════════════════════════════════ */

  // Day resets at 5:30 AM IST = UTC midnight (UTC+5:30 offset)
  // So we use UTC day number as our "IST day" marker
  const CHECKIN_REWARDS = [7, 15, 35, 80, 180, 400, 1000]; // Day 1–7
  let checkinCountdownTimer = null;

  function getUtcDayNumber() {
    return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  }

  function getCheckinData(address) {
    if (!address) return { streak: 0, lastDay: -1 };
    const key = `meme_smash_checkin_${address.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { streak: 0, lastDay: -1 };
  }

  function saveCheckinData(address, data) {
    if (!address) return;
    const key = `meme_smash_checkin_${address.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(data));
    syncToCloud(address);
  }

  function getCheckinStatus(address) {
    const today = getUtcDayNumber();
    const data  = getCheckinData(address);
    const alreadyCheckedIn = data.lastDay === today;
    // Streak continues only if last check-in was YESTERDAY; otherwise broken
    const streakAlive = data.lastDay === (today - 1);
    const currentStreak = streakAlive || alreadyCheckedIn ? data.streak : 0;
    return { today, alreadyCheckedIn, currentStreak, lastDay: data.lastDay };
  }

  function msUntilNextCheckin() {
    const now = Date.now();
    const nextMidnightUTC = (getUtcDayNumber() + 1) * 24 * 60 * 60 * 1000;
    return Math.max(0, nextMidnightUTC - now);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'Available now!';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`;
  }

  function showCheckinModal() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }
    renderCheckinModal(addr);
    document.getElementById('modal-checkin').classList.add('active');
    startCheckinCountdown(addr);
  }

  function closeCheckinModal() {
    document.getElementById('modal-checkin').classList.remove('active');
    if (checkinCountdownTimer) { clearInterval(checkinCountdownTimer); checkinCountdownTimer = null; }
  }

  function startCheckinCountdown(addr) {
    if (checkinCountdownTimer) clearInterval(checkinCountdownTimer);
    checkinCountdownTimer = setInterval(() => {
      renderCheckinModal(addr);
    }, 1000);
  }

  function renderCheckinModal(addr) {
    const { today, alreadyCheckedIn, currentStreak, lastDay } = getCheckinStatus(addr);
    const nextDayIndex = Math.min(currentStreak, 6); // which reward comes next (0-indexed)
    const msLeft = msUntilNextCheckin();
    const canCheckin = !alreadyCheckedIn;

    // Render day tiles
    const grid = document.getElementById('checkin-day-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const dayNum   = i + 1;
      const reward   = CHECKIN_REWARDS[i];
      const isDone   = i < currentStreak;
      const isToday  = i === currentStreak && canCheckin;
      const isFuture = !isDone && !isToday;

      const tile = document.createElement('div');
      tile.className = 'ci-tile' + (isDone ? ' ci-done' : '') + (isToday ? ' ci-today' : '') + (isFuture ? ' ci-future' : '');
      tile.innerHTML = `
        <div class="ci-day">Day ${dayNum}</div>
        <div class="ci-pts">${isDone ? '<span class="ci-check">&#10003;</span>' : reward + '<span class="ci-mp">MP</span>'}</div>
      `;
      grid.appendChild(tile);
    }

    // Streak label
    const streakEl = document.getElementById('ci-streak-label');
    if (streakEl) {
      if (currentStreak === 0) {
        streakEl.textContent = 'Start your streak!';
      } else if (currentStreak >= 7) {
        streakEl.textContent = '7-Day Champion! Streak resets now!';
      } else {
        streakEl.textContent = `${currentStreak}-Day Streak!`;
      }
    }

    // Countdown / CTA
    const btnEl = document.getElementById('ci-btn');
    const cdEl  = document.getElementById('ci-countdown');
    const rewardEl = document.getElementById('ci-next-reward');
    if (currentStreak >= 7 && !canCheckin) {
      // Full cycle done, show restart info
      if (rewardEl) rewardEl.textContent = `Next streak starts tomorrow — Day 1 (7 MP)`;
      if (cdEl) cdEl.textContent = formatCountdown(msLeft);
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Full Streak Complete!'; }
    } else if (canCheckin) {
      const idx = Math.min(currentStreak, 6);
      if (rewardEl) rewardEl.textContent = `Today's reward: ${CHECKIN_REWARDS[idx]} Meme Points`;
      if (cdEl) cdEl.textContent = '';
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Click to Check-In'; }
    } else {
      const idx = Math.min(currentStreak, 6);
      if (rewardEl) rewardEl.textContent = `Next: Day ${currentStreak + 1} — ${CHECKIN_REWARDS[idx]} Meme Points`;
      if (cdEl) cdEl.textContent = `Next check-in in: ${formatCountdown(msLeft)}`;
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Checked In Today!'; }
    }
  }

  async function doCheckin() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect your wallet first!'); return; }

    const { today, alreadyCheckedIn, currentStreak } = getCheckinStatus(addr);
    if (alreadyCheckedIn) { alert('Already checked in today! Come back tomorrow.'); return; }

    const btn = document.getElementById('ci-btn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      await Web3.payForDailyCheckin();

      // Determine new streak
      const data = getCheckinData(addr);
      const lastDay = data.lastDay;
      let newStreak;
      if (lastDay === today - 1) {
        // Consecutive day
        newStreak = (data.streak >= 7) ? 1 : data.streak + 1;
      } else {
        // Broken or first time
        newStreak = 1;
      }

      saveCheckinData(addr, { streak: newStreak, lastDay: today });

      // Award meme points
      const rewardIdx = newStreak - 1; // 0-indexed
      const pts = CHECKIN_REWARDS[Math.min(rewardIdx, 6)];
      const profile = getProfileData(addr);
      profile.cumulativeScore = (profile.cumulativeScore || 0) + pts;
      saveProfileData(addr, profile);
      refreshProfileUI(addr);
      recordFeePayment(addr, 'checkin', 0.01); // Track for referral system

      btn.textContent = `+${pts} Meme Points Earned!`;
      renderCheckinModal(addr);

      setTimeout(() => {
        btn.textContent = origText;
        renderCheckinModal(addr);
      }, 3000);

    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = 'Payment Failed — Try Again';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2500);
    }
  }


  /* ═══════════════════════════════════════════
     REFERRAL SYSTEM
  ═══════════════════════════════════════════ */

  const PAYOUT_MIN_USD = 5.0;
  const REF_TIER_DEFS = [
    { label: 'Active',  min: 0,   rate: 0.10, color: '#4CAF50' },
    { label: 'Pro',     min: 10,  rate: 0.15, color: '#FF8C00' },
    { label: 'Elite',   min: 50,  rate: 0.30, color: '#FF3DAE' },
    { label: 'Legend',  min: 100, rate: 0.40, color: '#9B3BDB' },
    { label: 'Mythic',  min: 500, rate: 0.50, color: '#FFD700' },
  ];

  function isAdminWallet(addr) {
    return addr && addr.toLowerCase() === ADMIN_WALLET.toLowerCase();
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatUSD(val) {
    if (!val || isNaN(val)) return '0.00';
    return Number(val.toFixed(4)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  /* ── Deterministic Codes & Links (no backend needed) ── */
  function getMyRefCode(addr) {
    if (!addr || addr.length < 10) return '';
    return 'MS' + addr.slice(2,6).toUpperCase() + addr.slice(-4).toUpperCase();
  }
  function getMyRefLink(addr) {
    if (!addr) return '';
    return window.location.href.split('?')[0] + '?ref=' + addr.toLowerCase();
  }

  /* ── Data Accessors ── */
  function getRefData(addr) {
    if (!addr) return _emptyRef();
    const raw = localStorage.getItem(`meme_smash_ref_${addr.toLowerCase()}`);
    return raw ? { ..._emptyRef(), ...JSON.parse(raw) } : _emptyRef();
  }
  function _emptyRef() {
    return { referrals: [], pendingUSD: 0, lifetimeUSD: 0, paidOutUSD: 0, payoutHistory: [] };
  }
  function saveRefData(addr, data) {
    if (!addr) return;
    localStorage.setItem(`meme_smash_ref_${addr.toLowerCase()}`, JSON.stringify(data));
    syncToCloud(addr);
  }
  function getRefBinding(addr) {
    if (!addr) return null;
    const raw = localStorage.getItem(`meme_smash_binding_${addr.toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  }
  function saveRefBinding(addr, data) {
    if (!addr) return;
    localStorage.setItem(`meme_smash_binding_${addr.toLowerCase()}`, JSON.stringify(data));
    syncToCloud(addr);
  }
  function getFeeStats(addr) {
    if (!addr) return _emptyFees();
    const raw = localStorage.getItem(`meme_smash_fees_${addr.toLowerCase()}`);
    return raw ? { ..._emptyFees(), ...JSON.parse(raw) } : _emptyFees();
  }
  function _emptyFees() {
    return { totalUSD: 0, gamesSubmitted: 0, revives: 0, checkins: 0, txHistory: [] };
  }
  function saveFeeStats(addr, data) {
    if (!addr) return;
    localStorage.setItem(`meme_smash_fees_${addr.toLowerCase()}`, JSON.stringify(data));
    syncToCloud(addr);
  }

  /* ── Tier Helpers ── */
  function getRefTier(validCount) {
    for (let i = REF_TIER_DEFS.length - 1; i >= 0; i--) {
      if (validCount >= REF_TIER_DEFS[i].min) return REF_TIER_DEFS[i];
    }
    return REF_TIER_DEFS[0];
  }
  function computeTierFillPct(validCount) {
    const segs = [{f:0,t:10},{f:10,t:50},{f:50,t:100},{f:100,t:500}];
    if (validCount >= 500) return 100;
    for (let i = 0; i < segs.length; i++) {
      if (validCount < segs[i].t) {
        return i * 25 + ((validCount - segs[i].f) / (segs[i].t - segs[i].f)) * 25;
      }
    }
    return 100;
  }

  /* ── Fee Recording (called after every payment) ── */
  function recordFeePayment(addr, type, amountUSD) {
    if (!addr) return;
    const fs = getFeeStats(addr);
    fs.totalUSD = (fs.totalUSD || 0) + amountUSD;
    if (type === 'submit')  fs.gamesSubmitted = (fs.gamesSubmitted || 0) + 1;
    if (type === 'revive')  fs.revives  = (fs.revives  || 0) + 1;
    if (type === 'checkin') fs.checkins = (fs.checkins || 0) + 1;
    fs.txHistory.push({ type, amountUSD, ts: Date.now() });
    saveFeeStats(addr, fs);
    // Update profile fee tracking
    const profile = getProfileData(addr);
    profile.feesSpentUSD = (profile.feesSpentUSD || 0) + amountUSD;
    if (type === 'submit') profile.gamesSubmitted = (profile.gamesSubmitted || 0) + 1;
    saveProfileData(addr, profile);
    // Credit referrer (if their data exists on this device)
    const binding = getRefBinding(addr);
    if (binding && binding.referrerAddr) {
      _creditReferrer(addr, binding.referrerAddr, amountUSD, fs.gamesSubmitted);
    }
  }

  function _creditReferrer(refereeAddr, referrerAddr, amountUSD, gamesSubmitted) {
    const rd = getRefData(referrerAddr);
    let ref = rd.referrals.find(r => r.addr.toLowerCase() === refereeAddr.toLowerCase());
    if (!ref) {
      const p = getProfileData(refereeAddr);
      ref = { addr: refereeAddr.toLowerCase(), name: p.name || 'Unknown', status: 'pending',
               gamesSubmitted: 0, feesUSD: 0, earnedUSD: 0, boundAt: Date.now() };
      rd.referrals.push(ref);
    }
    
    ref.feesUSD = (ref.feesUSD || 0) + amountUSD;
    ref.gamesSubmitted = gamesSubmitted;
    
    let newlyValid = false;
    // Promote to valid after 10 game submissions
    if (gamesSubmitted >= 10 && ref.status === 'pending') {
      ref.status = 'valid';
      newlyValid = true;
    }
    
    // Only earn from valid referrals
    if (ref.status === 'valid') {
      const validCount = rd.referrals.filter(r => r.status === 'valid').length;
      const rate = getRefTier(validCount).rate;
      
      // If they just became valid, credit ALL historical fees they spent. Otherwise, just credit the current amount.
      const amountToCredit = newlyValid ? (ref.feesUSD * rate) : (amountUSD * rate);
      
      ref.earnedUSD = (ref.earnedUSD || 0) + amountToCredit;
      rd.pendingUSD = (rd.pendingUSD   || 0) + amountToCredit;
      rd.lifetimeUSD = (rd.lifetimeUSD || 0) + amountToCredit;
    }
    saveRefData(referrerAddr, rd);
  }

  /* ── URL Auto-Bind ── */
  function tryAutoBindFromURL() {
    const params = new URLSearchParams(window.location.search);
    // Handle payout request import for admin
    const payreq = params.get('payreq');
    if (payreq) {
      try {
        const req = JSON.parse(atob(payreq));
        const key = `meme_smash_payout_req_${req.addr.toLowerCase()}_${req.requestedAt}`;
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, JSON.stringify({ ...req, status: 'pending' }));
        }
      } catch(e) {}
    }
    // Handle referral link
    const refAddr = params.get('ref');
    if (refAddr && /^0x[a-fA-F0-9]{40}$/.test(refAddr)) {
      sessionStorage.setItem('meme_smash_pending_ref', refAddr.toLowerCase());
    }
    window.history.replaceState({}, '', window.location.href.split('?')[0]);
  }

  let _refApplied = false;
  function checkAndApplyPendingRef(userAddr) {
    if (!userAddr || _refApplied) return;
    const pending = sessionStorage.getItem('meme_smash_pending_ref');
    if (!pending) return;
    if (pending === userAddr.toLowerCase()) return; // can't self-refer
    if (getRefBinding(userAddr)) { _refApplied = true; return; }
    _refApplied = true;
    _doBindReferral(userAddr, pending, 'link');
    sessionStorage.removeItem('meme_smash_pending_ref');
  }

  function _doBindReferral(userAddr, referrerAddr, method) {
    if (!userAddr || !referrerAddr) return false;
    if (userAddr.toLowerCase() === referrerAddr.toLowerCase()) return false;
    if (getRefBinding(userAddr)) return false;
    saveRefBinding(userAddr, {
      referrerAddr: referrerAddr.toLowerCase(),
      code: getMyRefCode(referrerAddr), method,
      boundAt: Date.now(), onchain: false
    });
    // Update referrer list on this device if their data exists
    const rd = getRefData(referrerAddr);
    if (!rd.referrals.find(r => r.addr.toLowerCase() === userAddr.toLowerCase())) {
      const p = getProfileData(userAddr);
      rd.referrals.push({ addr: userAddr.toLowerCase(), name: p.name || 'Unknown',
        status: 'pending', gamesSubmitted: 0, feesUSD: 0, earnedUSD: 0, boundAt: Date.now() });
      saveRefData(referrerAddr, rd);
    }
    return true;
  }

  async function doManualRefBind() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect wallet first!'); return; }
    if (getRefBinding(addr)) { alert('You already have a referral binding.'); return; }

    const code    = (document.getElementById('manual-ref-code-input')?.value || '').trim().toUpperCase();
    const refAddr = (document.getElementById('manual-ref-addr-input')?.value || '').trim().toLowerCase();
    if (!code && !refAddr) { alert('Enter a referral code or referrer wallet address.'); return; }

    let finalAddr = null;
    const applyBtn = document.getElementById('manual-ref-apply-btn');
    const orig = applyBtn.textContent;
    applyBtn.disabled = true; applyBtn.textContent = 'Searching...';

    try {
      if (refAddr && /^0x[a-fA-F0-9]{40}$/.test(refAddr)) {
        if (code && getMyRefCode(refAddr) !== code) { alert('Code does not match wallet address!'); return; }
        finalAddr = refAddr;
      } else if (code) {
        // Query global database for user with matching generated referral code
        const allUsers = await _getAllUsers();
        for (const u of allUsers) {
          if (getMyRefCode(u.addr) === code) { finalAddr = u.addr.toLowerCase(); break; }
        }
        
        if (!finalAddr) {
          alert('Referral Code not found globally!\nPlease double check the code or use their 0x wallet address instead.');
          return;
        }
      } else { alert('Enter a valid code or wallet address.'); return; }
    } catch(e) {
      console.error("DB Query error:", e);
      alert('Network error while searching for code.');
      return;
    } finally {
      applyBtn.disabled = false; applyBtn.textContent = orig;
    }

    if (finalAddr === addr.toLowerCase()) { alert("You can't refer yourself!"); return; }

    applyBtn.disabled = true; applyBtn.textContent = 'Binding...';
    try {
      const doOnchain = confirm('Bind this referral permanently on-chain?\n(Small gas fee — or Cancel for local-only bind)');
      if (doOnchain) {
        await Web3.bindReferralOnchain(finalAddr);
        _doBindReferral(addr, finalAddr, 'onchain');
        const b = getRefBinding(addr);
        if (b) { b.onchain = true; saveRefBinding(addr, b); }
        alert('Referral bound permanently on-chain!');
      } else {
        _doBindReferral(addr, finalAddr, 'manual');
        alert('Referral bound locally!');
      }
      renderRefModal();
    } catch(e) {
      console.error(e);
      _doBindReferral(addr, finalAddr, 'manual');
      alert('On-chain bind failed. Saved locally instead.');
      renderRefModal();
    } finally {
      applyBtn.disabled = false; applyBtn.textContent = orig;
    }
  }

  function showOnchainBind() {
    const toggle = document.getElementById('ref-onchain-toggle');
    const ui = document.getElementById('ref-onchain-ui');
    if (toggle) toggle.style.display = 'none';
    if (ui) ui.style.display = 'block';
  }

  async function doOnchainRefBind() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect wallet first!'); return; }
    if (getRefBinding(addr)) { alert('You already have a referral binding.'); return; }

    const refAddr = (document.getElementById('manual-ref-addr-input')?.value || '').trim().toLowerCase();
    if (!refAddr || !/^0x[a-fA-F0-9]{40}$/.test(refAddr)) { alert('Enter a valid 0x wallet address.'); return; }
    if (refAddr === addr.toLowerCase()) { alert("You can't refer yourself!"); return; }

    try {
      if (!confirm('This will send a gasless/low-cost transaction to bind this referrer permanently on the Base blockchain. Proceed?')) return;
      await Web3.bindReferralOnchain(refAddr);
      _doBindReferral(addr, refAddr, 'onchain');
      const b = getRefBinding(addr);
      if (b) { b.onchain = true; saveRefBinding(addr, b); }
      alert('Referral bound permanently on-chain!');
      renderRefModal();
    } catch(e) {
      console.error(e);
      alert('On-chain bind failed or was rejected. ' + e.message);
    }
  }

  /* ── Payout ── */
  function requestPayout() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    const rd = getRefData(addr);
    if (rd.pendingUSD < PAYOUT_MIN_USD) {
      alert(`Min payout is $${PAYOUT_MIN_USD}. You have $${rd.pendingUSD.toFixed(4)} pending.`);
      return;
    }
    const reqId = Date.now();
    const key = `meme_smash_payout_req_${addr.toLowerCase()}_${reqId}`;
    const existing = localStorage.getItem(key);
    if (existing && JSON.parse(existing).status === 'pending') {
      alert('Error creating request.'); return;
    }
    const profile = getProfileData(addr);
    const req = { addr: addr.toLowerCase(), name: profile.name || 'Unknown',
                   amountUSD: rd.pendingUSD, requestedAt: reqId, status: 'pending' };
    
    rd.pendingUSD = 0; // Reset active queue so new batch starts
    saveRefData(addr, rd);

    localStorage.setItem(key, JSON.stringify(req));
    setDoc(doc(db, 'payoutRequests', key), req).catch(e => console.warn(e));
    // Generate shareable URL for cross-device admin import
    const reqUrl = window.location.href.split('?')[0] + '?payreq=' + btoa(JSON.stringify(req));
    alert(`Payout request of $${formatUSD(req.amountUSD)} submitted!\nYour earnings are reset to 0 for the next batch.\n\nShare this link with admin if they are on a different device:\n${reqUrl}\n\n(Link copied to clipboard)`);
    try { navigator.clipboard.writeText(reqUrl); } catch(e) {}
    renderRefModal();
  }

  /* ── Referral Modal UI ── */
  function showReferModal() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { alert('Connect wallet first!'); return; }
    renderRefModal();
    document.getElementById('modal-refer').classList.add('active');
  }
  function closeReferModal() {
    document.getElementById('modal-refer').classList.remove('active');
  }
  function copyRefCode() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    navigator.clipboard.writeText(getMyRefCode(addr)).then(() => {
      const b = document.getElementById('ref-copy-code-btn');
      if (b) { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy Code', 1500); }
    }).catch(() => {});
  }
  function copyRefLink() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    navigator.clipboard.writeText(getMyRefLink(addr)).then(() => {
      const b = document.getElementById('ref-copy-link-btn');
      if (b) { b.textContent = 'Copied!'; setTimeout(() => b.textContent = 'Copy Referral Link', 1500); }
    }).catch(() => {});
  }

  function showFullRefsModal(filterType = 'all') {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    const rd = getRefData(addr);
    
    // Sync names & Filter & Sort
    rd.referrals.forEach(r => {
      const p = getProfileData(r.addr);
      if (p && p.name) r.name = p.name;
    });

    let filteredRefs = [...rd.referrals];
    if (filterType === 'valid') filteredRefs = filteredRefs.filter(r => r.status === 'valid');
    if (filterType === 'pending') filteredRefs = filteredRefs.filter(r => r.status !== 'valid');

    const sortedRefs = filteredRefs.sort((a,b) => (b.earnedUSD || 0) - (a.earnedUSD || 0));

    // Update active tab UI
    document.querySelectorAll('#modal-full-refs .admin-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.reftab === filterType);
    });

    const listEl = document.getElementById('full-ref-list');
    if (listEl) {
      if (sortedRefs.length === 0) {
        listEl.innerHTML = `<div class="ref-empty">No ${filterType !== 'all' ? filterType : ''} referrals found.</div>`;
      } else {
        listEl.innerHTML = sortedRefs.map((r, index) => `
          <div class="ref-item">
            <div class="ref-item-info">
              <span class="ref-item-name" style="cursor:pointer;" title="View Profile" onclick="Game.showPublicProfile('${r.addr}')">${index+1}. ${escHtml(r.name || 'Unknown')}</span>
            </div>
            <div class="ref-item-right">
              <span class="ref-item-status ${r.status}">${r.status === 'valid' ? 'Valid' : `Pending (${r.gamesSubmitted}/10)`}</span>
              ${isAdminWallet(addr) ? `<span class="ref-item-fees">$${formatUSD(r.feesUSD)} spent</span>` : ''}
              <span class="ref-item-earned">+$${formatUSD(r.earnedUSD)}</span>
            </div>
          </div>`).join('');
      }
    }
    document.getElementById('modal-full-refs').classList.add('active');
  }

  function filterFullRefs(tab) {
    showFullRefsModal(tab);
  }

  function closeFullRefsModal() {
    document.getElementById('modal-full-refs').classList.remove('active');
  }

  function renderRefModal() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    const rd = getRefData(addr);

    // --- Retroactive Bug Fix for affected $0 earners ---
    let needsSave = false;
    const validCountTemp = rd.referrals.filter(r => r.status === 'valid').length;
    const currentRate = getRefTier(validCountTemp).rate > 0 ? getRefTier(validCountTemp).rate : 0.10;
    
    rd.referrals.forEach(r => {
       if (r.status === 'valid' && r.feesUSD > 0 && (r.earnedUSD === undefined || r.earnedUSD < 0.0001)) {
           const missedEarnings = r.feesUSD * currentRate;
           r.earnedUSD = missedEarnings;
           rd.pendingUSD = (rd.pendingUSD || 0) + missedEarnings;
           rd.lifetimeUSD = (rd.lifetimeUSD || 0) + missedEarnings;
           needsSave = true;
       }
    });
    if (needsSave) saveRefData(addr, rd);
    // ---------------------------------------------------

    const binding = getRefBinding(addr);
    const validCount = rd.referrals.filter(r => r.status === 'valid').length;
    const tier = getRefTier(validCount);

    // Code display
    const codeEl = document.getElementById('ref-code-display');
    if (codeEl) codeEl.textContent = getMyRefCode(addr);

    // Tier track
    renderTierTrack(validCount);

    // Binding info
    const bindEl = document.getElementById('ref-binding-info');
    const manualSec = document.getElementById('ref-manual-section');
    if (bindEl) {
      if (binding) {
        const method = binding.onchain ? 'Permanent Onchain' : binding.method;
        bindEl.innerHTML = `<div class="ref-binding-badge">
          Referred by <code>${binding.referrerAddr.slice(0,8)}...${binding.referrerAddr.slice(-6)}</code>
          <span class="ref-binding-method">${method}</span></div>`;
        if (manualSec) manualSec.style.display = 'none';
      } else {
        bindEl.innerHTML = '';
        if (manualSec) manualSec.style.display = 'block';
      }
    }

    // Count badge
    const badge = document.getElementById('ref-count-badge');
    if (badge) badge.textContent = rd.referrals.length;

    // Referral list
    const listEl = document.getElementById('ref-list');
    if (listEl) {
      if (rd.referrals.length === 0) {
        listEl.innerHTML = '<div class="ref-empty">No referrals yet — share your link!</div>';
      } else {
        // Sync names & Sort by earnings descending
        rd.referrals.forEach(r => {
          const p = getProfileData(r.addr);
          if (p && p.name) r.name = p.name;
        });
        const sortedRefs = [...rd.referrals].sort((a,b) => (b.earnedUSD || 0) - (a.earnedUSD || 0));
        
        let html = sortedRefs.slice(0, 3).map((r, index) => `
          <div class="ref-item">
            <div class="ref-item-info">
              <span class="ref-item-name" style="cursor:pointer;" title="View Profile" onclick="Game.showPublicProfile('${r.addr}')">${index + 1}. ${escHtml(r.name || 'Unknown')}</span>
            </div>
            <div class="ref-item-right">
              <span class="ref-item-status ${r.status}">${r.status === 'valid' ? 'Valid' : `Pending (${r.gamesSubmitted}/10)`}</span>
              ${isAdminWallet(addr) ? `<span class="ref-item-fees">$${formatUSD(r.feesUSD)} spent</span>` : ''}
              <span class="ref-item-earned">+$${formatUSD(r.earnedUSD)}</span>
            </div>
          </div>`).join('');

        if (sortedRefs.length > 3) {
          html += `<div style="text-align:center; padding-top:8px;">
            <a href="#" onclick="Game.showFullRefsModal(); return false;" style="font-size:12px; color:var(--text-mid); text-decoration:underline;">View full referrals (${sortedRefs.length})</a>
          </div>`;
        }
        html += `<div style="text-align:center; padding-top:6px; font-size:10px; color:var(--text-mid); opacity:0.6;">
          Leaderboard and earnings update daily at 11:30 PM UTC
        </div>`;
        
        listEl.innerHTML = html;
      }
    }

    // Earnings
    const pct = Math.min(100, (rd.pendingUSD / PAYOUT_MIN_USD) * 100);
    const lifeEl   = document.getElementById('ref-lifetime');
    const pendEl   = document.getElementById('ref-pending');
    const fillEl   = document.getElementById('ref-payout-fill');
    const barLabel = document.getElementById('ref-bar-label');
    const claimBtn = document.getElementById('ref-claim-btn');
    if (lifeEl)   lifeEl.textContent = `$${formatUSD(rd.lifetimeUSD)}`;
    if (pendEl)   pendEl.textContent = `$${formatUSD(rd.pendingUSD)}`;
    if (fillEl)   fillEl.style.width = pct + '%';
    if (barLabel) barLabel.textContent = `$${formatUSD(rd.pendingUSD)} / $${formatUSD(PAYOUT_MIN_USD)} min`;
    if (claimBtn) {
      claimBtn.disabled = rd.pendingUSD < PAYOUT_MIN_USD;
      claimBtn.textContent = rd.pendingUSD >= PAYOUT_MIN_USD
        ? `Request Payout — $${formatUSD(rd.pendingUSD)}`
        : `Need $${formatUSD(PAYOUT_MIN_USD - rd.pendingUSD)} more to unlock`;
    }

    // Rate hint
    const rateEl = document.getElementById('ref-rate-hint');
    if (rateEl) {
      rateEl.textContent = tier.rate > 0
        ? `Current boost: ${(tier.rate*100).toFixed(0)}% of friends' fees — ${tier.label} tier`
        : 'Get 10 valid referrals to start earning boost rewards';
    }

    // Orders queue visually
    const orderList = document.getElementById('ref-orders-list');
    if (orderList) {
      const myReqs = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`meme_smash_payout_req_${addr.toLowerCase()}_`)) {
          try { myReqs.push(JSON.parse(localStorage.getItem(k))); } catch(e) {}
        }
      }
      myReqs.sort((a,b) => b.requestedAt - a.requestedAt);
      if (myReqs.length === 0) {
        orderList.innerHTML = '';
      } else {
        orderList.innerHTML = `<div class="ref-section-label" style="margin-top:10px;">Your Payout Orders</div>` + 
          myReqs.map(r => `
            <div class="ref-item" style="border:1.5px dashed rgba(155,59,219,0.22); margin-bottom:5px;">
              <div class="ref-item-info">
                <span class="ref-item-name">$${formatUSD(r.amountUSD)} <span style="font-size:10px;font-style:italic;color:var(--text-mid);font-weight:700;">— ${new Date(r.requestedAt).toLocaleDateString()}</span></span>
              </div>
              <div class="ref-item-right">
                 <span class="ref-item-status ${r.status==='paid'?'valid':'pending'}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
              </div>
            </div>
          `).join('');
      }
    }
  }

  function renderTierTrack(validCount) {
    const el = document.getElementById('tier-track');
    if (!el) return;
    const fillPct = computeTierFillPct(validCount);
    let ctIdx = 0;
    for (let i = REF_TIER_DEFS.length - 1; i >= 0; i--) {
      if (validCount >= REF_TIER_DEFS[i].min) { ctIdx = i; break; }
    }
    let html = `<div class="tier-bg-line"></div>
                <div class="tier-fill-line" style="width:${fillPct}%"></div>`;
    REF_TIER_DEFS.forEach((t, i) => {
      const state = i < ctIdx ? 'passed' : (i === ctIdx ? 'active' : '');
      html += `<div class="tier-node ${state}">
        <div class="tier-dot"></div>
        <div class="tier-info">
          <div class="tier-lbl">${t.label}</div>
          <div class="tier-min">${t.min === 0 ? 'Start' : t.min + '+'}</div>
          <div class="tier-rate">${t.rate > 0 ? (t.rate*100).toFixed(0)+'%' : '—'}</div>
        </div></div>`;
    });
    el.innerHTML = html;
  }

  /* ── Admin Panel ── */
  function showAdminPanel() {
    const addr = Web3.getConnectedAddress();
    if (!isAdminWallet(addr)) { alert('Admin access only.'); return; }
    renderAdminPanel();
    document.getElementById('modal-admin').classList.add('active');
  }
  function closeAdminPanel() {
    document.getElementById('modal-admin').classList.remove('active');
  }

  let _adminTab = 'queue';
  function adminSwitchTab(tab) {
    _adminTab = tab;
    document.getElementById('admin-pane-queue').style.display = tab === 'queue' ? 'block' : 'none';
    document.getElementById('admin-pane-users').style.display = tab === 'users' ? 'block' : 'none';
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderAdminPanel();
  }

  async function _getAllPayoutReqs() {
    try {
      const snap = await getDocs(query(collection(db, 'payoutRequests'), orderBy('requestedAt', 'desc')));
      const out = [];
      snap.forEach(doc => out.push(doc.data()));
      return out;
    } catch(e) { console.warn(e); return []; }
  }

  async function _getAllUsers() {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const out = [];
      snap.forEach(doc => {
        const d = doc.data();
        out.push({ addr: doc.id, profile: d.profile||{}, fees: d.fees||{}, binding: d.binding||null, refData: d.refData||{} });
      });
      return out;
    } catch(e) { console.warn(e); return []; }
  }

  async function adminMarkPaid(userAddr, reqTime) {
    if (!confirm(`Are you sure you want to Pay ${userAddr} via wallet?`)) return;
    const key = `meme_smash_payout_req_${userAddr.toLowerCase()}_${reqTime}`;
    const raw = localStorage.getItem(key);
    if (!raw) { alert('Request not found on this device.'); return; }
    const req = JSON.parse(raw);

    const btn = document.getElementById(`btn-pay-${reqTime}`);
    const origText = btn ? btn.textContent : 'Mark Paid';
    if (btn) { btn.disabled = true; btn.textContent = 'Trxf...'; }

    try {
      // Prompt wallet Tx
      await Web3.payReferralPayout(userAddr, req.amountUSD);

      // Save locally & cloud
      req.status = 'paid'; req.paidAt = Date.now();
      localStorage.setItem(key, JSON.stringify(req));
      setDoc(doc(db, 'payoutRequests', key), req).catch(e=>console.warn(e));

      const rd = getRefData(userAddr);
      rd.paidOutUSD = (rd.paidOutUSD || 0) + req.amountUSD;
      rd.payoutHistory.push({ amount: req.amountUSD, paidAt: Date.now() });
      saveRefData(userAddr, rd);
      alert(`Marked paid! $${formatUSD(req.amountUSD)} sent to ${userAddr}`);
    } catch(e) {
      console.error(e);
      alert('Wallet payment failed or was rejected. Keeping as Pending.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      renderAdminPanel();
    }
  }

  async function renderAdminPanel() {
    const viewerAddr = Web3.getConnectedAddress();
    if (!isAdminWallet(viewerAddr)) return;

    const filterAddr = window._adminSearchFilter;
    const qEl = document.getElementById('admin-payout-queue');
    const uEl = document.getElementById('admin-users-list');
    const summaryEl = document.getElementById('admin-user-summary');

    /* ----- Payout Queue ----- */
    if (qEl && _adminTab === 'queue') {
      const all = await _getAllPayoutReqs();
      const pending = all.filter(r => r.status === 'pending');
      const paid    = all.filter(r => r.status === 'paid');
      let html = '';
      if (!pending.length) html += '<div class="admin-empty">No pending payout requests on this device</div>';
      pending.forEach(r => {
        html += `<div class="admin-req-card">
          <div class="admin-req-main">
            <div class="admin-req-name">${escHtml(r.name||'Unknown')}</div>
            <a class="admin-req-addr" href="https://basescan.org/address/${r.addr}" target="_blank" rel="noopener">
              ${r.addr.slice(0,10)}...${r.addr.slice(-8)} ↗</a>
            <div class="admin-req-amount">$${formatUSD(r.amountUSD)}</div>
            <div class="admin-req-date">${new Date(r.requestedAt).toLocaleDateString()}</div>
          </div>
          <div class="admin-req-actions">
            <button class="btn-admin-pay" id="btn-pay-${r.requestedAt}" onclick="Game.adminMarkPaid('${r.addr}', ${r.requestedAt})">Pay Now</button>
            <button class="btn-admin-copy" onclick="navigator.clipboard.writeText('${r.addr}').then(()=>this.textContent='Copied!').catch(()=>{})">Copy Addr</button>
          </div></div>`;
      });
      if (paid.length) {
        html += `<div class="admin-sec-lbl">Completed (${paid.length})</div>`;
        paid.slice(0,15).forEach(r => {
          html += `<div class="admin-req-card paid">
            <div class="admin-req-main">
              <div class="admin-req-name">${escHtml(r.name||'Unknown')}</div>
              <a class="admin-req-addr" href="https://basescan.org/address/${r.addr}" target="_blank" rel="noopener">
                ${r.addr.slice(0,10)}...${r.addr.slice(-8)} ↗</a>
              <div class="admin-req-amount">$${formatUSD(r.amountUSD)} — Paid ${new Date(r.paidAt||r.requestedAt).toLocaleDateString()}</div>
            </div></div>`;
        });
      }
      qEl.innerHTML = html;
    }

    if (uEl && _adminTab === 'users') {
      let users = await _getAllUsers();
      
      if (filterAddr) {
        users = users.filter(u => u.addr.toLowerCase() === filterAddr.toLowerCase());
      }

      // Render Summary if filtering
      if (filterAddr && users.length > 0 && summaryEl) {
        const u = users[0];
        const valids = (u.refData?.referrals||[]).filter(r=>r.status==='valid').length;
        const overallRefVolume = (u.refData?.referrals||[]).reduce((sum, r) => sum + (r.feesUSD || 0), 0);
        
        summaryEl.innerHTML = `
          <div class="admin-summary-card">
            <div class="summary-header">
              <span class="summary-title">User Insights</span>
              <button class="btn btn-secondary" style="margin:0; padding:6px 12px; font-size:11px;" onclick="Game.showPublicProfile('${u.addr}')">View Profile</button>
            </div>
            <div class="summary-grid">
              <div class="summary-item">
                <div class="summary-label">Total Spent Fees</div>
                <div class="summary-value highlight">$${(u.fees?.totalUSD||0).toFixed(3)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Total Referral Volume</div>
                <div class="summary-value highlight" style="background:linear-gradient(135deg, #00C853, #64DD17);-webkit-background-clip:text;">$${formatUSD(overallRefVolume)}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Total Invites / Valid</div>
                <div class="summary-value">${(u.refData?.referrals||[]).length} / ${valids}</div>
              </div>
              <div class="summary-item" style="opacity:0.6;">
                <div class="summary-label">Total Games Played</div>
                <div class="summary-value">${u.fees?.gamesSubmitted||0}</div>
              </div>
            </div>
            <div style="font-size:10px; color:#666; margin-top:10px; font-family:monospace; line-height:1.4;">
              ID: ${u.addr}<br>
              Name: ${u.profile?.name || 'Unnamed'}<br>
              Twitter: ${u.profile?.socials?.twitter || 'Not Linked'}<br>
              Telegram: ${u.profile?.socials?.telegram || 'Not Linked'}
            </div>
          </div>
        `;
      } else if (summaryEl) {
        summaryEl.innerHTML = '';
      }

      if (!users.length) {
        uEl.innerHTML = '<div class="admin-empty">' + (filterAddr ? 'User history not found' : 'No user profiles found') + '</div>';
      } else {
        uEl.innerHTML = users.map(({addr, profile, fees, binding, refData}) => {
          const valids = (refData?.referrals||[]).filter(r=>r.status==='valid').length;
          const txRows = (fees?.txHistory||[]).slice(-15).reverse()
            .map(t=>`<span class="admin-tx">${t.type} $${formatUSD(t.amountUSD)} · ${new Date(t.ts).toLocaleDateString()}</span>`).join('');
          return `<div class="admin-user-card">
            <div class="admin-user-hdr">
              <span class="admin-user-name">${escHtml(profile.name||'Unnamed')}</span>
              <a class="admin-user-scan" href="https://basescan.org/address/${addr}" target="_blank" rel="noopener">
                ${addr.slice(2,8)}...${addr.slice(-6)} ↗</a>
            </div>
            <div class="admin-user-stats">
              <span>Games: ${fees?.gamesSubmitted||0}</span>
              <span>Spent: $${(fees?.totalUSD||0).toFixed(3)}</span>
              <span>MP: ${profile.cumulativeScore||0}</span>
              <span>Refs: ${(refData?.referrals||[]).length} (${valids} valid)</span>
              <span>Revives: ${fees?.revives||0}</span>
              <span>Check-ins: ${fees?.checkins||0}</span>
            </div>
            ${binding ? `<div class="admin-user-ref">Referred by:
              <a href="https://basescan.org/address/${binding.referrerAddr}" target="_blank" rel="noopener">
                ${binding.referrerAddr.slice(0,8)}...${binding.referrerAddr.slice(-6)} ↗
              </a> <em>${binding.method}${binding.onchain?' (onchain)':''}</em></div>` : ''}
            <div class="admin-tx-hist">${txRows}</div>
          </div>`;
        }).join('');
      }
    }
  }

  /* ═══════════════════════════════════════════
     DAILY TASKS LOGIC
  ═══════════════════════════════════════════ */
  const TASK_DEFS = {
    'daily-play-1':   { type: 'daily',  qty: 1,   reward: 100,  label: 'Daily Ninja', desc: 'Play 1 submitted game' },
    'daily-play-5':   { type: 'daily',  qty: 5,   reward: 500,  label: 'Meme Warrior', desc: 'Play 5 submitted games' },
    'daily-revive-1': { type: 'daily',  qty: 1,   reward: 300,  label: 'Survivor', desc: 'Revive 1 time in a game' },
    'daily-revive-5': { type: 'daily',  qty: 5,   reward: 1000, label: 'Immortal', desc: 'Revive 5 times total' },
    'weekly-streak-7':{ type: 'streak', qty: 7,   reward: 1000, label: 'Loyal Legend', desc: '7-Day Check-in Streak' },
    'ref-1':          { type: 'ref',    qty: 1,   reward: 100,  label: 'Social Ninja', desc: 'Invite 1 friend' },
    'ref-10':         { type: 'ref',    qty: 10,  reward: 1000, label: 'Team Leader', desc: 'Invite 10 friends' },
    'ref-100':        { type: 'ref',    qty: 100, reward: 10000,label: 'Community King', desc: 'Invite 100+ friends' },
  };

  /** Task reset (daily) logic */
  function _ensureTaskStats(profile) {
    const today = getUtcDayNumber();
    if (!profile.taskStats) {
      profile.taskStats = { dailyPlays: 0, dailyRevives: 0, lastResetDay: today, claims: {} };
    }
    if (profile.taskStats.lastResetDay !== today) {
      profile.taskStats.dailyPlays = 0;
      profile.taskStats.dailyRevives = 0;
      profile.taskStats.lastResetDay = today;
      // Wipe daily claims so they can be re-earned tomorrow
      for (let id in (profile.taskStats.claims||{})) {
        if (TASK_DEFS[id] && TASK_DEFS[id].type === 'daily') {
          delete profile.taskStats.claims[id];
        }
      }
    }
    return profile;
  }

  function recordTaskAction(type) {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    let profile = getProfileData(addr);
    profile = _ensureTaskStats(profile);
    if (type === 'play') profile.taskStats.dailyPlays++;
    if (type === 'revive') profile.taskStats.dailyRevives++;
    saveProfileData(addr, profile);
  }

  function getTaskProgress(id, addr) {
    const profile = getProfileData(addr);
    const def = TASK_DEFS[id];
    if (!def) return 0;

    if (def.type === 'daily') {
      if (id.includes('play')) return (profile.taskStats||{}).dailyPlays || 0;
      if (id.includes('revive')) return (profile.taskStats||{}).dailyRevives || 0;
    }
    if (def.type === 'streak') {
      return getCheckinStatus(addr).currentStreak || 0;
    }
    if (def.type === 'ref') {
      return getRefData(addr).referrals.length || 0;
    }
    return 0;
  }

  function showTasksModal() {
    const addr = Web3.getConnectedAddress();
    if (!addr) { showToast("Connect wallet to view tasks!", "⚠️"); return; }
    
    let profile = getProfileData(addr);
    profile = _ensureTaskStats(profile);
    saveProfileData(addr, profile);

    renderTasksModal();
    showScreen('screen-tasks');
  }

  function renderTasksModal() {
    const addr = Web3.getConnectedAddress();
    const list = document.getElementById('tasks-list');
    if (!list || !addr) return;

    const profile = getProfileData(addr);
    const claims = (profile.taskStats||{}).claims || {};
    
    let html = '';
    let totalClaimable = 0;

    // Categories
    const categories = {
      'daily': { label: 'Daily Missions', icon: '⚡' },
      'streak':{ label: 'Consistency Goals', icon: '🔥' },
      'ref':   { label: 'Expansion Tasks', icon: '🌍' }
    };

    for (let cat in categories) {
      html += `<div class="task-section-title">${categories[cat].icon} ${categories[cat].label}</div>`;
      
      for (let id in TASK_DEFS) {
        const def = TASK_DEFS[id];
        if (def.type !== cat) continue;

        const progress = getTaskProgress(id, addr);
        const isComplete = progress >= def.qty;
        const isClaimed = !!claims[id];
        const fillPct = Math.min(100, (progress / def.qty) * 100);

        if (isComplete && !isClaimed) {
          totalClaimable += def.reward;
        }

        const actionHtml = isClaimed
          ? '<div class="task-done-badge">✅ Done</div>'
          : (isComplete
              ? `<button class="btn btn-primary btn-task-claim" onclick="Game.doTaskClaim(['${id}'])">Claim</button>`
              : '<button class="btn btn-secondary btn-task-claim" disabled style="opacity:0.45;">🔒</button>');

        html += `
          <div class="task-card">
            <div class="task-left">
              <div class="task-top-row">
                <span class="task-name">${def.label}</span>
                <span class="task-reward">+${def.reward} MP</span>
              </div>
              <div style="display:flex;align-items:center;gap:5px;">
                <div class="task-progress-container" style="flex:1;">
                  <div class="task-progress-bar" style="width:${fillPct}%"></div>
                </div>
                <span class="task-progress-text">${progress}/${def.qty}</span>
              </div>
            </div>
            <div class="task-action">${actionHtml}</div>
          </div>
        `;
      }
    }

    list.innerHTML = html;
    
    const batchStats = document.getElementById('batch-stats');
    const batchBtn   = document.getElementById('btn-batch-claim');

    if (batchStats) batchStats.textContent = `Total Claimable: ${totalClaimable} Meme Points`;
    if (batchBtn) {
      batchBtn.disabled = totalClaimable === 0;
      batchBtn.textContent = `Batch Claim All (${totalClaimable} MP)`;
    }
  }

  async function doTaskClaim(ids) {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    
    let totalReward = 0;
    ids.forEach(id => { totalReward += TASK_DEFS[id].reward; });
    if (totalReward <= 0) return;

    try {
      // Corrected: use standard receiver address to avoid simulation failure
      await Web3.sendETH(Web3.RECEIVER_ADDRESS, 0.01); 

      const profile = getProfileData(addr);
      profile.cumulativeScore = (profile.cumulativeScore || 0) + totalReward;
      
      // Mark claimed
      if (!profile.taskStats.claims) profile.taskStats.claims = {};
      ids.forEach(id => {
        profile.taskStats.claims[id] = Date.now();
      });

      saveProfileData(addr, profile);
      refreshProfileUI(addr);
      showToast(`${totalReward} Meme Points Claimed!`, "🏆");
      renderTasksModal();
    } catch(e) {
      console.error(e);
      showToast("Claim failed. Please try again.", "❌");
    }
  }

  function doBatchClaim() {
    const addr = Web3.getConnectedAddress();
    if (!addr) return;
    
    const profile = getProfileData(addr);
    const claims = (profile.taskStats||{}).claims || {};
    let toClaim = [];

    for (let id in TASK_DEFS) {
      const def = TASK_DEFS[id];
      const progress = getTaskProgress(id, addr);
      if (progress >= def.qty && !claims[id]) {
        toClaim.push(id);
      }
    }
    if (toClaim.length > 0) doTaskClaim(toClaim);
  }

  /* ═══════════════════════════════════════════
     EXPORT PUBLIC API
  ═══════════════════════════════════════════ */

  return { 
    init, 
    startGame, 
    restartGame, 
    showLeaderboard, 
    goHome, 
    toggleSettings, 
    resumeGame, 
    toggleMute, 
    goHomeFromPause,
    handleWalletAction,
    updatePlayButtonState,
    reviveMenu,
    submitScoreMenu,
    showProfile,
    saveProfileName,
    saveSocials,
    copySocialExternal,
    addAlternativeAddress,
    removeAlternativeAddress,
    copyAddress,
    setLeaderboardMode,
    showPublicProfile,
    closePublicProfile,
    showCheckinModal,
    closeCheckinModal,
    doCheckin,
    showReferModal,
    closeReferModal,
    copyRefCode,
    copyRefLink,
    doManualRefBind,
    showOnchainBind,
    doOnchainRefBind,
    showFullRefsModal,
    filterFullRefs,
    closeFullRefsModal,
    requestPayout,
    showAdminPanel,
    closeAdminPanel,
    adminSwitchTab,
    adminMarkPaid,
    adminSearchUser,
    confirmLeave,
    cancelLeave,
    leaveAndSubmit,
    toggleRefInfo,
    resetGlobalLeaderboard,
    copyLeaderboardData,
    showTasksModal: function() { return showTasksModal(); },
    doTaskClaim: function(ids) { return doTaskClaim(ids); },
    doBatchClaim: function() { return doBatchClaim(); },
  };

})();

window.Game = Game;
window.addEventListener('DOMContentLoaded', () => {
  Game.init();
  // Periodically check wallet state as a fallback
  setInterval(Game.updatePlayButtonState, 2000);
});
