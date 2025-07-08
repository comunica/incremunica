import type { MediatorHashBindings } from '@comunica/bus-hash-bindings';
import type { MediatorMergeBindingsContext } from '@comunica/bus-merge-bindings-context';
import type { MediatorQueryOperation } from '@comunica/bus-query-operation';
import type {
  IActionRdfJoin,
  IActorRdfJoinOutputInner,
  IActorRdfJoinArgs,
  IActorRdfJoinTestSideData,
} from '@comunica/bus-rdf-join';
import { ActorRdfJoin } from '@comunica/bus-rdf-join';
import type { MediatorRdfJoinEntriesSort } from '@comunica/bus-rdf-join-entries-sort';
import { KeysInitQuery, KeysQueryOperation } from '@comunica/context-entries';
import type { TestResult } from '@comunica/core';
import { failTest, passTest, passTestWithSideData } from '@comunica/core';
import type { IMediatorTypeJoinCoefficients } from '@comunica/mediatortype-join-coefficients';
import type {
  BindingsStream,
  IQueryOperationResultBindings,
  IActionContext,
  IJoinEntryWithMetadata,
  ComunicaDataFactory,
} from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { materializeOperation, getSafeBindings } from '@comunica/utils-query-operation';
import { KeysBindings } from '@incremunica/context-entries';
import type * as RDF from '@rdfjs/types';
import {
  ArrayIterator,
  EmptyIterator,
  UnionIterator,
} from 'asynciterator';
import type { AsyncIterator } from 'asynciterator';
import { Factory, Algebra, Util } from 'sparqlalgebrajs';

/**
 * A comunica Multi-way Bind RDF Join Actor.
 */
export class ActorRdfJoinInnerMemoryBind extends ActorRdfJoin {
  public readonly selectivityModifier: number;
  public readonly mediatorJoinEntriesSort: MediatorRdfJoinEntriesSort;
  public readonly mediatorQueryOperation: MediatorQueryOperation;
  public readonly mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  public readonly mediatorHashBindings: MediatorHashBindings;

  public constructor(args: IActorRdfJoinInnerMemoryMultiBindArgs) {
    super(args, {
      logicalType: 'inner',
      physicalName: 'bind',
      canHandleUndefs: true,
    });
  }

