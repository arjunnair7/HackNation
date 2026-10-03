import { Logger } from '@nestjs/common';
import {
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

/** socket.io on the API port (default path /socket.io), reached through the Vite proxy. */
@WebSocketGateway()
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.log(`client connected ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client disconnected ${client.id}`);
  }

  /** Returned value goes back as the socket.io ack. */
  @SubscribeMessage('ping')
  ping(@MessageBody() data: unknown) {
    return { pong: true, serverTime: Date.now(), echo: data ?? null };
  }

  emit(event: string, payload: unknown) {
    this.server.emit(event, payload);
  }
}
