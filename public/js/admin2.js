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
        } else if (e.data == "ADMIN:OVERRIDDEN") {
            websocket.onclose = () => setConnectionStatus("<span style='color: red'>Overridden</span>");
            websocket.close();
            return;
        } else if (e.data.startsWith("ADMIN:INSTANCES:")) {
            const instances = JSON.parse(e.data.slice("ADMIN:INSTANCES:".length));
            updateInstances(instances);
        } else if (e.data.startsWith("ADMIN:CLIENTS:")) {
            const data = JSON.parse(e.data.slice("ADMIN:CLIENTS:".length));
            updateClientData(data);
        } else if (e.data.startsWith("ADMIN:SERVERCONFIG:")) {
            serverConfig = JSON.parse(e.data.slice("ADMIN:SERVERCONFIG:".length));
            setSegmentButtons("inputAccess", serverConfig.inputAccess);

        }
    } else if (e.data == "pong") {
        report(`Server responded in ${parseTime(Date.now() - lastPing)}`, 1);
        lastPing = null;
    } else if (e.data.startsWith("@meta:")) {
        const theme = JSON.parse(e.data.slice("@meta:".length)).theme;
        document.getElementById("theme").value = theme;
    }
}



function setConnectionStatus(msg) {
    document.getElementById("connection-status").innerHTML = msg;
}


function checkAdmin() {
    websocket.send(`ADMIN:${__(document.getElementById("password").value)}`);
}


function createNewInstance() {
    const name = prompt("Enter name for new instance:");
    if (name === null) return null;
    req("/api/instance/create", "POST", { name });
}

function updateInstances(data) {
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

        li.onclick = e => {
            req(`/api/data?name=${name}`, "GET")
                .then(resp => {
                    resp.json().then(json => {
                        // li.querySelector(".instance-bottom").innerText = json;
                        li.classList.toggle("expanded");
                        const btm = li.querySelector(".instance-bottom");
                        btm.innerHTML = `
                            <div class="instance-data-col"></div>
                            <div class="instance-data-col"></div>
                        `;
                        btm.querySelectorAll(".instance-data-col").forEach((col, i) => {
                            const data = json[i];
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
                })
        };
        
        // [Select]
        li.querySelector("button:nth-child(1)").onclick = e => {
            e.stopPropagation();
            req("/api/instance/switch", "POST", { name });
        };

        // [Clone]
        li.querySelector("button:nth-child(2)").onclick = e => {
            e.stopPropagation();
            const newName = prompt("Enter new name:");
            if (newName === null) return;
            req("/api/instance/clone", "POST", { from: name, to: newName });
        };

        // [Delete]
        li.querySelector("button:nth-child(3)").onclick = e => {
            e.stopPropagation();
            const check = prompt("Type the instance name again to confirm deletion:");
            if (check !== name) return;
            req("/api/instance/delete", "DELETE", { name });
        };
        list.appendChild(li);
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
                <button>Allow input</button>
            </td>
        `;

        const tdAction = document.createElement("td");

        // [Disconnect]
        tr.querySelector("button:nth-child(1)").onclick = () => {
            websocket.send(`ADMIN:clients-disconnect:${entry.id}`);
        };
        
        // [Allow input]
        tr.querySelector("button:nth-child(2)").onclick = () => {
            websocket.send(`ADMIN:clients-allow-input:${entry.id}`);
        };

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
        // document.getElementById("instance-management").style.opacity = 1;
    }
    return response;
}

function configUpdate(newConfig) {
    req("/api/config/update", "POST", newConfig);
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
    configUpdate({ inputAccess: value });
});
