import 'jest-rdf';
import '@incremunica/jest';
import { EventEmitter } from 'node:events';
import { ActionContext, Bus } from '@comunica/core';
import type { IActionContext, IActionContextKey } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import {
  ActorMergeBindingsContextIsAddition,
} from '@incremunica/actor-merge-bindings-context-is-addition';
import type { IActionDetermineChanges, MediatorDetermineChanges } from '@incremunica/bus-determine-changes';
import { KeysBindings, KeysDetermineChanges } from '@incremunica/context-entries';
import {
  createTestBindingsFactory,
  createTestContextWithDataFactory,
  partialArrayifyAsyncIterator,
  quad,
} from '@incremunica/dev-tools';
import { DataFactory } from 'rdf-data-factory';
import { Factory } from 'sparqlalgebrajs';
import { streamifyArray } from 'streamify-array';
import { ActorQuerySourceIdentifyHypermediaNone } from '../lib';

const DF = new DataFactory();
const AF = new Factory();

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

describe('ActorRdfResolveHypermediaNone', () => {
  let bus: any;
  let BF: BindingsFactory;

  beforeEach(async() => {
    bus = new Bus({ name: 'bus' });
    BF = await createTestBindingsFactory(DF);
  });

  describe('An ActorRdfResolveHypermediaNone instance', () => {
    let actor: ActorQuerySourceIdentifyHypermediaNone;
    let context: IActionContext;
    let mediatorDetermineChanges: MediatorDetermineChanges;
    let mediatorMergeBindingsContext: any;
    let determineChangesEvents: EventEmitter;
    let mediatorFn: jest.Func;

    beforeEach(() => {
      context = createTestContextWithDataFactory(DF);
      determineChangesEvents = new EventEmitter();
      captureEvents(determineChangesEvents, 'modified', 'up-to-date');
      mediatorFn = jest.fn();
      mediatorDetermineChanges = <any> {
        mediate: (action: IActionDetermineChanges) => {
          mediatorFn(action);
          return { determineChangesEvents };
        },
      };
      mediatorMergeBindingsContext = <any> {
        mediate: async(action: any) => {
          return (await new ActorMergeBindingsContextIsAddition({
            bus: new Bus({ name: 'bus' }),
            name: 'actor',
          }).run(<any>{})).mergeHandlers;
        },
      };
      actor = new ActorQuerySourceIdentifyHypermediaNone({
        name: 'actor',
        bus,
        mediatorDetermineChanges,
        mediatorMergeBindingsContext,
      });
    });

    it('should test', async() => {
      const action = <any>{};
      expect((await actor.test(action)).get()).toMatchObject({ filterFactor: 0 });
    });

    it('should run and make a streaming store', async() => {
      const action = <any> {
        context,
        url: 'http://test.com',
        quads: streamifyArray([
          quad('s1', 'p1', 'o1'),
          quad('s2', 'p2', 'o2'),
          quad('s1', 'p1', 'o1', undefined, false),
        ]),
      };
      const result = (await actor.run(action));
      const stream = result.source.queryBindings(
        AF.createPattern(DF.variable('s'), DF.variable('p'), DF.variable('o')),
        new ActionContext(),
      );
      await expect(partialArrayifyAsyncIterator(stream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s2') ],
          [ DF.variable('p'), DF.namedNode('p2') ],
          [ DF.variable('o'), DF.namedNode('o2') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('s'), DF.namedNode('s1') ],
          [ DF.variable('p'), DF.namedNode('p1') ],
          [ DF.variable('o'), DF.namedNode('o1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
    });

    it('should run add a toString to the source', async() => {
      const action = <any> {
        context,
        url: 'http://test.com',
        quads: streamifyArray([]),
      };
      const result = (await actor.run(action));
      expect(result.source.toString()).toBe('ActorQuerySourceIdentifyHypermediaNone(http://test.com)');
    });

    it('should run and add a determine-changes', async() => {
      const action = <any> {
        context,
        url: 'http://test.com',
        quads: streamifyArray([]),
      };
      await actor.run(action);
      expect(mediatorFn).toHaveBeenCalledTimes(1);
    });

    it('should add the determine-changes events to the source', async() => {
      class ActionContextKeyTest implements IActionContextKey<boolean> {
        public readonly name = 'test';
        public readonly dummy: boolean | undefined;
      }

      mediatorFn = jest.fn((action: IActionDetermineChanges) => {
        action.streamingQuerySource.context = (new ActionContext()).set(new ActionContextKeyTest(), true);
      });
      const action = <any> {
        context,
        url: 'http://test.com',
        quads: streamifyArray([]),
      };
      const result = await actor.run(action);
      expect(mediatorFn).toHaveBeenCalledTimes(1);
      expect((<any> result.source).context.get(KeysDetermineChanges.events)).toEqual(determineChangesEvents);
      expect((<any> result.source).context.get(new ActionContextKeyTest())).toBe(true);
    });

    it('should add the determine changes events to the source even if the source has no context', async() => {
      mediatorFn = jest.fn((action: IActionDetermineChanges) => {
        action.streamingQuerySource.context = undefined;
      });
      const action = <any> {
        context,
        url: 'http://test.com',
        quads: streamifyArray([]),
      };
      const result = await actor.run(action);
      expect(mediatorFn).toHaveBeenCalledTimes(1);
      expect((<any> result.source).context.get(KeysDetermineChanges.events)).toEqual(determineChangesEvents);
    });
  });
});
