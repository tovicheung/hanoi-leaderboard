// SOCKET

type Auth = { type: "none" }
    | { type: "admin" }
    | { type: "token", token: string, expireIn: number }
    | { type: "elevated", timestamp: number }

interface Client {
    socket: WebSocket,
    connectTimestamp: number,
    role: string, // not strict, purely informative
    auth: Auth,
    userAgent: string | null,
}

const clients = new Map<string, Client>();

let adminId: string | null = null;

type AccessType = "everyone" | "restricted" | "none";

interface Config {
    inputAccess: AccessType,
    outputAccess: AccessType,
    backupUrl: string | null,
    parentUrl: string | null, // unused for now
}

interface InstanceMeta {
    timeLimits: object,
    theme: string,
}

interface Lb {
    meta: InstanceMeta,
    data: Leaderboard[],
}

const DEFAULT_CONFIG: Config = {
    inputAccess: "restricted",
    outputAccess: "everyone",
    backupUrl: null,
    parentUrl: null,
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
        typeof obj.outputAccess === "string" &&
        "backupUrl" in obj &&
        (typeof obj.backupUrl === "string" || obj.backupUrl === null) &&
        "parentUrl" in obj &&
        (typeof obj.parentUrl === "string" || obj.parentUrl === null)
    );
}

const kv = await Deno.openKv();
const config: Config = await (async () => {
    const tmp = (await kv.get(["config"])).value;
    if (isValidConfig(tmp)) return tmp;
    return DEFAULT_CONFIG;
})();

interface LbRecord {
    name: string;
    score: number;
}

type Leaderboard = LbRecord[];

function getNewMeta() {
    return {
        timeLimits: {
            "leaderboard1": 3 * 60 * 1000,
            "leaderboard2": 4 * 60 * 1000,
        },
        theme: "demonslayer",
    };
}

async function createInstance(name: string) {
    if (await instanceExists(name)) return;

    await kv.atomic()
        .set(["instances", name, "data"], [[], []])
        .set(["instances", name, "meta"], getNewMeta())
        .commit();
}

async function instanceExists(name: string) {
    const test = await kv.get(["instances", name, "meta"]);
    return test.value !== null;
}

function getDefaultInstance() {
    return {
        meta: {
            timeLimits: {
                "leaderboard1": 3 * 60 * 1000,
                "leaderboard2": 4 * 60 * 1000,
            },
            theme: "demonslayer",
        },
        data: [[], []]
    };
}

async function setupKv() {
    let config = (await kv.get(["config"])).value;
    if (config === null) {
        config = structuredClone(DEFAULT_CONFIG);
        await kv.set(["config"], config);
    }
    
    const entries = kv.list({ prefix: ["instances"] });
    for await (const entry of entries) {
        if (entry.key.length == 2) {
            const name = entry.key[1];
            const temp = (await kv.get(["instances", name])).value;
            await kv.set(["instances", name, "data"], temp.data);
            await kv.set(["instances", name, "meta"], temp.meta);
            await kv.delete(["instances", name]);
            console.log("Converted", name);
        }
    }

    if ((await getAllInstanceNames()).length == 0) {
        await createInstance("_default");
    }
    
    if ((await kv.get(["instanceName"])).value === null) {
        await kv.set(["instanceName"], "_default");
    }
}

await setupKv();

function broadcast(msg: string) {
    clients.forEach(c => {
        if (c.socket.readyState == c.socket.CLOSED) return;
        c.socket.send(msg);
    });
}

async function getActiveName(): Promise<string> {
    return (await kv.get<string>(["instanceName"])).value!;
}

async function getMeta(): Promise<InstanceMeta> {
    const name = await getActiveName();
    return <InstanceMeta>(await kv.get(["instances", name, "meta"])).value;
}

async function setMeta(meta: InstanceMeta) {
    const name = await getActiveName();
    await kv.set(["instances", name, "meta"], meta);
}

async function editMeta(callback: (meta: InstanceMeta) => void | Promise<void>) {
    const meta = await getMeta();
    await callback(meta);
    await setMeta(meta);
    broadcast(`@meta:${JSON.stringify(meta)}`);
}

async function getTimeLimits(): Promise<object> {
    return (await getMeta()).timeLimits;
}

async function getData(): Promise<Leaderboard[]> {
    const name = await getActiveName();
    return <Leaderboard[]>(await kv.get(["instances", name, "data"])).value;
}

async function setData(leaderboards: Leaderboard[]) {
    const name = await getActiveName();
    await kv.set(["instances", name, "data"], leaderboards);
}

