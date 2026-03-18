import { EventEmitter } from 'events';
import type { IActionHttp, IActorHttpOutput } from '@comunica/bus-http';
import type { Actor, IActorTest, Mediator } from '@comunica/core';
import { Bus } from '@comunica/core';
import 'jest-rdf';
import '@comunica/utils-jest';
import type { IActionSourceWatch } from '@incremunica/bus-source-watch';
import type { Server } from 'ws';
import { WebSocket } from 'ws';
import { ActorSourceWatchSolidNotificationWebsockets } from '../lib/ActorSourceWatchSolidNotificationWebsockets';
import {
  createChannelDescriptionRequest,
  createDescriptionResourceRequest,
  createEmptyChannelDescriptionRequest,
  createEmptyResourceRequest,
  createFailedRequest,
  createResourceRequest,
} from './mocks/HTTPMock';

const message: any = {
  '@context': [
    'https://www.w3.org/ns/activitystreams',
    'https://www.w3.org/ns/solid/notification/v1',
  ],
  id: 'urn:1700310987535:http://localhost:3000/pod1/container/',
  object: 'http://localhost:3000/pod1/container/test',
  target: 'http://localhost:3000/pod1/container/',
  published: '2023-11-18T12:36:27.535Z',
};

//
// let AddMessage = {
// "type": "Add",
// "object": "http://localhost:3000/pod1/test",
// "target": "http://localhost:3000/pod1/",
// "state": "1700310987000-text/turtle",
// };
//
// let RemoveMessage = {
// "type":"Remove",
// "object":"http://localhost:3000/pod1/test",
// "target":"http://localhost:3000/pod1/",
// "state":"1700311266000-text/turtle",
// }
//
// let UpdateMessage = {
// "type":"Update",
// "object":"http://localhost:3000/pod1/test",
// "state":"1700311389000-text/turtle",
// };
//
// let DeleteMessage = {
// "type":"Delete",
// "object":"http://localhost:3000/pod1/test2",
// };
//
// let CreateMessage = {
// "type":"Create",
// "object":"http://localhost:3000/pod1/test2",
// "state":"1700311525000-text/turtle",
// };
//

