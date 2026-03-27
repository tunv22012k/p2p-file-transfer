/* eslint-disable @typescript-eslint/no-require-imports */
// ---- IMPORT THƯ VIỆN KHỞI TẠO CƠ BẢN ----
const express = require('express');
const { createServer } = require('http');     // Bọc Express lại thành HTTP server tiêu chuẩn
const { Server } = require('socket.io');      // Socket.io dùng để chat / WebRTC Signaling theo thời gian thực
const cors = require('cors');                 // Xử lý Cross-Origin cho phép mọi domain kết nối

const app = express();
app.use(cors());

// ---- CẤU HÌNH CLOUDFLARE TURN SERVER ----
const TURN_TOKEN_ID = process.env.TURN_TOKEN_ID || 'edd80bc0681b477ba21a1758e6b123f5';
const TURN_API_TOKEN = process.env.TURN_API_TOKEN || '6a3da08d35a6483617f85fd6189e248aa76ffb03825efcacdb4402a375293d3f';

// (API DỰ PHÒNG) Cấp thông tin ICE (TURN/STUN) qua giao thức HTTP GET cổ điển
app.get('/turn-credentials', async (req, res) => {
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_TOKEN_ID}/credentials/generate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cloudflare TURN API error:', response.status, errorText);
      return res.status(502).json({ error: 'Failed to generate TURN credentials' });
    }

    const data = await response.json();
    console.log('Generated TURN credentials successfully via HTTP');
    if (data && data.success && data.result && data.result.iceServers) {
      res.json({ iceServers: data.result.iceServers });
    } else if (data && data.iceServers) {
      res.json({ iceServers: data.iceServers });
    } else {
      res.status(502).json({ error: 'Invalid response from TURN provider' });
    }
  } catch (err) {
    console.error('TURN credentials error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- KHỞI TẠO SOCKET.IO SERVER ----
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // Chấp nhận mọi nguồn gốc kết nối (Trong thực tế nên giới hạn lại theo domain)
    methods: ["GET", "POST"]
  }
});

// ---- QUẢN LÝ BỘ NHỚ (IN-MEMORY STORES) ----
// Cấu trúc danh sách các Phòng: { Mã_Phòng: Map<SocketID, Tên_Hiển_Thị> }
// Dùng cho tính năng Chia sẻ cùng phòng (Room Sharing)
const rooms = new Map();

// Cấu trúc Thiết bị lân cận: { IP_Public: Set<SocketID> }
// Máy nào trùng dải IP (chung Wi-Fi/4G IP) thì sẽ thấy nhau.
const ipGroups = new Map();