async function broadcastAndSaveData(leaderboards: Leaderboard[]) {
    broadcast(JSON.stringify(leaderboards));
    await setData(leaderboards);


    if (config.backupUrl == null) {
        return;
    }

    const admin = Deno.env.get("ADMIN");

    await fetch(config.backupUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${admin}`
        },
        body: JSON.stringify(leaderboards),
    });
}

function getAdminSocket(): WebSocket | null {
    if (adminId === null) return null;
    if (!clients.has(adminId)) return null;
    return clients.get(adminId)!.socket;
}

function adminSendServerConfig() {
    getAdminSocket()
        ?.send(`ADMIN:SERVERCONFIG:${JSON.stringify(config)}`);
}

async function getAllInstanceNames() {
    const entries = kv.list({ prefix: ["instances"] });
    const names: string[] = [];
    for await (const entry of entries) {
        if (entry.key.length == 3 && entry.key[2] == "meta") {
            const name = entry.key[1];
            if (typeof name === "string") {
                names.push(name);
            }
        }
    }
    return names;
}

async function switchInstance(newInstance: string) {
    if (!await instanceExists(newInstance)) return;

    // const currentInstance = (await kv.get(["instanceName"])).value;
    // if (typeof currentInstance !== "string") {
    //     return;
    // }
    // await kv.set(["instances", currentInstance], {
    //     meta: (await kv.get(["meta"])).value,
    //     data: (await kv.get(["leaderboards"])).value,
    // });
    // await kv.atomic()
    //     .set(["instanceName"], newInstance)
    //     .set(["leaderboards"], newLb.data)
    //     .set(["meta"], newLb.meta)
    //     .commit();
    
    await kv.set(["instanceName"], newInstance);

    broadcast("!reload-all");
    // getAdminSocket()?.send(`@meta:${JSON.stringify(await getMeta())}`);
}

async function adminSendInstancesData() {
    getAdminSocket()
        ?.send(`ADMIN:INSTANCES:${JSON.stringify({
            instances: await getAllInstanceNames(),
            current: await getActiveName(),
        })}`);
}

function adminSendClientsData() {
    const data = [];
    for (const id of clients.keys()) {
        data.push({
            id: id,
            ...clients.get(id),
        });
    }
    getAdminSocket()
        ?.send(`ADMIN:CLIENTS:${JSON.stringify(data)}`);
}

async function getAccessData() {
    const entries = kv.list({ prefix: ["tokens"] });
    const result: any = {};
    for await (const entry of entries) {
        const token = entry.key[1];
        if (typeof token !== "string") continue;
        const expireIn = entry.value;
        result[token] = expireIn;
    }
    return result;
}

// async function adminSendAccessData() {
//     const entries = await kv.list({ prefix: ["tokens"] });
//     const result: any = {};
//     for await (const entry of entries) {
//         const token = entry.key[1];
//         if (typeof token !== "string") continue;
//         const expireIn = entry.value;
//         result[token] = expireIn;
//     }
//     getAdminSocket()
//         ?.send(`ADMIN:ACCESS:${JSON.stringify(result)}`);
// }

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

    clients.set(clientId, {
        socket: socket,
        connectTimestamp: Date.now(),
        role: "Pre-Auth",
        auth: { type: "none" },
        userAgent: req.headers.get("user-agent"),
    });

    socket.addEventListener("open", async () => {
        socket.send(`@meta:${JSON.stringify(await getMeta())}`);
        socket.send(JSON.stringify(await getData()));
        broadcast(`@nclients:${clients.size}`);
        if (config.inputAccess == "everyone") {
            socket.send("AUTH:success");
        } else {
            socket.send("AUTH:required");
        }
        adminSendClientsData();
        adminSendInstancesData();
    });

    socket.addEventListener("message", async (event) => {
        if (!clients.has(clientId)) return;
        // console.log(`received from ${clientId}`)
        // console.log(event.data);

        // for easy local development
        const fastpass = event.data == "ADMIN:TEST" && Deno.env.get("TEST") !== undefined;
        
        if (event.data == "ADMIN:TEST" && !fastpass) {
            return;
        }

        if (event.data == `ADMIN:${Deno.env.get("ADMIN")}` || fastpass) {
            if (adminId !== null && clients.has(adminId) && clientId != adminId) {
                const oldAdmin = clients.get(adminId);
                oldAdmin?.socket.send("ADMIN:OVERRIDDEN");
            }
            adminId = clientId;
            clients.get(adminId)!.role = "Admin";
            clients.get(adminId)!.auth = { type: "admin" };
            socket.send("ADMIN:OK");
            adminSendServerConfig();
            adminSendClientsData();
            await adminSendInstancesData();
            return;
        }
        
        if (clientId == adminId && event.data.startsWith("ADMIN:")) {
            // admin scope
            const data = event.data.slice(6);
            if (data.startsWith("clients-disconnect:")) {
                const id = data.slice("clients-disconnect:".length);
                clients.get(id)?.socket.close();
            } else if (data.startsWith("clients-allow-input:")) {
                const id = data.slice("clients-allow-input:".length);
                const c = clients.get(id);
                if (!c) return;
                if (c.auth.type == "admin") return;
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
                    clients.get(clientId)!.auth = { type: "token", token: token, expireIn: tokExpireIn };
                    adminSendClientsData();
                } else {
                    socket.send("AUTH:failure");
                }
            }
            return;
        }

        if (event.data.startsWith("REPORT-ROLE:")) {
            const role = event.data.slice("REPORT-ROLE:".length);
            clients.get(clientId)!.role = role;
            adminSendClientsData();
            return;
        }
        
        const clientAuth = clients.get(clientId)!.auth;

        if (clientAuth.type == "token" && clientAuth.expireIn < Date.now()) {
            clients.get(clientId)!.auth = { type: "none" };
        }

        if (
            (config.inputAccess == "restricted" && clients.get(clientId)?.auth.type == "none")
            || (config.inputAccess == "none" && clients.get(clientId)!.auth.type != "admin")
        ) {
            // unauthenticated client intends to send input
            socket.send("AUTH:failure");
            return;
        }

        // at this point, client is checked to have input permissions
        
        if (event.data.startsWith("@timeLimit:")) {
            const parts = event.data.split(":");
            if (parts.length != 3) return;

            const id = parts[1];

            const newTimeLimit = parseInt(parts[2]);
            if (isNaN(newTimeLimit)) return;

            const timeLimits = await getTimeLimits();
            timeLimits[id] = newTimeLimit;

            await editMeta(meta => {
                meta.timeLimits = timeLimits;
            })
            
            return;
        }
        
        if (event.data.startsWith("@theme:")) {
            return; // disabled for now
            const newTheme = event.data.slice("@theme:".length);
            const meta = await getMeta();
            meta.theme = newTheme;
            await kv.set(["meta"], meta);
            broadcast(`@meta:${JSON.stringify(meta)}`);
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

            if ("highlight" in obj && obj.highlight !== null && "id" in obj.highlight && "name" in obj.highlight) {
                broadcast(`!highlight-${JSON.stringify(obj.highlight)}`);
            }
        }
    });

    socket.addEventListener("close", () => {
        clients.delete(clientId);
        broadcast(`@nclients:${clients.size}`);
        if (clientId === adminId) adminId = null;
        adminSendClientsData();
    })
  return response;
}

// HTTPS

function validateLeaderboardData(data: object): string | null {
    if (!Array.isArray(data)) {
        return "Data must be an array of leaderboards.";
    }
    if (data.length !== 2) {
        return "Data must contain exactly 2 leaderboards.";
    }
    for (let i = 0; i < data.length; i++) {
        const lb = data[i];
        if (!Array.isArray(lb)) {
            return `Leaderboard at index ${i} is not an array.`;
        }
        for (let j = 0; j < lb.length; j++) {
            const record = lb[j];
            if (typeof record !== "object" || record === null) {
                return `Invalid record at leaderboard ${i} index ${j}.`;
            }
            if (typeof (record as any).name !== "string") {
                return `Invalid name at leaderboard ${i} index ${j}.`;
            }
            if (typeof (record as any).score !== "number" || !Number.isFinite((record as any).score)) {
                return `Invalid score at leaderboard ${i} index ${j}.`;
            }
        }
    }
    return null;
}

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
    const method = req.method;
    
    if (path == "/api/data" && method == "GET") {
        const url = new URL(req.url);
        const name = url.searchParams.get("name");
        if (name) {
            const data = (await kv.get(["instances", name, "data"])).value;
            if (data === null) {
                return bad("Instance does not exist.");
            }
            return new Response(JSON.stringify(data), { status: 200 });
        }
        return new Response(JSON.stringify(await getData()), { status: 200 });
    }

    // admin territory below

    const resp = httpsAuthAdmin(req);
    if (resp !== null) {
        return resp;
    }
    const body = method == "GET" ? {} : await req.json();

    if (path == "/api/data" && method == "POST") {
        const issue = validateLeaderboardData(body);
        if (issue !== null) {
            return bad(issue);
        }
        // sort each leaderboard by score ascending
        (body as any[]).forEach((l) => l.sort((a: any, b: any) => a.score - b.score));
        await broadcastAndSaveData(body);
    } else if (path.startsWith("/api/instance")) {
        // grouped since admin has to be notified

        if (path == "/api/instance/create" && method == "POST") {
            if ("name" in body && typeof body.name == "string") {
                if (body.name.length == 0) {
                    return bad("String is empty.");
                }
                if (await instanceExists(body.name)) {
                    return bad("Name is already in use.");
                }
                await createInstance(body.name);
            }
        } else if (path == "/api/instance/switch" && method == "POST") {
            if ("name" in body && typeof body.name == "string") {
                await switchInstance(body.name);
            }
        } else if (path == "/api/instance/delete" && (method == "POST" || method == "DELETE")) {
            if ("name" in body && typeof body.name == "string") {
                if (body.name == await getActiveName()) {
                    return bad("Active instance cannot be deleted.");
                }
                if (!await instanceExists(body.name)) {
                    return bad("Instance does not exist.");
                }

                // TODO: atomicity
                await kv.delete(["instances", name, "meta"]);
                await kv.delete(["instances", name, "data"]);
            }
        } else if (path == "/api/instance/clone" && method == "POST") {
            if ("from" in body && typeof body.from == "string" && "to" in body && typeof body.to == "string") {
                const from = body.from;
                const to = body.to;
                if (from.length == 0) {
                    return bad("Name (from) is empty.");
                }
                if (to.length == 0) {
                    return bad("Name (to) is empty.");
                }
                if (!await instanceExists(from)) {
                    return bad("Source instance does not exist.");
                }
                if (await instanceExists(to)) {
                    return bad("Target name is already in use.");
                }

                // TODO: apply checks and atomicity

                await kv.set(["instances", to, "meta"], (await kv.get(["instances", from, "meta"])).value);
                await kv.set(["instances", to, "data"], (await kv.get(["instances", from, "data"])).value);
            }
        } else if (path == "/api/instance/import" && method == "POST") {
            if ("data" in body) {
                await setData(body.data);
                broadcast("!reload-all");
            }
        }
        await adminSendInstancesData();
    
    } else if (path == "/api/config/update" && method == "POST") {
        for (const fieldName in config) {
            if (fieldName in body) {
                // @ts-ignore :)
                config[fieldName] = body[fieldName];
            }
        }
        await kv.set(["config"], config);
        adminSendServerConfig();
    } else if (path == "/api/token/create" && method == "POST") {
        const { token, expireIn } = body;
        if (typeof token !== "string") return bad("Invalid token name.");
        if (typeof expireIn !== "number") return bad("Invalid expiry.");
        if (token.length < 4) return bad("Tokens must be at least 4 characters long.");
        adminCreateToken(token, expireIn);
    } else if (path == "/api/token/modify" && method == "POST") {
        const { token, expireIn } = body;
        if (typeof token !== "string") {
            return bad("Invalid token name.");
        }
        if (typeof expireIn !== "number") {
            return bad("Invalid expiry.");
        }
        if ((await kv.get(["tokens", token])).value === null) {
            return bad("Token does not exist.");
        }
        await kv.delete(["tokens", token]);
        adminCreateToken(token, expireIn);
    } else if (path == "/api/token/delete" && (method == "POST" || method == "DELETE")) {
        const { token } = body;
        if (typeof token !== "string") {
            return bad("Invalid token name.");
        }
        if ((await kv.get(["tokens", token])).value === null) {
            return bad("Token does not exist.");
        }
        await kv.delete(["tokens", token]);
    } else if (path == "/api/token" && method == "GET") {
        return new Response(JSON.stringify(await getAccessData()), { status: 200 });
    } else {
        return bad("Unknown method");
    }
    return ok();
}

const minjs = Deno.env.get("NO_MIN") === undefined;

const routes: Record<string, string> = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/sync": "/sync.html",
    "/output": "/output.html",
    "/disconnected": "/disconnected.html", // unused
    "/admin2": "/admin2.html",
};

Deno.serve(async (req) => {
    let path = (new URL(req.url)).pathname;
    // console.log("request to path:", path);

    if (path.startsWith("/api")) {
        return await handleApi(path, req);
    }

    if (path === "/ws") {
        if (req.headers.get("upgrade") == "websocket") {
            return connectSocket(req);
        }
    } else if (path in routes) {
        path = routes[path];
    } else if (path === "/ping") {
        return ok();
    } else if (path === "/assets/bg") { // dynamic assets (disabled for now)
        path = "/assets/ds1.jpg";
        // const theme = (await getMeta()).theme;
        // if (theme === "gojo") {
        //     path = "/assets/bg1.jpg";
        // } else if (theme === "demonslayer") {
        //     path = "/assets/ds1.jpg"
        // }
    } else if (path === "/css-output") { // dynamic assets (disabled for now)
        path = "/css-output/demonslayer.css";
        // const theme = (await getMeta()).theme;
        // path = `/css-output/${theme}.css`;
    }

    if (minjs && path.startsWith("/js/")) {
        path = path.replace("/js/", "/js-min/").replace(".js", ".min.js");
    }

    try {
        const filePath = Deno.cwd() + "/public" + path;
        const fileInfo = await Deno.stat(filePath);
        if (fileInfo.isDirectory) {
            return new Response("Not Found", { status: 404 });
        }
        const file = await Deno.open(filePath);
        return new Response(file.readable);
    } catch {
        // console.error(`Error serving file ${path}:`, e);
        return new Response("Not Found", { status: 404 });
    }
});
