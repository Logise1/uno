import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCmIeRH5j1b3TdVQA6amPs67e2QqzIYXoI",
    authDomain: "spinshot-8d13d.firebaseapp.com",
    projectId: "spinshot-8d13d",
    storageBucket: "spinshot-8d13d.firebasestorage.app",
    messagingSenderId: "678712302906",
    appId: "1:678712302906:web:74efdc7dca6c2fb7c08403"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === SOUND MANAGER ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioUnlocked = false;

document.addEventListener('click', () => {
    if (!audioUnlocked && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => audioUnlocked = true);
    }
}, { once: true });

function playTone(freq, type, duration, vol = 0.1) {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const sfx = {
    draw: () => { playTone(400, 'sine', 0.1, 0.05); setTimeout(() => playTone(600, 'sine', 0.15, 0.05), 50); },
    place: () => playTone(250, 'square', 0.1, 0.05),
    turn: () => { playTone(500, 'triangle', 0.1, 0.05); setTimeout(() => playTone(800, 'triangle', 0.2, 0.05), 100); },
    error: () => playTone(150, 'sawtooth', 0.3, 0.05),
    win: () => { [400, 500, 600, 800, 1000].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.2, 0.05), i * 100)); },
    deal: () => playTone(300, 'sine', 0.05, 0.02)
};
window.sfx = sfx;

let isHost = false;
let currentRoomId = null;
let myPlayerId = null;
let playerName = "";
let roomData = null;
let selectedCardData = null;
let selectedCardElement = null;
let wakeLock = null;
let renderedDiscardCount = 0;
let previousTurn = null;
let isHandVisible = false;

const GAME_APP_ID = 'spinshot-8d13d';
function getRoomDocRef(rId) {
    return doc(db, 'artifacts', GAME_APP_ID, 'public', 'data', 'rooms', rId);
}

// INICIO Y RUTEO
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentRoomId = urlParams.get('room');
    myPlayerId = parseInt(urlParams.get('p'));
    isHost = !currentRoomId;

    signInAnonymously(auth).catch(e => alert("Error de conexión. Recarga."));

    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.getElementById('loading-screen').classList.add('hidden');
            if (isHost) initHost();
            else initPlayer();
        }
    });
};

// ================= ANFITRIÓN =================
async function initHost() {
    document.getElementById('host-view').classList.remove('hidden');
    currentRoomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const docRef = getRoomDocRef(currentRoomId);

    const initialState = {
        status: 'waiting',
        gameType: 'uno',
        strictView: true,
        turn: 1,
        direction: 1,
        drawStack: 0,
        currentColor: '',
        activeTurns: 1,
        winner: null,
        discardPile: [],
        deck: [],
        lastPlayerId: null,
        players: {
            1: { joined: false, alive: true, name: '', cards: [] },
            2: { joined: false, alive: true, name: '', cards: [] },
            3: { joined: false, alive: true, name: '', cards: [] },
            4: { joined: false, alive: true, name: '', cards: [] }
        }
    };
    await setDoc(docRef, initialState);

    const baseUrl = window.location.href.split('?')[0];
    for (let i = 1; i <= 4; i++) {
        new QRCode(document.getElementById(`qr-${i}`), {
            text: `${baseUrl}?room=${currentRoomId}&p=${i}`,
            width: 120, height: 120,
            colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L
        });
    }

    onSnapshot(docRef, (snap) => {
        roomData = snap.data();
        if (roomData) updateHostUI();
    });

    document.getElementById('btn-start-game').addEventListener('click', hostStartGame);
    document.getElementById('btn-restart').addEventListener('click', hostRestartGame);

    // Config listener
    document.getElementById('strict-view-check').addEventListener('change', async (e) => {
        if (roomData) {
            await updateDoc(docRef, { strictView: e.target.checked });
        }
    });
}

