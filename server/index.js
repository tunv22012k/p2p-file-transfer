/* eslint-disable @typescript-eslint/no-require-imports */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // In production, restrict this to your domain
    methods: ["GET", "POST"]
  }
});

// A simple in-memory store for rooms
// { roomId: { users: Map<socketId, username> } }
const rooms = new Map();

// Store for nearby discovery (by Public IP)
// { publicIp: Set<socketId> }
const ipGroups = new Map();

function getNearbyUsers(publicIp, excludeSocketId) {
  const group = ipGroups.get(publicIp);
  if (!group) return [];
  
  const users = [];
  const toRemove = [];

  for (const id of group) {
    const targetSocket = io.sockets.sockets.get(id);
    
    // Verify socket is still active
    if (!targetSocket || !targetSocket.connected) {
      toRemove.push(id);
      continue;
    }

    if (id !== excludeSocketId) {
      let username = targetSocket.customName || `Thiết bị-${id.slice(0, 4)}`;
      
      // Fallback to room username
      if (!targetSocket.customName) {
        for (const [, usersMap] of rooms.entries()) {
          if (usersMap.has(id)) {
            username = usersMap.get(id);
            break;
          }
        }
      }
      users.push({ id, username });
    }
  }

  // Self-healing: Remove invalid IDs found during traversal
  if (toRemove.length > 0) {
    toRemove.forEach(id => group.delete(id));
    if (group.size === 0) ipGroups.delete(publicIp);
  }

  return users;
}

function broadcastNearbyUpdate(publicIp) {
  const group = ipGroups.get(publicIp);
  console.log(`Broadcasting update to IP group: ${publicIp}, size: ${group?.size || 0}`);
  if (!group) return;
  
  for (const id of group) {
    const nearby = getNearbyUsers(publicIp, id);
    console.log(`Sending nearby list to ${id}:`, nearby);
    io.to(id).emit('nearby-users', nearby);
  }
}

io.on('connection', (socket) => {
  let publicIp = socket.handshake.address;
  // Normalize localhost for discovery
  if (publicIp === '::1' || publicIp === '::ffff:127.0.0.1') {
    publicIp = '127.0.0.1';
  }
  
  console.log('User connected:', socket.id, 'IP:', publicIp);

  // Add to IP group
  if (!ipGroups.has(publicIp)) {
    ipGroups.set(publicIp, new Set());
  }
  ipGroups.get(publicIp).add(socket.id);

  // Immediate broadcast to neighbors
  broadcastNearbyUpdate(publicIp);

  // Send the socket ID to the client
  socket.emit('your-id', socket.id);

  // For Link Sharing: Direct peer connection
  // When receiver opens the link, they tell the server they want to connect to a specific sender ID
  socket.on('request-direct-connection', (targetPeerId) => {
    // Forward the request to the target peer
    io.to(targetPeerId).emit('incoming-direct-connection', socket.id);
  });

  // For Room Sharing: Join a room with a username
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    const displayName = username || `User-${socket.id.slice(0, 6)}`;
    rooms.get(roomId).set(socket.id, displayName);
    
    console.log(`User ${displayName} (${socket.id}) joined room ${roomId}`);

    // Notify other peers in the room (include username)
    socket.to(roomId).emit('peer-joined', { id: socket.id, username: displayName });
    
    // Send list of existing users to the new user (with usernames)
    const otherUsers = [];
    for (const [id, name] of rooms.get(roomId).entries()) {
      if (id !== socket.id) {
        otherUsers.push({ id, username: name });
      }
    }
    socket.emit('room-users', otherUsers);

    // Update neighbors with the new username
    broadcastNearbyUpdate(publicIp);
  });

  socket.on('update-username', (name) => {
    console.log(`User ${socket.id} updated name to: ${name}`);
    socket.customName = name;
    broadcastNearbyUpdate(publicIp);
  });

  // Signaling protocol
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', {
      from: socket.id,
      sdp: data.sdp
    });
  });

  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      from: socket.id,
      sdp: data.sdp
    });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // Room sharing: Request to send file (include sender username)
  socket.on('file-request', (data) => {
    // Find the sender's username from any room they're in
    let senderUsername = socket.id;
    for (const [, usersMap] of rooms.entries()) {
      if (usersMap.has(socket.id)) {
        senderUsername = usersMap.get(socket.id);
        break;
      }
    }
    // Send a prompt to the receiver
    io.to(data.to).emit('file-request', {
      from: socket.id,
      fromUsername: senderUsername,
      metadata: data.metadata
    });
  });

  socket.on('file-request-accepted', (data) => {
    io.to(data.to).emit('file-request-accepted', {
      from: socket.id
    });
  });

  socket.on('file-request-rejected', (data) => {
    io.to(data.to).emit('file-request-rejected', {
      from: socket.id
    });
  });

  // Leave handling
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id, 'IP:', publicIp);
    
    // Remove from IP group
    const group = ipGroups.get(publicIp);
    if (group) {
      group.delete(socket.id);
      console.log(`Removed ${socket.id} from group ${publicIp}. Remaining: ${group.size}`);
      if (group.size === 0) {
        ipGroups.delete(publicIp);
        console.log(`Deleted empty group for IP: ${publicIp}`);
      } else {
        broadcastNearbyUpdate(publicIp);
      }
    }

    // Notify all rooms the user was in
    for (const [roomId, usersMap] of rooms.entries()) {
      if (usersMap.has(socket.id)) {
        usersMap.delete(socket.id);
        socket.to(roomId).emit('peer-left', socket.id);
        if (usersMap.size === 0) {
          rooms.delete(roomId);
        }
      }
    }
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
