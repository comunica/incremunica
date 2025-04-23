import type { ComunicaDataFactory, IActionContext } from '@comunica/types';
import type { Bindings, BindingsFactory } from '@comunica/utils-bindings-factory';
import type {
  IActorBindingsAggregatorFactoryOutput,
  MediatorBindingsAggregatorFactory,
} from '@incremunica/bus-bindings-aggregator-factory';
import { KeysBindings } from '@incremunica/context-entries';
import { Queue } from '@incremunica/data-structures';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import type { Algebra } from 'sparqlalgebrajs';

type IGroupObject = {
  groupBindings: Bindings;
  aggregators: Record<string, IActorBindingsAggregatorFactoryOutput>;
  // When waiting on the aggregators we put incoming bindings in the groupBuffer
  groupBuffer: Queue<Bindings> | undefined;
  previousBindings: Bindings | undefined;
  count: number;
};

/**
 * A state manager for the groups constructed by consuming the bindings-stream.
 */
export class GroupIterator extends AsyncIterator<Bindings> {
  private readonly pattern: Algebra.Group;
  private readonly dataFactory: ComunicaDataFactory;
  private readonly groups: Map<string, IGroupObject>;
  private readonly groupVariables: Set<string>;
  private variablesInner: RDF.Variable[];
  private readonly hashFunction: (bindings: Bindings, variables: RDF.Variable[]) => string;
  private readonly context: IActionContext;
  private readonly mediatorBindingsAggregatorFactory: MediatorBindingsAggregatorFactory;
  private nextBindings: Bindings | null = null;
  private readonly source: AsyncIterator<Bindings>;
  private started = false;
  private emptyResult: Bindings | undefined = undefined;
  private emptyResultEmitted = false;
  private readonly bindingsFactory: BindingsFactory;
  private readCount = 0;

  public constructor(
    source: AsyncIterator<Bindings>,
    context: IActionContext,
    pattern: Algebra.Group,
    dataFactory: ComunicaDataFactory,
    bindingsFactory: BindingsFactory,
    mediatorBindingsAggregatorFactory: MediatorBindingsAggregatorFactory,
    groupVariables: Set<string>,
    variablesInner: RDF.Variable[],
    hashFunction: (bindings: Bindings, variables: RDF.Variable[]) => string,
  ) {
    super();
    this.dataFactory = dataFactory;
    this.pattern = pattern;
    this.groups = new Map<string, IGroupObject>();
    this.variablesInner = variablesInner;
    this.groupVariables = groupVariables;
    this.hashFunction = hashFunction;
    this.context = context;
    this.mediatorBindingsAggregatorFactory = mediatorBindingsAggregatorFactory;
    this.source = source;
    this.bindingsFactory = bindingsFactory;

    this.source.on('readable', this._readBindings.bind(this));
    this.source.on('error', (error: Error) => this.destroy(error));
    // TODO [2025-09-01]: if source is ended we should end this iterator as well

    this.on('end', () => {
      this._cleanup();
    });
  }

  private _readBindings(): void {
    let bindings = this.source.read();
    // It's possible the source has no elements, and then we need to possibly emit an empty value
    if (!bindings) {
      this.readable = true;
      return;
    }
    while (bindings) {
      this.readCount++;
      this.putBindings(bindings)
        .then(() => {
          this.readCount--;
          if (this.readCount === 0) {
            this.readable = true;
          }
        })
        .catch((e) => {
          this.destroy(e);
        });
      bindings = this.source.read();
    }
  }

  protected _cleanup(): void {
    this.groups.clear();
    this.groupVariables.clear();
    this.variablesInner = [];
  }

  public override _end(): void {
    super._end();
  }