function updateHostUI() {
    let joinedCount = 0;
    for (let i = 1; i <= 4; i++) {
        const p = roomData.players[i];
        if (p.joined) {
            joinedCount++;
            const nameLabel = document.getElementById(`name-${i}`);

            // Remplazar QR con visto bueno
            if (nameLabel && nameLabel.innerText === 'Esperando...') {
                document.getElementById(`qr-${i}`).innerHTML = `<div class="w-28 h-28 bg-green-500 rounded-xl flex items-center justify-center"><i class="fa-solid fa-check text-5xl text-white"></i></div>`;
                sfx.deal(); // Ding a player joined
            }

            // Actualizar vista dependiendo de quien tenga el turno
            if (!p.alive && roomData.status === 'playing') {
                nameLabel.innerHTML = `<i class="fa-solid fa-skull"></i> ${p.name}`;
                nameLabel.className = "mt-2 font-black text-xl text-red-500 bg-black/80 px-4 py-1 rounded-full";
            } else if (roomData.status === 'playing' && roomData.turn === i) {
                nameLabel.innerHTML = `<i class="fa-solid fa-star text-yellow-300"></i> ${p.name} <i class="fa-solid fa-star text-yellow-300"></i>`;
                nameLabel.className = "mt-2 font-black text-3xl text-white bg-yellow-600/90 px-6 py-2 rounded-full shadow-[0_0_40px_rgba(234,179,8,1)] border-4 border-yellow-300 animate-pulse";
            } else {
                nameLabel.innerHTML = p.name || `Jugador ${i}`;
                nameLabel.className = "mt-2 font-black text-2xl text-green-400 bg-black/80 px-4 py-1 rounded-full shadow-lg";
            }
        }
    }

    const btnStart = document.getElementById('btn-start-game');
    const chkStrict = document.getElementById('strict-view-check');
    if (chkStrict.checked !== roomData.strictView && roomData.status === 'waiting') {
        chkStrict.checked = roomData.strictView;
    }

    if (joinedCount === 0) {
        btnStart.disabled = true;
        document.getElementById('host-status-msg').innerText = "Esperando jugadores...";
    } else {
        btnStart.disabled = false;
        document.getElementById('host-status-msg').innerText = `${joinedCount} jugador(es) listo(s).`;
    }

    if (roomData.status === 'playing') {
        document.getElementById('host-setup-ui').classList.add('hidden');
        document.getElementById('table-qrs').style.opacity = '0.3';
        document.getElementById('host-game-ui').classList.remove('hidden');

        const activeName = roomData.players[roomData.turn].name;
        document.getElementById('host-turn-indicator').innerText = `Turno de: ${activeName}`;

        if (roomData.gameType === 'uno') {
            document.getElementById('host-direction').innerText = roomData.direction === 1 ? '↻' : '↺';
        } else {
            document.getElementById('host-direction').innerText = '';
        }

        const pileDiv = document.getElementById('discard-pile');
        if (roomData.currentColor) {
            pileDiv.style.setProperty('--wild-color', getHexColor(roomData.currentColor));
            pileDiv.classList.add('wild-ring');
        } else {
            pileDiv.classList.remove('wild-ring');
        }

        if (roomData.discardPile && roomData.discardPile.length > renderedDiscardCount) {
            for (let i = renderedDiscardCount; i < roomData.discardPile.length; i++) {
                const card = roomData.discardPile[i];
                const cardEl = createCardHTML(card, true);
                const rot = (Math.random() * 40) - 20;
                cardEl.style.setProperty('--target-rot', `rotate(${rot}deg)`);

                // Throwing animation
                let startTransform = "translate(0px, 0px)";
                const pId = roomData.lastPlayerId;
                if (pId) {
                    if (pId === 1) startTransform = "translate(0px, 400px)";
                    if (pId === 2) startTransform = "translate(-400px, 0px)";
                    if (pId === 3) startTransform = "translate(0px, -400px)";
                    if (pId === 4) startTransform = "translate(400px, 0px)";
                }

                cardEl.style.setProperty('--start-transform', startTransform);
                cardEl.classList.remove('relative');
                cardEl.classList.add('anim-drop-in');
                pileDiv.appendChild(cardEl);

                if (i === roomData.discardPile.length - 1) sfx.place();
            }
            renderedDiscardCount = roomData.discardPile.length;
        }

        if (roomData.winner && document.getElementById('host-victory-ui').classList.contains('hidden')) {
            sfx.win();
            document.getElementById('host-victory-ui').classList.remove('hidden');
            document.getElementById('host-winner-name').innerText = roomData.players[roomData.winner].name.toUpperCase();
        }
    }
}

