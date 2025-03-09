const clients = new Map();

function broadcast(msg) {
    clients.forEach(websocket => {
        if (websocket.isClosed) return;
        websocket.send(msg);
    });
}

async function getScores() {
    const kv = await Deno.openKv();
    const scores = await kv.get(["scores"]);
    if (scores === null) return [];
    return scores.value
}

async function broadcastScores(scores) {
    const kv = await Deno.openKv();
    broadcast(JSON.stringify(scores));
    kv.set(["scores"], scores);
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
        socket.send(JSON.stringify(await getScores()));
        broadcast(`@nclients:${clients.size}`)
    });

    socket.addEventListener("message", async (event) => {
        console.log(`received from ${clientId}`)
        var scores = await getScores();
        if (scores === null) scores = [];
        if (event.data == "refresh-all") {
            scores.sort((a, b) => a.score - b.score);
            await broadcastScores(scores);
            return;
        }
        if (event.data == "refresh") {
            socket.send(JSON.stringify(scores));
            return;
        }
        if (event.data == "clear") {
            scores = [];
            await broadcastScores(scores);
            return;
        }
        const obj = JSON.parse(event.data);
        if (obj.type === "update") { // new api
            scores = obj.leaderboard;
            scores.sort((a, b) => a.score - b.score);
            await broadcastScores(scores);
        }
    });

    socket.addEventListener("close", () => {
        console.log(`client ${clientId} disconnected!`);
        clients.delete(clientId);
        broadcast(`@nclients:${clients.size}`)
    })
  return response;
});
