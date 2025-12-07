function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

function updateLeaderboards() {
    for (const id in leaderboards) {
        updateLeaderboard(id, leaderboards[id]);
    }
    updateTimeLimits();

    const seen = new Set();
    for (const id in leaderboards) {
        for (const record of leaderboards[id]) {
            seen.add(record.name);
        }
    }
    
    document.getElementById("unique-players").innerText = `${seen.size}`;
}

let timeLimits = {
    lb4: -1,
    lb5: -1,
};

var leaderboards = {
    lb4: [],
    lb5: [],
}

const id2titles = {
    lb4: "4 disks",
    lb5: "5 disks",
};

let statusTimeout = null;

function setStatus(msg, vanish = false) {
    if (statusTimeout !== null) {
        clearTimeout(statusTimeout); // clear previous timeout
    }
    const elem = document.getElementById("status");
    elem.style.display = "block";
    elem.innerText = msg;
    if (vanish) {
        statusTimeout = setTimeout(() => elem.style.display = "none", 1500);
    }
}

function switchScreen(n) {
    for (const child of document.getElementById("container").children) {
        child.style.display = "none";
    }
    document.getElementById(`screen${n}`).style.display = "block";

    // temp
    if (n == 4) {
        if (!checkName(trialOptions.name, `lb${trialOptions.ndisks}`)) {
            switchScreen(6);
            document.getElementById("custom-name-input").value = trialOptions.name;
            return;
        }
        websocket.send(`!reginit-${trialOptions.ndisks}${trialOptions.name}`);
        document.querySelectorAll(".trial-name").forEach(e => e.innerText = trialOptions.name);
        document.querySelectorAll(".trial-ndisks").forEach(e => e.innerText = trialOptions.ndisks);
    } else if (n == 6) {
        document.getElementById("custom-name-input").value = "";
        document.getElementById("custom-name-input").focus();
    }
}

function connectionTest2() {
    const disp = document.getElementById("connection-test-display");
    const actions = document.getElementById("connection-test-actions");
    disp.innerText = "Socket failed\nTesting HTTP connection ...";
    fetch("/ping")
        .then(response => {
            if (response.ok) {
                disp.innerHTML = "<span style='color: brown'>HTTP ok; socket closed</span>";
                actions.innerHTML = "Reload this page to reconnect.";
            } else {
                disp.innerHTML = `<span style='color: red'>Server returned an error<br>${response.status} ${response.statusText}</span>`;
                actions.innerHTML = "* Do NOT reload anything.<br>"
                + "* Test the connection again and again. (the server *should* restart soon)<br>"
                + "* If the issue persists, switch to the backup system.<br>";
            }
        })
        .catch(error => {
            disp.innerHTML = "<span style='color: red'>The server is unreachable";
            actions.innerHTML = "Check the internet connection on this device.<br>"
                + "If it is not a problem with internet connection, and the issue persists, switch to the backup system.<br>"
        });
}

function connectionTest() {
    document.getElementById("connection-test").style.display = "block";
    const disp = document.getElementById("connection-test-display");
    const actions = document.getElementById("connection-test-actions");
    disp.innerHTML = "Testing socket connection ...";
    actions.innerText = "Please wait";

    const oldOnMessage = websocket.onmessage;
    const timeout = setTimeout(() => {
        websocket.onmessage = oldOnMessage;
        connectionTest2();
    }, 2000);

    websocket.onmessage = e => {
        if (e.data === "pong") {
            websocket.onmessage = oldOnMessage;
            clearTimeout(timeout);
            disp.innerHTML = "<span style='color: darkgreen'>No problems detected.</span>";
            actions.innerText = "If there is issue with the output computer, reload it using Ctrl+Shift+R.";
            return;
        }
        return oldOnMessage(e);
    }
    
    websocket.send("ping");
}

const trialOptions = {
    name: "",
    ndisks: 4,
    startTime: 0,
    timerInterval: 0,
    timeoutInterval: 0,
    score: 0,
    timeLimit: -1,
};

function sendUpdate(highlight = null) {
    websocket.send(`UPDATE:${JSON.stringify({
        leaderboards,
        highlight,
    })}`);
}