async function hostStartGame() {
    sfx.deal();
    const gameType = document.getElementById('game-select').value;
    const isStrict = document.getElementById('strict-view-check').checked;
    const deck = createDeck(gameType);

    const newPlayers = { ...roomData.players };
    let firstJoined = null;

    for (let i = 1; i <= 4; i++) {
        if (newPlayers[i].joined) {
            if (!firstJoined) firstJoined = i;
            newPlayers[i].alive = true;
            if (gameType === 'ek') {
                newPlayers[i].cards = deck.splice(0, 4);
                newPlayers[i].cards.push({ game: 'ek', type: 'desactivar', value: 'Desactivar', bgColor: 'bg-green-600', id: genId() });
            } else {
                newPlayers[i].cards = deck.splice(0, 7);
            }
        }
    }

    let discardPile = [];
    if (gameType === 'uno') {
        let firstCardIdx = deck.findIndex(c => !isNaN(c.value));
        if (firstCardIdx === -1) firstCardIdx = 0;
        discardPile = [deck.splice(firstCardIdx, 1)[0]];
    } else {
        discardPile = [{ game: 'ek', type: 'fondo', value: 'Mazo', bgColor: 'bg-gray-800', id: 'start' }];
        let numJoined = [1, 2, 3, 4].filter(i => newPlayers[i].joined).length;
        for (let k = 0; k < numJoined - 1; k++) {
            deck.push({ game: 'ek', type: 'gatito', value: 'Explosión', bgColor: 'bg-red-800', textColor: 'text-white', id: genId() });
        }
        deck.sort(() => Math.random() - 0.5);
    }

    await updateDoc(getRoomDocRef(currentRoomId), {
        status: 'playing', gameType: gameType, strictView: isStrict,
        deck: deck, discardPile: discardPile,
        players: newPlayers, turn: firstJoined,
        direction: 1, drawStack: 0, currentColor: '', activeTurns: 1,
        winner: null, lastPlayerId: null
    });
}

async function hostRestartGame() {
    document.getElementById('host-victory-ui').classList.add('hidden');
    document.getElementById('discard-pile').innerHTML = '';
    document.getElementById('discard-pile').classList.remove('wild-ring');
    renderedDiscardCount = 0;
    await hostStartGame();
}

// ================= JUGADOR =================
function initPlayer() {
    document.getElementById('player-view').classList.remove('hidden');
    document.getElementById('display-player-id').innerText = myPlayerId;

    document.getElementById('btn-join').addEventListener('click', async () => {
        playerName = document.getElementById('player-name-input').value.trim() || `Jugador ${myPlayerId}`;
        await playerJoin();
    });
    document.getElementById('btn-place').addEventListener('click', () => { sfx.place(); playerPlaceCard(); });
    document.getElementById('btn-draw').addEventListener('click', () => { sfx.draw(); playerDrawCard(); });

    document.getElementById('btn-toggle-eye').addEventListener('click', () => {
        isHandVisible = !isHandVisible;
        sfx.deal();
        updatePlayerUI();
    });

    document.getElementById('btn-show-cards').addEventListener('click', () => {
        isHandVisible = true;
        sfx.deal();
        updatePlayerUI();
    });

    window.selectColor = (color) => {
        sfx.place();
        document.getElementById('color-picker-ui').classList.add('hidden');
        executePlayCard(selectedCardData, color);
    };

    onSnapshot(getRoomDocRef(currentRoomId), (snap) => {
        roomData = snap.data();
        if (roomData) updatePlayerUI();
    });
}

async function playerJoin() {
    sfx.deal();
    try { if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); } catch (e) { }
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }

    const docRef = getRoomDocRef(currentRoomId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
        await updateDoc(docRef, {
            [`players.${myPlayerId}.joined`]: true,
            [`players.${myPlayerId}.name`]: playerName
        });
    }

    document.getElementById('join-ui').classList.add('hidden');
    document.getElementById('wait-name-display').innerText = `¡Hola, ${playerName}!`;
    document.getElementById('wait-ui').classList.remove('hidden');
}

