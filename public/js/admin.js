function parseTime(millis) {
    const dur = new Date(millis);
    return `${dur.getMinutes().toString().padStart(2, "0")}:${dur.getSeconds().toString().padStart(2, "0")}.${dur.getMilliseconds().toString().padStart(3, "0")}`
}

function updateLeaderboards() {
    updateLeaderboard("leaderboard1", leaderboard1);
    updateLeaderboard("leaderboard2", leaderboard2);
}

const _ = (str, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
const __ = (str) => _(str, _(str));

const websocket = (() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    return new WebSocket(wsUrl);
})();

websocket._send = websocket.send;
websocket.send = msg => {
    if (websocket.readyState == websocket.CONNECTING) {
        report("Websocket connecting", 0);
    } else if (websocket.readyState == websocket.CLOSING) {
        report("Websocket connection closing", 0);
    } else if (websocket.readyState == websocket.CLOSED) {
        report("Websocket disconnected", 0);
        return;
    }
    websocket._send(msg);
}

var info = {
    connectionStatus: "not connected",
}

var serverConfig = {
    inputAccess: "unknown",
    outputAccess: "unknown",
}

function updateInfo() {
    document.getElementById("connection-status").innerText = info.connectionStatus;
    document.getElementById("input-access").innerText = serverConfig.inputAccess;
    document.getElementById("output-access").innerText = serverConfig.outputAccess;
}

