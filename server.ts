import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

interface ClientMeta {
  ws: WebSocket;
  room: string;
  role: 'sender' | 'receiver';
  id: string;
  deviceName?: string;
}

const app = express();
const httpServer = http.createServer(app);
const PORT = 3000;

app.use(express.json());

// In-memory room manager
const rooms = new Map<string, Set<ClientMeta>>();
const clientToMeta = new WeakMap<WebSocket, ClientMeta>();

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId.trim();
  const roomClients = rooms.get(roomId);
  if (!roomClients) {
    return res.json({ exists: false, senderConnected: false, receiverCount: 0 });
  }

  let senderConnected = false;
  let receiverCount = 0;
  for (const client of roomClients) {
    if (client.role === 'sender') senderConnected = true;
    if (client.role === 'receiver') receiverCount++;
  }

  return res.json({ exists: true, senderConnected, receiverCount });
});

// WebSocket Server attached to same HTTP server
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (rawMessage: string | Buffer) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      const { type, room: roomId, role, target, ...rest } = data;

      if (type === 'ping') {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
        return;
      }

      if (type === 'join') {
        const cleanRoom = String(roomId || '').trim().toLowerCase();
        if (!cleanRoom) {
          ws.send(JSON.stringify({ type: 'error', message: 'ID de sala inválido' }));
          return;
        }

        const clientId = `peer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const meta: ClientMeta = {
          ws,
          room: cleanRoom,
          role: role === 'receiver' ? 'receiver' : 'sender',
          id: clientId,
          deviceName: rest.deviceName || (role === 'receiver' ? 'OBS Studio' : 'Micrófono'),
        };

        clientToMeta.set(ws, meta);

        if (!rooms.has(cleanRoom)) {
          rooms.set(cleanRoom, new Set());
        }
        const roomSet = rooms.get(cleanRoom)!;
        roomSet.add(meta);

        // Acknowledge joining
        ws.send(
          JSON.stringify({
            type: 'joined',
            clientId,
            room: cleanRoom,
            role: meta.role,
          })
        );

        // Notify other peers in this room
        for (const other of roomSet) {
          if (other.ws !== ws && other.ws.readyState === WebSocket.OPEN) {
            other.ws.send(
              JSON.stringify({
                type: 'peer-joined',
                peerId: clientId,
                role: meta.role,
                deviceName: meta.deviceName,
              })
            );

            // If a sender joins and there is already a receiver, or vice-versa, alert both
            if (meta.role === 'receiver' && other.role === 'sender') {
              ws.send(
                JSON.stringify({
                  type: 'peer-joined',
                  peerId: other.id,
                  role: other.role,
                  deviceName: other.deviceName,
                })
              );
            }
          }
        }
        return;
      }

      const senderMeta = clientToMeta.get(ws);
      if (!senderMeta) return;

      const currentRoom = rooms.get(senderMeta.room);
      if (!currentRoom) return;

      // Targeted message (offer, answer, ice-candidate)
      if (target) {
        for (const peer of currentRoom) {
          if (peer.id === target && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(
              JSON.stringify({
                type,
                from: senderMeta.id,
                ...rest,
              })
            );
            break;
          }
        }
        return;
      }

      // Broadcast to all other peers in the room (e.g. mute status, volume meter)
      for (const peer of currentRoom) {
        if (peer.ws !== ws && peer.ws.readyState === WebSocket.OPEN) {
          peer.ws.send(
            JSON.stringify({
              type,
              from: senderMeta.id,
              ...rest,
            })
          );
        }
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    const meta = clientToMeta.get(ws);
    if (!meta) return;

    const roomSet = rooms.get(meta.room);
    if (roomSet) {
      roomSet.delete(meta);
      // Notify remaining peers
      for (const other of roomSet) {
        if (other.ws.readyState === WebSocket.OPEN) {
          other.ws.send(
            JSON.stringify({
              type: 'peer-left',
              peerId: meta.id,
              role: meta.role,
            })
          );
        }
      }
      if (roomSet.size === 0) {
        rooms.delete(meta.room);
      }
    }
  });
});

// Vite middleware for dev or Static files for production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`OBS Audio Streamer running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