function updatePlayerUI() {
    if (roomData.status !== 'playing') return;

    document.getElementById('wait-ui').classList.add('hidden');
    document.getElementById('play-ui').classList.remove('hidden');

    const me = roomData.players[myPlayerId];

    if (!me.alive && !roomData.winner) {
        document.getElementById('player-end-ui').classList.remove('hidden');
        document.getElementById('player-end-title').innerText = "¡EXPLOTASTE! 💥";
        document.getElementById('player-end-title').className = "text-5xl font-black mb-4 text-red-500 text-center";
        return;
    }

    if (roomData.turn !== previousTurn) {
        if (roomData.turn === myPlayerId) {
            sfx.turn();
        } else {
            isHandVisible = false;
        }
        previousTurn = roomData.turn;
    }

    const eyeIcon = document.getElementById('eye-icon');
    if (isHandVisible) {
        eyeIcon.className = "fa-solid fa-eye text-blue-400";
    } else {
        eyeIcon.className = "fa-solid fa-eye-slash text-gray-400";
    }

    document.getElementById('card-count').innerText = me.cards.length;
    renderPlayerHand(me.cards);

    const showHandOverlay = document.getElementById('show-hand-overlay');
    if (roomData.turn === myPlayerId && !isHandVisible) {
        showHandOverlay.classList.remove('hidden');
    } else {
        showHandOverlay.classList.add('hidden');
    }

    const topCardInfo = document.getElementById('top-card-info');
    if (roomData.strictView) {
        topCardInfo.classList.add('invisible'); // hide visually but keep layout
    } else {
        topCardInfo.classList.remove('invisible');
    }

    const topCard = roomData.discardPile[roomData.discardPile.length - 1];
    const miniTop = document.getElementById('mini-top-card');
    let displayBg = topCard.bgColor;
    if (roomData.currentColor) displayBg = roomData.currentColor;
    miniTop.className = `inline-flex w-16 h-24 rounded-lg border-2 border-gray-500 items-center justify-center font-black text-xl shadow-md ${displayBg}`;
    miniTop.innerHTML = getCardContentHTML(topCard, false);

    const isMyTurn = (roomData.turn === myPlayerId);
    const turnBanner = document.getElementById('my-turn-banner');
    const subBanner = document.getElementById('turn-sub-banner');
    const notMyTurn = document.getElementById('not-my-turn-banner');
    const btnDraw = document.getElementById('btn-draw');
    const btnPlace = document.getElementById('btn-place');

    if (roomData.gameType === 'ek') {
        const ekInd = document.getElementById('ek-turns-indicator');
        if (roomData.activeTurns > 1) {
            ekInd.classList.remove('hidden');
            document.getElementById('ek-turns-count').innerText = roomData.activeTurns - 1;
        } else { ekInd.classList.add('hidden'); }
    }

    const opponentsContainer = document.getElementById('opponents-container');

    if (isMyTurn) {
        turnBanner.classList.remove('-translate-y-full');
        notMyTurn.classList.add('hidden');
        btnDraw.classList.remove('hidden');
        if (opponentsContainer) opponentsContainer.style.marginTop = turnBanner.offsetHeight + "px";

        if (roomData.gameType === 'uno' && roomData.drawStack > 0) {
            subBanner.classList.remove('hidden');
            subBanner.innerText = `¡Acumulado: +${roomData.drawStack}!`;
            btnDraw.innerHTML = `<i class="fa-solid fa-layer-group"></i> Robar ${roomData.drawStack} y Pasar`;
            btnDraw.className = "bg-red-600 text-white px-8 py-4 rounded-full font-bold text-xl shadow-[0_0_20px_rgba(220,38,38,0.8)] active:scale-95 transition-transform flex items-center gap-2 animate-pulse relative z-[150] cursor-pointer pointer-events-auto border-2 border-red-400";
        } else {
            subBanner.classList.add('hidden');
            btnDraw.innerHTML = roomData.gameType === 'ek' ? `<i class="fa-solid fa-forward"></i> Terminar (Robar)` : `<i class="fa-solid fa-hand-holding"></i> Robar Carta`;
            btnDraw.className = "bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-5 rounded-full font-black text-2xl shadow-[0_10px_30px_rgba(147,51,234,0.4)] active:scale-95 transition-transform flex items-center gap-3 relative z-[150] cursor-pointer pointer-events-auto border-2 border-purple-400";
        }

        if (selectedCardData && isValidPlay(selectedCardData, topCard, roomData) && isHandVisible) {
            btnPlace.classList.remove('hidden');
        } else {
            btnPlace.classList.add('hidden');
        }
    } else {
        turnBanner.classList.add('-translate-y-full');
        notMyTurn.classList.remove('hidden');
        document.getElementById('current-turn-name').innerText = roomData.players[roomData.turn].name;
        btnDraw.classList.add('hidden');
        btnPlace.classList.add('hidden');
        if (opponentsContainer) opponentsContainer.style.marginTop = "0px";
    }

    if (opponentsContainer) {
        opponentsContainer.innerHTML = '';
        for (let i = 1; i <= 4; i++) {
            const p = roomData.players[i];
            if (i !== myPlayerId && p.joined) {
                const oppDiv = document.createElement('div');
                oppDiv.className = `flex flex-col items-center mx-2 transition-transform ${!p.alive ? 'opacity-40 grayscale' : ''}`;

                const nameEl = document.createElement('span');
                nameEl.className = `text-[10px] font-black tracking-wider uppercase mb-1 px-2 py-0.5 rounded-full ${roomData.turn === i ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,1)] animate-pulse' : 'text-gray-300 bg-black/50 border border-gray-600'}`;
                nameEl.innerHTML = p.name || `J${i}`;

                const cardsDiv = document.createElement('div');
                cardsDiv.className = 'flex -space-x-3 items-center mt-1';
                const numCards = p.cards ? p.cards.length : 0;

                if (numCards > 0) {
                    const maxDisplay = 10;
                    const displayCount = Math.min(numCards, maxDisplay);

                    for (let c = 0; c < displayCount; c++) {
                        const miniCard = document.createElement('div');
                        miniCard.className = `w-5 h-8 rounded-sm border border-white/30 shadow-[0_2px_4px_rgba(0,0,0,0.8)] flex-shrink-0 ${roomData.gameType === 'ek' ? 'bg-gray-800' : 'bg-red-600'}`;
                        const rot = (Math.random() * 8) - 4;
                        miniCard.style.transform = `rotate(${rot}deg)`;
                        cardsDiv.appendChild(miniCard);
                    }

                    const countBadge = document.createElement('div');
                    countBadge.className = 'w-5 h-5 bg-black text-white text-[10px] font-bold rounded-full flex items-center justify-center relative -left-2 z-10 border border-gray-500 shadow-md';
                    countBadge.innerText = numCards;
                    cardsDiv.appendChild(countBadge);
                } else if (p.alive) {
                    cardsDiv.innerHTML = '<span class="text-[10px] text-gray-500 font-bold border border-gray-700 bg-gray-800 px-1 rounded">0</span>';
                }

                oppDiv.appendChild(nameEl);
                oppDiv.appendChild(cardsDiv);
                opponentsContainer.appendChild(oppDiv);
            }
        }
    }

    if (roomData.winner && document.getElementById('player-end-ui').classList.contains('hidden')) {
        document.getElementById('player-end-ui').classList.remove('hidden');
        const title = document.getElementById('player-end-title');
        if (roomData.winner === myPlayerId) {
            sfx.win();
            title.innerText = "¡GANASTE! 🏆";
            title.className = "text-5xl font-black mb-4 text-green-400 text-center";
        } else {
            title.innerText = "FIN DEL JUEGO";
            title.className = "text-5xl font-black mb-4 text-gray-400 text-center";
        }
    }
}

