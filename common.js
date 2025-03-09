function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

const id2titles = {
    "leaderboard1": "4 disks",
    "leaderboard2": "5 disks",
}

function updateLeaderboard(id, leaderboard) {
    const container = document.getElementById(id);
    container.innerHTML = `<p>${id2titles[id]}</p>`;
    var rank = 1;
    for (const {name, score} of leaderboard) {
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

        rank++;
    }
    if (leaderboard.length == 0) {
        container.innerHTML = "<p>Waiting for challengers ...</p>";
    }
    container.style.backgroundColor = "lightgreen";
    setTimeout(() => container.style.backgroundColor = "", 300);
}

function updateLeaderboards() {
    updateLeaderboard("leaderboard1", leaderboard1);
    updateLeaderboard("leaderboard2", leaderboard2);
}
