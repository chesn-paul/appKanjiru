ARG NODE_VERSION=20.11.1

FROM node:${NODE_VERSION}-alpine

RUN apk --no-cache add font-dejavu

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY --chown=node:node package*.json ./

USER node

RUN npm install

COPY --chown=node:node . .

EXPOSE 8080

CMD [ "npm", "start" ]