function renderPlayerHand(cards) {
    const container = document.getElementById('player-hand');
    container.innerHTML = '';

    if (selectedCardData && !cards.find(c => c.id === selectedCardData.id)) {
        selectedCardData = null; selectedCardElement = null;
        document.getElementById('btn-place').classList.add('hidden');
    }

    cards.forEach(card => {
        const cardEl = createCardHTML(card, false);

        if (!isHandVisible) {
            cardEl.classList.add('card-back');
            if (roomData.gameType === 'ek') cardEl.classList.add('ek-back');
        }

        if (selectedCardData && selectedCardData.id === card.id && isHandVisible) {
            cardEl.classList.add('card-selected'); selectedCardElement = cardEl;
        }

        cardEl.addEventListener('click', () => {
            if (!isHandVisible || roomData.turn !== myPlayerId) return;
            const topCard = roomData.discardPile[roomData.discardPile.length - 1];

            document.querySelectorAll('.card').forEach(c => c.classList.remove('card-selected'));

            if (isValidPlay(card, topCard, roomData)) {
                sfx.deal();
                cardEl.classList.add('card-selected');
                selectedCardData = card; selectedCardElement = cardEl;
                document.getElementById('btn-place').classList.remove('hidden');
            } else {
                sfx.error();
                cardEl.classList.add('animate-bounce', 'border-red-500');
                setTimeout(() => cardEl.classList.remove('animate-bounce', 'border-red-500'), 500);
                selectedCardData = null;
                document.getElementById('btn-place').classList.add('hidden');
            }
        });
        container.appendChild(cardEl);
    });
}