function pushRecord(disks, name, score, highlight = false) {
    const leaderboard = leaderboards[`lb${parseInt(disks)}`];
    leaderboard.forEach((data, i) => {
        if (data.name == name) {
            if (data.score < score) score = data.score;
            leaderboard.splice(i, 1);
        }
    });
    leaderboard.push({
        name: name,
        score: score,
    });
    leaderboard.sort((a, b) => a.score - b.score);
    if (highlight) {
        sendUpdate({ // highlight
            id: `lb${disks}`,
            name,
        });
    } else {
        sendUpdate();
    }
}

function adjustHeight() {
    const n = prompt("Enter number of rows to show below the top 3 (default 7):");
    if (n === null) return;
    websocket.send(`!adjust-height-${n}`)
}

function announce() {
    const msg = prompt("Enter announcement:\n(Leave blank to remove announcement)").trim();
    if (msg === null) return;
    if (msg.length == 0) {
        websocket.send("!announcement-hide");
        return;
    }
    websocket.send(`!announcement-show:${msg}`);
}

function checkName(name, id) {
    let result = [];
    let ids = [];
    for (const record of leaderboards.lb4) {
        if (record.name === name) {
            result.push({disks: 4, record});
            ids.push("lb4");
            break;
        }
    }
    for (const record of leaderboards.lb5) {
        if (record.name === name) {
            result.push({disks: 5, record});
            ids.push("lb5");
            break;
        }
    }
    if (result.length == 0) {
        return true;
    }

    msg = `The name '${name}' already exists in the system:\n`
    for (const found of result) {
        msg += `[${found.disks} disks]  ${found.record.name}  -  ${parseTime(found.record.score)}\n`
    }
    // msg += "\nClick OK if this is intentional.\nClick cancel to cancel the operation."
    msg += "\n";
    
    if (ids.includes(id)) {
        msg += `This name already exists in the leaderboard chosen (${id[2]} disks). If it is the same person, the system will automatically keep the best record.\n\n`
    }
    msg += "Click OK if this is the SAME person (if you are unsure, ask them if they have played already)\n";
    msg += "Otherwise, click Cancel and choose another name.\n";
    
    return window.confirm(msg)
}

function addRaw() {
    const ndisks = prompt("Insert record (Step 1/3)\n4 or 5 disks? Enter a single digit.");
    if (ndisks !== "4" && ndisks !== "5") return;
    const name = prompt("Insert record (Step 2/3)\nEnter the name:");
    if (name === null) return;
    if (!checkName(name, `lb${ndisks}`)) return;
    let score = prompt("Insert record (Step 3/3)\nEnter the time (eg: 01:23.456):\nLeave blank to enter the number of milliseconds directly");
    if (score === null) return;
    if (score === "") {
        score = prompt("Insert record (Step 3/3)\nEnter the number of milliseconds:");
        if (score === null) return;
        score = parseInt(score);
    } else {
        score = timeStringToMillis(score);
    }
    pushRecord(
        ndisks,
        name,
        score,
    );
}

function sendNewRecord() {
    websocket.send("!regconfirm");
    pushRecord(trialOptions.ndisks, trialOptions.name, score, true);
    switchScreen(1);
}

function timerClickListener(obj) {
    clearInterval(trialOptions.timerInterval);
    clearInterval(trialOptions.timeoutInterval);
    score = Date.now() - trialOptions.startTime;
    if ("forceTime" in obj && obj.forceTime !== null) {
        score = obj.forceTime;
    }
    removeEventListener("mousedown", timerClickListener);
    removeEventListener("touchstart", timerClickListener);
    document.getElementById("timer-start-button").style.display = "block";
    document.getElementById("timer-cancel-button").style.display = "block";
    websocket.send(`!regend-${score}`);
    switchScreen(5);
    document.querySelectorAll(".trial-result").forEach(e => e.innerText = parseTime(score));
    document.getElementById("timer").innerText = "00:00.000";
}

function startTimer() {
    trialOptions.timeLimit = timeLimits[`lb${trialOptions.ndisks}`];
    trialOptions.startTime = Date.now();
    trialOptions.timerInterval = setInterval(() => {
        document.getElementById("timer").innerText = parseTime(Date.now() - trialOptions.startTime);
    }, 57);
    if (trialOptions.timeLimit != -1) {
        trialOptions.timeoutInterval = setInterval(() => {
            timerClickListener({forceTime: trialOptions.timeLimit}); // forcibly end the run
        }, trialOptions.timeLimit);
    }
    addEventListener("mousedown", timerClickListener);
    addEventListener("touchstart", timerClickListener);
    document.getElementById("timer-start-button").style.display = "none";
    document.getElementById("timer-cancel-button").style.display = "none";
    websocket.send("!regstart");
}

