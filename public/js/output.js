function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

function updateLeaderboards() {
    if (theme == "demonslayer") {
        updateLeaderboardNew("lb-4", leaderboard1);
        updateLeaderboardNew("lb-5", leaderboard2);
    } else {
        updateLeaderboard("leaderboard1", leaderboard1);
        updateLeaderboard("leaderboard2", leaderboard2);
    }
}

var leaderboard1 = [];
var leaderboard2 = [];

var regStart = 0;
var regInterval = 0;

var websocket = openSocket();
var fails = 0;
const MAX_TRIES = 5;
var offline = false;

var theme = "demonslayer";

const currentUrl = new URL(window.location.href);
const urlParams = currentUrl.searchParams;
if (urlParams.get("theme") == "gojo") {
    theme = "gojo";
}

function openSocket() {
    if (offline) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    websocket = new WebSocket(wsUrl);

    websocket.onopen = e => {
        console.log("CONNECTED");
        document.getElementById("loading").style.display = "none";
        websocket.send("REPORT-ROLE:Output");
        fails = 0;
    };

    websocket.onmessage = socketOnMessage;

    websocket.onclose = e => {
        console.log("DISCONNECTED");
        if (fails >= MAX_TRIES) {
            offline = true;
            document.getElementById("loading-inner").innerHTML = "Offline mode";
            setTimeout(() => document.getElementById("loading").style.display = "none", 3000);
            return;
        }
        fails++;
        // window.location.href = "./disconnected"
        document.getElementById("loading-inner").innerHTML = `Disconnected.<br><br>Reconnecting ... ${fails}/${MAX_TRIES}`;
        document.getElementById("loading").style.display = "block";
        setTimeout(openSocket, 3000);
    };

    websocket.onerror = e => {
        console.log(`ERROR: ${e.data}`);
    };

    return websocket;
}

const id2titles = {
    "leaderboard1": "4 disks",
    "leaderboard2": "5 disks",
};

var dotsInterval = 0;
var timeoutToClean = null; // used in !regcancel

function startDots() {
    stopDots();
    dotsInterval = setInterval(() => {
        const dots = document.getElementById("dots");
        dots.innerText = ".".repeat((dots.innerText.length) % 3 + 1);
    }, 400);
}

function stopDots() {
    clearInterval(dotsInterval);
    document.getElementById("dots").innerText = "";
}

function socketOnMessage(e) {
    console.log(`RECEIVED: ${e.data}`);
    if (e.data.startsWith("@")) {
        if (e.data.startsWith("@meta:")) {
            const newData = JSON.parse(e.data.slice("@meta:".length));
            // if (newData.theme != theme) {
            //     window.location.reload();
            // }
            // manually reload if want change theme!
            theme = newData.theme;
        }
        return;
    }
    if (e.data.startsWith("!")) {
        handleCommand(e.data);
        return;
    }
    if (e.data.startsWith("AUTH:")) return;
    const data = JSON.parse(e.data);
    leaderboard1 = data[0];
    leaderboard2 = data[1];
    updateLeaderboards();
}

function appendRegName(name, i) {
    if (i == name.length + 1) return;
    document.getElementById("banner-name").innerText = name.slice(0, i);
    setTimeout(() => appendRegName(name, i+1), name[i] == " " ? 0 : 200);
}

function toggleDisplay(elem) {
    if (elem.classList.contains("hidden")) {
        elem.classList.remove("hidden");
    } else {
        elem.classList.add("hidden");
    }
}