describe('ActorSourceWatchSolidNotificationWebsockets', () => {
  let bus: any;
  let actor: ActorSourceWatchSolidNotificationWebsockets;
  let mediatorHttp: Mediator<
    Actor<IActionHttp, IActorTest, IActorHttpOutput>,
    IActionHttp,
IActorTest,
IActorHttpOutput
>;
  let action: IActionSourceWatch;
  let priority: number;
  let createResourceRequestFn: (url: string) => any;
  let createDescriptionResourceRequestFn: (url: string) => any;
  let createChannelDescriptionRequestFn: (url: string) => any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
    priority = 0;

    createResourceRequestFn = (url: string): any => {
      throw new Error('createResourceRequestFn not set');
    };
    createDescriptionResourceRequestFn = (url: string): any => {
      throw new Error('createDescriptionResourceRequestFn not set');
    };
    createChannelDescriptionRequestFn = (url: string): any => {
      throw new Error('createChannelDescriptionRequestFn not set');
    };

    mediatorHttp = <any>{
      mediate: async(action: IActionHttp) => {
        if (action.input === 'www.test.com') {
          return createResourceRequestFn('www.test.com');
        }
        if (action.input === 'http://localhost:3000/.well-known/solid') {
          return createDescriptionResourceRequestFn(action.input);
        }
        if (action.input === 'http://localhost:3000/.notifications/WebSocketChannel2023/') {
          return createChannelDescriptionRequestFn(action.input);
        }
        throw new Error('Unknown URL');
      },
    };

    actor = new ActorSourceWatchSolidNotificationWebsockets({
      beforeActors: [],
      mediatorHttp,
      name: 'actor',
      bus,
      priority,
    });

    action = {
      context: <any>{},
      url: 'www.test.com',
      metadata: {
        etag: 0,
        'cache-control': undefined,
        age: undefined,
      },
    };
  });

  describe('ActorSourceWatchSolidNotificationWebsockets test', () => {
    it('should test', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      const result = await actor.test(action);

      expect(result.get()).toEqual({ priority });
    });

    it('should not test if first get fails', async() => {
      createResourceRequestFn = createFailedRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      await expect(actor.test(action)).resolves.toFailTest('Failed fetching resource: www.test.com');
    });

    it('should not test if second get fails', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createFailedRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      await expect(actor.test(action)).resolves
        .toFailTest('Failed fetching resource: http://localhost:3000/.well-known/solid');
    });

    it('should not test if third get fails', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createFailedRequest;

      await expect(actor.test(action)).resolves.toFailTest('unexpected Content Type');
    });

    it('should not test if subscriptionService is undefined', async() => {
      createResourceRequestFn = createEmptyResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      await expect(actor.test(action)).resolves.toFailTest('Cannot read properties of null (reading \'replace\')');
    });

    it('should not test if notificationChannel.receiveFrom is undefined', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createEmptyChannelDescriptionRequest;

      await expect(actor.test(action))
        .resolves.toFailTest('Source does not support Solid Notifications with Websockets');
    });
  });

  describe('ActorSourceWatchSolidNotificationWebsockets run', () => {
    let websocket: Server<typeof import('ws')>;
    const closeEvents = new EventEmitter();
    let openConnections = 0;
    const onCloseFn = jest.fn(() => {
      openConnections--;
      closeEvents.emit('close');
    });
    let send: () => void | undefined;
    const onConnectionFn = jest.fn((ws: WebSocket) => {
      openConnections++;
      send = () => {
        ws.send(JSON.stringify(message));
      };
      ws.onclose = onCloseFn;
    });

    beforeEach(() => {
      websocket = new WebSocket.WebSocketServer({ port: 4015 });
      websocket.on('connection', onConnectionFn);
    });

    afterEach(async() => {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (openConnections > 0) {
        await new Promise<void>(resolve => closeEvents.once('close', resolve));
      }
      websocket.close();
      jest.clearAllMocks();
    });

    it('should handle multiple starts and stops', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();
      result.start();
      result.start();

      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      result.stop();
      result.stop();
      result.stop();
      result.start();
      result.start();
      result.start();
      await expect(Promise.all([
        new Promise<void>(resolve => result.events.once('update', () => {
          resolve();
        })),
        new Promise<void>(resolve => closeEvents.once('close', resolve)),
      ])).resolves.toEqual([ undefined, undefined ]);
      expect(onConnectionFn).toHaveBeenCalledTimes(2);
      expect(onCloseFn).toHaveBeenCalledTimes(1);

      result.stop();
    });

    it('should handle immediate stop after start', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();
      result.stop();

      await new Promise<void>(resolve => closeEvents.once('close', resolve));

      expect(onConnectionFn).toHaveBeenCalledTimes(1);
      expect(onCloseFn).toHaveBeenCalledTimes(1);
    });

    it('should support ADD', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      message.type = 'Add';
      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });

      result.start();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      send();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();

      result.stop();
    });

    it('should support Remove', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      message.type = 'Remove';
      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();

      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      send();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();

      result.stop();
    });

    it('should support Create', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      message.type = 'Create';
      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();

      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      send();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();

      result.stop();
    });

    it('should support Update', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      message.type = 'Update';
      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();

      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      send();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();

      result.stop();
    });

    it('should support Delete', async() => {
      createResourceRequestFn = createResourceRequest;
      createDescriptionResourceRequestFn = createDescriptionResourceRequest;
      createChannelDescriptionRequestFn = createChannelDescriptionRequest;

      message.type = 'Delete';
      const result = await actor.run(action, { notificationChannel: 'ws://localhost:4015' });
      result.start();
      await expect(new Promise<void>(resolve => result.events.once('update', () => {
        resolve();
      }))).resolves.toBeUndefined();
      expect(onConnectionFn).toHaveBeenCalledTimes(1);

      send();
      await expect(new Promise<void>(resolve => result.events.once('delete', () => {
        resolve();
      }))).resolves.toBeUndefined();

      result.stop();
    });
  });
});
