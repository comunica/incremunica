import type { MediatorHashBindings } from '@comunica/bus-hash-bindings';
import type { MediatorMergeBindingsContext } from '@comunica/bus-merge-bindings-context';
import type { IActionQueryOperation } from '@comunica/bus-query-operation';
import type { IActionRdfJoin, IActorRdfJoinTestSideData } from '@comunica/bus-rdf-join';
import type { IActionRdfJoinEntriesSort, MediatorRdfJoinEntriesSort } from '@comunica/bus-rdf-join-entries-sort';
import type { IActionRdfJoinSelectivity, IActorRdfJoinSelectivityOutput } from '@comunica/bus-rdf-join-selectivity';
import 'jest-rdf';
import { KeysInitQuery, KeysQueryOperation } from '@comunica/context-entries';
import type { Actor, IActorTest, Mediator } from '@comunica/core';
import { failTest, ActionContext, Bus } from '@comunica/core';
import type { BindingsStream, IActionContext, IQueryOperationResultBindings } from '@comunica/types';
import type { BindingsFactory } from '@comunica/utils-bindings-factory';
import { MetadataValidationState } from '@comunica/utils-metadata';
import { KeysBindings, KeysStreamingSource } from '@incremunica/context-entries';
import {
  createTestBindingsFactory,
  createTestMediatorMergeBindingsContext,
  createTestMediatorHashBindings,
  createTestContextWithDataFactory,
  partialArrayifyStream,
} from '@incremunica/dev-tools';
import { arrayifyStream } from 'arrayify-stream';
import { ArrayIterator, WrappingIterator } from 'asynciterator';
import { promisifyEventEmitter } from 'event-emitter-promisify/dist';
import { DataFactory } from 'rdf-data-factory';
import type { Stream } from 'readable-stream';
import { PassThrough } from 'readable-stream';
import { Algebra, Factory } from 'sparqlalgebrajs';
import { streamifyArray } from 'streamify-array';
import {
  ActorRdfJoinInnerComputationalBind,
} from '../lib';
import '@comunica/utils-jest';
import '@incremunica/jest';

const DF = new DataFactory();
const FACTORY = new Factory(DF);

