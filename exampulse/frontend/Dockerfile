FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json tsconfig.json vite.config.ts index.html ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY <<EOF /etc/nginx/conf.d/default.conf
server {
    listen 5173;
    server_name localhost;
    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