  /**
   * Create a new bindings stream that takes every binding of the base stream
   * and binds it to the remaining patterns, evaluates those patterns, and emits all their bindings.
   *
   * @param baseStream The base stream.
   * @param operations The operations to bind with each binding of the base stream.
   * @param operationBinder A callback to retrieve the bindings stream of bound operations.
   * @param optional If the original bindings should be emitted when the resulting bindings stream is empty.
   * @param algebraFactory The algebra factory.
   * @param bindingsFactory The bindingsFactory created with bindings context merger.
   * @param hashInputBindings
   * @param hashOutputBindings
   * @return {AsyncIterator<Bindings>}
   */
  public static async createBindStream(
    baseStream: AsyncIterator<Bindings>,
    operations: Algebra.Operation[],
    operationBinder: (boundOperations: Algebra.Operation[], operationBindings: Bindings)
    => Promise<AsyncIterator<Bindings>>,
    optional: boolean,
    algebraFactory: Factory,
    bindingsFactory: BindingsFactory,
    hashInputBindings: (bindings: Bindings) => number,
    hashOutputBindings: (bindings: Bindings) => number,
  ): Promise<AsyncIterator<Bindings>> {
    const transformMap = new Map<
      number,
      {
        iterator: AsyncIterator<Bindings>;
        memory: Map<
          number,
          {
            bindings: Bindings;
            count: number;
          }
        >;
        count: number;
      }
    >();
    // Create bindings function
    const binder = (bindings: Bindings, done: () => void, push: (i: AsyncIterator<Bindings>) => void): void => {
      const hash = hashInputBindings(bindings);
      if (bindings.getContextEntry(KeysBindings.isAddition) ?? true) {
        const hashData = transformMap.get(hash);
        if (hashData === undefined) {
          const data = {
            iterator: new EmptyIterator<Bindings>(),
            memory: new Map<number, { bindings: Bindings; count: number }>(),
            count: 1,
          };
          transformMap.set(hash, data);

          // We don't bind the filter because filters are always handled last,
          // and we need to avoid binding filters of sub-queries, which are to be handled first. (see spec test bind10)
          const subOperations = operations
            .map(operation => materializeOperation(
              operation,
              bindings,
              algebraFactory,
              bindingsFactory,
              { bindFilter: false },
            ));

          const transformFunc = (subBindings: Bindings, subDone: () => void, subPush: (i: Bindings) => void): void => {
            const newBindings = subBindings.merge(bindings);
            if (newBindings === undefined) {
              subDone();
              return;
            }
            const bindingsHash = hashOutputBindings(newBindings);
            const bindingsData = data.memory.get(bindingsHash);
            if (newBindings.getContextEntry(KeysBindings.isAddition) ?? true) {
              if (bindingsData === undefined) {
                data.memory.set(bindingsHash, { bindings: newBindings, count: 1 });
              } else {
                bindingsData.count++;
              }
              for (let i = 0; i < data.count; i++) {
                subPush(newBindings);
              }
            } else if (bindingsData !== undefined) {
              if (bindingsData.count > 1) {
                bindingsData.count--;
              } else {
                data.memory.delete(bindingsHash);
              }
              for (let i = 0; i < data.count; i++) {
                subPush(newBindings);
              }
            }
            subDone();
          };

          // eslint-disable-next-line ts/no-floating-promises
          operationBinder(subOperations, bindings).then((bindingStream) => {
            const transformIterator = bindingStream.transform({
              transform: transformFunc,
            });

            data.iterator = transformIterator;

            push(transformIterator);
            done();
          });
        } else {
          hashData.count++;
          push(new ArrayIterator(hashData.memory.values()).transform({
            transform(item, arrayDone, arrayPush) {
              for (let i = 0; i < item.count; i++) {
                arrayPush(item.bindings);
              }
              arrayDone();
            },
          }));
          done();
        }
      } else {
        const hashData = transformMap.get(hash);
        if (hashData !== undefined) {
          if (hashData.count < 2) {
            hashData.iterator.close();
            hashData.count = 0;
            transformMap.delete(hash);
          } else {
            hashData.count--;
          }
          if (hashData.memory.size > 0) {
            push(new ArrayIterator(hashData.memory.values()).transform({
              transform(item, arrayDone, arrayPush) {
                const transformBindings = item.bindings.setContextEntry(KeysBindings.isAddition, false);
                for (let i = 0; i < item.count; i++) {
                  arrayPush(transformBindings);
                }
                arrayDone();
              },
            }));
          }
        }
        done();
      }
    };

    return new UnionIterator(baseStream.transform({
      transform: binder,
      optional,
    }), { autoStart: false });
  }

  /**
   * Order the given join entries using the join-entries-sort bus.
   * @param {IJoinEntryWithMetadata[]} entries An array of join entries.
   * @param context The action context.
   * @return {IJoinEntryWithMetadata[]} The sorted join entries.
   */
  public async sortJoinEntries(
    entries: IJoinEntryWithMetadata[],
    context: IActionContext,
  ): Promise<TestResult<IJoinEntryWithMetadata[]>> {
    // If there is a stream that can contain undefs, we don't modify the join order.
    const hasUndefVars = entries.some(entry => entry.metadata.variables.some(variable => variable.canBeUndef));
    if (hasUndefVars) {
      return passTest(entries);
    }

    // Calculate number of occurrences of each variable
    const variableOccurrences: Record<string, number> = {};
    for (const entry of entries) {
      for (const metadataVariable of entry.metadata.variables) {
        let counter = variableOccurrences[metadataVariable.variable.value];
        if (!counter) {
          counter = 0;
        }
        variableOccurrences[metadataVariable.variable.value] = ++counter;
      }
    }

    // Determine variables that occur in at least two join entries
    const multiOccurrenceVariables: string[] = [];
    for (const [ variable, count ] of Object.entries(variableOccurrences)) {
      if (count >= 2) {
        multiOccurrenceVariables.push(variable);
      }
    }

    // Reject if no entries have common variables
    if (multiOccurrenceVariables.length === 0) {
      return failTest(`Bind join can only join entries with at least one common variable`);
    }

    // Determine entries without common variables
    // These will be placed in the back of the sorted array
    const entriesWithoutCommonVariables: IJoinEntryWithMetadata[] = [];
    for (const entry of entries) {
      let hasCommon = false;
      for (const metadataVariable of entry.metadata.variables) {
        if (multiOccurrenceVariables.includes(metadataVariable.variable.value)) {
          hasCommon = true;
          break;
        }
      }
      if (!hasCommon) {
        entriesWithoutCommonVariables.push(entry);
      }
    }

    return passTest((await this.mediatorJoinEntriesSort.mediate({ entries, context })).entries
      .sort((entryLeft, entryRight) => {
        // Sort to make sure that entries without common variables come last in the array.
        // For all other entries, the original order is kept.
        const leftWithoutCommonVariables = entriesWithoutCommonVariables.includes(entryLeft);
        const rightWithoutCommonVariables = entriesWithoutCommonVariables.includes(entryRight);
        if (leftWithoutCommonVariables === rightWithoutCommonVariables) {
          return 0;
        }
        return leftWithoutCommonVariables ?
          1 :
            -1;
      }));
  }

