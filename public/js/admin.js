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

var serverConfig = {};
const websocket = (() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;
    return new WebSocket(wsUrl);
})();

websocket._send = websocket.send;
websocket.send = msg => {
    if (websocket.readyState == websocket.CONNECTING) {
        showNotification("Websocket is connecting", 0);
    } else if (websocket.readyState == websocket.CLOSING) {
        showNotification("Websocket is closing", 0);
    } else if (websocket.readyState == websocket.CLOSED) {
        showNotification("Websocket is disconnected", 0);
        return;
    }
    websocket._send(msg);
}

websocket.onopen = () => {
    setConnectionStatus("Authentication required");
    websocket.send("ADMIN:TEST"); // try fastpass
}

websocket.onclose = () => {
    setConnectionStatus("<span style='color: red'>Disconnected</span>")
}

websocket.onmessage = e => {
    console.log(`RECEIVED: ${e.data}`);
    // pushLog(`[socket] received: ${e.data}`);
    if (e.data === "AUTH:failure") {
        document.getElementById("auth-msg").innerText = "Wrong Password";
        document.getElementById("auth-msg").style.color = "red";
    } else if (e.data.startsWith("ADMIN:")) {
        if (e.data === "ADMIN:OK") {
            setConnectionStatus("Connected")
            showTab("clients");
            showNotification("Authenticated!", 1);
            document.getElementById("auth-msg").innerText = "Authenticated";
            document.getElementById("auth-msg").style.color = "green";
            loadAccessData();
            loadInstanceData();
            loadConfig();
            document.querySelector(".tab-btn.warn").classList.remove("warn");
        } else if (e.data == "ADMIN:OVERRIDDEN") {
            document.getElementById("password").value = "";
            websocket.onclose = () => setConnectionStatus("<span style='color: red'>Overridden</span>");
            websocket.close();
            showNotification("This session is overridden by another session. Reload to reconnect.", type = 0, { duration: 5000 });
            return;
        } else if (e.data.startsWith("ADMIN:CLIENTS:")) {
            const data = JSON.parse(e.data.slice("ADMIN:CLIENTS:".length));
            updateClientData(data);
        }
    } else if (e.data == "pong") {
        report(`Server responded in ${parseTime(Date.now() - lastPing)}`, 1);
        lastPing = null;
    } else if (e.data.startsWith("@meta:")) {
        // const theme = JSON.parse(e.data.slice("@meta:".length)).theme;
        // document.getElementById("theme").value = theme;
    }
}

function setConnectionStatus(msg) {
    document.getElementById("connection-status").innerHTML = msg;
}

function checkAdmin() {
    websocket.send(`ADMIN:${__(document.getElementById("password").value)}`);
}

async function createNewInstance() {
    const name = prompt("Enter name for new instance:");
    if (name === null) return null;
    const resp = await req("/api/instance/create", "POST", { name });
    if (!resp.ok) return;
    const data = await resp.json();
    updateInstances(data);
}

async function switchInstance(name) {
    const resp = await req("/api/instance/switch", "POST", { name });
    if (!resp.ok) return;
    const data = await resp.json();
    updateInstances(data);
}

async function cloneInstance(name) {
    const newName = prompt("Enter new name:");
    if (newName === null) return;
    const resp = await req("/api/instance/clone", "POST", { from: name, to: newName });
    if (!resp.ok) return;
    const data = await resp.json();
    updateInstances(data);
}

async function deleteInstance(name) {
    const check = prompt("Type the instance name again to confirm deletion:");
    if (check !== name) return;
    const resp = await req("/api/instance/delete", "DELETE", { name });
    if (!resp.ok) return;
    const data = await resp.json();
    updateInstances(data);
}

function instanceImport() {
    const data = prompt("Enter JSON data:");
    if (data === null) return;
    req("/api/data", "POST", JSON.parse(data));
}

async function instanceExport() {
    try {
        const resp = await fetch("/api/data");
        if (!resp.ok) {
            showNotification("Error fetching /api/data, check console", 0);
            console.log(resp);
            return;
        }
        const text = await resp.text();
        await navigator.clipboard.writeText(text);
        showNotification("Copied JSON to clipboard!", 1);
    } catch (e) {
        showNotification("Error copying data, check console", 0);
        console.error(e);
    }
}

