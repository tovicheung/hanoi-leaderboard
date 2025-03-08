function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

function updateLeaderboard() {
    const container = document.getElementById("leaderboard");
    container.innerHTML = "";
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
        container.appendChild(record);

        rank++;
    }
    if (leaderboard.length == 0) {
        container.innerHTML = "Waiting for challengers ...";
    }
    document.getElementById("leaderboard").style.backgroundColor = "lightgreen";
    setTimeout(() => document.getElementById("leaderboard").style.backgroundColor = "", 300);
}
