function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

const id2titles = {
    "leaderboard1": "4 disks",
    "leaderboard2": "5 disks",
}


function updateLeaderboards() {
    updateLeaderboard("leaderboard1", leaderboard1);
    updateLeaderboard("leaderboard2", leaderboard2);
}
