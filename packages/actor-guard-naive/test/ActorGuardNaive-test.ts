import EventEmitter = require('events');
import type { IActionDereferenceRdf, MediatorDereferenceRdf } from '@comunica/bus-dereference-rdf';
import { Bus } from '@comunica/core';
import type { IActionGuard } from '@incremunica/bus-guard';
import type {
  IActionResourceWatch,
  IActorResourceWatchOutput,
  MediatorResourceWatch,
} from '@incremunica/bus-resource-watch';
import { Store, DataFactory } from 'n3';
import type { Transform } from 'readable-stream';
import 'jest-rdf';
import { ActorGuardNaive } from '../lib';

const quad = require('rdf-quad');
const streamifyArray = require('streamify-array');

// Captures the number of times an event has been emitted
function captureEvents(item: EventEmitter, ...events: string[]) {
  const counts = (<any>item)._eventCounts = Object.create(null);
  for (const event of events) {
    counts[event] = 0;
    item.on(event, () => {
      counts[event]++;
    });
  }
  return item;
}

describe('ActorGuardNaive', () => {
  let bus: any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
  });

  describe('An ActorGuardNaive instance', () => {
    let actor: ActorGuardNaive;
    let mediatorResourceWatch: MediatorResourceWatch;
    let mediatorDereferenceRdf: MediatorDereferenceRdf;
    let action: IActionGuard;
    let quadArrayStore: any[];
    let quadArray: any[];
    let streamingStoreEventEmitter: EventEmitter;
    let changeNotificationEventEmitter: EventEmitter;
    let removeQuadFn = jest.fn();
    let addQuadFn = jest.fn();
    let stopFn = jest.fn();
    let startFn = jest.fn();
    let onFn: () => void;
    let hasEnded: { value: boolean };
    const setStatus = (status: number) => {
      (<any>action.streamingQuerySource).status = status;
      action.streamingQuerySource.statusEvents.emit('status', status);
    };

    beforeEach(() => {
      quadArray = [];
      streamingStoreEventEmitter = new EventEmitter();
      changeNotificationEventEmitter = new EventEmitter();
      quadArrayStore = [];
      removeQuadFn = jest.fn();
      addQuadFn = jest.fn();
      stopFn = jest.fn();
      startFn = jest.fn();
      hasEnded = { value: false };

      mediatorDereferenceRdf = <any>{
        mediate: async(action: IActionDereferenceRdf) => {
          return {
            data: streamifyArray(quadArray),
          };
        },
      };

      mediatorResourceWatch = <any>{
        mediate: async(action: IActionResourceWatch): Promise<IActorResourceWatchOutput> => {
          return {
            events: changeNotificationEventEmitter,
            stop: stopFn,
            start: startFn,
          };
        },
      };

      actor = new ActorGuardNaive({
        name: 'actor',
        bus,
        mediatorResourceWatch,
        mediatorDereferenceRdf,
      });

      action = {
        context: <any>{},
        url: 'www.test.com',
        metadata: {},
        streamingQuerySource: <any>{
          status: 0,
          statusEvents: new EventEmitter(),
          store: {
            on: (str: string, fn: () => void) => {
              onFn = fn;
            },
            hasEnded: () => {
              return hasEnded.value;
            },
            import: (stream: Transform) => {
              streamingStoreEventEmitter.emit('data', stream);
              return stream;
            },
            copyOfStore: () => {
              return new Store(quadArrayStore);
            },
            getStore: () => {
              return new Store(quadArrayStore);
            },
            removeQuad: (quad: any) => removeQuadFn(quad),
            addQuad: (quad: any) => addQuadFn(quad),
          },
        },
      };
    });

    it('should test', async() => {
      await expect(actor.test(action)).resolves.toBeTruthy();
    });

    it('should only start resource watcher if streamingQuerySource is running', async() => {
      await actor.run(action);
      expect(startFn).toHaveBeenCalledTimes(0);
      expect(stopFn).toHaveBeenCalledTimes(0);

      setStatus(1);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(stopFn).toHaveBeenCalledTimes(0);
      setStatus(2);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(stopFn).toHaveBeenCalledTimes(1);
    });

    it('should start resource watcher if streamingQuerySource is running early', async() => {
      setStatus(1);

      await actor.run(action);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(stopFn).toHaveBeenCalledTimes(0);

      setStatus(2);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(stopFn).toHaveBeenCalledTimes(1);
    });

    it('should remove all items if mediatorDereferenceRdf errors', async() => {
      quadArrayStore = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ];

      actor = new ActorGuardNaive({
        name: 'actor',
        bus,
        mediatorResourceWatch,
        mediatorDereferenceRdf,
      });

      const { guardEvents } = await actor.run(action);

      mediatorDereferenceRdf.mediate = async() => {
        throw new Error('mediatorDereferenceRdf errors');
      };

      changeNotificationEventEmitter.emit('update');
      await new Promise<void>(resolve => guardEvents.once('up-to-date', resolve));

      expect(removeQuadFn).toHaveBeenCalledTimes(3);
      expect(removeQuadFn).toHaveBeenNthCalledWith(1, DataFactory.quad(
        DataFactory.namedNode('s1'),
        DataFactory.namedNode('p1'),
        DataFactory.namedNode('o1'),
      ));
      expect(removeQuadFn).toHaveBeenNthCalledWith(2, DataFactory.quad(
        DataFactory.namedNode('s2'),
        DataFactory.namedNode('p2'),
        DataFactory.namedNode('o2'),
      ));
      expect(removeQuadFn).toHaveBeenNthCalledWith(3, DataFactory.quad(
        DataFactory.namedNode('s3'),
        DataFactory.namedNode('p3'),
        DataFactory.namedNode('o3'),
      ));
    });

    it('should attach a positive changes stream', async() => {
      quadArrayStore = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
      ];

      const { guardEvents } = await actor.run(action);
      captureEvents(guardEvents, 'modified', 'up-to-date');

      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'update')).toBe(1);
      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'delete')).toBe(1);

      quadArray = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ];

      changeNotificationEventEmitter.emit('update');

      await new Promise<void>(resolve => guardEvents.once('up-to-date', resolve));

      expect((<any>guardEvents)._eventCounts.modified).toBe(1);
      expect((<any>guardEvents)._eventCounts['up-to-date']).toBe(1);
      expect(addQuadFn).toHaveBeenCalledTimes(1);
      expect(addQuadFn).toHaveBeenCalledWith(quad('s3', 'p3', 'o3'));
    });

    it('should attach a negative changes stream', async() => {
      quadArrayStore = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ];

      const { guardEvents } = await actor.run(action);
      captureEvents(guardEvents, 'modified', 'up-to-date');

      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'update')).toBe(1);
      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'delete')).toBe(1);

      quadArray = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
      ];

      changeNotificationEventEmitter.emit('update');

      await new Promise<void>(resolve => guardEvents.once('up-to-date', resolve));

      expect((<any>guardEvents)._eventCounts.modified).toBe(1);
      expect((<any>guardEvents)._eventCounts['up-to-date']).toBe(1);
      expect(removeQuadFn).toHaveBeenCalledTimes(1);
      expect(removeQuadFn).toHaveBeenCalledWith(
        DataFactory.quad(
          DataFactory.namedNode('s3'),
          DataFactory.namedNode('p3'),
          DataFactory.namedNode('o3'),
        ),
      );
    });

    it('should handle delete events', async() => {
      quadArrayStore = [
        quad('s1', 'p1', 'o1'),
        quad('s2', 'p2', 'o2'),
        quad('s3', 'p3', 'o3'),
      ];

      const { guardEvents } = await actor.run(action);
      captureEvents(guardEvents, 'modified', 'up-to-date');

      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'update')).toBe(1);
      expect(EventEmitter.listenerCount(changeNotificationEventEmitter, 'delete')).toBe(1);

      const updatePromise = new Promise<void>(resolve => guardEvents.once('up-to-date', resolve));

      changeNotificationEventEmitter.emit('delete');

      await updatePromise;

      expect((<any>guardEvents)._eventCounts.modified).toBe(1);
      expect((<any>guardEvents)._eventCounts['up-to-date']).toBe(1);
      expect(removeQuadFn).toHaveBeenCalledTimes(3);
      expect(removeQuadFn).toHaveBeenNthCalledWith(1, DataFactory.quad(
        DataFactory.namedNode('s1'),
        DataFactory.namedNode('p1'),
        DataFactory.namedNode('o1'),
      ));
      expect(removeQuadFn).toHaveBeenNthCalledWith(2, DataFactory.quad(
        DataFactory.namedNode('s2'),
        DataFactory.namedNode('p2'),
        DataFactory.namedNode('o2'),
      ));
      expect(removeQuadFn).toHaveBeenNthCalledWith(3, DataFactory.quad(
        DataFactory.namedNode('s3'),
        DataFactory.namedNode('p3'),
        DataFactory.namedNode('o3'),
      ));
    });
  });
});