async function req(url, method, data) {
    if (url.startsWith("/")) url = url.slice(1);
    const response = await fetch(`${window.location.protocol}//${window.location.host}/${url}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${__(document.getElementById("password").value)}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        report("Success", 1);
    } else {
        report(`[${response.status}] ${await response.text()}`, 0, log = true);
    }
    waiting = false;
    document.getElementById("instance-management").style.opacity = 1;
}

function report(msg, type, log = false) {
    let color = type === null || type === undefined ? "gray" : type ? "green" : "red";
    document.getElementById("popup").style.backgroundColor = color;
    document.getElementById("popup").innerText = msg;
    document.getElementById("popup").style.display = "block";
    setTimeout(() => {
        document.getElementById("popup").style.display = "none";
    }, 3000);
    if (log) {
        pushLog(msg);
    }
}

function checkAdmin() {
    websocket.send(`ADMIN:${__(document.getElementById("password").value)}`);
}

var lastPing = null;

function testConnection() {
    websocket.send("ping");
    lastPing = Date.now();
}

function createNewInstance() {
    const name = prompt("Enter name for new instance:");
    if (name === null) return null;
    req("/api/instance/create", "POST", { name });
}

function importAndOverwrite() {
    const data = prompt("Enter JSON of data:");
    if (data === null) return null;
    req("/api/instance/import", "POST", { data: JSON.parse(data) });
}

async function exportData() {
    try {
        const resp = await fetch("/api/data");
        if (!resp.ok) {
            report("Error fetching /api/data, check console", 0);
            console.log(resp);
            return;
        }
        const text = await resp.text();
        await navigator.clipboard.writeText(text);
        report("Copied JSON to clipboard!", 1);
    } catch (e) {
        report("Error copying data, check console", 0);
        console.error(e);
    }
}

function deleteInstance() {
    const name = prompt("Enter name of instance to delete (cannot be current instance):");
    if (name === null) return null;
    req("/api/instance/delete", "DELETE", { name });
}

function cloneInstance() {
    const name = prompt("Enter name of clone of current:");
    if (name === null) return null;
    req("/api/instance/clone", "POST", { name });
}

var waiting = false;

function waitForInstanceUpdate() {
    document.getElementById("instance-management").style.opacity = 0.5;
    waiting = true;
}

function instanceUpdate(func) {
    if (waiting) {
        alert("Waiting for previous write to finish ...");
        return;
    }
    const ret = func();
    if (ret === null) return;
    waitForInstanceUpdate();
    return ret;
}

function configUpdate(newConfig) {
    // websocket.send(`ADMIN:config-update:${JSON.stringify(newConfig)}`);
    req("/api/config/update", "POST", newConfig);
}

function fullDateFmt(date, millis = false) {
    var str = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.toLocaleTimeString("en-US", { hour12: false })}`;
    if (millis) str += "." + date.getMilliseconds().toString().padStart(3, "0");
    return str;
}

function pushLog(msg) {
    const line = document.createElement("p");
    line.innerText = `[${fullDateFmt(new Date, millis = true)}] ${msg}`;
    const logs = document.getElementById("logs");
    logs.prepend(line);
}

websocket.onopen = e => {
    console.log("CONNECTED");
    pushLog("[socket] connected")
    info.connectionStatus = "connected (not admin)";
    updateInfo();
    document.getElementById("button-verify").disabled = false;
};

websocket.onclose = e => {
    console.log("DISCONNECTED");
    pushLog("[socket] disconnected")
    reset();
};

websocket.onmessage = e => {
    console.log(`RECEIVED: ${e.data}`);
    pushLog(`[socket] received: ${e.data}`);
    if (e.data.startsWith("ADMIN:")) {
        if (e.data == "ADMIN:OVERRIDDEN") {
            websocket.close();
            document.getElementById("msg").innerText = "Session overriden - another client has connected as admin, reload to reconnect"
            return;
        } else if (e.data.startsWith("ADMIN:INSTANCES:")) {
            const instanceData = JSON.parse(e.data.slice("ADMIN:INSTANCES:".length));
            const segment = document.getElementById("instances");
            while (segment.children.length) {
                segment.removeChild(segment.children[0]);
            }
            for (const name of instanceData["instances"]) {
                const btn = document.createElement("button");
                btn.innerText = name;
                btn.value = name;
                btn.onclick = e => instanceUpdate(() => {
                    // websocket.send(`ADMIN:inst-switch:${e.target.value}`);
                    req("/api/instance/switch", "POST", { name });
                });
                segment.appendChild(btn);
                if (name == instanceData["current"]) {
                    btn.classList.add("selected");
                }
            }
        } else if (e.data.startsWith("ADMIN:CLIENTS:")) {
            const data = JSON.parse(e.data.slice("ADMIN:CLIENTS:".length));
            updateClientData(data);
        } else if (e.data.startsWith("ADMIN:SERVERCONFIG:")) {
            info.connectionStatus = "connected as admin";
            serverConfig = JSON.parse(e.data.slice("ADMIN:SERVERCONFIG:".length));
            updateInfo();
        } else if (e.data.startsWith("ADMIN:request-session:")) {
            // unused
            const sessionName = e.data.slice("ADMIN:request-session:");
            const ans = prompt(`[Session request] \"${sessionName}\".\n\nm`)
        }
    } else if (e.data == "pong") {
        report(`Server responded in ${parseTime(Date.now() - lastPing)}`, 1);
        lastPing = null;
    }
}

function uasniff(userAgentString) {
    const ua = userAgentString.toLowerCase();
    
    const result = {
        os: null,
        deviceType: null,
        browser: null,
        mobile: false
    };
    
    if (/iphone|ipod|ipad/.test(ua)) {
        result.os = 'iOS';
    } else if (/windows/.test(ua)) {
        result.os = 'Windows';
    } else if (/macintosh|mac os x/.test(ua)) {
        result.os = 'MacOS';
    } else if (/android/.test(ua)) {
        result.os = 'Android';
    } else if (/linux/.test(ua)) {
        result.os = 'Linux';
    }
    
    if (/mobile|android|iphone|ipad|ipod/.test(ua)) {
        result.mobile = true;
        if (/ipad/.test(ua)) {
            result.deviceType = 'Tablet';
        } else {
            result.deviceType = 'Mobile';
        }
    } else {
        result.deviceType = 'Desktop';
    }
    
    if (/chrome\/([0-9]+)/.test(ua)) {
        result.browser = 'Chrome';
    } else if (/firefox\/([0-9]+)/.test(ua)) {
        result.browser = 'Firefox';
    } else if (/safari\/([0-9]+)/.test(ua)) {
        result.browser = 'Safari';
    } else if (/edge\/([0-9]+)/.test(ua)) {
        result.browser = 'Edge';
    }
    
    return result;
}

function updateClientData(data) {
    const tbody = document.getElementById("clients-data");
    while (tbody.children.length) {
        tbody.removeChild(tbody.children[0]);
    }
    for (const entry of data) {
        const tr = document.createElement("tr");

        const tdTimestamp = document.createElement("td");
        tdTimestamp.innerText = fullDateFmt(new Date(entry.connectTimestamp));
        tr.appendChild(tdTimestamp);

        const tdUA = document.createElement("td");
        const sniffed = uasniff(entry.userAgent);
        tdUA.innerText = `${sniffed.os}, ${sniffed.browser}`;
        tr.appendChild(tdUA);

        const tdRole = document.createElement("td");
        if (entry.role === undefined) {
            tdRole.innerText = "Unknown";
        } else {
            tdRole.innerText = entry.role;
        }
        tr.appendChild(tdRole);
        
        const tdAuth = document.createElement("td");
        const _auth = entry.auth;
        if (_auth.type == "admin") {
            tdAuth.innerText = "Admin";
        } else if (_auth.type == "token") {
            tdAuth.innerText = `Token; Until ${fullDateFmt(new Date(parseInt(_auth.expireIn)))}`;
        } else if (_auth.type == "elevated") {
            tdAuth.innertext = `Elevated at ${fullDateFmt(new Date(_auth.timestamp))}`;
        } else if (_auth.type == "none") {
            tdAuth.innerText = "None";
        } else {
            tdAuth.innerText = "Malformed";
        }
        tr.appendChild(tdAuth);

        const tdAction = document.createElement("td");

        // [Disconnect]
        const btnDisconnect = document.createElement("button");
        btnDisconnect.innerText = "Disconnect";
        btnDisconnect.onclick = () => {
            websocket.send(`ADMIN:clients-disconnect:${entry.id}`);
        };
        tdAction.appendChild(btnDisconnect);
        
        // [Allow input]
        const btnAllowInput = document.createElement("button");
        btnAllowInput.innerText = "Allow input";
        btnAllowInput.onclick = () => {
            websocket.send(`ADMIN:clients-allow-input:${entry.id}`);
        };
        tdAction.appendChild(btnAllowInput);

        tr.appendChild(tdAction);

        const tdFullId = document.createElement("td");
        tdFullId.innerText = entry.id;
        tr.appendChild(tdFullId);

        tbody.appendChild(tr);
    }
}

function createToken() {
    const token = prompt("Enter access token (at least 4 chars):");
    if (token === null) return;
    const tonight = new Date;
    tonight.setHours(23, 59, 59);
    const dateString = prompt("Enter expiry date (YYYY-MM-DD hh:mm:ss):", fullDateFmt(tonight));
    if (dateString === null) return;
    const expireIn = Date.parse(dateString);
    req("/api/token/create", "POST", { token, expireIn });
    // websocket.send("ADMIN:create-token:" + JSON.stringify({
    //     token,
    //     expireIn,
    // }));
}

const reset = () => {
    info.connectionStatus = "disconnected";
    info.serverStatus = "unknown";
    updateInfo();
    document.getElementById("button-verify").disabled = true;
};

document.addEventListener("DOMContentLoaded", () => {
    reset();
    info.connectionStatus = "connecting ...";
    updateInfo();
});