  public override read(): Bindings | null {
    if (!this.started) {
      this._readBindings();
      this.readable = false;
      this.started = true;
      return null;
    }
    if (this.emptyResult) {
      if (this.groups.size === 0) {
        if (!this.emptyResultEmitted) {
          this.readable = false;
          this.emptyResultEmitted = true;
          return this.emptyResult;
        }
      } else if (this.emptyResultEmitted) {
        const result = this.emptyResult.setContextEntry(KeysBindings.isAddition, false);
        this.emptyResultEmitted = false;
        this.emptyResult = undefined;
        return result;
      }
    }
    if (this.nextBindings) {
      const bindings = this.nextBindings;
      this.nextBindings = null;
      return bindings;
    }
    // TODO [2025-09-01]: maybe make sure this is done in round robin fashion
    for (const group of this.groups.values()) {
      if (group.groupBuffer) {
        continue;
      }
      let hasResult = false;
      let returnBindings = group.groupBindings;
      for (const variable in group.aggregators) {
        const value = group.aggregators[variable].result();
        if (value !== undefined) {
          hasResult = true;
        }
        if (value) {
          returnBindings = returnBindings.set(this.dataFactory.variable(variable), value);
        }
      }
      // If the groupBuffer is undefined and there are no aggregators we can return the resultBindings once
      // We do this by setting the previous result to the returned bindings
      if (Object.keys(group.aggregators).length === 0) {
        if (group.previousBindings === undefined && group.count > 0) {
          group.previousBindings = returnBindings;
          return returnBindings;
        }
        if (group.previousBindings !== undefined && group.count === 0) {
          this.groups.delete(this.hashFunction(group.groupBindings, this.variablesInner));
          return group.previousBindings.setContextEntry(KeysBindings.isAddition, false);
        }
      }
      if (group.count === 0) {
        this.groups.delete(this.hashFunction(group.groupBindings, this.variablesInner));
        if (group.previousBindings !== undefined) {
          return group.previousBindings.setContextEntry(KeysBindings.isAddition, false);
        }
      }
      if (hasResult) {
        if (group.previousBindings === undefined) {
          // This will be the first result from this group, this will be an addition
          group.previousBindings = returnBindings;
          return returnBindings;
        }
        // This is a subsequent result from this group
        // first return the previous bindings as a deletion
        // then set the result as nextBindings
        this.nextBindings = returnBindings;
        returnBindings = group.previousBindings;
        returnBindings = returnBindings.setContextEntry(KeysBindings.isAddition, false);
        group.previousBindings = this.nextBindings;
        return returnBindings;
      }
    }
    // Case: No Input
    // Some aggregators still define an output on the empty input
    // Result is a single Bindings
    // TODO [2025-09-01]: only do tis once when the iterator is started and keep the result for the future
    if (this.groupVariables.size === 0 && this.groups.size === 0) {
      const single: [RDF.Variable, RDF.Term][] = [];
      Promise.all(this.pattern.aggregates.map(async(aggregate) => {
        const key = aggregate.variable;
        const aggregator = await this.mediatorBindingsAggregatorFactory
          .mediate({ expr: aggregate, context: this.context });
        const value = aggregator.result();
        if (value !== undefined && value !== null) {
          single.push([ key, value ]);
        }
      })).then(() => {
        this.emptyResult = this.bindingsFactory.bindings(single);
        this.readable = true;
      }).catch((e) => {
        this.destroy(e);
      });
    }
    this.readable = false;
    return null;
  }

  public async putBindings(bindings: Bindings): Promise<void> {
    const grouper = bindings
      .filter((_, variable) => this.groupVariables.has(variable.value));
    const groupHash = this.hashFunction(grouper, this.variablesInner);

    const group = this.groups.get(groupHash);
    if (bindings.getContextEntry(KeysBindings.isAddition) ?? true) {
      if (group === undefined) {
        const initializeGroup: IGroupObject = {
          groupBindings: grouper,
          aggregators: {},
          groupBuffer: new Queue([ bindings ]),
          previousBindings: undefined,
          count: 0,
        };
        this.groups.set(groupHash, initializeGroup);
        await Promise.all(this.pattern.aggregates.map(async(aggregate) => {
          const key = aggregate.variable.value;
          initializeGroup.aggregators[key] = await this.mediatorBindingsAggregatorFactory
            .mediate({ expr: aggregate, context: this.context });
        }));
        while (initializeGroup.groupBuffer!.length > 0) {
          const bufferedBindings = initializeGroup.groupBuffer!.shift()!;
          if (bufferedBindings.getContextEntry(KeysBindings.isAddition) ?? true) {
            initializeGroup.count++;
          } else {
            initializeGroup.count--;
          }
          await Promise.all(this.pattern.aggregates.map(async(aggregate) => {
            const variable = aggregate.variable.value;
            return initializeGroup.aggregators[variable].putBindings(bufferedBindings);
          }));
        }
        initializeGroup.groupBuffer = undefined;
        return;
      }
    } else if (group === undefined) {
      throw new Error('Received deletion for non-existing addition');
    }
    if (group.groupBuffer) {
      group.groupBuffer.push(bindings);
      return;
    }
    if (bindings.getContextEntry(KeysBindings.isAddition) ?? true) {
      group.count++;
    } else {
      group.count--;
    }
    await Promise.all(this.pattern.aggregates.map(async(aggregate) => {
      const variable = aggregate.variable.value;
      return group.aggregators[variable].putBindings(bindings);
    }));
  }
}
