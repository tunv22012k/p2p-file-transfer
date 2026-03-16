# Tài liệu Kiến trúc Hệ thống P2P File Transfer

Tài liệu này cung cấp cái nhìn chi tiết về cấu trúc mã nguồn, vai trò của từng trang và các thành phần chính trong ứng dụng Chuyển file P2P sử dụng WebRTC.

## 1. Cấu trúc Thư mục Chính

- `src/app`: Chứa các trang (pages) và layout của ứng dụng Next.js.
- `src/components`: Các thành phần UI tái sử dụng.
- `src/hooks`: Chứa custom hooks, đặc biệt là logic WebRTC.
- `src/lib`: Các thư viện tiện ích (Crypto, History, WebRTC Config).
- `server/`: Signaling Server (Server báo hiệu) sử dụng Node.js & Socket.io.

---

## 2. Các Trang Chính (Pages)

### 🏠 Trang Chủ (`src/app/page.tsx`)
- **Vai trò**: Cung cấp 2 lựa chọn chính cho người dùng:
    1. **Chia sẻ qua Link**: Chuyển hướng đến quy trình gửi file đơn lẻ.
    2. **Vào Phòng**: Cho phép nhiều người tham gia vào một ID phòng chung để trao đổi file.
- **Cách hoạt động**: Sử dụng `useRouter` để điều hướng và lưu trữ thông tin phòng/tên người dùng tạm thời.

### 👥 Trang Phòng (`src/app/room/[roomId]/page.tsx`)
- **Vai trò**: Môi trường cộng tác đa người dùng.
- **Tính năng**:
    - Hiển thị danh sách thành viên hiện có trong phòng.
    - Cho phép chọn một người cụ thể để gửi yêu cầu chuyển file.
    - Xử lý chấp nhận/từ chối yêu cầu từ người khác.
- **Luồng hoạt động**: Kết nối với Signaling Server ngay khi mount, tham gia vào `roomId` và lắng nghe các sự kiện `room-users`.

### 🔗 Trang Tạo Link Chia sẻ (`src/app/share/new/page.tsx`)
- **Vai trò**: Dành cho người muốn gửi link trực tiếp (nhanh).
- **Cách hoạt động**: 
    - Tự động tạo một khóa mã hóa ngẫu nhiên (Crypto Key).
    - Tạo một URL chứa ID của người gửi và khóa mã hóa (phần `#hash`).
    - Chờ đợi người nhận truy cập vào link để thiết lập kết nối WebRTC.

### 📥 Trang Nhận File qua Link (`src/app/share/[peerId]/page.tsx`)
- **Vai trò**: Giao diện cho người nhận khi nhấn vào link chia sẻ.
- **Cách hoạt động**:
    - Trích xuất `peerId` từ URL và khóa mã hóa từ `location.hash`.
    - Tự động thực hiện kết nối tới `peerId` (người gửi).
    - Hiển thị tiến trình tải và nút lưu file sau khi hoàn tất.

---

## 3. Thành phần Cốt lõi (Core Components & Logic)

### ⚡ Hook `useWebRTC` (`src/hooks/useWebRTC.ts`)
Đây là **"trái tim"** của toàn bộ ứng dụng. 
- **Quản lý trạng thái**: Kết nối (`Connecting`, `Connected`, `Disconnected`), tiến độ (`progress`), danh sách người trong phòng.
- **WebRTC Data Channel**: Xử lý việc chia nhỏ file thành các "chunks", chuyển đổi sang `ArrayBuffer` và gửi đi.
- **Signaling**: Giao tiếp với server Socket.io để trao đổi Offer/Answer/ICE Candidates.

### 🔒 Crypto (`src/lib/crypto.ts`)
- Đảm bảo tính bảo mật "End-to-End".
- Sử dụng **Web Crypto API** (AES-GCM).
- File được mã hóa ngay tại trình duyệt người gửi và chỉ được giải mã tại trình duyệt người nhận bằng khóa chung được trao đổi qua URL.

### 📜 History (`src/lib/history.ts`)
- Lưu trữ lịch sử các lần chuyển file thành công hoặc thất bại vào `localStorage`.