function updateInstances(data) {
    console.log(999, data);
    const list = document.getElementById("instance-list");
    list.innerHTML = "";
    for (const name of data["instances"]) {
        const li = document.createElement("li");
        li.classList.add("instance-item");
        if (name == data["current"]) {
            li.classList.add("active");
        }
        li.innerHTML = `
            <div class="instance-top">
                <div class="instance-info">
                    <span class="instance-name"></span>
                    ${name === data["current"] ? `<span class="active-status">ACTIVE</span>` : ''}
                </div>
                <div class="instance-controls">
                    <button ${name === data["current"] ? 'disabled' : ''}>Select</button>
                    <button><span class="material-symbols-outlined">content_copy</span></button>
                    <button ${name === data["current"] ? 'disabled' : ''}><span class="material-symbols-outlined">delete</span></button>
                </div>
            </div>
            <div class="instance-bottom"></div>
        `;
        li.querySelector(".instance-name").innerText = name;

        li.querySelector(".instance-top").onclick = () => {
            li.classList.toggle("expanded");
            if (!li.classList.contains("expanded")) {
                return;
            }
            const btm = li.querySelector(".instance-bottom");
            btm.innerHTML = "<p>Loading ...</p>";

            req(`/api/data?name=${name}`, "GET")
                .then(resp => {
                    resp.json().then(json => {
                        btm.innerHTML = `
                            <div class="instance-data-col"></div>
                            <div class="instance-data-col"></div>
                        `;
                        btm.querySelectorAll(".instance-data-col").forEach((col, i) => {
                            const data = json[`lb${i+4}`];
                            for (let j = 0; j < data.length; j++) {
                                const row = document.createElement("div");
                                row.classList.add("instance-data-row");
                                row.innerHTML = `
                                    <div class="instance-data-rank">${j+1}</div>
                                    <div class="instance-data-name">${data[j].name}</div>
                                    <div class="instance-data-score">${data[j].score}</div>
                                `;
                                col.appendChild(row);
                            }
                        });
                    })
                });
        };
        
        // [Select]
        li.querySelector("button:nth-child(1)").onclick = async e => {
            e.stopPropagation();
            await switchInstance(name)
        };

        // [Clone]
        li.querySelector("button:nth-child(2)").onclick = async e => {
            e.stopPropagation();
            await cloneInstance(name);
        };

        // [Delete]
        li.querySelector("button:nth-child(3)").onclick = async e => {
            e.stopPropagation();
            await deleteInstance(name);
        };
        list.appendChild(li);
    }

    // preload tab with its icons
    const tab = document.getElementById("tab-instances");

    if (tab.classList.contains("active")) return;

    tab.style.visibility = "hidden";
    tab.style.display = "block";
    setTimeout(() => {
        tab.style.display = "";
        tab.style.visibility = "";
    }, 10);
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

function fullDateFmt(date, millis = false) {
    var str = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.toLocaleTimeString("en-US", { hour12: false })}`;
    if (millis) str += "." + date.getMilliseconds().toString().padStart(3, "0");
    return str;
}

function updateClientData(data) {
    const tbody = document.getElementById("clients-data");
    tbody.innerHTML = "";
    for (const entry of data) {
        const tr = document.createElement("tr");
        
        // just use react atp

        const sniffed = uasniff(entry.userAgent);

        const _auth = entry.auth;
        let authText;
        if (_auth.type == "admin") {
            authText = "Admin";
        } else if (_auth.type == "token") {
            authText = `Token; Until ${fullDateFmt(new Date(parseInt(_auth.expireIn)))}`;
        } else if (_auth.type == "elevated") {
            authText = `Elevated at ${fullDateFmt(new Date(_auth.timestamp))}`;
        } else if (_auth.type == "none") {
            authText = "None";
        } else {
            authText = "Malformed";
        }

        tr.innerHTML = `
            <td>${fullDateFmt(new Date(entry.connectTimestamp))}</td>
            <td>${sniffed.os}, ${sniffed.browser}</td>
            <td>${entry.role === undefined ? "Unknown" : entry.role}</td>
            <td>${authText}</td>
            <td>
                <button>Disconnect</button>
                <button>Elevate</button>
            </td>
        `;

        const tdAction = document.createElement("td");

        // [Disconnect]
        tr.querySelector("button:nth-child(1)").onclick = () => {
            websocket.send(`ADMIN:clients-disconnect:${entry.id}`);
        };
        
        // [Elevate]
        if (_auth.type == "admin") {
            tr.querySelector("button:nth-child(2)").disabled = true;
        } else {
            tr.querySelector("button:nth-child(2)").onclick = () => {
                websocket.send(`ADMIN:clients-allow-input:${entry.id}`);
            };
        }

        tbody.appendChild(tr);
    }
}

function showNotification(message, type, options = {}) {
    let color = type === null || type === undefined ? "white" : type ? "lightgreen" : "pink";
    const notif = document.createElement("div");
    notif.className = "notification";
    notif.innerHTML = `
        <span>${message}</span>
        <button class="close-btn" title="Dismiss">&times;</button>
    `;
    notif.style.backgroundColor = color;
    notif.querySelector(".close-btn").onclick = () => notif.remove();
    document.getElementById("notifications").appendChild(notif);

    const duration = options.duration ?? 2000;
    if (duration > 0) {
        setTimeout(() => notif.remove(), duration);
    }
}

function showTab(tab) {
    document.querySelectorAll("#tab-content > div").forEach(e => e.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
    });
}
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
        showTab(btn.getAttribute("data-tab"));
    }
});

showTab("auth");

document.getElementById("auth-form").onsubmit = e => {
    e.preventDefault();
    checkAdmin();
}

async function req(url, method, data) {
    if (url.startsWith("/")) url = url.slice(1);
    const response = await fetch(`${window.location.protocol}//${window.location.host}/${url}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${__(document.getElementById("password").value)}`
        },
        body: method == "GET" ? undefined : JSON.stringify(data),
    });
    if (!response.ok) {
        showNotification(`[${response.status}] ${await response.text()}`, 0);
    } else if (method != "GET") {
        showNotification("Success", 1);
    }
    return response;
}

