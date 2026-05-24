FROM node:20-alpine AS build-stage

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# The dist/ folder is the build output.
# In docker-compose, the vps-web service writes dist/ to a shared volume
# that nginx then reads from.
