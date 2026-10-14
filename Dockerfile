FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY src ./src
COPY public ./public
# Runs as root so it can read the Docker socket for the log panel.
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server.js"]