async function loadConfig() {
    const resp = await req("/api/config", "GET");
    if (!resp.ok) return;
    const data = await resp.json();
    updateConfig(data);
}

function updateConfig(config) {
    serverConfig = config;
    setSegmentButtons("inputAccess", config.inputAccess);
    if (config.backupUrl === null) {
        document.getElementById("backup-url").innerText = "[unset]"
    } else {
        document.getElementById("backup-url").innerText = config.backupUrl;
    }
    document.getElementById("parent-url").innerText = config.parentUrl === null ? "[unset]" : config.parentUrl;
}

async function setConfig(newConfig) {
    const resp = await req("/api/config", "POST", newConfig);
    if (!resp.ok) return;
    const data = await resp.json();
    updateConfig(data);
}

async function createToken() {
    const token = prompt("Enter access token (at least 4 chars):");
    if (token === null) return;
    const tonight = new Date;
    tonight.setHours(23, 59, 59);
    const dateString = prompt("Enter expiry date (YYYY-MM-DD hh:mm:ss):", fullDateFmt(tonight));
    if (dateString === null) return;
    const expireIn = Date.parse(dateString);
    await req("/api/token/create", "POST", { token, expireIn });
    loadAccessData();
}

function updateAccessData() {
    const tbody = document.getElementById("access-data-body");
    tbody.innerHTML = "";
    const vis = document.getElementById("vis").checked;
    for (const token in _tokdata) {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${vis ? token : "****"}</td>
            <td>${fullDateFmt(new Date(_tokdata[token]))}</td>
            <td>
                <button>Modify</button>
                <button>Delete</button>
            </td>
        `;

        // [Modify]
        tr.querySelector("button:nth-child(1)").onclick = async () => {
            const dateString = prompt("Enter new expiry date (YYYY-MM-DD hh:mm:ss):", fullDateFmt(new Date(_tokdata[token])));
            if (dateString === null) return;
            const expireIn = Date.parse(dateString);
            await req("/api/token/modify", "POST", {
                token,
                expireIn,
            });
            loadAccessData();
        }
        
        // [Delete]
        tr.querySelector("button:nth-child(2)").onclick = async () => {
            const check = prompt("Type the token again to confirm deletion:");
            if (check !== token) return;
            await req("/api/token/delete", "POST", {
                token,
            });
            loadAccessData();
        }

        tbody.appendChild(tr);
    }
}

let _tokdata = {};

async function loadAccessData() {
    const resp = await req("/api/token", "GET");
    if (!resp.ok) return;
    _tokdata = await resp.json();
    updateAccessData();
}

async function loadInstanceData() {
    const resp = await req("/api/instance", "GET");
    if (!resp.ok) return;
    const data = await resp.json();
    updateInstances(data);
}

function modifyBackupUrl() {
    let newUrl = prompt("Enter new backup url:", serverConfig.backupUrl);
    if (newUrl == null) return;
    if (newUrl == "") {
        newUrl = null
    }
    setConfig({ backupUrl: newUrl });
}

function modifyParentUrl() {
    let newUrl = prompt("Enter new parent url:", serverConfig.parentUrl);
    if (newUrl == null) return;
    if (newUrl == "") {
        newUrl = null
    }
    setConfig({ parentUrl: newUrl });
}

function setupSegmentButtons(id, onchange) {
    const parent = document.getElementById(id);
    parent.querySelectorAll("button").forEach(btn => {
        btn.onclick = () => onchange(btn.getAttribute("value"));
    });
}

function setSegmentButtons(id, value) {
    const parent = document.getElementById(id);
    parent.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("selected", btn.getAttribute("value") === value);
    });
}

setupSegmentButtons("inputAccess", value => {
    setConfig({ inputAccess: value });
});

async function ping() {
    const start = Date.now();
    await fetch(`${window.location.protocol}//${window.location.host}/ping`, {
        method: "GET",
    });
    const end = Date.now();
    showNotification(`Server responded in ${end - start}ms`, 1);
}
