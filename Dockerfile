# Sử dụng Node.js image gọn nhẹ
FROM node:22-alpine

WORKDIR /app

# Thiết lập môi trường Production
ENV NODE_ENV=production

# Copy các file mô tả thư viện
COPY package*.json ./

# Chỉ cài đặt các packages cần thiết cho production (express, socket.io, cors...)
# Lệnh ci giúp cài đúng phiên bản trong package-lock.json
RUN npm ci --omit=dev

# Copy mã nguồn backend
COPY server/ ./server/

# Port mặc định của server là 3001
EXPOSE 3001

# Khởi chạy ứng dụng
CMD ["node", "server/index.js"]