  public async getOutput(
    action: IActionRdfJoin,
    sideData: IActorRdfJoinMemoryMultiBindTestSideData,
  ): Promise<IActorRdfJoinOutputInner> {
    const dataFactory: ComunicaDataFactory = action.context.getSafe(KeysInitQuery.dataFactory);
    const algebraFactory = new Factory(dataFactory);
    const bindingsFactory = await BindingsFactory.create(
      this.mediatorMergeBindingsContext,
      action.context,
      dataFactory,
    );

    const { hashFunction } = await this.mediatorHashBindings.mediate({ context: action.context });

    for (const [ i, element ] of sideData.entriesSorted.entries()) {
      if (i !== 0) {
        element.output.bindingsStream.close();
      }
    }

    // Take the stream with the lowest cardinality
    const smallestStream: IQueryOperationResultBindings = sideData.entriesSorted[0].output;
    const remainingEntries = [ ...sideData.entriesSorted ];
    remainingEntries.splice(0, 1);

    const allVariablesSet = new Map<string, RDF.Variable>();
    for (const entry of sideData.entriesSorted) {
      for (const metadataVariable of entry.metadata.variables) {
        allVariablesSet.set(metadataVariable.variable.value, metadataVariable.variable);
      }
    }

    // Bind the remaining patterns for each binding in the stream
    const subContext = action.context
      .set(KeysQueryOperation.joinLeftMetadata, sideData.entriesSorted[0].metadata)
      .set(KeysQueryOperation.joinRightMetadatas, remainingEntries.map(entry => entry.metadata));
    const bindingsStream = <BindingsStream><unknown> await ActorRdfJoinInnerMemoryBind.createBindStream(
      <AsyncIterator<Bindings>><unknown>smallestStream.bindingsStream,
      remainingEntries.map(entry => entry.operation),
      async(operations: Algebra.Operation[], operationBindings: Bindings) => {
        // Send the materialized patterns to the mediator for recursive join evaluation.
        const operation = operations.length === 1 ?
          operations[0] :
          algebraFactory.createJoin(operations);
        const output = getSafeBindings(await this.mediatorQueryOperation.mediate(
          { operation, context: subContext?.set(KeysQueryOperation.joinBindings, operationBindings) },
        ));
        return <AsyncIterator<Bindings>><unknown>output.bindingsStream;
      },
      false,
      algebraFactory,
      bindingsFactory,
      entry => hashFunction(entry, sideData.entriesSorted[0].metadata.variables.map(v => v.variable)),
      entry => hashFunction(entry, [ ...allVariablesSet.values() ]),
    );

    return {
      result: {
        type: 'bindings',
        bindingsStream,
        metadata: () => this.constructResultMetadata(
          sideData.entriesSorted,
          sideData.entriesSorted.map(entry => entry.metadata),
          action.context,
        ),
      },
      physicalPlanMetadata: {
        bindIndex: sideData.entriesUnsorted.indexOf(sideData.entriesSorted[0]),
      },
    };
  }

  public canBindWithOperation(operation: Algebra.Operation): boolean {
    let valid = true;
    Util.recurseOperation(operation, {
      [Algebra.types.EXTEND](): boolean {
        valid = false;
        return false;
      },
      [Algebra.types.GROUP](): boolean {
        valid = false;
        return false;
      },
    });

    return valid;
  }