function handleCommand(cmd) {
    if (cmd == "!reload-all") {
        window.location.reload();
    } else if (cmd == "!disconnect-all-output") {
        websocket.close();
    } else if (cmd == "!fullscreen-all-output") {
        document.body.requestFullscreen();
    } else if (cmd.startsWith("!adjust-height-")) {
        let n = parseInt(cmd.slice(15));
        if (n <= 0) return;
        if (theme == "gojo") {
            const newBaseHeight = n;
            height = newBaseHeight + (height - baseHeight);
            baseHeight = newBaseHeight;
            shiftPages();
        } else if (theme == "demonslayer") {
            rowsPerPage = n;
            document.querySelectorAll(".lb-scroll").forEach(e => e.style.height = `${ROW_HEIGHT * rowsPerPage - 6}px`);
            // cyclePages();
            updateLeaderboards();
        }
    } else if (cmd == "!toggle-l4") {
        toggleDisplay(document.getElementById("leaderboard1"));
    } else if (cmd == "!toggle-l5") {
        toggleDisplay(document.getElementById("leaderboard2"));
    } else if (cmd.startsWith("!announcement-show:")) {
        const msg = cmd.slice("!announcement-show:".length);
        document.getElementById("announcement").innerText = msg;
        document.getElementById("announcement").classList.remove("hidden");
    } else if (cmd == "!announcement-hide") {
        document.getElementById("announcement").classList.add("hidden");
        document.getElementById("announcement").innerText = "";
    } else if (cmd.startsWith("!reginit-")) {
        const ndisks = cmd[9];
        const name = cmd.slice(10);
        document.getElementById("banner-name").innerText = "";
        document.getElementById("banner-ndisks").innerText = ndisks;
        clearInterval(regInterval);
        document.getElementById("banner-time").innerText = "Waiting to start ";
        document.getElementById("banner-time").style.color = "white";
        document.getElementById("banner").style.display = "flex";
        startDots();
        document.getElementById("banner").animate([
            {
                left: CSS.percent(-200),
                bottom: CSS.percent(40),
            },
            {
                left: 0,
                bottom: CSS.percent(40),
            },
        ], {
            duration: 600,
            fill: "forwards"
        });
        setTimeout(() => appendRegName(name, 0), 500);
        document.getElementById("overlay").style.display = "block";
    } else if (cmd.startsWith("!regstart")) {
        regStart = Date.now(); // the latency will (probably) fix itself
        regInterval = setInterval(() => {
            document.getElementById("banner-time").innerText = parseTime(Date.now() - regStart);
        }, 57);
        stopDots();
        timeoutToClean = setTimeout(() => {
            document.getElementById("banner").animate([
                {
                    bottom: CSS.percent(40),
                },
                {
                    bottom: 0,
                },
            ], {
                duration: 400,
                fill: "forwards"
            });
            document.getElementById("overlay").style.display = "none";
        }, 1000);
        height = baseHeight - 1;
    } else if (cmd.startsWith("!regend-")) {
        clearInterval(regInterval);
        const result = parseInt(cmd.slice(8));
        document.getElementById("banner-time").innerText = parseTime(result);
        document.getElementById("banner-time").style.color = "lime";
        document.getElementById("banner").animate([
            {
                bottom: 0,
            },
            {
                bottom: CSS.percent(40),
            },
        ], {
            duration: 400,
            fill: "forwards"
        });
        document.getElementById("overlay").style.display = "block";
    } else if (cmd == "!regconfirm") {
        document.getElementById("banner").animate([
            {
                left: 0,
                bottom: CSS.percent(40),
            },
            {
                left: CSS.percent(-200),
                bottom: CSS.percent(40),
            },
        ], {
            duration: 600,
            fill: "forwards"
        });
        setTimeout(() => {
            document.getElementById("overlay").style.display = "none";
            document.getElementById("banner").style.display = "none";
        }, 600);
        height = baseHeight;
    } else if (cmd == "!regcancel") {
        // should clean up everything regardless of current state
        document.getElementById("overlay").style.display = "none";
        document.getElementById("banner").style.display = "none";
        stopDots();
        clearTimeout(timeoutToClean);
        clearInterval(regInterval);
        height = baseHeight;
    }
}

function renderRecord(container, rank, name, score) {
    const record = document.createElement("div");
    record.classList.add("record");
    const recordRank = document.createElement("span");
    recordRank.classList.add("record-rank");
    recordRank.innerHTML = rank <= 3 ? ["&#129351;", "&#129352;", "&#129353;"][rank - 1] : rank.toString();
    const recordName = document.createElement("span");
    recordName.classList.add("record-name");
    recordName.innerText = name;
    const recordTime = document.createElement("span");
    recordTime.classList.add("record-time");
    recordTime.innerText = parseTime(score);
    record.appendChild(recordRank);
    record.appendChild(recordName);
    record.appendChild(recordTime);
    container.appendChild(record);
}


