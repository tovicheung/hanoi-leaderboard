const clients = new Map();
var adminId = null;

function broadcast(msg) {
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(msg);
    });
}

async function serverIsLocked() {
    const kv = await Deno.openKv();
    const locked = await kv.get(["locked"]);
    if (locked.value === null) {
        await kv.set(["locked"], false);
        return false;
    }
    return locked.value;
}

async function getData() {
    const kv = await Deno.openKv();
    const leaderboards = await kv.get(["leaderboards"]);
    if (leaderboards.value === null) return [[], []];
    return leaderboards.value
}

async function broadcastData(leaderboards) {
    const kv = await Deno.openKv();
    broadcast(JSON.stringify(leaderboards));
    await kv.set(["leaderboards"], leaderboards);
}

async function adminUpdate() {
    const socket = clients.get(adminId);
    const info = {
        connectionId: adminId,
        serverStatus: "unknown",
    };
    if (await serverIsLocked()) {
        info.serverStatus = "locked";
    } else {
        info.serverStatus = "open";
    }
    socket.send(`ADMIN:${JSON.stringify(info)}`);
}

async function getInstances(kv) {
    const entries = kv.list({ prefix: ["instances"] });
    const names = [];
    for await (const entry of entries) {
        names.push(entry.key[1]);
    }
    return names;
}

async function switchInstance(kv, newInstance) {
    const newData = (await kv.get(["instances", newInstance])).value;
    if (newData === null) return;

    const currentInstance = (await kv.get(["instanceName"])).value;
    await kv.set(["instances", currentInstance], (await kv.get(["leaderboards"])).value);
    await kv.atomic()
        .set(["instanceName"], newInstance)
        .set(["leaderboards"], newData)
        .commit();

    broadcast("!reload-all");
}

async function sendInstanceData(socket) {
    const kv = await Deno.openKv();
    socket.send(`ADMIN:INSTANCES:${JSON.stringify({
        "instances": await getInstances(kv),
        "current": (await kv.get(["instanceName"])).value,
    })}`);
}

async function adminDone() {
    if (adminId == null) return;
    const socket = clients.get(adminId);
    socket.send("ADMIN:DONE");
    sendInstanceData(socket);
}

Deno.serve(async (req) => {
    if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const clientId = crypto.randomUUID();
    clients.set(clientId, socket);

    // Send current scores to newly connected client
    socket.addEventListener("open", async () => {
        console.log(`client ${clientId} connected!`);
        socket.send(JSON.stringify(await getData()));
        broadcast(`@nclients:${clients.size}`)
        if (await serverIsLocked()) {
            socket.send("!locked");
            console.log(`locked ${clientId}`);
        }
    });

    socket.addEventListener("message", async (event) => {
        console.log(`received from ${clientId}`)
        console.log(event.data);
        if (event.data == `ADMIN:${Deno.env.get("ADMIN")}`) {
            if (adminId !== null && clients.has(adminId)) {
                const oldClient = clients.get(adminId);
                oldClient.send("ADMIN:OVERRIDDEN");
            }
            adminId = clientId;
            sendInstanceData(socket);
        } else if (clientId == adminId && event.data.startsWith("ADMIN:")) {
            // admin scope
            const data = event.data.slice(6);
            const kv = await Deno.openKv();
            if (data == "lock") {
                await kv.set(["locked"], true);
            } else if (data == "unlock") {
                await kv.set(["locked"], false);
            } else if (data.startsWith("inst-create:")) {
                const name = data.slice("inst-create:".length);
                if (name.length != 0 && (await kv.get(["instances", name])).value == null) {
                    await kv.set(["instances", name], [[], []]);
                };
                await adminDone();
            } else if (data.startsWith("inst-switch:")) {
                const newName = data.slice("inst-switch:".length);
                if (newName.length != 0) {
                    await switchInstance(kv, newName);
                }
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
            }
        }
        if (adminId != clientId && await serverIsLocked()) {
            socket.send("!locked");
            console.log(`locked ${clientId}`);
            return;
        }
        if (adminId == clientId) {
            await adminUpdate();
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
        var obj;
        try {
            obj = JSON.parse(event.data);
        } catch {
            return;
        }
        if ("type" in obj && obj.type === "update") { // new api
            leaderboards = obj.leaderboards;
            leaderboards.forEach(l => l.sort((a, b) => a.score - b.score));
            await broadcastData(leaderboards);
        }
    });

    socket.addEventListener("close", () => {
        console.log(`client ${clientId} disconnected!`);
        clients.delete(clientId);
        broadcast(`@nclients:${clients.size}`)
    })
  return response;
});
