// SOCKET

type Auth = { type: "none" }
    | { type: "admin" }
    | { type: "token", token: string, expireIn: number }
    | { type: "elevated", timestamp: number }

interface Client {
    socket: WebSocket,
    connectTimestamp: number,
    role: string, //
    auth: Auth,
    userAgent: string | null,
}

const clients_ = new Map<string, Client>();

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
    
    let instanceName = (await kv.get(["instanceName"])).value;
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
    clients_.forEach(c => {
        if (c.socket.readyState == c.socket.CLOSED) return;
        c.socket.send(msg);
    });
}

async function getData() {
    const leaderboards = (await kv.get(["leaderboards"])).value;
    if (leaderboards === null) return [[], []];
    return leaderboards
}

async function broadcastAndSaveData(leaderboards: Leaderboard[]) {
    broadcast(JSON.stringify(leaderboards));
    await kv.set(["leaderboards"], leaderboards);
}

function getAdminSocket(): WebSocket | null {
    if (adminId === null) return null;
    if (!clients_.has(adminId)) return null;
    return clients_.get(adminId)!.socket;
}

function adminSendServerConfig() {
    getAdminSocket()
        ?.send(`ADMIN:SERVERCONFIG:${JSON.stringify(config)}`);
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
    getAdminSocket()
        ?.send(`ADMIN:INSTANCES:${JSON.stringify({
            instances: await getInstances(),
            current: (await kv.get(["instanceName"])).value,
        })}`);
}

