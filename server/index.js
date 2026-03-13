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
// { roomId: { users: Set<socketId> } }
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Send the socket ID to the client
  socket.emit('your-id', socket.id);

  // For Link Sharing: Direct peer connection
  // When receiver opens the link, they tell the server they want to connect to a specific sender ID
  socket.on('request-direct-connection', (targetPeerId) => {
    // Forward the request to the target peer
    io.to(targetPeerId).emit('incoming-direct-connection', socket.id);
  });

  // For Room Sharing: Join a room
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);
    
    console.log(`User ${socket.id} joined room ${roomId}`);

    // Notify other peers in the room
    socket.to(roomId).emit('peer-joined', socket.id);
    
    // Send list of existing users to the new user
    const otherUsers = Array.from(rooms.get(roomId)).filter(id => id !== socket.id);
    socket.emit('room-users', otherUsers);
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

  // Room sharing: Request to send file
  socket.on('file-request', (data) => {
    // Send a prompt to the receiver
    io.to(data.to).emit('file-request', {
      from: socket.id,
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
    console.log('User disconnected:', socket.id);
    
    // Notify all rooms the user was in
    for (const [roomId, users] of rooms.entries()) {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit('peer-left', socket.id);
        if (users.size === 0) {
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
