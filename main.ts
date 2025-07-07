// SOCKET

const clients = new Map();
const clientsTimestamp = new Map();
const clientsAuth = new Map();
const clientsRole = new Map();
const clientsUA = new Map();
const clientsExpire = new Map();

// TODO: merge maps

let adminId: string | null = null;

const kv = await Deno.openKv();

interface Config {
    inputAccess: string,
    outputAccess: string,
}

const DEFAULT_CONFIG: Config = {
    inputAccess: "restricted",
    outputAccess: "everyone",
}

// none: function is only accessible by admin
// restricted: function is only accessible by admin and admin-approved sessions
// everyone: function is accessible by all sessions

function isValidConfig(obj: unknown): obj is Config {
    return (
        typeof obj === "object" &&
        obj !== null &&
        "inputAccess" in obj &&
        typeof obj.inputAccess === "string" &&
        "outputAccess" in obj &&
        typeof obj.outputAccess === "string"
    );
}

let config = await (async () => {
    const tmp = (await kv.get(["config"])).value;
    if (isValidConfig(tmp)) return tmp;
    return DEFAULT_CONFIG;
})();

interface Record {
    name: string;
    score: number;
}

type Leaderboard = Record[];

async function setupKv() {
    let config = (await kv.get(["config"])).value;
    if (config === null) {
        config = structuredClone(DEFAULT_CONFIG);
        await kv.set(["config"], config);
    }
    
    const entries = kv.list({ prefix: ["instances"] });
    const names = [];
    for await (const entry of entries) {
        names.push(entry.key[1]);
    }
    if (names.length == 0) {
        await kv.set(["instances", "_default"], [[], []]);
    }
    
    let instanceName = (await kv.get(["instancName"])).value;
    if (instanceName === null) {
        await kv.set(["instanceName"], "_default");
    }

    let leaderboards = (await kv.get(["leaderboards"])).value;
    if (leaderboards === null) {
        await kv.set(["leaderboards"], [[], []]);
    }
}

await setupKv();

function broadcast(msg: string) {
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(msg);
    });
}

async function getData() {
    const leaderboards = (await kv.get(["leaderboards"])).value;
    if (leaderboards === null) return [[], []];
    return leaderboards
}

async function broadcastData(leaderboards: Leaderboard[]) {
    broadcast(JSON.stringify(leaderboards));
    await kv.set(["leaderboards"], leaderboards);
}

function adminSendServerConfig() {
    if (adminId === null) return;
    const socket = clients.get(adminId);
    socket.send(`ADMIN:SERVERCONFIG:${JSON.stringify(config)}`);
}

async function getInstances() {
    const entries = kv.list({ prefix: ["instances"] });
    const names = [];
    for await (const entry of entries) {
        names.push(entry.key[1]);
    }
    return names;
}

async function switchInstance(newInstance: string) {
    const newData = (await kv.get(["instances", newInstance])).value;
    if (newData === null) return;

    const currentInstance = (await kv.get(["instanceName"])).value;
    if (typeof currentInstance !== "string") {
        return;
    }
    await kv.set(["instances", currentInstance], (await kv.get(["leaderboards"])).value);
    await kv.atomic()
        .set(["instanceName"], newInstance)
        .set(["leaderboards"], newData)
        .commit();

    broadcast("!reload-all");
}

async function adminSendInstancesData() {
    if (adminId === null) return;
    const socket = clients.get(adminId);
    socket.send(`ADMIN:INSTANCES:${JSON.stringify({
        "instances": await getInstances(),
        "current": (await kv.get(["instanceName"])).value,
    })}`);
}

async function adminDone() {
    if (adminId === null) return;
    const socket = clients.get(adminId);
    socket.send("ADMIN:DONE");
    await adminSendInstancesData();
}

function adminSendClientsData() {
    if (adminId === null) return;
    const data = [];
    for (const id of clients.keys()) {
        data.push({
            id: id,
            timestamp: clientsTimestamp.get(id),
            expireIn: clientsExpire.get(id),
            role: clientsRole.get(id),
            userAgent: clientsUA.get(id),
        });
    }
    const socket = clients.get(adminId);
    socket.send(`ADMIN:CLIENTS:${JSON.stringify(data)}`);
}

function adminCreateToken(token: string, expireIn: number) {
    const timedelta = expireIn - Date.now();
    kv.set(["tokens", token], expireIn, { expireIn: timedelta });
}

async function authCheckToken(token: string) {
    const tok = await kv.get(["tokens", token]);
    if (tok.value === null) return false;
    if (typeof tok.value !== "number") return false; // invalid token
    if (Date.now() >= tok.value) return false; // expired
    return tok.value;
}