function adminSendClientsData() {
    const data = [];
    for (const id of clients_.keys()) {
        data.push({
            id: id,
            ...clients_.get(id),
        });
    }
    getAdminSocket()
        ?.send(`ADMIN:CLIENTS:${JSON.stringify(data)}`);
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

    clients_.set(clientId, {
        socket: socket,
        connectTimestamp: Date.now(),
        role: "Pre-Auth",
        auth: { type: "none" },
        userAgent: req.headers.get("user-agent"),
    });

    // clients.set(clientId, socket);
    // clientsTimestamp.set(clientId, Date.now());
    // clientsUA.set(clientId, req.headers.get("user-agent"));
    // clientsRole.set(clientId, "Pre-Auth");

    // Send current scores to newly connected client
    socket.addEventListener("open", async () => {
        console.log(`client ${clientId} connected!`);
        socket.send(JSON.stringify(await getData()));
        broadcast(`@nclients:${clients_.size}`)
        if (config.inputAccess == "everyone") {
            socket.send("AUTH:success");
        } else {
            socket.send("AUTH:required");
            console.log(`requiring auth from ${clientId}`);
        }
        adminSendClientsData();
    });

    socket.addEventListener("message", async (event) => {
        if (!clients_.has(clientId)) return;
        console.log(`received from ${clientId}`)
        console.log(event.data);
        if (event.data == `ADMIN:${Deno.env.get("ADMIN")}`) {
            if (adminId !== null && clients_.has(adminId) && clientId != adminId) {
                // const oldClient = clients.get(adminId);
                // oldClient.send("ADMIN:OVERRIDDEN");
                const oldAdmin = clients_.get(adminId);
                oldAdmin?.socket.send("ADMIN:OVERRIDEN");
            }
            adminId = clientId;
            // clientsRole.set(adminId, "Admin");
            clients_.get(adminId)!.role = "Admin";
            clients_.get(adminId)!.auth = { type: "admin" };
            adminSendServerConfig();
            await adminSendInstancesData();
            adminSendClientsData();
            return;
        }
        
        if (clientId == adminId && event.data.startsWith("ADMIN:")) {
            // admin scope
            const data = event.data.slice(6);
            if (data.startsWith("clients-disconnect:")) {
                const id = data.slice("clients-disconnect:".length);
                clients_.get(id)?.socket.close();
            } else if (data.startsWith("clients-allow-input:")) {
                const id = data.slice("clients-allow-input:".length);
                const c = clients_.get(id);
                if (!c) return;
                // const sock = clients.get(id);
                // clientsAuth.set(id, `@admin:${Date.now()}`);
                // clientsExpire.set(id, `@admin:${Date.now()}`);
                c.auth = { type: "elevated", timestamp: Date.now() };
                c.socket.send("AUTH:success");
                adminSendClientsData();
            }
        }

        if (event.data == "ping") {
            socket.send("pong");
            return;
        }

        if (event.data.startsWith("AUTH:") && config.inputAccess != "none") {
            if (event.data.startsWith("AUTH:token:")) {
                const token = event.data.slice("AUTH:token:".length);
                const tokExpireIn = await authCheckToken(token);
                if (tokExpireIn) {
                    socket.send("AUTH:success");
                    // clientsAuth.set(clientId, token);
                    // clientsExpire.set(clientId, tokExpireIn);
                    clients_.get(clientId)!.auth = { type: "token", token: token, expireIn: tokExpireIn };
                    adminSendClientsData();
                } else {
                    socket.send("AUTH:failure");
                }
            }
            return;
        }

        if (event.data.startsWith("REPORT-ROLE:")) {
            const role = event.data.slice("REPORT-ROLE:".length);
            // clientsRole.set(clientId, role);
            clients_.get(clientId)!.role = role;
            adminSendClientsData();
            return;
        }
        
        if (
            (config.inputAccess == "restricted" && /* !clientsAuth.has(clientId) */ clients_.get(clientId)?.auth.type == "none")
            || (config.inputAccess == "none" && clients_.get(clientId)!.auth.type != "admin")
        ) {
            // unauthenticated client intends to send input
            socket.send("AUTH:failure");
            console.log(`denied input access from ${clientId}`);
            return;
        }

        if (event.data.startsWith("!")) {
            broadcast(event.data);
            return;
        }

        const leaderboards = await getData();
        if (event.data == "refresh-all") {
            leaderboards.forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastAndSaveData(leaderboards);
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(leaderboards));
            return;
        }
        if (event.data == "clear") {
            await broadcastAndSaveData([[], []]);
            return;
        }
        let obj;
        try {
            obj = JSON.parse(event.data);
        } catch {
            return;
        }
        if ("type" in obj && obj.type === "update" && "leaderboards" in obj) {
            const leaderboards: Leaderboard[] = obj.leaderboards;
            leaderboards.forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastAndSaveData(leaderboards);
        }
    });

    socket.addEventListener("close", () => {
        console.log(`client ${clientId} disconnected`);
        clients_.delete(clientId);
        // clients.delete(clientId);
        // clientsTimestamp.delete(clientId);
        broadcast(`@nclients:${clients_.size}`);
        if (clientId === adminId) adminId = null;
        // if (clientsAuth.has(clientId)) clientsAuth.delete(clientId);
        // if (clientsUA.has(clientId)) clientsUA.delete(clientId);
        // if (clientsRole.has(clientId)) clientsRole.delete(clientId);
        // if (clientsExpire.has(clientId)) clientsExpire.delete(clientId);
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
                broadcast("!reload-all");
            }
        }
        await adminSendInstancesData();
    } else if (path == "/api/config/update" && method == "POST") {
        for (const fieldName in config) {
            if (fieldName in body) {
                config[fieldName] = body[fieldName];
            }
        }
        await kv.set(["config"], config);
        adminSendServerConfig();
    } else if (path == "/api/token/create" && method == "POST") {
        const { token, expireIn } = body;
        if (typeof token !== "string") return bad("Invalid token name.");
        if (typeof expireIn !== "number") return bad("Invalid expiry.");
        if (token.length < 4 || token.length > 256) return bad("Tokens must be at least 4 characters long.");
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

    if (path.startsWith("/api/")) {
        return await handleApi(path, req);
    }

    if (path === "/ws") {
        if (req.headers.get("upgrade") == "websocket") {
            return connectSocket(req);
        }
        return new Response(null, { status: 501 });
    } else if (path === "/") {
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

    try {
        const file = await Deno.open(Deno.cwd() + path);
        return new Response(file.readable);
    } catch (e) {
        console.error(`Error serving file ${path}:`, e);
        return new Response("Not Found", { status: 404 });
    }
});