const websocket = (() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`; // Example: ws://localhost:8080/ws
    return new WebSocket(wsUrl);
})();

websocket.onopen = e => {
    console.log("CONNECTED");
    websocket.send("REPORT-ROLE:Input");
};

websocket.onclose = e => {
    console.log("DISCONNECTED");
    setStatus("Disconnected.");
    // document.getElementById("reload-this-button").style.color = "blue";
    connectionTest();
};

websocket.onmessage = e => {
    console.log(`RECEIVED: ${e.data}`);
    if (e.data.startsWith("@")) {
        if (e.data.startsWith("@nclients:")) {
            document.getElementById("nclients").innerText = e.data.slice(10);
        } else if (e.data.startsWith("@meta:")) {
            const newData = JSON.parse(e.data.slice("@meta:".length));
            timeLimits = newData.timeLimits;
            updateTimeLimits();
        }
    } else if (e.data.startsWith("!")) {
        if (e.data == "!reload-all") {
            window.location.reload();
        }
    } else if (e.data.startsWith("AUTH:")) {
        if (e.data == "AUTH:required") {
            // server requires auth
            const token = localStorage.getItem("token");
            if (token == null) {
                switchScreen(999);
                setStatus("Server blocked input requests.");
            } else {
                websocket.send(`AUTH:token:${token}`);
                setStatus("Authenticating ...");
            }
        } else if (e.data == "AUTH:success") {
            setStatus("Permission granted.", true);
            switchScreen(1);
        } else if (e.data == "AUTH:failure") {
            localStorage.removeItem("token");
            switchScreen(999);
            setStatus("Server blocked input requests.");
        }
    } else if (e.data.startsWith("DATA:")) {
        const data = JSON.parse(e.data.slice("DATA:".length));
        leaderboards = data;
        updateLeaderboards();
    }
};

websocket.onerror = e => {
    console.log(`ERROR: ${e.data}`);
};

function timeStringToMillis(timeString) {
    let parts = timeString.split(":");
    const minutes = parseInt(parts[0]);
    parts = parts[1].split(".");
    const seconds = parseInt(parts[0]);
    const millis = parseInt(parts[1]);
    return (minutes * 60 + seconds) * 1000 + millis;
}

function timeLimitDisplay(timeLimit) {
    return timeLimit == -1 ? "none" : millisToCoarseTime(timeLimit);
}

function updateTimeLimits() {
    for (const id in timeLimits) {
        const timeLimit = timeLimits[id];
        const elem = document.getElementById(`time-limit-${id}`);
        if (!elem) continue;
        if (timeLimit === -1) {
            elem.innerText = "none";
        } else {
            elem.innerText = millisToCoarseTime(timeLimit);
        }
    }
}

function modifyRank(id, n) {
    const leaderboard = leaderboards[id];
    const name = prompt("Modify Record (Step 1/2)\nEdit the name:", leaderboard[n-1].name);
    if (name === null) return;
    if (name != leaderboard[n-1].name && !checkName(name, id)) return;
    const newTime = prompt("Modify Record (Step 2/2)\nEdit the time:\nLeave blank to edit the number of milliseconds directly", parseTime(leaderboard[n-1].score));
    if (newTime === null) return;
    let score;
    if (newTime == "") {
        score = prompt("Modify Record (Step 2/2)\nEdit the number of milliseconds:", leaderboard[n-1].score);
        if (score === null) return;
        score = parseInt(score);
    } else {
        score = timeStringToMillis(newTime);
    }
    leaderboard.splice(n-1, 1);
    pushRecord(parseInt(id[2]), name, score); // resolve name clashes
    // leaderboard[n-1] = { name, score };
    // sendUpdate();
}

function removeRank(leaderboard, n) {
    leaderboard.splice(n - 1, 1);
    sendUpdate();
}

function updateLeaderboard(id, leaderboard) {
    const container = document.getElementById(id);
    container.innerHTML = `<h2 class="header">${id2titles[id]}</h2>`;
    container.innerHTML += `<div class="header2">Time limit = <span id="time-limit-${id}"></span><span class="action" onclick="editTimeLimit('${id}')">[Edit]</span></div>`
    var rank = 1;
    for (const {name, score} of leaderboard) {
        const record = document.createElement("div");
        record.classList.add("record");
        const recordRank = document.createElement("span");
        recordRank.classList.add("record-rank");
        recordRank.innerText = rank.toString();
        const recordName = document.createElement("span");
        recordName.classList.add("record-name");
        recordName.innerText = name;
        const recordTime = document.createElement("span");
        recordTime.classList.add("record-time");
        recordTime.innerText = parseTime(score);
        record.appendChild(recordRank);
        record.appendChild(recordName);
        record.appendChild(recordTime);

        const modifyButton = document.createElement("span");
        modifyButton.classList.add("action");
        modifyButton.innerText = "[Mod]";
        modifyButton._rank = rank
        modifyButton.style.marginLeft = "12px";
        modifyButton.onclick = e => modifyRank(id, e.target._rank);

        const removeButton = document.createElement("span");
        removeButton.classList.add("action");
        removeButton.innerText = "[Del]";
        removeButton._rank = rank;
        removeButton.onclick = e => {
            if (!window.confirm(`Remove this record?\n[${id[2]} disks] ${name}  -  ${score}`)) return;
            removeRank(leaderboard, e.target._rank)
        };
        
        record.appendChild(modifyButton);
        record.appendChild(removeButton);

        container.appendChild(record);

        rank++;
    }
    if (leaderboard.length == 0) {
        container.innerHTML += "<h2>[no data]</h2>";
    }
    container.style.backgroundColor = "lightgreen";
    setTimeout(() => container.style.backgroundColor = "", 300);
}

// AI generated function
function coarseTimeToMillis(durationString) {
  // Regular expression to check if the string is purely digits (for milliseconds)
  const pureDigitsRegex = /^\d+$/;

  // Regular expression to parse minutes and seconds
  // (?:(\d+)m)?  -> Optional non-capturing group for minutes. Captures digits before 'm' in group 1.
  // (?:(\d+)s)?  -> Optional non-capturing group for seconds. Captures digits before 's' in group 2.
  // ^ and $     -> Ensure the entire string matches the pattern.
  const durationRegex = /^(?:(\d+)m)?(?:(\d+)s)?$/;

  // If the string is purely digits, treat it as milliseconds
  if (pureDigitsRegex.test(durationString)) {
    return parseInt(durationString, 10);
  }

  const match = durationString.match(durationRegex);

  // If there's no match or the match is empty (e.g., "" or "m" or "s"), return 0
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return 0;
  }

  let totalMilliseconds = 0;

  // Extract minutes from the first capturing group (if present)
  const minutes = match[1];
  if (minutes !== undefined) {
    totalMilliseconds += parseInt(minutes, 10) * 60 * 1000; // Convert minutes to milliseconds
  }

  // Extract seconds from the second capturing group (if present)
  const seconds = match[2];
  if (seconds !== undefined) {
    totalMilliseconds += parseInt(seconds, 10) * 1000; // Convert seconds to milliseconds
  }

  return totalMilliseconds;
}

function millisToCoarseTime(millis) {
  millis = Math.floor(millis / 1000) * 1000;
  const secs = millis / 1000;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;

  let result = "";
  if (minutes > 0) {
    result += `${minutes}m`;
  }
  if (seconds > 0) {
    result += `${seconds}s`;
  } else if (minutes === 0 && seconds === 0) {
    result = "0s";
  }

  return result;
}

// functionality

function newTrial(n) {
    trialOptions.ndisks = n;
    switchScreen(6);
}

function useAccessToken() {
    const token = prompt("Enter access token:");
    if (token === null) return;
    if (token.length < 4) return;
    websocket.send("AUTH:token:" + token);
    localStorage.setItem("token", token);
}

function customName() {
    const custom = prompt("Enter name:");
    if (custom === null) return;
    trialOptions.name = custom;
    switchScreen(4);
}

function editTimeLimit(id) {
    const newTimeLimit = prompt("Enter new time limit\nExamples: '4m' / '2m30s' / '1000' (1000 millis)\nEnter '-1' to remove time limit", timeLimits[id]);
    if (newTimeLimit === null) return;
    if (newTimeLimit.length == 0) return;
    if (newTimeLimit == "-1") {
        websocket.send(`@timeLimit:${id}:-1`);
    } else {
        let parsed = coarseTimeToMillis(newTimeLimit);
        parsed = isNaN(parsed) ? -1 : parsed;
        websocket.send(`@timeLimit:${id}:${parsed}`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("connection-test").style.display = "none";
    document.getElementById("new-trial-4").onclick = () => newTrial(4);
    document.getElementById("new-trial-5").onclick = () => newTrial(5);

    document.getElementById("refresh-all-button").onclick = () => {
        websocket.send("refresh-all"); // note: not to be broadcasted!
    };

    document.getElementById("reload-all-button").onclick = () => {
        websocket.send("!reload-all");
    };

    // document.getElementById("disconnect-all-button").onclick = () => {
    //     websocket.send("!disconnect-all-output");
    // };

    document.getElementById("manual-input-button").onclick = () => {
        addRaw();
    };

    // document.getElementById("reset-l4-button").onclick = () => {
    //     leaderboards.lb4 = [];
    //     sendUpdate();
    // };
// 
    // document.getElementById("reset-l5-button").onclick = () => {
    //     leaderboards.lb5 = [];
    //     sendUpdate();
    // };

    // document.getElementById("toggle-l4-button").onclick = () => {
    //     websocket.send("!toggle-l4");
    // };
// 
    // document.getElementById("toggle-l5-button").onclick = () => {
    //     websocket.send("!toggle-l5");
    // };

    document.getElementById("adjust-height-button").onclick = () => {
        adjustHeight();
    };

    document.getElementById("clear-animation-button").onclick = () => {
        websocket.send("!regcancel");
    };

    document.getElementById("announce-button").onclick = () => {
        announce();
    };

    if (0) document.getElementById("hide-announcement-button").onclick = () => {
        websocket.send("!announcement-hide");
    };

    document.getElementById("custom-name-button").onclick = customName;
    document.getElementById("timer-start-button").onclick = startTimer;
    document.getElementById("result-confirm-button").onclick = sendNewRecord;
    
    document.getElementById("result-cancel-button").onclick = () => {
        websocket.send('!regcancel');
        switchScreen(1);
    };

    document.getElementById("action-use-access-token").onclick = useAccessToken;

    document.querySelectorAll(".screen-1-button").forEach(btn => btn.onclick = () => {
        switchScreen(1);
    });

    document.getElementById("name-confirm-button").onclick = () => {
        trialOptions.name = document.getElementById("custom-name-input").value;
        if (trialOptions.name == "") {
            alert("Name cannot be empty!");
            return;
        }
        switchScreen(4);
    }

    document.querySelectorAll("button[dangerous]").forEach(e => {
        e._onclick = e.onclick;
        e.onclick = () => {
            const ans = prompt("Are you sure? Type 'yes!' to confirm.");
            if (ans == "yes!") {
                e._onclick();
            }
        }
    });
    
    switchScreen(1);

    return;

    // unused

    for (let i = 1; i <= 6; i++) {
        const row = document.createElement("div");
        row.classList.add("row");
        for (const letter of "ABCDE") {
            const btn = document.createElement("button");
            btn.classList.add("outline");
            btn.innerText = `${i}${letter}`;
            if (i <= 3 && letter == "E") btn.style.opacity = 0;
            else btn.onclick = e => {
                trialOptions.name = e.target.innerText;
                switchScreen(3);
            }
            row.appendChild(btn);
        }
        const parent = document.querySelector("#screen2 > .centered");
        parent.insertBefore(row, parent.childNodes[parent.childNodes.length - 2]);
    }
    const width = 5;
    const height = 7;
    for (let i = 0; i < height; i++) {
        const row = document.createElement("div");
        row.classList.add("row");
        for (let j = 0; j < width; j++) {
            const btn = document.createElement("button");
            btn.classList.add("outline");
            btn.innerText = (i * width + j + 1).toString().padStart(2, "0");
            btn.onclick = e => {
                trialOptions.name += " " + e.target.innerText;
                switchScreen(4);

                websocket.send(`!reginit-${trialOptions.ndisks}${trialOptions.name}`);
            }
            row.appendChild(btn);
        }
        const parent = document.querySelector("#screen3 > .centered");
        parent.insertBefore(row, parent.childNodes[parent.childNodes.length - 2]);
    }
});