// Hàm phụ trợ: Lấy danh sách toàn bộ các thành viên CÙNG MỘT MẠNG IP (Trừ người đang truy vấn)
function getNearbyUsers(publicIp, excludeSocketId) {
  const group = ipGroups.get(publicIp);
  if (!group) {
    return [];
  }

  console.log("group", group);

  const users = [];
  const toRemove = [];

  for (const id of group) {
    const targetSocket = io.sockets.sockets.get(id);

    // Dọn dẹp tự động (Self-heal) nếu socket kia đã hỏng/ngắt kết nối mà chưa kịp gỡ khỏi danh sách
    if (!targetSocket || !targetSocket.connected) {
      toRemove.push(id);
      continue;
    }

    if (id !== excludeSocketId) {
      // Ưu tiên custom name, nếu không tự random theo 4 chữ số ID
      let username = targetSocket.customName || `Thiết bị-${id.slice(0, 4)}`;

      // Nếu người đó đang trong phòng, thử lấy tên trong phòng bù đắp cho tên lân cận
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

  // Self-healing: Tiến hành tháo dỡ các ID hỏng đã lọc ở trên khỏi danh sách IP chung
  if (toRemove.length > 0) {
    toRemove.forEach(id => group.delete(id));
    if (group.size === 0) {
      ipGroups.delete(publicIp);
    }
  }

  return users;
}

// Hàm phụ trợ: Nhắc lại hệ thống hãy gửi danh sách thiết bị mới nhất cho MỌI THIẾT BỊ cùng IP đó
function broadcastNearbyUpdate(publicIp) {
  const group = ipGroups.get(publicIp);
  console.log(`Broadcasting update to IP group: ${publicIp}, size: ${group?.size || 0}`);
  if (!group) {
    return;
  }

  for (const id of group) {
    const nearby = getNearbyUsers(publicIp, id);
    console.log(`Sending nearby list to ${id}:`, nearby);
    io.to(id).emit('nearby-users', nearby);
  }
}

// ---- SỰ KIỆN KHI CÓ MỘT KẾT NỐI MỚI ----
io.on('connection', (socket) => {
  const headers = socket.handshake.headers;

  // Thuật toán quét và lấy Public IP thật của máy khách, xuyên qua các lớp Tường lửa, NGINX, Cloudflare
  let publicIp = headers['cf-connecting-ip']                 // Cloudflare Tunnel
    || headers['x-real-ip']                                  // Nginx proxy
    || (headers['x-forwarded-for'] || '').split(',')[0].trim() // Generic proxy (VD: AWS ALB)
    || socket.handshake.address;                             // Direct connection (Chạy local nội bộ)

  console.log("publicIp", publicIp);

  // Normalize localhost for local development
  if (publicIp === '::1' || publicIp === '::ffff:127.0.0.1' || !publicIp) {
    publicIp = '127.0.0.1';
  }

  console.log('User connected:', socket.id, 'IP:', publicIp);
  console.log('  Headers:', JSON.stringify({
    'cf-connecting-ip': headers['cf-connecting-ip'] || null,
    'x-forwarded-for': headers['x-forwarded-for'] || null,
    'x-real-ip': headers['x-real-ip'] || null,
    rawAddress: socket.handshake.address
  }));

  // Thêm cá nhân vào đại gia đình chung IP này
  if (!ipGroups.has(publicIp)) {
    ipGroups.set(publicIp, new Set());
  }
  ipGroups.get(publicIp).add(socket.id);

  // Ép toàn bộ các máy khác Load lại thông tin list "lân cận" vì có máy mới vào
  broadcastNearbyUpdate(publicIp);

  // Gửi ID Socket cá nhân (định danh) lại cho thiết bị vừa kết nối
  socket.emit('your-id', socket.id);

  // (API CHÍNH) Yêu cầu cấp quyền TURN Server từ Cloudflare và nhồi nhét TCP Port 443 cho nó
  socket.on('get-turn-credentials', async (callback) => {
    try {
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_TOKEN_ID}/credentials/generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TURN_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Cloudflare TURN API error:', response.status, errorText);
        if (typeof callback === 'function') {
          callback({ error: 'Failed to generate TURN credentials' });
        }
        return;
      }

      const data = await response.json();
      // DEBUG: Log the FULL raw response from Cloudflare
      console.log('[TURN] Raw Cloudflare API response:', JSON.stringify(data, null, 2));

      // Rút trích `iceServers` từ Response thô (Response của Cloudflare hay thay đổi cấu trúc bọc)
      let iceServers = null;
      if (data?.iceServers) {
        iceServers = data.iceServers;
      }

      if (!iceServers || !iceServers.username || !iceServers.credential) {
        console.error('[TURN] Missing credentials in response:', data);
        if (typeof callback === 'function') {
          callback({ error: 'Missing credentials from TURN API' });
        }
        return;
      }

      // THỦ THUẬT VƯỢT TƯỜNG LỬA DOANH NGHIỆP:
      // Các cty thường khóa Port lạ (như UDP 3478 của STUN). Ở đây chúng ta thêm trực tiếp
      // giao thức TCP trên Port HTTPS (443) ngụy trang dữ liệu P2P thành luồng lướt web bình thường.
      const baseUrls = Array.isArray(iceServers.urls) ? iceServers.urls : [iceServers.urls];
      const enhancedUrls = new Set(baseUrls);

      // Thêm biến địa chỉ qua TCP trên cổng 443 (RẤT QUAN TRỌNG VÀ MẠU CHỐT)
      enhancedUrls.add('turn:turn.cloudflare.com:443?transport=tcp');
      enhancedUrls.add('turns:turn.cloudflare.com:443?transport=tcp');

      // Also ensure standard ports are included
      enhancedUrls.add('turn:turn.cloudflare.com:3478?transport=udp');
      enhancedUrls.add('turn:turn.cloudflare.com:3478?transport=tcp');
      enhancedUrls.add('turns:turn.cloudflare.com:5349?transport=tcp');

      const result = {
        iceServers: {
          urls: Array.from(enhancedUrls),
          username: iceServers.username,
          credential: iceServers.credential,
        }
      };

      console.log('[TURN] Sending to client:', socket.id, {
        urls: result.iceServers.urls,
        username: result.iceServers.username ? '✓ present' : '✗ MISSING',
        credential: result.iceServers.credential ? '✓ present' : '✗ MISSING',
      });

      if (typeof callback === 'function') {
        callback(result);
      }
    } catch (err) {
      console.error('TURN credentials error:', err);
      if (typeof callback === 'function') {
        callback({ error: 'Internal server error' });
      }
    }
  });

  // ---- LINK SHARING FLOW ----
  // Yêu cầu Môi giới (Broker). Cho phép người nhận truy cập Link hỏi mua đường tới ID của người gửi (có sẵn trên Link).
  socket.on('request-direct-connection', (targetPeerId, ack) => {
    const targetSocket = io.sockets.sockets.get(targetPeerId);

    // Nếu người gửi không truy cập app hay đã đóng tab
    if (!targetSocket || !targetSocket.connected) {
      console.log(`request-direct-connection: target ${targetPeerId} not found or disconnected`);
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'not-found' });
      }
      return;
    }
    // Forward the request to the target peer
    io.to(targetPeerId).emit('incoming-direct-connection', socket.id);
    console.log(`request-direct-connection: forwarded from ${socket.id} to ${targetPeerId}`);
    if (typeof ack === 'function') {
      ack({ ok: true });
    }
  });

  // ---- ROOM SHARING FLOW ----
  // Xử lý khi một người dùng tham gia vào một phòng theo mã roomId
  socket.on('join-room', ({ roomId, username }) => {
    // 1. Join vào channel của socket.io
    socket.join(roomId);

    // 2. Cấu trúc lại danh sách người dùng trong bộ nhớ (Map)
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    // Nếu người dùng không nhập tên, tiến hành random một cái tên tự động
    const displayName = username || `User-${socket.id.slice(0, 6)}`;
    rooms.get(roomId).set(socket.id, displayName);

    console.log(`User ${displayName} (${socket.id}) joined room ${roomId}`);

    // 3. Thông báo cho những người ĐÃ Ở TRONG PHÒNG biết rằng có người mới vào
    // 'socket.to' sẽ gửi cho tất cả mọi người trong roomId, TRỪ người đang join
    socket.to(roomId).emit('peer-joined', { id: socket.id, username: displayName });

    // 4. Lấy danh sách những người ĐANG Ở SẴN trong phòng và gửi lại cho người mới vào phòng (room-users)
    const otherUsers = [];
    for (const [id, name] of rooms.get(roomId).entries()) {
      if (id !== socket.id) {
        otherUsers.push({ id, username: name });
      }
    }
    socket.emit('room-users', otherUsers);

    // 5. Cập nhật tên mới của người dùng cho tính năng "Thiết bị lân cận"
    broadcastNearbyUpdate(publicIp);
  });

  // ---- RENAME SENDER OVER NETWORK ----
  // Cho phép người dùng cập nhật lại tên hiển thị bất kỳ lúc nào
  socket.on('update-username', (name) => {
    console.log(`User ${socket.id} updated name to: ${name}`);
    socket.customName = name; // Gắn tên tùy chỉnh vào đối tượng socket hiện tại
    // Chạy lệnh quét và phát tán lại danh sách thiết bị cho tất cả những máy chung IP internet
    broadcastNearbyUpdate(publicIp);
  });

  // ---- WEBRTC SIGNALING PROTOCOL ----
  // Giao thức trung gian (Signaling) bắt buộc của WebRTC để hai thiết bị chia sẻ thông tin IP kết nối

  // A. Offer: Thiết bị gửi (Sender) sẽ khởi tạo WebRTC và báo cho Receiver cấu hình kết nối của mình
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', {
      from: socket.id,
      sdp: data.sdp
    });
  });

  // B. Answer: Thiết bị nhận (Receiver) sau khi chấp nhận Offer sẽ phản hồi lại thông tin kết nối
  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      from: socket.id,
      sdp: data.sdp
    });
  });

  // C. ICE Candidates: Các gói tin truyền IP Address thực tế, dùng để tìm đường ngắn nhất (P2P hoặc chui qua TURN server)
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // ---- FILE REQUEST PROTOCOL ----

  // Bước 1: Xin phép chuyển file. Máy gửi thông báo cho máy nhận là mình đang muốn gửi file với thông tin metadata.
  socket.on('file-request', (data) => {
    // Tự động tìm kiếm xem người gửi ở phòng nào để lấy chính xác username
    let senderUsername = socket.id;
    for (const [, usersMap] of rooms.entries()) {
      if (usersMap.has(socket.id)) {
        senderUsername = usersMap.get(socket.id);
        break;
      }
    }
    // Chuyển tiếp lời yêu cầu (Request) sang cho người nhận, kèm theo tên hiển thị
    io.to(data.to).emit('file-request', {
      from: socket.id,
      fromUsername: senderUsername,
      metadata: data.metadata
    });
  });

  // Bước 2a: Người nhận nhấn ĐỒNG Ý nhận file
  socket.on('file-request-accepted', (data) => {
    io.to(data.to).emit('file-request-accepted', {
      from: socket.id
    });
  });

  // Bước 2b: Người nhận TỪ CHỐI nhận file
  socket.on('file-request-rejected', (data) => {
    io.to(data.to).emit('file-request-rejected', {
      from: socket.id
    });
  });

  // ---- DISCONNECT HANDLING ----
  // Xử lý rác hệ thống (Garbage Cleanup) khi người dùng thoát trình duyệt / disconnect mạng
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id, 'IP:', publicIp);

    // 1. Xóa socket của người dùng khỏi nhóm mạng (IP group) để ẩn trên thẻ "Thiết bị gần đây"
    const group = ipGroups.get(publicIp);
    if (group) {
      group.delete(socket.id);
      console.log(`Removed ${socket.id} from group ${publicIp}. Remaining: ${group.size}`);
      // Dọn bộ nhớ nếu không còn ai truy cập ở public ip đó
      if (group.size === 0) {
        ipGroups.delete(publicIp);
        console.log(`Deleted empty group for IP: ${publicIp}`);
      } else {
        // Gửi tín hiệu thông báo người đó biến mất để UI của những người gần đó tự render lại
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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