### 📡 Signaling Server (`server/index.js`)
- Server trung gian giúp các trình duyệt tìm thấy nhau.
- **Không bao giờ chạm vào dữ liệu file**. Nó chỉ chuyển tiếp các gói tin điều khiển (Signaling) để thiết lập kết nối trực tiếp (P2P) giữa hai máy tính.

---

## 5. Giải thích Kỹ thuật Chuyên sâu

### 📦 Xử lý Chunking (Chia nhỏ dữ liệu)
- **File liên quan**: `src/hooks/useWebRTC.ts` (Dòng 602 - 659) & `src/lib/webrtc-config.ts`.
- **Cơ chế**:
    - Ứng dụng không đọc toàn bộ file vào bộ nhớ (tránh crash RAM). Thay vào đó, nó sử dụng **ReadableStream** (`file.stream()`).
    - Mỗi mẩu dữ liệu từ luồng đọc được chia nhỏ tiếp thành các **Chunk** cố định 64KB (`CHUNK_SIZE`).
    - **Kiểm soát nghẽn (Backpressure)**: WEB RTC có bộ nhớ đệm (`bufferedAmount`). Nếu bộ đệm vượt quá 64MB (`MAX_BUFFERED_AMOUNT`), ứng dụng sẽ tạm dừng đọc file và đợi sự kiện `bufferedamountlow` mới gửi tiếp. Điều này đảm bảo truyền được file cực lớn (hàng chục GB) mà trình duyệt vẫn mượt mà.

### 🔐 Cơ chế Mã hóa (Encryption)
- **File liên quan**: `src/lib/crypto.ts` & `src/hooks/useWebRTC.ts` (Dòng 638, 137).
- **Công nghệ**: **Web Crypto API** (Native trong trình duyệt, hiệu năng cao).
- **Thuật toán**: **AES-GCM 256-bit** (Chuẩn mã hóa quân đội, cực kỳ an toàn).
- **Quy trình**:
    1. **Key Generation**: Một khóa 256-bit được tạo ngẫu nhiên cho mỗi phiên gửi.
    2. **IV (Initialization Vector)**: Với mỗi chunk 64KB, một mã IV 12-byte ngẫu nhiên được tạo ra.
    3. **Encrypt**: Chunk + Key + IV -> Ciphertext.
    4. **Payload**: IV (12 bytes) được gắn vào đầu Ciphertext trước khi gửi qua WebRTC.
    5. **Decrypt**: Người nhận lấy 12-byte đầu làm IV để giải mã phần dữ liệu phía sau.

### 🌐 WebRTC, STUN và TURN
- **File liên quan**: `src/lib/webrtc-config.ts` & `src/hooks/useWebRTC.ts` (Dòng 249).
- **STUN (Session Traversal Utilities for NAT)**: 
    - Vai trò: Giúp trình duyệt biết IP công cộng của chính mình.
    - Hiện tại đang dùng server STUN miễn phí của Google.
- **TURN (Traversal Using Relays around NAT)**:
    - Vai trò: Khi hai máy tính nằm sau tường lửa quá chặt chẽ (như mạng công ty, 4G) không thể kết nối trực tiếp, dữ liệu sẽ được "tiếp sức" qua server TURN trung gian.
    - **Lưu ý**: Hiện tại code đang cấu hình STUN. Để hoạt động tốt nhất trong mọi môi trường mạng phức tạp, bạn cần bổ sung thông tin TURN server vào `webrtc-config.ts`.

### 🔌 Socket.io (Signaling Layer)
- **File liên quan**: `server/index.js` (Server) & `src/hooks/useWebRTC.ts` (Dòng 285).
- **Tại sao cần Socket?**: Hai trình duyệt không thể tự nhiên biết IP của nhau để kết nối P2P. Socket đóng vai trò "người môi giới".
- **Luồng báo hiệu**:
    1. **Join**: Lấy danh sách người trong phòng.
    2. **Offer/Answer**: Trình duyệt A gửi lời mời kết nối, trình duyệt B phản hồi.
    3. **ICE Candidates**: Hai bên gửi các "địa chỉ tìm thấy" cho nhau qua Socket.
    4. **Switch to P2P**: Một khi WebRTC kết nối thành công, Socket.io không còn tham gia vào quá trình truyền file nữa. Dữ liệu file đi theo đường ống riêng của WebRTC.