  public async getJoinCoefficients(
    action: IActionRdfJoin,
    sideData: IActorRdfJoinTestSideData,
  ): Promise<TestResult<IMediatorTypeJoinCoefficients, IActorRdfJoinMemoryMultiBindTestSideData>> {
    let { metadatas } = sideData;
    // Order the entries so we can pick the first one (usually the one with the lowest cardinality)
    const entriesUnsorted = action.entries
      .map((entry, i) => ({ ...entry, metadata: metadatas[i] }));
    const entriesTest = await this.sortJoinEntries(entriesUnsorted, action.context);
    if (entriesTest.isFailed()) {
      return entriesTest;
    }
    const entriesSorted = entriesTest.get();
    metadatas = entriesSorted.map(entry => entry.metadata);

    const requestInitialTimes = ActorRdfJoin.getRequestInitialTimes(metadatas);
    const requestItemTimes = ActorRdfJoin.getRequestItemTimes(metadatas);

    // Determine first stream and remaining ones
    const remainingEntries = [ ...entriesSorted ];
    const remainingRequestInitialTimes = [ ...requestInitialTimes ];
    const remainingRequestItemTimes = [ ...requestItemTimes ];
    remainingEntries.splice(0, 1);
    remainingRequestInitialTimes.splice(0, 1);
    remainingRequestItemTimes.splice(0, 1);

    // Reject binding on some operation types
    if (remainingEntries
      .some(entry => !this.canBindWithOperation(entry.operation))) {
      return failTest(`Actor ${this.name} can not bind on Extend and Group operations`);
    }

    // Reject binding on modified operations, since using the output directly would be significantly more efficient.
    if (remainingEntries.some(entry => entry.operationModified)) {
      return failTest(`Actor ${this.name} can not be used over remaining entries with modified operations`);
    }

    // Only run this actor if the smallest stream is significantly smaller than the largest stream.
    // We must use Math.max, because the last metadata is not necessarily the biggest, but it's the least preferred.
    // If join entries are produced locally, we increase the possibility of doing this bind join, as it's cheap.
    const isRemoteAccess = requestItemTimes.some(time => time > 0);
    if (metadatas[0].cardinality.value * 60 / (isRemoteAccess ? 1 : 3) >
      Math.max(...metadatas.map(metadata => metadata.cardinality.value))) {
      return failTest(`Actor ${this.name} can only run if the smallest stream is much smaller than largest stream`);
    }

    // Determine selectivities of smallest entry with all other entries
    const selectivities = await Promise.all(remainingEntries
      .map(async entry => (await this.mediatorJoinSelectivity.mediate({
        entries: [ entriesSorted[0], entry ],
        context: action.context,
      })).selectivity * this.selectivityModifier));

    // Determine coefficients for remaining entries
    const cardinalityRemaining = remainingEntries
      .map((entry, i) => entry.metadata.cardinality.value * selectivities[i])
      .reduce((sum, element) => sum + element, 0);
    const receiveInitialCostRemaining = remainingRequestInitialTimes
      .reduce((sum, element) => sum + element, 0);
    const receiveItemCostRemaining = remainingRequestItemTimes
      .reduce((sum, element) => sum + element, 0);

    // TODO [2025-09-01]: persistedItems is not yet implemented
    return passTestWithSideData({
      iterations: metadatas[0].cardinality.value * cardinalityRemaining,
      persistedItems: 0,
      blockingItems: 0,
      requestTime: requestInitialTimes[0] +
        metadatas[0].cardinality.value * (
          requestItemTimes[0] +
          receiveInitialCostRemaining +
          cardinalityRemaining * receiveItemCostRemaining
        ),
    }, { ...sideData, entriesUnsorted, entriesSorted });
  }
}

export interface IActorRdfJoinInnerMemoryMultiBindArgs extends IActorRdfJoinArgs {
  /**
   * Multiplier for selectivity values
   * @range {double}
   * @default {0.0001}
   */
  selectivityModifier: number;
  /**
   * The join entries sort mediator
   */
  mediatorJoinEntriesSort: MediatorRdfJoinEntriesSort;
  /**
   * The query operation mediator
   */
  mediatorQueryOperation: MediatorQueryOperation;
  /**
   * The merge bindings context mediator
   */
  mediatorMergeBindingsContext: MediatorMergeBindingsContext;
  /**
   * The hash bindings mediator
   */
  mediatorHashBindings: MediatorHashBindings;
}

export interface IActorRdfJoinMemoryMultiBindTestSideData extends IActorRdfJoinTestSideData {
  entriesUnsorted: IJoinEntryWithMetadata[];
  entriesSorted: IJoinEntryWithMetadata[];
}