async function playerPlaceCard() {
    if (!selectedCardData || roomData.turn !== myPlayerId) return;
    document.getElementById('btn-place').classList.add('hidden');

    if (roomData.gameType === 'uno' && (selectedCardData.value === 'Cambio' || selectedCardData.value === '+4')) {
        document.getElementById('color-picker-ui').classList.remove('hidden');
        return;
    }

    await executePlayCard(selectedCardData, '');
}

async function executePlayCard(card, chosenColor) {
    try {
        document.getElementById('btn-draw').classList.add('hidden');
        if (selectedCardElement) {
            selectedCardElement.classList.remove('card-selected');
            selectedCardElement.classList.add('anim-fly-up');
        }
        await new Promise(r => setTimeout(r, 600));

        const docRef = getRoomDocRef(currentRoomId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        let data = snap.data();

        data.discardPile = data.discardPile || [];
        data.deck = data.deck || [];

        const myCards = data.players[myPlayerId].cards || [];
        const cardIndex = myCards.findIndex(c => c.id === card.id);
        if (cardIndex === -1) return;

        const playedCard = myCards.splice(cardIndex, 1)[0];
        data.discardPile.push(playedCard);
        data.currentColor = chosenColor || '';
        data.lastPlayerId = myPlayerId; // Set last player for hit animation

        if (data.gameType === 'uno') {
            if (card.value === 'Reversa') data.direction = (data.direction || 1) * -1;
            if (card.value === '+2') data.drawStack = (data.drawStack || 0) + 2;
            if (card.value === '+4') data.drawStack = (data.drawStack || 0) + 4;

            let skips = 1;
            if (card.value === 'Bloqueo') skips = 2;
            let activeCount = Object.values(data.players).filter(p => p.joined).length;
            if (activeCount === 2 && card.value === 'Reversa') skips = 2;

            for (let i = 0; i < skips; i++) {
                data.turn = getNextAliveTurn(data.turn, data.direction || 1, data.players);
            }

            if (myCards.length === 0) data.winner = myPlayerId;
        }
        else if (data.gameType === 'ek') {
            if (card.type === 'ataque') {
                data.turn = getNextAliveTurn(data.turn, 1, data.players);
                data.activeTurns = 2;
            } else if (card.type === 'saltar') {
                data.activeTurns = (data.activeTurns || 1) - 1;
                if (data.activeTurns <= 0) {
                    data.turn = getNextAliveTurn(data.turn, 1, data.players);
                    data.activeTurns = 1;
                }
            } else if (card.type === 'barajar') {
                data.deck.sort(() => Math.random() - 0.5);
            }

            let aliveCount = Object.values(data.players).filter(p => p.joined && p.alive).length;
            if (aliveCount <= 1) data.winner = myPlayerId;
        }

        await updateDoc(docRef, {
            discardPile: data.discardPile, deck: data.deck,
            [`players.${myPlayerId}.cards`]: myCards,
            turn: data.turn, direction: data.direction || 1,
            drawStack: data.drawStack || 0, currentColor: data.currentColor || "",
            activeTurns: data.activeTurns || 1, winner: data.winner !== undefined ? data.winner : null,
            lastPlayerId: data.lastPlayerId
        });
        selectedCardData = null; selectedCardElement = null;
    } catch (e) {
        console.error("Error al jugar carta", e);
        showAlert("Error de conexión al jugar: " + e.message);
        document.getElementById('btn-draw').classList.remove('hidden');
    }
}

async function playerDrawCard() {
    try {
        if (roomData.turn !== myPlayerId) return;
        document.getElementById('btn-draw').classList.add('hidden');
        document.getElementById('btn-place').classList.add('hidden');

        const docRef = getRoomDocRef(currentRoomId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        let data = snap.data();

        data.deck = data.deck || [];
        data.discardPile = data.discardPile || [];
        data.players[myPlayerId].cards = data.players[myPlayerId].cards || [];

        let amountToDraw = 1;
        if (data.gameType === 'uno' && data.drawStack > 0) {
            amountToDraw = data.drawStack;
            data.drawStack = 0;
        }

        let showMsg = null;

        for (let i = 0; i < amountToDraw; i++) {
            if (data.deck.length === 0) {
                if (data.discardPile.length > 1) {
                    const topNode = data.discardPile.pop();
                    data.deck = [...data.discardPile].sort(() => Math.random() - 0.5);
                    data.discardPile = [topNode];
                } else {
                    break;
                }
            }
            if (data.deck.length === 0) break;

            const drawnCard = data.deck.pop();

            if (data.gameType === 'ek' && drawnCard && drawnCard.type === 'gatito') {
                sfx.error(); // explosion
                const myCards = data.players[myPlayerId].cards;
                const defuseIdx = myCards.findIndex(c => c && c.type === 'desactivar');
                if (defuseIdx > -1) {
                    myCards.splice(defuseIdx, 1);
                    const pos = Math.floor(Math.random() * data.deck.length);
                    data.deck.splice(pos, 0, drawnCard);
                    showMsg = "¡USASTE DESACTIVAR! 🔧";
                } else {
                    data.players[myPlayerId].alive = false;
                    showMsg = "¡EXPLOTASTE! 💣";
                    break;
                }
            } else if (drawnCard) {
                data.players[myPlayerId].cards.push(drawnCard);
            }
        }

        if (data.players[myPlayerId].alive) {
            if (data.gameType === 'uno') {
                data.turn = getNextAliveTurn(data.turn, data.direction || 1, data.players);
            } else {
                data.activeTurns = (data.activeTurns || 1) - 1;
                if (data.activeTurns <= 0) {
                    data.turn = getNextAliveTurn(data.turn, 1, data.players);
                    data.activeTurns = 1;
                }
            }
        } else {
            data.turn = getNextAliveTurn(data.turn, 1, data.players);
            data.activeTurns = 1;

            let aliveArr = Object.entries(data.players).filter(([id, p]) => p.joined && p.alive);
            if (aliveArr.length === 1) data.winner = parseInt(aliveArr[0][0]);
        }

        if (showMsg) showAlert(showMsg);

        await updateDoc(docRef, {
            deck: data.deck, discardPile: data.discardPile,
            [`players.${myPlayerId}.cards`]: data.players[myPlayerId].cards,
            [`players.${myPlayerId}.alive`]: data.players[myPlayerId].alive,
            turn: data.turn, drawStack: data.drawStack || 0, activeTurns: data.activeTurns || 1,
            winner: data.winner !== undefined ? data.winner : null
        });
    } catch (e) {
        console.error("Error drawing card", e);
        showAlert("Error de conexión al robar: " + e.message);
        document.getElementById('btn-draw').classList.remove('hidden');
    }
}

function getNextAliveTurn(current, dir, players) {
    let next = current;
    let safe = 0;
    do {
        next += dir;
        if (next > 4) next = 1;
        if (next < 1) next = 4;
        safe++;
        if (safe > 10) break;
    } while (!players[next].joined || !players[next].alive);
    return next;
}

const genId = () => Math.random().toString(36).substr(2, 9);

function createDeck(gameType) {
    let deck = [];
    if (gameType === 'uno') {
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500'];
        for (let c of colors) {
            deck.push({ game: 'uno', bgColor: c, value: '0', id: genId() });
            for (let v = 1; v <= 9; v++) {
                deck.push({ game: 'uno', bgColor: c, value: v.toString(), id: genId() });
                deck.push({ game: 'uno', bgColor: c, value: v.toString(), id: genId() });
            }
            for (let i = 0; i < 2; i++) {
                deck.push({ game: 'uno', bgColor: c, value: 'Reversa', id: genId() });
                deck.push({ game: 'uno', bgColor: c, value: 'Bloqueo', id: genId() });
                deck.push({ game: 'uno', bgColor: c, value: '+2', id: genId() });
            }
        }
        for (let i = 0; i < 4; i++) {
            deck.push({ game: 'uno', bgColor: 'bg-gray-800', value: 'Cambio', id: genId() });
            deck.push({ game: 'uno', bgColor: 'bg-gray-800', value: '+4', id: genId() });
        }
    } else if (gameType === 'ek') {
        for (let i = 0; i < 5; i++) {
            deck.push({ game: 'ek', type: 'ataque', value: 'Ataque', bgColor: 'bg-orange-500', id: genId() });
            deck.push({ game: 'ek', type: 'saltar', value: 'Saltar', bgColor: 'bg-blue-500', id: genId() });
            deck.push({ game: 'ek', type: 'barajar', value: 'Barajar', bgColor: 'bg-purple-500', id: genId() });
        }
        deck.push({ game: 'ek', type: 'desactivar', value: 'Desactivar', bgColor: 'bg-green-600', id: genId() });
        deck.push({ game: 'ek', type: 'desactivar', value: 'Desactivar', bgColor: 'bg-green-600', id: genId() });
    }
    return deck.sort(() => Math.random() - 0.5);
}

function createCardHTML(cardData, isForHost) {
    const div = document.createElement('div');
    let classes = `card border-4 border-gray-200 rounded-xl flex flex-col items-center justify-center font-black ${cardData.bgColor} overflow-hidden`;

    if (isForHost) classes += ` absolute top-0 left-0 w-32 h-48 text-4xl shadow-2xl`;
    else classes += ` relative w-24 h-36 text-2xl shadow-md shrink-0`;

    classes += cardData.textColor ? ` ${cardData.textColor}` : ` text-white`;
    div.className = classes;
    div.innerHTML = getCardContentHTML(cardData, isForHost);
    return div;
}

function getCardContentHTML(cardData, isHost) {
    if (!cardData) return '';

    if (cardData.game === 'uno') {
        let icon = cardData.value;
        if (icon === 'Reversa') icon = '<i class="fa-solid fa-rotate"></i>';
        if (icon === 'Bloqueo') icon = '<i class="fa-solid fa-ban"></i>';
        if (icon === 'Cambio') icon = '<i class="fa-solid fa-palette"></i>';

        return `
            <div class="bg-white/20 w-3/4 h-3/4 rounded-full flex items-center justify-center transform -rotate-12 absolute">
                <span class="drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] text-center ${isHost ? 'text-6xl' : 'text-4xl'}">${icon}</span>
            </div>
            <span class="absolute top-1 left-2 text-sm drop-shadow-md">${icon}</span>
            <span class="absolute bottom-1 right-2 text-sm drop-shadow-md rotate-180">${icon}</span>
        `;
    } else {
        let icon = '<i class="fa-solid fa-cat"></i>';
        if (cardData.type === 'gatito') icon = '<i class="fa-solid fa-bomb"></i>';
        if (cardData.type === 'desactivar') icon = '<i class="fa-solid fa-wrench"></i>';
        if (cardData.type === 'ataque') icon = '<i class="fa-solid fa-khanda"></i>';
        if (cardData.type === 'saltar') icon = '<i class="fa-solid fa-forward-step"></i>';
        if (cardData.type === 'barajar') icon = '<i class="fa-solid fa-shuffle"></i>';

        return `
            <span class="${isHost ? 'text-6xl' : 'text-4xl'} mb-2 drop-shadow-lg">${icon}</span>
            <span class="text-xs uppercase tracking-widest bg-black/40 px-2 py-1 rounded w-full text-center truncate">${cardData.value}</span>
        `;
    }
}

function isValidPlay(card, topCard, state) {
    if (state.gameType === 'uno') {
        if (state.drawStack > 0) {
            return card.value === '+2' || card.value === '+4';
        }
        if (card.value === 'Cambio' || card.value === '+4') return true;

        let matchColor = state.currentColor || topCard.bgColor;
        return card.bgColor === matchColor || card.value === topCard.value;
    } else {
        if (card.type === 'gatito' || card.type === 'desactivar') return false;
        return true;
    }
}

function getHexColor(twClass) {
    if (twClass.includes('red')) return '#ef4444';
    if (twClass.includes('blue')) return '#3b82f6';
    if (twClass.includes('green')) return '#22c55e';
    if (twClass.includes('yellow')) return '#eab308';
    return '#ffffff';
}

function showAlert(msg) {
    const el = document.getElementById('player-alert');
    document.getElementById('player-alert-msg').innerText = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
}
