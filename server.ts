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
        serverStatus: "unknown",
    };
    if (await serverIsLocked()) {
        info.serverStatus = "locked";
    } else {
        info.serverStatus = "open";
    }
    socket.send(`ADMIN:${JSON.stringify(info)}`);
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
            console.log(serverIsLocked());
            socket.send("!locked");
            console.log(`locked ${clientId}`);
        }
    });

    socket.addEventListener("message", async (event) => {
        console.log(`received from ${clientId}`)
        console.log(event.data);
        if (event.data == `ADMIN:Deno.env.get("ADMIN")`) {
            adminId = clientId;
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