let rowsPerPage = 7;
const PAGE_DURATION_MS = 5000;
const ANIMATION_DURATION_MS = 1000;

const leaderboardStates = {};
const ROW_HEIGHT = 50 + 6;

function renderRecordNew(container, rank, name, score) {
    const record = document.createElement("div");
    record.classList.add("lb-row");
    const recordRank = document.createElement("div");
    recordRank.classList.add("lb-row-rank");
    recordRank.innerText = rank.toString();
    // recordRank.innerHTML = rank <= 3 ? ["&#129351;", "&#129352;", "&#129353;"][rank - 1] : rank.toString();
    const recordName = document.createElement("div");
    recordName.classList.add("lb-row-name");
    recordName.innerText = name;
    const recordTime = document.createElement("div");
    recordTime.classList.add("lb-row-score");
    recordTime.innerText = parseTime(score);
    record.appendChild(recordRank);
    record.appendChild(recordName);
    record.appendChild(recordTime);
    container.appendChild(record);
}

function updateLeaderboardNew(id, data) {
    const lbElement = document.getElementById(id);
    if (!lbElement) {
        console.error(`Leaderboard element with ID ${id} not found.`);
        return;
    }
    if (leaderboardStates[id] && leaderboardStates[id].interval) {
        clearInterval(leaderboardStates[id].interval);
    }
    const topData = data.slice(0, 3);
    const scrollData = data.slice(3);
    
    const totalRows = scrollData.length;
    const totalPages = Math.ceil(totalRows / rowsPerPage);

    leaderboardStates[id] = {
        currentPageIndex: 0,
        totalRows: totalRows,
        totalPages: totalPages,
        interval: null,
        bottomEl: lbElement.querySelector(".lb-bottom"),
        scrollEl: lbElement.querySelector(".lb-scroll"),
        topEl: lbElement.querySelector(".lb-top")
    };
    const state = leaderboardStates[id];
    state.topEl.innerHTML = topData.map((item, index) => renderRow(item, index + 1, true)).join("");
    state.bottomEl.innerHTML = scrollData.map((item, index) => renderRow(item, index + 4, false)).join("");
    state.bottomEl.style.transition = `transform ${ANIMATION_DURATION_MS / 1000}s ease-in-out`;
    
    if (data.length == 0) {
        state.topEl.innerHTML = "<div class='lb-row'><span class='lb-row-name' style='text-align: center; color: yellow;'>Waiting for challengers ...</span></div>";
    }

    lbElement.style.backgroundColor = "rgba(0, 255, 0, 0.3)";
    setTimeout(() => lbElement.style.backgroundColor = "", 300);

    startCycle(id);
}

function renderRow(item, rank, isTop) {
    const topClass = isTop ? "top-rank" : "";
    if (isTop) {
        return `
            <div class="lb-row">
                <div class="lb-row-rank-top">
                    <img class="lb-row-avatar" src="assets/${["gold", "silver", "bronze"][rank - 1]}.png">
                    <span>${rank}</span>
                </div>
                <!-- <span class="lb-row-rank">${["&#129351;", "&#129352;", "&#129353;"][rank - 1]}</span> -->
                <span class="lb-row-name">${item.name}</span>
                <span class="lb-row-score">${parseTime(item.score)}</span>
            </div>
        `;
    }
    return `
        <div class="lb-row">
            <span class="lb-row-rank">${rank}</span>
            <span class="lb-row-name">${item.name}</span>
            <span class="lb-row-score">${parseTime(item.score)}</span>
        </div>
    `;
}

function updateScrollPosition(id) {
    const state = leaderboardStates[id];
    if (!state || !state.bottomEl) return;

    const offsetRows = state.currentPageIndex * rowsPerPage;
    const offsetPixels = offsetRows * ROW_HEIGHT;

    state.bottomEl.style.transform = `translateY(-${offsetPixels}px)`;
}

