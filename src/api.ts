import { Hono, Context, Next } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import { HanoiData } from "./types.ts";
import { config, updateConfig, getData, instanceExists, createInstance, switchInstance, getActiveName, kv, adminCreateToken, getTokensData } from "./db.ts";
import { broadcastAndSaveData, adminSendInstancesData, adminSendServerConfig, connectSocket } from "./socket.ts";

function validateHanoiData(data: any): string | null {
    if (!("lb4" in data)) {
        return "Missing 'lb4'";
    }

    if (!("lb5" in data)) {
        return "Missing 'lb5'";
    }

    for (const id of ["lb4", "lb5"]) {
        const lb = data[id];
        if (!Array.isArray(lb)) {
            return `Leaderboard '${id}' is not an array.`;
        }
        for (let j = 0; j < lb.length; j++) {
            const record = lb[j];
            if (typeof record !== "object" || record === null) {
                return `Invalid record at leaderboard '${id}' index ${j}.`;
            }
            if (typeof (record as any).name !== "string") {
                return `Invalid name at leaderboard '${id}' index ${j}.`;
            }
            if (typeof (record as any).score !== "number" || !Number.isFinite((record as any).score)) {
                return `Invalid score at leaderboard '${id}' index ${j}.`;
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

export const app = new Hono();

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
    const issue = validateHanoiData(body);
    if (issue !== null) {
        return bad(c, issue);
    }
    Object.values(body as HanoiData).forEach((l) => l.sort((a, b) => a.score - b.score));
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
        const result = await kv.atomic()
            .set(["instances", to, "meta"], (await kv.get(["instances", from, "meta"])).value)
            .set(["instances", to, "data"], (await kv.get(["instances", from, "data"])).value)
            .commit();
        await adminSendInstancesData();
        if (result.ok) {
            return ok(c);
        } else {
            return bad(c, "KV write failed.");
        }
    }
    return bad(c, "Invalid request body.");
});

app.post("/api/config/update", adminAuth, async (c) => {
    const body = await c.req.json();
    const newConfig = { ...config };
    for (const fieldName in config) {
        if (fieldName in body) {
            // @ts-ignore
            newConfig[fieldName] = body[fieldName];
        }
    }
    await updateConfig(newConfig);
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
    "/input": "/index.html",
    "/output": "/output.html",
    "/admin": "/admin.html",
    "/sync": "/sync.html",
    "/disconnected": "/disconnected.html", // unused
    "/admin/legacy": "/admin_legacy.html",
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
