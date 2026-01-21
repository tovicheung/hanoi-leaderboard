import { Client, HanoiData, InstanceMeta } from "./types.ts";
import { config, authCheckToken, getData, setData, getMeta, setMeta, getTimeLimits } from "./db.ts";

const channel = new BroadcastChannel("broadcasts");

channel.onmessage = (event: MessageEvent) => {
    broadcast(event.data, false);
};

export const clients = new Map<string, Client>();
export let adminId: string | null = null;

export function broadcast(msg: string, global: boolean = true) {
    clients.forEach(c => {
        if (c.socket.readyState == c.socket.CLOSED) return;
        c.socket.send(msg);
    });
    if (global) channel.postMessage(msg);
}

export async function broadcastAndSaveData(leaderboards: HanoiData) {
    if (config.outputAccess === "everyone") {
        broadcast(`DATA:${JSON.stringify(leaderboards)}`);
    }
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

export function adminSendClientsData() {
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

async function editMeta(callback: (meta: InstanceMeta) => void | Promise<void>) {
    const meta = await getMeta();
    await callback(meta);
    await setMeta(meta);
    broadcast(`@meta:${JSON.stringify(meta)}`);
}

export function connectSocket(req: Request) {
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
        // broadcast(`@nclients:${clients.size}`);
        if (config.inputAccess === "everyone") {
            socket.send("AUTH:success");
        } else if (config.inputAccess === "restricted") {
            socket.send("AUTH:required");
        } else {
            socket.send("AUTH:no-input");
        }
        if (config.outputAccess === "everyone") {
            socket.send(`@meta:${JSON.stringify(await getMeta())}`);
            socket.send(`DATA:${JSON.stringify(await getData())}`);
        } else {
            socket.send("AUTH:no-output");
        }
        adminSendClientsData();
    });

    socket.addEventListener("message", async (event) => {
        if (!clients.has(clientId)) return;

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
            adminSendClientsData();
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

                if (config.outputAccess !== "everyone") {
                    // only re-send data if not sent already
                    socket.send(`@meta:${JSON.stringify(await getMeta())}`);
                    socket.send(`DATA:${JSON.stringify(await getData())}`);
                }
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
                    socket.send(`@meta:${JSON.stringify(await getMeta())}`);
                    socket.send(`DATA:${JSON.stringify(await getData())}`);
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

        if (event.data.startsWith("UPDATE:")) {
            const obj = JSON.parse(event.data.slice("UPDATE:".length));
            if ("leaderboards" in obj) {
                const leaderboards: HanoiData = obj.leaderboards;
                Object.values(leaderboards).forEach(l => l.sort((a, b) => a.score - b.score));
                await broadcastAndSaveData(leaderboards);

                if ("highlight" in obj && obj.highlight !== null && "id" in obj.highlight && "name" in obj.highlight) {
                    broadcast(`!highlight-${JSON.stringify(obj.highlight)}`);
                }
            }
        }

        if (event.data.startsWith("@timeLimit:")) {
            const parts = event.data.split(":");
            if (parts.length != 3) return;

            // extremely ugly code but whatever
            const id = <"lb4" | "lb5">parts[1];

            const newTimeLimit = parseInt(parts[2]);
            if (isNaN(newTimeLimit)) return;

            const timeLimits = await getTimeLimits();
            timeLimits[id] = newTimeLimit;

            await editMeta(meta => {
                meta.timeLimits = timeLimits;
            });

            return;
        }

        if (event.data.startsWith("@theme:")) {
            return; // disabled for now
        }

        if (event.data.startsWith("!")) {
            broadcast(event.data);
            return;
        }

        const leaderboards = await getData();
        if (event.data == "refresh-all") {
            Object.values(leaderboards).forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastAndSaveData(leaderboards);
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(leaderboards));
            return;
        }
    });

    socket.addEventListener("close", () => {
        clients.delete(clientId);
        // broadcast(`@nclients:${clients.size}`);
        if (clientId === adminId) adminId = null;
        adminSendClientsData();
    })
    return response;
}