function connectSocket(req: Request) {
    if (req.headers.get("upgrade") !== "websocket") {
        return new Response(null, { status: 501 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    
    const clientId = crypto.randomUUID();
    clients.set(clientId, socket);
    clientsTimestamp.set(clientId, Date.now());
    clientsUA.set(clientId, req.headers.get("user-agent"));

    // Send current scores to newly connected client
    socket.addEventListener("open", async () => {
        console.log(`client ${clientId} connected!`);
        socket.send(JSON.stringify(await getData()));
        broadcast(`@nclients:${clients.size}`)
        if (config.inputAccess == "everyone") {
            socket.send("AUTH:success");
        } else {
            socket.send("AUTH:required");
            console.log(`requiring auth from ${clientId}`);
        }
        adminSendClientsData();
    });

    socket.addEventListener("message", async (event) => {
        console.log(`received from ${clientId}`)
        console.log(event.data);
        if (event.data == `ADMIN:${Deno.env.get("ADMIN")}`) {
            if (adminId !== null && clients.has(adminId) && clientId != adminId) {
                const oldClient = clients.get(adminId);
                oldClient.send("ADMIN:OVERRIDDEN");
            }
            adminId = clientId;
            clientsRole.set(adminId, "Admin");
            await adminSendServerConfig();
            await adminSendInstancesData();
            adminSendClientsData();
        } else if (clientId == adminId && event.data.startsWith("ADMIN:")) {
            // admin scope
            const data = event.data.slice(6);
            if (data.startsWith("inst-create:")) {
                const name = data.slice("inst-create:".length);
                if (name.length != 0 && (await kv.get(["instances", name])).value == null) {
                    await kv.set(["instances", name], [[], []]);
                };
                await adminDone();
            } else if (data.startsWith("inst-switch:")) {
                const newName = data.slice("inst-switch:".length);
                if (newName.length != 0) {
                    await switchInstance(newName);
                }
                await adminDone();
            } else if (data.startsWith("inst-import:")) {
                const newJson = data.slice("inst-import:".length);
                await kv.set(["leaderboards"], JSON.parse(newJson));
                await adminDone();
            } else if (data.startsWith("inst-delete:")) {
                const name = data.slice("inst-delete:".length);
                if (name != (await kv.get(["instanceName"])).value) {
                    await kv.delete(["instances", name]);
                }
                await adminDone();
            } else if (data.startsWith("inst-clone-to:")) {
                const name = data.slice("inst-clone-to:".length);
                if (name.length != 0 && (await kv.get(["instances", name])).value === null) {
                    await kv.set(["instances", name], (await kv.get(["leaderboards"])).value);
                }
                await adminDone();
            } else if (data.startsWith("clients-disconnect:")) {
                const id = data.slice("clients-disconnect:".length);
                if (!clients.has(id)) return;
                const sock = clients.get(id);
                sock.close();
            } else if (data.startsWith("clients-allow-input:")) {
                const id = data.slice("clients-allow-input:".length);
                if (!clients.has(id)) return;
                const sock = clients.get(id);
                clientsAuth.set(id, `@admin:${Date.now()}`);
                clientsExpire.set(id, `@admin:${Date.now()}`);
                sock.send("AUTH:success");
                adminSendClientsData();
            } else if (data.startsWith("config-update:")) {
                const newConfig = JSON.parse(data.slice("config-update:".length));
                config = { ...config, ...newConfig };
                await kv.set(["config"], config);
                await adminSendServerConfig();
            } else if (data.startsWith("create-token:")) {
                // TODO: switch to using forms and POST!!
                const {token, expireIn} = JSON.parse(data.slice("create-token:".length));
                if (token === undefined || expireIn === undefined) return;
                if (token.length < 8 || token.length > 256) return;
                adminCreateToken(token, expireIn);
            }
        }

        if (event.data.startsWith("AUTH:") && config.inputAccess != "none") {
            if (event.data.startsWith("AUTH:token:")) {
                const token = event.data.slice("AUTH:token:".length);
                const tokExpireIn = await authCheckToken(token);
                if (tokExpireIn) {
                    socket.send("AUTH:success");
                    clientsAuth.set(clientId, token);
                    clientsExpire.set(clientId, tokExpireIn);
                    adminSendClientsData();
                } else {
                    socket.send("AUTH:failure");
                }
            }
            return;
        }

        if (event.data.startsWith("REPORT-ROLE:")) {
            const role = event.data.slice("REPORT-ROLE:".length);
            clientsRole.set(clientId, role);
            return;
        }
        
        if (adminId != clientId && (
            (config.inputAccess == "restricted" && !clientsAuth.has(clientId))
            || config.inputAccess == "none"
        )) {
            // unauthenticated client intends to send input
            socket.send("AUTH:failure");
            console.log(`denied input from ${clientId}`);
            return;
        }
        if (event.data.startsWith("!")) {
            broadcast(event.data);
            return;
        }
        var leaderboards = await getData();
        if (event.data == "refresh-all") {
            leaderboards.forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastData(leaderboards);
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(leaderboards));
            return;
        }
        if (event.data == "clear") {
            await broadcastData([[], []]);
            return;
        }
        let obj;
        try {
            obj = JSON.parse(event.data);
        } catch {
            return;
        }
        if ("type" in obj && obj.type === "update" && "leaderboards" in obj) { // new api
            const leaderboards: Leaderboard[] = obj.leaderboards;
            leaderboards.forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastData(leaderboards);
        }
    });

    socket.addEventListener("close", () => {
        console.log(`client ${clientId} disconnected!`);
        clients.delete(clientId);
        clientsTimestamp.delete(clientId);
        broadcast(`@nclients:${clients.size}`);
        if (clientId === adminId) adminId = null;
        if (clientsAuth.has(clientId)) clientsAuth.delete(clientId);
        if (clientsUA.has(clientId)) clientsUA.delete(clientId);
        if (clientsRole.has(clientId)) clientsRole.delete(clientId);
        if (clientsExpire.has(clientId)) clientsExpire.delete(clientId);
        adminSendClientsData();
    })
  return response;
}

// HTTPS

function httpsAuthAdmin(req: Request): Response | null {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response("Unauthorized: Missing or invalid Authorization header.", { status: 401 });
    }

    const token = authHeader.split(" ")[1];

    if (token !== Deno.env.get("ADMIN")) {
        return new Response("Unauthorized: Invalid token.", { status: 401 });
    }

    return null;
}

function bad(msg: string | null = null) {
    if (msg === null) {
        return new Response("Invalid API call", { status: 400 });
    }
    return new Response(`Invalid API call: ${msg}`, { status: 400 });
}

function ok() {
    return new Response("Done", { status: 200 });
}

async function handleApi(path: string, req: Request): Promise<Response> {
    const resp = httpsAuthAdmin(req);
    const method = req.method;
    if (resp !== null) {
        return resp;
    }
    const body = await req.json();
    if (path.startsWith("/api/instance")) {
        if (path == "/api/instance/create" && method == "POST") {
            if ("name" in body && typeof body.name == "string") {
                const name = body.name;
                if (name.length == 0) return bad("String is empty.");
                if ((await kv.get(["instances", name])).value !== null) return bad("Name is already in use.");
                await kv.set(["instances", name], [[], []]);
            }
        } else if (path == "/api/instance/switch" && method == "POST") {
            if ("name" in body && typeof body.name == "string") {
                const name = body.name;
                await switchInstance(name);
            }
        } else if (path == "/api/instance/delete" && method == "DELETE") {
            if ("name" in body && typeof body.name == "string") {
                const name = body.name;
                if (name == (await kv.get(["instanceName"])).value) return bad("Cannot be current instance.");
                if ((await kv.get(["instances", name])).value === null) return bad("Instance does not exist.");
                await kv.delete(["instances", name]);
            }
        } else if (path == "/api/instance/clone" && method == "POST") {
            if ("name" in body && typeof body.name == "string") {
                const name = body.name;
                if (name.length == 0) return bad("String is empty.");
                if ((await kv.get(["instances", name])).value !== null) return bad("Name is already in use.");
                await kv.set(["instances", name], (await kv.get(["leaderboards"])).value);
            }
        } else if (path == "/api/instance/import" && method == "POST") {
            if ("data" in body) {
                await kv.set(["leaderboards"], body.data);
            }
        }
        await adminSendInstancesData();
    } else if (path == "/api/config/update" && method == "POST") {
        for (const fieldName in config) {
            if (fieldName in body) {
                config[fieldName] = body[fieldName];
            }
        }
    } else if (path == "/api/token/create" && method == "POST") {
        const { token, expireIn } = body;
        if (typeof token !== "string") return bad("Invalid token name.");
        if (typeof expireIn !== "number") return bad("Invalid expiry.");
        if (token.length < 8 || token.length > 256) return bad("Tokens must be 8-256 characters long.");
        adminCreateToken(token, expireIn);
    } else if (path == "/api/token/delete" && method == "DELETE") {
        const { token } = body;
        if (typeof token !== "string") return bad("Invalid token name.");
        await kv.delete(["tokens", token]);
    }
    return ok();
}

Deno.serve(async (req) => {
    let path = (new URL(req.url)).pathname;
    console.log("request to path:", path);

    if (path === "/ws") {
        if (req.headers.get("upgrade") == "websocket") {
            return connectSocket(req);
        }
        return new Response(null, { status: 501 });
    } else if (path === "/") { // Serve static files
        path = "/index.html";
    } else if (path === "/admin") {
        path = "/admin.html";
    } else if (path === "/sync") {
        path = "/sync.html";
    } else if (path === "/output") {
        path = "/output.html";
    } else if (path === "/disconnected") {
        path = "/disconnected.html";
    }

    if (path.startsWith("/api/")) {
        return await handleApi(path, req);
    }

    try {
        const file = await Deno.open(Deno.cwd() + path);
        return new Response(file.readable);
    } catch (e) {
        console.error(`Error serving file ${path}:`, e);
        return new Response("Not Found", { status: 404 });
    }
});
