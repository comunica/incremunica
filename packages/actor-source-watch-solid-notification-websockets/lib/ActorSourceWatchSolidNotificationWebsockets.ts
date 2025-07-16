import { EventEmitter } from 'events';
import type { MediatorHttp } from '@comunica/bus-http';
import type { IActorTest, TestResult } from '@comunica/core';
import { failTest, passTestWithSideData } from '@comunica/core';
import type {
  IActionSourceWatch,
  IActorSourceWatchArgs,
  IActorSourceWatchOutput,
} from '@incremunica/bus-source-watch';
import {
  ActorSourceWatch,
} from '@incremunica/bus-source-watch';
import type { ISourceWatchEventEmitter } from '@incremunica/types';
import { SubscriptionClient } from '@solid-notifications/subscription';
import type { NotificationChannel } from '@solid-notifications/types';
import { ChannelType } from '@solid-notifications/types';
import { is_node } from 'tstl';

if (is_node()) {
  // Polyfill for WebSocket in Node.js
  // eslint-disable-next-line ts/no-require-imports, no-restricted-globals
  (<any>global).WebSocket ??= require('ws');
}

/**
 * An incremunica Source Watch Solid Notification Websockets Actor.
 */
export class ActorSourceWatchSolidNotificationWebsockets extends ActorSourceWatch<SideData> {
  public readonly mediatorHttp: MediatorHttp;
  private readonly channelType: ChannelType = ChannelType.WebSocketChannel2023;

  public constructor(args: IActorSolidNotificationWebsocketsArgs) {
    super(args);
  }

  public async test(action: IActionSourceWatch): Promise<TestResult<IActorTest, SideData>> {
    const customFetch = (input: RequestInfo, init?: RequestInit | undefined): Promise<Response> =>
      this.mediatorHttp.mediate({
        context: action.context,
        input,
        init,
      });

    let notificationChannel: NotificationChannel;
    try {
      const client = new SubscriptionClient(<typeof fetch>customFetch);
      notificationChannel = await client.subscribe(action.url, this.channelType);
    } catch (error) {
      return failTest((<any>error).message);
    }

    if (notificationChannel.receiveFrom === undefined) {
      return failTest('Source does not support Solid Notifications with Websockets');
    }

    return passTestWithSideData({ priority: this.priority }, { notificationChannel: notificationChannel.receiveFrom });
  }

  public async run(
    _action: IActionSourceWatch,
    sideData: SideData,
  ): Promise<IActorSourceWatchOutput> {
    const events: ISourceWatchEventEmitter = new EventEmitter();

    let socket: WebSocket | undefined;
    const start = (): void => {
      if (socket) {
        return;
      }
      socket = new WebSocket(sideData.notificationChannel);
      socket.onmessage = (message) => {
        // TODO [2025-09-01]: For now ignoring the Buffer options => tests?
        // let data: string | Buffer | ArrayBuffer | Buffer[] = message.data;
        // if (Array.isArray(data)) {
        // data = Buffer.concat(data);
        // }
        // if (data instanceof Buffer) {
        // data = data.toString();
        // }
        // if (data instanceof ArrayBuffer) {
        // const decoder = new TextDecoder('utf-8');
        // data = decoder.decode(data);
        // }

        const messageData = JSON.parse(<string>message.data);
        if (messageData.type === 'Delete') {
          events.emit('delete');
        } else {
          events.emit('update');
        }
      };
      socket.onopen = () => {
        events.emit('update');
      };
    };

    return {
      events,
      stop() {
        if (socket) {
          if (socket.readyState === WebSocket.OPEN) {
            socket.close();
          }
          if (socket.readyState === WebSocket.CONNECTING) {
            const constSocket = socket;
            constSocket.onopen = () => {
              constSocket.close();
            };
          }
        }
        socket = undefined;
      },
      start,
    };
  }
}

export interface IActorSolidNotificationWebsocketsArgs extends IActorSourceWatchArgs<SideData> {
  /**
   * The HTTP mediator
   */
  mediatorHttp: MediatorHttp;
}

interface SideData {
  notificationChannel: string;
}