describe('ActorRdfJoinComputationalBind', () => {
  let bus: any;
  let BF: BindingsFactory;

  beforeEach(async() => {
    bus = new Bus({ name: 'bus' });
    BF = await createTestBindingsFactory(DF);
  });

  describe('An ActorRdfJoinComputationalBind instance', () => {
    let mediatorJoinSelectivity: Mediator<
      Actor<IActionRdfJoinSelectivity, IActorTest, IActorRdfJoinSelectivityOutput>,
      IActionRdfJoinSelectivity,
      IActorTest,
      IActorRdfJoinSelectivityOutput
      >;
    let mediatorJoinEntriesSort: MediatorRdfJoinEntriesSort;
    let context: IActionContext;
    let mediatorQueryOperation: Mediator<
      Actor<IActionQueryOperation, IActorTest, IQueryOperationResultBindings>,
      IActionQueryOperation,
      IActorTest,
      IQueryOperationResultBindings
    >;
    let mediatorMergeBindingsContext: MediatorMergeBindingsContext;
    let mediatorHashBindings: MediatorHashBindings;
    let actor: ActorRdfJoinInnerComputationalBind;
    let haltFn: () => void;
    let resumeFn: () => void;

    beforeEach(() => {
      mediatorJoinSelectivity = <any> {
        mediate: async() => ({ selectivity: 0.8 }),
      };
      mediatorJoinEntriesSort = <any> {
        async mediate(action: IActionRdfJoinEntriesSort) {
          const entries = [ ...action.entries ]
            .sort((left, right) => left.metadata.cardinality.value - right.metadata.cardinality.value);
          return { entries };
        },
      };
      haltFn = jest.fn();
      resumeFn = jest.fn();
      context = createTestContextWithDataFactory(DF);
      context = context.set(KeysQueryOperation.querySources, [ <any>{
        source: {
          resume: resumeFn,
          halt: haltFn,
        },
        context: <any>{},
      } ]);
      mediatorQueryOperation = <any> {
        mediate: jest.fn(async(_arg: IActionQueryOperation): Promise<IQueryOperationResultBindings> => {
          return {
            bindingsStream: new ArrayIterator([
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
              ]),
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
              ]),
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
              ]).setContextEntry(KeysBindings.isAddition, true),
            ], { autoStart: false }),
            metadata: () => Promise.resolve({
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 3 },
              variables: [{
                variable: DF.variable('bound'),
                canBeUndef: false,
              }],
            }),
            type: 'bindings',
          };
        }),
      };
      mediatorMergeBindingsContext = createTestMediatorMergeBindingsContext();
      mediatorHashBindings = createTestMediatorHashBindings();
      actor = new ActorRdfJoinInnerComputationalBind({
        name: 'actor',
        bus,
        selectivityModifier: 0.1,
        mediatorQueryOperation,
        mediatorJoinSelectivity,
        mediatorJoinEntriesSort,
        mediatorMergeBindingsContext,
        mediatorHashBindings,
      });
    });

    describe('getJoinCoefficients', () => {
      let action: IActionRdfJoin;
      let sideData: IActorRdfJoinTestSideData;
      beforeEach(async() => {
        action = {
          type: 'inner',
          entries: [
            {
              output: <any>{},
              operation: FACTORY.createNop(),
            },
            {
              output: <any>{},
              operation: FACTORY.createNop(),
            },
            {
              output: <any>{},
              operation: FACTORY.createNop(),
            },
          ],
          context,
        };
        sideData = {
          metadatas: [
            {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 3 },
              pageSize: 100,
              requestTime: 10,
              variables: [{
                variable: DF.variable('a'),
                canBeUndef: false,
              }],
            },
            {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 2 },
              pageSize: 100,
              requestTime: 20,
              variables: [{
                variable: DF.variable('a'),
                canBeUndef: false,
              }],
            },
            {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 5 },
              pageSize: 100,
              requestTime: 30,
              variables: [{
                variable: DF.variable('a'),
                canBeUndef: false,
              }],
            },
          ],
        };
      });

      it('should fail if sort fails', async() => {
        jest.spyOn(actor, 'sortJoinEntries').mockResolvedValue(failTest('test message'));
        const joinCoefficients = await actor.getJoinCoefficients(action, sideData);
        expect(actor.sortJoinEntries).toHaveBeenCalledTimes(1);
        expect(joinCoefficients).toFailTest('test message');
      });

      it('should fail if source can\'t halt', async() => {
        action.context = action.context.set(KeysQueryOperation.querySources, [ <any>{
          source: {
            resume: resumeFn,
          },
          context: <any>{},
        } ]);
        const joinCoefficients = await actor.getJoinCoefficients(action, sideData);
        expect(joinCoefficients).toFailTest('A source can\'t halt or resume');
      });

      it('should fail if source can\'t resume', async() => {
        action.context = action.context.set(KeysQueryOperation.querySources, [ <any>{
          source: {
            halt: haltFn,
          },
          context: <any>{},
        } ]);
        const joinCoefficients = await actor.getJoinCoefficients(action, sideData);
        expect(joinCoefficients).toFailTest('A source can\'t halt or resume');
      });

      it('should handle three entries', async() => {
        const joinCoefficients = await actor.getJoinCoefficients(action, sideData);
        expect(joinCoefficients.isPassed()).toBeTruthy();
        expect(joinCoefficients.get()).toEqual({
          iterations: 0,
          persistedItems: 0,
          blockingItems: 0,
          requestTime: 0,
        });
        expect(joinCoefficients.getSideData().entriesUnsorted.map(entry => entry.metadata.cardinality.value))
          .toEqual([ 3, 2, 5 ]);
        expect(joinCoefficients.getSideData().entriesSorted.map(entry => entry.metadata.cardinality.value))
          .toEqual([ 2, 3, 5 ]);
        expect(joinCoefficients.getSideData().remainingEntries.map(entry => entry.metadata.cardinality.value))
          .toEqual([ 3, 5 ]);
        expect(joinCoefficients.getSideData().streamingQuerySources).toEqual([{
          halt: haltFn,
          resume: resumeFn,
        }]);
      });

      it('should handle three entries with a lower variable overlap', async() => {
        await expect(actor.getJoinCoefficients(
          {
            type: 'inner',
            entries: [
              {
                output: <any>{},
                operation: FACTORY.createNop(),
              },
              {
                output: <any>{},
                operation: FACTORY.createNop(),
              },
              {
                output: <any>{},
                operation: FACTORY.createNop(),
              },
            ],
            context,
          },
          {
            metadatas: [
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                pageSize: 100,
                requestTime: 10,
                variables: [
                  {
                    canBeUndef: false,
                    variable: DF.variable('a'),
                  },
                  {
                    canBeUndef: false,
                    variable: DF.variable('b'),
                  },
                ],
              },
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                pageSize: 100,
                requestTime: 20,
                variables: [
                  {
                    canBeUndef: false,
                    variable: DF.variable('a'),
                  },
                  {
                    canBeUndef: false,
                    variable: DF.variable('b'),
                  },
                ],
              },
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 5 },
                pageSize: 100,
                requestTime: 30,
                variables: [
                  {
                    canBeUndef: false,
                    variable: DF.variable('a'),
                  },
                  {
                    canBeUndef: false,
                    variable: DF.variable('b'),
                  },
                ],
              },
            ],
          },
        )).resolves.toPassTest({
          iterations: 0,
          persistedItems: 0,
          blockingItems: 0,
          requestTime: 0,
        });
      });

      it('should reject on a right stream of type extend', async() => {
        await expect(actor.getJoinCoefficients(
          {
            type: 'inner',
            entries: [
              {
                output: <any>{
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 3 },
                    variables: [{
                      canBeUndef: false,
                      variable: DF.variable('a'),
                    }],
                  }),
                },
                operation: <any>{ type: Algebra.types.EXTEND },
              },
              {
                output: <any>{
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 2 },
                    variables: [{
                      canBeUndef: false,
                      variable: DF.variable('a'),
                    }],
                  }),
                },
                operation: <any>{},
              },
            ],
            context,
          },
          {
            metadatas: [
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                pageSize: 100,
                requestTime: 10,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                pageSize: 100,
                requestTime: 20,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            ],
          },
        )).resolves.toFailTest('Actor actor can not bind on Extend and Group operations');
      });

      it('should reject on a right stream of type group', async() => {
        await expect(actor.getJoinCoefficients(
          {
            type: 'inner',
            entries: [
              {
                output: <any> {},
                operation: <any> { type: Algebra.types.GROUP },
              },
              {
                output: <any> {},
                operation: <any> {},
              },
            ],
            context,
          },
          {
            metadatas: [
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                pageSize: 100,
                requestTime: 10,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                pageSize: 100,
                requestTime: 20,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            ],
          },
        )).resolves.toFailTest('Actor actor can not bind on Extend and Group operations');
      });

      it('should not reject on a left stream of type group', async() => {
        await expect(actor.getJoinCoefficients(
          {
            type: 'inner',
            entries: [
              {
                output: <any> {},
                operation: FACTORY.createNop(),
              },
              {
                output: <any> {},
                operation: <any> { type: Algebra.types.GROUP },
              },
            ],
            context,
          },
          {
            metadatas: [
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                pageSize: 100,
                requestTime: 10,
                canContainUndefs: false,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
              {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                pageSize: 100,
                requestTime: 20,
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            ],
          },
        )).resolves.toPassTest({
          iterations: 0,
          persistedItems: 0,
          blockingItems: 0,
          requestTime: 0,
        });
      });
    });

    describe('sortJoinEntries', () => {
      it('sorts 2 entries', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
          context,
        )).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
        });
      });

      it('sorts 3 entries', async() => {
        await expect(actor.sortJoinEntries([
          {
            output: <any> {},
            operation: <any> {},
            metadata: {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 3 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('a'),
              }],
            },
          },
          {
            output: <any> {},
            operation: <any> {},
            metadata: {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 2 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('a'),
              }],
            },
          },
          {
            output: <any> {},
            operation: <any> {},
            metadata: {
              state: new MetadataValidationState(),
              cardinality: { type: 'estimate', value: 5 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('a'),
              }],
            },
          },
        ], context)).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 5 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
        });
      });

      it('sorts 3 equal entries', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
          context,
        )).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
        });
      });

      it('does not sort if there is an undef', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 5 },
                variables: [{
                  canBeUndef: true,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
          context,
        )).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 5 },
                variables: [{
                  canBeUndef: true,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
        });
      });

      it('throws if there are no overlapping variables', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a1'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('b1'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a2'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('b2'),
                }],
              },
            },
          ],
          context,
        )).resolves.toFailTest('Bind join can only join entries with at least one common variable');
      });

      it('sorts entries without common variables in the back', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 1 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
          context,
        )).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 1 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
            },
          ],
        });
      });

      it('sorts several entries without variables in the back', async() => {
        await expect(actor.sortJoinEntries(
          [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 1 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 20 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 20 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('c'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 10 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('d'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 10 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
          ],
          context,
        )).resolves.toEqual({
          value: [
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 2 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 10 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 20 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 1 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 10 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('d'),
                }],
              },
            },
            {
              output: <any> {},
              operation: <any> {},
              metadata: {
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 20 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('c'),
                }],
              },
            },
          ],
        });
      });
    });

    describe('getOutput', () => {
      it('should handle two entries without context', async() => {
        const action: IActionRdfJoin = {
          type: 'inner',
          entries: [
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b1') ],
                  ]),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b2') ],
                  ]),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b3') ],
                  ]),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 3 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('b'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
            },
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('a'), DF.namedNode('ex:a1') ],
                  ]),
                  BF.bindings([
                    [ DF.variable('a'), DF.namedNode('ex:a2') ],
                  ]),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 1 },
                  variables: [{
                    variable: DF.variable('a'),
                    canBeUndef: false,
                  }],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.namedNode('ex:o')),
            },
          ],
          context,
        };
        const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

        // Validate output
        expect(result.type).toBe('bindings');
        await expect(arrayifyStream(result.bindingsStream)).resolves.toBeIsomorphicBindingsArray([
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        await expect(result.metadata()).resolves.toEqual({
          state: new MetadataValidationState(),
          cardinality: { type: 'estimate', value: 2.400_000_000_000_000_4 },
          variables: [{
            canBeUndef: false,
            variable: DF.variable('a'),
          }, {
            canBeUndef: false,
            variable: DF.variable('b'),
          }],
        });
      });

      it('should handle three entries', async() => {
        const action: IActionRdfJoin = {
          context,
          type: 'inner',
          entries: [
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b2') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b3') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 3 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('b'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
            },
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('c'), DF.namedNode('ex:c1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('c'), DF.namedNode('ex:c2') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('c'), DF.namedNode('ex:c3') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 4 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('c'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.variable('c')),
            },
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('a'), DF.namedNode('ex:a1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('a'), DF.namedNode('ex:a2') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 1 },
                  variables: [{
                    variable: DF.variable('a'),
                    canBeUndef: false,
                  }],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.namedNode('ex:o')),
            },
          ],
        };
        const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

        // Validate output
        expect(result.type).toBe('bindings');
        await expect(arrayifyStream(result.bindingsStream)).resolves.toBeIsomorphicBindingsArray([
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a2') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        await expect(result.metadata()).resolves.toEqual({
          state: new MetadataValidationState(),
          cardinality: { type: 'estimate', value: 9.600_000_000_000_001 },
          variables: [
            {
              canBeUndef: false,
              variable: DF.variable('a'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('b'),
            },
            {
              canBeUndef: false,
              variable: DF.variable('c'),
            },
          ],
        });

        // Validate mock calls
        expect(mediatorQueryOperation.mediate).toHaveBeenCalledTimes(2);
        expect(mediatorQueryOperation.mediate).toHaveBeenNthCalledWith(1, {
          operation: FACTORY.createJoin([
            FACTORY.createPattern(DF.namedNode('ex:a1'), DF.namedNode('ex:p1'), DF.variable('b')),
            FACTORY.createPattern(DF.namedNode('ex:a1'), DF.namedNode('ex:p2'), DF.variable('c')),
          ]),
          context: new ActionContext({
            [KeysQueryOperation.querySources.name]: expect.any(Object),
            [KeysInitQuery.dataFactory.name]: expect.any(DataFactory),
            [KeysStreamingSource.matchOptions.name]: [],
            [KeysQueryOperation.joinLeftMetadata.name]: {
              state: expect.any(MetadataValidationState),
              cardinality: { type: 'estimate', value: 1 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('a'),
              }],
            },
            [KeysQueryOperation.joinRightMetadatas.name]: [
              {
                state: expect.any(MetadataValidationState),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
              {
                state: expect.any(MetadataValidationState),
                cardinality: { type: 'estimate', value: 4 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('c'),
                }],
              },
            ],
            [KeysQueryOperation.joinBindings.name]: BF.bindings([
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          }),
        });
        expect(mediatorQueryOperation.mediate).toHaveBeenNthCalledWith(2, {
          operation: FACTORY.createJoin([
            FACTORY.createPattern(DF.namedNode('ex:a2'), DF.namedNode('ex:p1'), DF.variable('b')),
            FACTORY.createPattern(DF.namedNode('ex:a2'), DF.namedNode('ex:p2'), DF.variable('c')),
          ]),
          context: new ActionContext({
            [KeysQueryOperation.querySources.name]: expect.any(Object),
            [KeysInitQuery.dataFactory.name]: expect.any(DataFactory),
            [KeysStreamingSource.matchOptions.name]: [],
            [KeysQueryOperation.joinLeftMetadata.name]: {
              state: expect.any(MetadataValidationState),
              cardinality: { type: 'estimate', value: 1 },
              variables: [{
                canBeUndef: false,
                variable: DF.variable('a'),
              }],
            },
            [KeysQueryOperation.joinRightMetadatas.name]: [
              {
                state: expect.any(MetadataValidationState),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('b'),
                }],
              },
              {
                state: expect.any(MetadataValidationState),
                cardinality: { type: 'estimate', value: 4 },
                variables: [{
                  canBeUndef: false,
                  variable: DF.variable('a'),
                }, {
                  canBeUndef: false,
                  variable: DF.variable('c'),
                }],
              },
            ],
            [KeysQueryOperation.joinBindings.name]: BF.bindings([
              [ DF.variable('a'), DF.namedNode('ex:a2') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          }),
        });
      });

      it('should handle two entries with one wrong binding (should not happen)', async() => {
        const action: IActionRdfJoin = {
          type: 'inner',
          entries: [
            {
              output: <any> {
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b2') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b3') ],
                  ]),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 4 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('b'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
            },
            {
              output: <any> {
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('bound'), DF.namedNode('ex:bound4') ],
                    [ DF.variable('a'), DF.namedNode('ex:a1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 1 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('bound'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.variable('bound')),
            },
          ],
          context,
        };
        const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

        // Validate output
        await expect(arrayifyStream(result.bindingsStream)).resolves.toBeIsomorphicBindingsArray([]);
      });

      it('should work if the active iterator ends first', async() => {
        let iterator: BindingsStream;
        const closeJest = jest.fn();
        const streams: PassThrough[] = [];
        let num = 0;

        mediatorQueryOperation = <any>{
          mediate: jest.fn(async(arg: IActionQueryOperation): Promise<IQueryOperationResultBindings> => {
            const unionStream = new PassThrough({ objectMode: true });
            const tempStream: Stream = streamifyArray([
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
              ]).setContextEntry(KeysBindings.isAddition, true),
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
              ]).setContextEntry(KeysBindings.isAddition, true),
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
              ]).setContextEntry(KeysBindings.isAddition, true),
            ]);
            tempStream.pipe(unionStream, { end: false });

            const stream = new PassThrough({
              objectMode: true,
            });
            stream.pipe(unionStream, { end: false });
            streams.push(stream);

            let tempEnd = false;
            let streamEnd = false;

            tempStream.on('close', () => {
              tempEnd = true;
              if (streamEnd) {
                unionStream.end();
              }
            });

            stream.on('close', () => {
              streamEnd = true;
              if (tempEnd) {
                unionStream.end();
              }
            });

            iterator = new WrappingIterator(unionStream);

            const streamNum = num;
            num++;
            const closefn = () => {
              if (streamNum === 0) {
                iterator.close();
                iterator.on('end', () => {
                  for (const streami of streams) {
                    if (!streami.closed) {
                      streami.end();
                    }
                  }
                });
              }
              closeJest();
            };
            const matchOptions = arg.context.get(KeysStreamingSource.matchOptions);
            expect(matchOptions).toBeDefined();
            if (matchOptions !== undefined) {
              (<({ closeStream: () => void })[]>matchOptions).push({
                closeStream: closefn,
              });
            }
            return {
              bindingsStream: iterator,
              metadata: () => Promise.resolve({
                state: new MetadataValidationState(),
                cardinality: { type: 'estimate', value: 3 },
                variables: [{
                  variable: DF.variable('bound'),
                  canBeUndef: false,
                }],
              }),
              type: 'bindings',
            };
          }),
        };

        actor = new ActorRdfJoinInnerComputationalBind({
          name: 'actor',
          bus,
          selectivityModifier: 0.1,
          mediatorQueryOperation,
          mediatorJoinSelectivity,
          mediatorJoinEntriesSort,
          mediatorMergeBindingsContext,
          mediatorHashBindings,
        });

        const tempStream: Stream = streamifyArray([
          BF.bindings([
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);
        const alteringStream = tempStream.pipe(new PassThrough({
          objectMode: true,
        }), { end: false });
        const wrapIterator = new WrappingIterator(alteringStream);

        const action: IActionRdfJoin = {
          type: 'inner',
          entries: [
            {
              output: <any>{
                bindingsStream: new ArrayIterator([
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b1') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b2') ],
                  ]).setContextEntry(KeysBindings.isAddition, true),
                  BF.bindings([
                    [ DF.variable('b'), DF.namedNode('ex:b3') ],
                  ]),
                ], { autoStart: false }),
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 4 },
                  variables: [
                    {
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    },
                    {
                      variable: DF.variable('b'),
                      canBeUndef: false,
                    },
                  ],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
            },
            {
              output: <any>{
                bindingsStream: wrapIterator,
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 1 },
                  variables: [{
                    variable: DF.variable('a'),
                    canBeUndef: false,
                  }],
                }),
                type: 'bindings',
              },
              operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.namedNode('ex:o')),
            },
          ],
          context,
        };

        const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

        await expect(partialArrayifyStream(result.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, true),
        ]);

        alteringStream.push(
          BF.bindings([
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, false),
        );

        await expect(partialArrayifyStream(result.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([
            [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
            [ DF.variable('a'), DF.namedNode('ex:a1') ],
          ]).setContextEntry(KeysBindings.isAddition, false),
        ]);

        alteringStream.end();

        await promisifyEventEmitter(result.bindingsStream);

        expect(haltFn).toHaveBeenCalledTimes(1);
        expect(resumeFn).toHaveBeenCalledTimes(1);
        expect(closeJest).toHaveBeenCalledTimes(2);
      });

      describe('with mock store', () => {
        let iterator: BindingsStream;
        let closeJest: () => void;
        const streams: PassThrough[] = [];

        beforeEach(() => {
          closeJest = jest.fn();

          mediatorQueryOperation = <any> {
            mediate: jest.fn(async(arg: IActionQueryOperation): Promise<IQueryOperationResultBindings> => {
              const unionStream = new PassThrough({ objectMode: true });
              const tempStream: Stream = streamifyArray([
                BF.bindings([
                  [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
                ]).setContextEntry(KeysBindings.isAddition, true),
                BF.bindings([
                  [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
                ]).setContextEntry(KeysBindings.isAddition, true),
                BF.bindings([
                  [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
                ]).setContextEntry(KeysBindings.isAddition, true),
              ]);
              tempStream.pipe(unionStream, { end: false });

              const stream = new PassThrough({
                objectMode: true,
              });
              stream.pipe(unionStream, { end: false });
              streams.push(stream);

              let tempEnd = false;
              let streamEnd = false;

              tempStream.on('close', () => {
                tempEnd = true;
                if (streamEnd) {
                  unionStream.end();
                }
              });

              stream.on('close', () => {
                streamEnd = true;
                if (tempEnd) {
                  unionStream.end();
                }
              });

              iterator = new WrappingIterator(unionStream);

              const closefn = () => {
                stream.end();
                closeJest();
              };
              const matchOptions = arg.context.get(KeysStreamingSource.matchOptions);

              if (matchOptions !== undefined) {
                (<({ closeStream: () => void })[]> matchOptions).push({
                  closeStream: closefn,
                });
              }
              return {
                bindingsStream: iterator,
                metadata: () => Promise.resolve({
                  state: new MetadataValidationState(),
                  cardinality: { type: 'estimate', value: 3 },
                  variables: [{
                    variable: DF.variable('bound'),
                    canBeUndef: false,
                  }],
                }),
                type: 'bindings',
              };
            }),
          };

          actor = new ActorRdfJoinInnerComputationalBind({
            name: 'actor',
            bus,
            selectivityModifier: 0.1,
            mediatorQueryOperation,
            mediatorJoinSelectivity,
            mediatorJoinEntriesSort,
            mediatorMergeBindingsContext,
            mediatorHashBindings,
          });
        });

        it('should handle entries', async() => {
          const action: IActionRdfJoin = {
            type: 'inner',
            entries: [
              {
                output: <any>{
                  bindingsStream: new ArrayIterator([
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b1') ],
                    ]).setContextEntry(KeysBindings.isAddition, true),
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b2') ],
                    ]).setContextEntry(KeysBindings.isAddition, true),
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b3') ],
                    ]),
                  ], { autoStart: false }),
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 4 },
                    variables: [
                      {
                        variable: DF.variable('a'),
                        canBeUndef: false,
                      },
                      {
                        variable: DF.variable('b'),
                        canBeUndef: false,
                      },
                    ],
                  }),
                  type: 'bindings',
                },
                operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
              },
              {
                output: <any>{
                  bindingsStream: new ArrayIterator([
                    BF.bindings([
                      [ DF.variable('a'), DF.namedNode('ex:a1') ],
                    ]).setContextEntry(KeysBindings.isAddition, true),
                  ]),
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 1 },
                    variables: [{
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    }],
                  }),
                  type: 'bindings',
                },
                operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.namedNode('ex:o')),
              },
            ],
            context,
          };

          const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

          await expect(partialArrayifyStream(result.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          ]);

          for (const stream of streams) {
            stream.push(
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound4') ],
              ]),
            );
          }

          await expect(partialArrayifyStream(result.bindingsStream, 1)).resolves.toBeIsomorphicBindingsArray([
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound4') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          ]);
          expect(haltFn).toHaveBeenCalledTimes(0);
          expect(resumeFn).toHaveBeenCalledTimes(0);

          for (const stream of streams) {
            stream.push(
              BF.bindings([
                [ DF.variable('bound'), DF.namedNode('ex:bound4') ],
              ]).setContextEntry(KeysBindings.isAddition, false),
            );
          }

          await expect(partialArrayifyStream(result.bindingsStream, 1)).resolves.toBeIsomorphicBindingsArray([
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound4') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
          ]);
          expect(haltFn).toHaveBeenCalledTimes(0);
          expect(resumeFn).toHaveBeenCalledTimes(0);
          expect(closeJest).toHaveBeenCalledTimes(0);
        });

        it('should handle entries with too many deletions', async() => {
          const tempStream: Stream = streamifyArray([
            BF.bindings([
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          ]);
          const alteringStream = tempStream.pipe(new PassThrough({
            objectMode: true,
          }), { end: false });
          const iterator = new WrappingIterator(alteringStream);

          const action: IActionRdfJoin = {
            type: 'inner',
            entries: [
              {
                output: <any>{
                  bindingsStream: new ArrayIterator([
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b1') ],
                    ]).setContextEntry(KeysBindings.isAddition, true),
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b2') ],
                    ]).setContextEntry(KeysBindings.isAddition, true),
                    BF.bindings([
                      [ DF.variable('b'), DF.namedNode('ex:b3') ],
                    ]),
                  ], { autoStart: false }),
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 4 },
                    variables: [
                      {
                        variable: DF.variable('a'),
                        canBeUndef: false,
                      },
                      {
                        variable: DF.variable('b'),
                        canBeUndef: false,
                      },
                    ],
                  }),
                  type: 'bindings',
                },
                operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p1'), DF.variable('b')),
              },
              {
                output: <any>{
                  bindingsStream: iterator,
                  metadata: () => Promise.resolve({
                    state: new MetadataValidationState(),
                    cardinality: { type: 'estimate', value: 1 },
                    variables: [{
                      variable: DF.variable('a'),
                      canBeUndef: false,
                    }],
                  }),
                  type: 'bindings',
                },
                operation: FACTORY.createPattern(DF.variable('a'), DF.namedNode('ex:p2'), DF.namedNode('ex:o')),
              },
            ],
            context,
          };

          const { result } = await actor.getOutput(action, <any>(await actor.test(action)).getSideData());

          await expect(partialArrayifyStream(result.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, true),
          ]);

          alteringStream.push(
            BF.bindings([
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
          );

          await expect(partialArrayifyStream(result.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound1') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound2') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
            BF.bindings([
              [ DF.variable('bound'), DF.namedNode('ex:bound3') ],
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
          ]);

          alteringStream.push(
            BF.bindings([
              [ DF.variable('a'), DF.namedNode('ex:a1') ],
            ]).setContextEntry(KeysBindings.isAddition, false),
          );

          const promisses = [];
          alteringStream.end();
          for (const stream of streams) {
            if (!stream.closed) {
              stream.end();
              promisses.push(promisifyEventEmitter(stream));
            }
          }
          await Promise.all(promisses);

          await expect(arrayifyStream(result.bindingsStream)).resolves.toBeIsomorphicBindingsArray([

          ]);

          expect(haltFn).toHaveBeenCalledTimes(1);
          expect(resumeFn).toHaveBeenCalledTimes(1);
          expect(closeJest).toHaveBeenCalledTimes(2);
        });
      });
    });
  });
});
