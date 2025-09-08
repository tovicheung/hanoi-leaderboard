function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

function updateLeaderboards() {
    updateLeaderboard("leaderboard1", leaderboard1);
    updateLeaderboard("leaderboard2", leaderboard2);
}

var leaderboard1 = [];
var leaderboard2 = [];

var regStart = 0;
var regInterval = 0;

const websocket = (() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    return new WebSocket(wsUrl);
})();

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

websocket.onopen = e => {
    console.log("CONNECTED");
    websocket.send("REPORT-ROLE:Output");
};

websocket.onclose = e => {
    console.log("DISCONNECTED");
    window.location.href = "./disconnected"
};

websocket.onmessage = e => {
    console.log(`RECEIVED: ${e.data}`);
    if (e.data.startsWith("@")) return;
    if (e.data.startsWith("!")) {
        handleCommand(e.data);
        return;
    }
    const data = JSON.parse(e.data);
    leaderboard1 = data[0];
    leaderboard2 = data[1];
    updateLeaderboards();
};

websocket.onerror = e => {
    console.log(`ERROR: ${e.data}`);
};

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
        const newBaseHeight = parseInt(cmd.slice(15));
        height = newBaseHeight + (height - baseHeight);
        baseHeight = newBaseHeight;
        shiftPages();
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
    let result = '';
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()[]{}\|;:,./<>?`~-=_+ ";
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

const title = "Gojo's Challenge: Tower of Hanoi";

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
    document.getElementById("setup-fullscreen").onclick = () => {
        document.body.requestFullscreen();
        document.getElementById("setup").style.display = "none";
        document.body.style.cursor = "none";
    }
});
