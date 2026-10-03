import { io, type Socket } from 'socket.io-client'

let socket: Socket | undefined

/** One shared connection to the API's socket.io gateway (same origin, proxied by Vite). */
export function getSocket(): Socket {
  return (socket ??= io())
}
