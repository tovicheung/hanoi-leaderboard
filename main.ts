import { Hono, Context, Next } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import { cache } from "@hono/hono/cache";

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

interface TimeLimits {
    leaderboard1: number,
    leaderboard2: number,
}

interface InstanceMeta {
    timeLimits: TimeLimits,
    theme: string,
}

const DEFAULT_CONFIG: Config = {
    inputAccess: "restricted",
    outputAccess: "everyone", // unused
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

async function setupKv() {
    let config = (await kv.get(["config"])).value;
    if (config === null) {
        config = structuredClone(DEFAULT_CONFIG);
        await kv.set(["config"], config);
    }

    if ((await getAllInstanceNames()).length == 0) {
        await createInstance("_default");
    }
    
    if ((await kv.get(["instanceName"])).value === null) {
        await kv.set(["instanceName"], "_default");
    }
}

await setupKv();

function getNewMeta() {
    return {
        timeLimits: {
            "leaderboard1": 3 * 60 * 1000,
            "leaderboard2": 4 * 60 * 1000,
        },
        theme: "demonslayer",
    };
}

// INSTANCE HELPERS

async function createInstance(name: string) {
    if (await instanceExists(name)) return;

    await kv.atomic()
        .set(["instances", name, "data"], [[], []])
        .set(["instances", name, "meta"], getNewMeta())
        .commit();
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

async function instanceExists(name: string) {
    const test = await kv.get(["instances", name, "meta"]);
    return test.value !== null;
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

async function getTimeLimits(): Promise<TimeLimits> {
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

// SOCKET HELPERS

function broadcast(msg: string) {
    clients.forEach(c => {
        if (c.socket.readyState == c.socket.CLOSED) return;
        c.socket.send(msg);
    });
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

async function adminSendInstancesData() {
    getAdminSocket()
        ?.send(`ADMIN:INSTANCES:${JSON.stringify({
            instances: await getAllInstanceNames(),
            current: await getActiveName(),
        })}`);
}

function adminSendClientsData() {
    const data = [];
    for (const [id, client] of clients.entries()) {
        data.push({
            id,
            connectTimestamp: client.connectTimestamp,
            role: client.role,
            auth: client.auth,
            userAgent: client.userAgent,
        });
    }
    getAdminSocket()
        ?.send(`ADMIN:CLIENTS:${JSON.stringify(data)}`);
}

type TokensData = Record<string, number>;

async function getTokensData(): Promise<TokensData> {
    const entries = kv.list({ prefix: ["tokens"] });
    const result: TokensData = {};
    for await (const entry of entries) {
        const token = entry.key[1];
        if (typeof token !== "string") continue;
        const expireIn = <number>entry.value;
        result[token] = expireIn;
    }
    return result;
}

function adminCreateToken(token: string, expireIn: number) {
    const timedelta = expireIn - Date.now();
    kv.set(["tokens", token], expireIn, { expireIn: timedelta });
}

async function authCheckToken(token: string): Promise<number | false> {
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

        // for easier local development
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

            // extremely ugly code but whatever
            const id = <"leaderboard1" | "leaderboard2">parts[1];

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

function bad(c: Context, msg: string | null = null) {
    if (msg === null) {
        return c.text("Invalid API call", 400);
    }
    return c.text(`Invalid API call: ${msg}`, 400);
}

function ok(c: Context) {
    return c.text("Done", 200);
}

const app = new Hono();

// auth middleware
const adminAuth = async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.body("Unauthorized: Missing or invalid Authorization header.", 401);
    }

    const token = authHeader.split(" ")[1];

    if (token !== Deno.env.get("ADMIN")) {
        return c.body("Unauthorized: Invalid token.", 401);
    }

    await next(); // auth ok
};

app.get("/api/data", async (c) => {
    const name = c.req.query("name");
    if (name) {
        const data = (await kv.get(["instances", name, "data"])).value;
        if (data === null) {
            return bad(c, "Instance does not exist.");
        }
        return c.json(data);
    }
    return c.json(await getData());
});

app.post("/api/data", adminAuth, async (c) => {
    const body = await c.req.json();
    const issue = validateLeaderboardData(body);
    if (issue !== null) {
        return bad(c, issue);
    }
    (body as LbRecord[][]).forEach((l) => l.sort((a, b) => a.score - b.score));
    await broadcastAndSaveData(body);
    return ok(c);
});

app.post("/api/instance/create", adminAuth, async (c) => {
    const body = await c.req.json();
    if ("name" in body && typeof body.name == "string") {
        if (body.name.length == 0) {
            return bad(c, "String is empty.");
        }
        if (await instanceExists(body.name)) {
            return bad(c, "Name is already in use.");
        }
        await createInstance(body.name);
        await adminSendInstancesData();
        return ok(c);
    }
    return bad(c, "Invalid request body.");
});

app.post("/api/instance/switch", adminAuth, async (c) => {
    const body = await c.req.json();
    if ("name" in body && typeof body.name == "string") {
        await switchInstance(body.name);
        await adminSendInstancesData();
        return ok(c);
    }
    return bad(c, "Invalid request body.");
});

app.delete("/api/instance/delete", adminAuth, async (c) => {
    const body = await c.req.json();
    if ("name" in body && typeof body.name == "string") {
        if (body.name == await getActiveName()) {
            return bad(c, "Active instance cannot be deleted.");
        }
        if (!await instanceExists(body.name)) {
            return bad(c, "Instance does not exist.");
        }
        await kv.delete(["instances", body.name, "meta"]);
        await kv.delete(["instances", body.name, "data"]);
        await adminSendInstancesData();
        return ok(c);
    }
    return bad(c, "Invalid request body.");
});

app.post("/api/instance/clone", adminAuth, async (c) => {
    const body = await c.req.json();
    if ("from" in body && typeof body.from == "string" && "to" in body && typeof body.to == "string") {
        const from = body.from;
        const to = body.to;
        if (from.length == 0) {
            return bad(c, "Name (from) is empty.");
        }
        if (to.length == 0) {
            return bad(c, "Name (to) is empty.");
        }
        if (!await instanceExists(from)) {
            return bad(c, "Source instance does not exist.");
        }
        if (await instanceExists(to)) {
            return bad(c, "Target name is already in use.");
        }
        await kv.set(["instances", to, "meta"], (await kv.get(["instances", from, "meta"])).value);
        await kv.set(["instances", to, "data"], (await kv.get(["instances", from, "data"])).value);
        await adminSendInstancesData();
        return ok(c);
    }
    return bad(c, "Invalid request body.");
});

app.post("/api/instance/import", adminAuth, async (c) => {
    const body = await c.req.json();
    if ("data" in body) {
        await setData(body.data);
        broadcast("!reload-all");
        await adminSendInstancesData();
        return ok(c);
    }
    return bad(c, "Invalid request body.");
});

app.post("/api/config/update", adminAuth, async (c) => {
    const body = await c.req.json();
    for (const fieldName in config) {
        if (fieldName in body) {
            // @ts-ignore
            config[fieldName] = body[fieldName];
        }
    }
    await kv.set(["config"], config);
    adminSendServerConfig();
    return ok(c);
});

app.post("/api/token/create", adminAuth, async (c) => {
    const { token, expireIn } = await c.req.json();
    if (typeof token !== "string") {
        return bad(c, "Invalid token name.");
    }
    if (typeof expireIn !== "number") {
        return bad(c, "Invalid expiry.");
    }
    if (token.length < 4) {
        return bad(c, "Tokens must be at least 4 characters long.");
    }
    adminCreateToken(token, expireIn);
    return ok(c);
});

app.post("/api/token/modify", adminAuth, async (c) => {
    const { token, expireIn } = await c.req.json();
    if (typeof token !== "string") {
        return bad(c, "Invalid token name.");
    }
    if (typeof expireIn !== "number") {
        return bad(c, "Invalid expiry.");
    }
    if ((await kv.get(["tokens", token])).value === null) {
        return bad(c, "Token does not exist.");
    }
    await kv.delete(["tokens", token]);
    adminCreateToken(token, expireIn);
    return ok(c);
});

app.delete("/api/token/delete", adminAuth, async (c) => {
    const { token } = await c.req.json();
    if (typeof token !== "string") {
        return bad(c, "Invalid token name.");
    }
    if ((await kv.get(["tokens", token])).value === null) {
        return bad(c, "Token does not exist.");
    }
    await kv.delete(["tokens", token]);
    return ok(c);
});

app.get("/api/token", adminAuth, async (c) => {
    return c.json(await getTokensData());
});

app.get("/ping", (c) => {
    return ok(c);
});

app.get("/assets/bg", async (c) => {
    const filePath = Deno.cwd() + "/public/assets/ds1.jpg"; // temp hard code
    try {
        const file = await Deno.open(filePath);
        return c.body(file.readable);
    } catch {
        return c.notFound();
    }
});

app.get("/css-output", async (c) => {
    const filePath = Deno.cwd() + "/public/css-output/demonslayer.css"; // temp hard code
    try {
        const file = await Deno.open(filePath);
        return c.body(file.readable, 200, { 'Content-Type': 'text/css' });
    } catch {
        return c.notFound();
    }
});

app.get("/ws", (c: Context) => {
    return connectSocket(c.req.raw); // raw request object
});

const MIN_JS = Deno.env.get("NO_MIN") === undefined;

const routes: Record<string, string> = {
    "/": "/index.html",
    "/admin": "/admin.html",
    "/sync": "/sync.html",
    "/output": "/output.html",
    "/disconnected": "/disconnected.html", // unused
    "/admin2": "/admin2.html",
};

app.use(
    serveStatic({
        root: "./public",
        rewriteRequestPath: (path) => {
            if (path in routes) {
                path = routes[path];
            }
            if (MIN_JS && path.startsWith("/js/") && path.endsWith(".js")) {
                path = path.replace("/js/", "/js-min/").replace(".js", ".min.js");
            }
            return path;
        },
        onFound: (path, ctx) => {
            if (path.includes("assets") && path.includes("static")) {
                ctx.header("Cache-Control", "public, max-age=86400");
            }
        },
    })
);

app.notFound((c) => {
    return c.text("Not Found", 404);
});

Deno.serve(app.fetch);