function cyclePages(id) {
    const state = leaderboardStates[id];
    if (!state || state.totalPages <= 1) return;

    if (state.currentPageIndex >= state.totalPages - 1) {
        state.currentPageIndex = 0;

        
    } else {
        state.currentPageIndex++;
    }
    state.scrollEl.classList.add("is-scrolling");
    setTimeout(() => {
        updateScrollPosition(id);
        setTimeout(() => {
            state.scrollEl.classList.remove("is-scrolling");
        }, ANIMATION_DURATION_MS);
    }, 500);
}

function startCycle(id) {
    const state = leaderboardStates[id];
    
    updateScrollPosition(id); 

    if (!state || state.totalPages <= 1) {
        return;
    }

    state.interval = setInterval(() => {
        cyclePages(id);
    }, PAGE_DURATION_MS);
}











function updateLeaderboard(id, leaderboard) {
    const container = document.getElementById(id);
    container.innerHTML = `<h2 class="header">${id2titles[id]}</h2>`;
    if (leaderboard.length == 0) {
        container.innerHTML += "<h2>Waiting for challengers ...</h2>";
    } else for (var rank = 1; rank <= Math.min(3, leaderboard.length); rank++) {
        const {name, score} = leaderboard[rank-1];
        renderRecord(container, rank, name, score);
    }
    container.style.backgroundColor = "lightgreen";
    loadPages();
    setTimeout(() => container.style.backgroundColor = "", 300);
}

function loadPage(lb, elem, page) {
    while (elem.childElementCount > 4) {
        elem.removeChild(elem.lastChild);
    }
    for (var i = page * height + 3; i < Math.min((page + 1) * height + 3, lb.length); i++) {
        const {name, score} = lb[i];
        renderRecord(elem, i + 1, name, score);
    }
}

function loadPages() {
    loadPage(leaderboard1, document.getElementById("leaderboard1"), currentPages[0]);
    loadPage(leaderboard2, document.getElementById("leaderboard2"), currentPages[1]);
}

function shiftPages() {
    const pages = [leaderboard1, leaderboard2].map(l => Math.ceil((l.length - 3) / height));
    currentPages = currentPages.map((p, i) => (p + 1) % pages[i]);
    loadPages();
}

var baseHeight = 7;
var height = baseHeight;
var currentPages = [0, 0];
setInterval(shiftPages, Math.max(5000, height * 900));

function rand(length) {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()[]{}\|;:,./<>?`~-=_+ ";
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

const title = "Tower of Hanoi Challenge";

function titleAnim2(n) {
    if (n == -1) return;
    document.getElementById("title").innerText = title.slice(0, title.length - n) + document.getElementById("title").innerText.slice(title.length - n);
    setTimeout(() => titleAnim2(n - 1), 30);
}

function titleAnim(n) {
    if (n == title.length) {
        titleAnim2(n);
        return;
    }
    document.getElementById("title").innerText = rand(n);
    setTimeout(() => titleAnim(n + 1), 30);
}

setInterval(() => titleAnim(1), 30000);
setInterval(() => {
    document.getElementById("setup").style.display = "none";
    document.body.style.cursor = "none";
}, 8000);

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("title").innerText = title;
    
    document.getElementById("setup-fullscreen").onclick = () => {
        document.body.requestFullscreen();
        document.getElementById("setup").style.display = "none";
        document.body.style.cursor = "none";
    };
    
    if (theme == "demonslayer") {
        document.getElementById("lbs-gojo").style.display = "none";
    } else {
        document.getElementById("lbs-demonslayer").style.display = "none";
    }
    // glowRandom(); unused yet
});

function randint(a, b) {
    return Math.floor(Math.random() * (b - a)) + a;
}

function glowRandom() {
    const arr = [...document.querySelectorAll(".lb-top .lb-row-score")];
    console.log(arr);
    if (arr.length != 0) {
        const elem = arr[Math.floor(Math.random() * arr.length)];
        elem.classList.add("glow-active");
        setTimeout(() => {
            elem.classList.remove("glow-active");
        }, 2000);
    }
    setTimeout(glowRandom, randint(3000, 5000));
}

