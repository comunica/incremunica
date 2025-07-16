import type { EventEmitter } from 'node:events';
import {
  ActorExpressionEvaluatorFactoryDefault,
} from '@comunica/actor-expression-evaluator-factory-default';
import { ActorFunctionFactoryTermEquality } from '@comunica/actor-function-factory-term-equality';
import { ActorFunctionFactoryTermLesserThan } from '@comunica/actor-function-factory-term-lesser-than';
import {
  ActorTermComparatorFactoryExpressionEvaluator,
} from '@comunica/actor-term-comparator-factory-expression-evaluator';
import type {
  MediatorExpressionEvaluatorFactory,
  ActorExpressionEvaluatorFactory,
  IActorExpressionEvaluatorFactoryArgs,
} from '@comunica/bus-expression-evaluator-factory';
import { BusFunctionFactory } from '@comunica/bus-function-factory';
import type {
  IActorFunctionFactoryArgs,
  MediatorFunctionFactory,
  ActorFunctionFactory,
} from '@comunica/bus-function-factory';
import type { MediatorHashBindings } from '@comunica/bus-hash-bindings';
import type { MediatorMergeBindingsContext } from '@comunica/bus-merge-bindings-context';
import type { MediatorQueryOperation } from '@comunica/bus-query-operation';
import type { MediatorTermComparatorFactory } from '@comunica/bus-term-comparator-factory';
import { KeysInitQuery, KeysExpressionEvaluator } from '@comunica/context-entries';
import { ActionContext, Bus } from '@comunica/core';
import { MediatorRace } from '@comunica/mediator-race';
import type { BindingsStream, IActionContext, ISuperTypeProvider, GeneralSuperTypeDict } from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import {
  ActorMergeBindingsContextIsAddition,
} from '@incremunica/actor-merge-bindings-context-is-addition';
import { KeysBindings } from '@incremunica/context-entries';
import type { Quad } from '@incremunica/types';
import type * as RDF from '@rdfjs/types';
import { AsyncIterator } from 'asynciterator';
import MurmurHash3 from 'imurmurhash';
import { LRUCache } from 'lru-cache';
import { DataFactory } from 'rdf-data-factory';
import { Algebra, Factory } from 'sparqlalgebrajs';
import { Wildcard } from 'sparqljs';

export const DF = new DataFactory();
export const BF = new BindingsFactory(DF, {});
export const AF = new Factory();

export function testBufferIterator<T>(buffer: (T | null)[]): AsyncIterator<T> {
  const iterator = new AsyncIterator<T>();
  iterator.read = (): T | null => {
    if (iterator.readable) {
      const element = buffer.shift() ?? null;
      if (element === null) {
        iterator.readable = false;
      }
      return element;
    }
    return null;
  };
  return iterator;
}

export async function partialArrayifyStream<T>(stream: EventEmitter, num: number): Promise<T[]> {
  const array: T[] = [];
  let count = 0;
  await new Promise<void>((resolve) => {
    const countFunction = (data: T): void => {
      array.push(data);
      count++;
      if (count === num) {
        stream.removeListener('data', countFunction);
        resolve();
      }
    };
    stream.on('data', countFunction);
  });
  return array;
}

export async function partialArrayifyAsyncIterator<T>(asyncIterator: AsyncIterator<T>, num: number): Promise<T[]> {
  const array: T[] = [];
  let count = 0;
  await new Promise<void>((resolve) => {
    const countFunction = (): void => {
      let data = asyncIterator.read();
      while (data) {
        array.push(data);
        count++;
        if (count === num) {
          asyncIterator.removeListener('readable', countFunction);
          resolve();
          break;
        }
        data = asyncIterator.read();
      }
    };
    countFunction();
    asyncIterator.on('readable', countFunction);
  });
  return array;
}

export function bindingsToString(bindings: Bindings): string {
  let string = `bindings, ${bindings.getContextEntry<boolean>(KeysBindings.isAddition) ?? true} :`;
  for (const [ key, value ] of bindings) {
    string += `\n\t${key.value}: ${value.value}`;
  }
  return string;
}

export function printBindings(bindings: Bindings): void {
  let string = `bindings, ${bindings.getContextEntry<boolean>(KeysBindings.isAddition) ?? true} :`;
  for (const [ key, value ] of bindings) {
    string += `\n\t${key.value}: ${value.value}`;
  }
  // eslint-disable-next-line no-console
  console.log(string);
}

export function printBindingsStream(bindingsStream: BindingsStream): BindingsStream {
  return bindingsStream.map((bindings) => {
    if (bindings) {
      printBindings(<Bindings>bindings);
    } else {
      // eslint-disable-next-line no-console
      console.log(bindings);
    }
    return bindings;
  });
}

export function quad(s: string, p: string, o: string, g?: string, isAddition?: boolean): Quad {
  const quad = <Quad>(DF.quad(DF.namedNode(s), DF.namedNode(p), DF.namedNode(o), g ? DF.namedNode(g) : undefined));
  quad.isAddition = isAddition;
  return quad;
}

export function createTestMediatorMergeBindingsContext(): MediatorMergeBindingsContext {
  return <any> {
    mediate: async() => {
      const mergeHandlers = (await new ActorMergeBindingsContextIsAddition({
        bus: new Bus({ name: 'bus' }),
        name: 'actor',
      }).run(<any>{})).mergeHandlers;
      return { mergeHandlers };
    },
  };
}

export function createTestHashBindings(b: RDF.Bindings): number {
  let hash = MurmurHash3();
  for (const variable of b.keys()) {
    hash = hash.hash(b.get(variable)?.value ?? 'UNDEF');
  }
  return hash.result();
}

export function createTestMediatorHashBindings(): MediatorHashBindings {
  return <any> {
    mediate: async() => {
      const hashFunction = (
        bindings: RDF.Bindings,
        variables: RDF.Variable[],
      ): number => createTestHashBindings(
        bindings.filter((_value, key) => variables.some(variable => variable.equals(key))),
      );
      return { hashFunction };
    },
  };
}

export async function createTestBindingsFactory(DF?: DataFactory): Promise<BindingsFactory> {
  return new BindingsFactory(
    DF ?? new DataFactory(),
    (await new ActorMergeBindingsContextIsAddition({
      bus: new Bus({ name: 'bus' }),
      name: 'actor',
    }).run(<any>{})).mergeHandlers,
  );
}

export function createTestContextWithDataFactory(dataFactory?: DataFactory, context?: IActionContext): IActionContext {
  if (!context) {
    context = new ActionContext();
  }
  if (!dataFactory) {
    dataFactory = DF;
  }
  return context.set(KeysInitQuery.dataFactory, dataFactory);
}

// TODO [2025-09-01]: The following functions are not accessible for incremunica, maybe fix this in comunica
export function createTermCompMediator(): MediatorTermComparatorFactory {
  return <MediatorTermComparatorFactory> {
    async mediate(action) {
      return createTermCompActor().actor.run(action);
    },
  };
}

export function createTermCompActor(): {
  actor: ActorTermComparatorFactoryExpressionEvaluator;
  bus: Bus<any, any, any, any>;
} {
  const bus: any = new Bus({ name: 'bus' });
  const actor = new ActorTermComparatorFactoryExpressionEvaluator({
    name: 'actor',
    bus,
    mediatorFunctionFactory: createFuncMediator([
      args => new ActorFunctionFactoryTermEquality(args),
      args => new ActorFunctionFactoryTermLesserThan(args),
    ], {}),
    mediatorQueryOperation: getMockMediatorQueryOperation(),
    mediatorMergeBindingsContext: getMockMediatorMergeBindingsContext(),
  });
  return { actor, bus };
}

export function makeAggregate(aggregator: string, distinct = false, separator?: string, wildcard = false):
Algebra.AggregateExpression {
  const inner: Algebra.Expression = wildcard ?
      {
        type: Algebra.types.EXPRESSION,
        expressionType: Algebra.expressionTypes.WILDCARD,
        wildcard: new Wildcard(),
      } :
      {
        type: Algebra.types.EXPRESSION,
        expressionType: Algebra.expressionTypes.TERM,
        term: DF.variable('x'),
      };
  return {
    type: Algebra.types.EXPRESSION,
    expressionType: Algebra.expressionTypes.AGGREGATE,
    aggregator: <any>aggregator,
    distinct,
    separator,
    expression: inner,
  };
}

interface RunFuncTestTableArgs extends IActorFunctionFactoryArgs {
  mediatorFunctionFactory: MediatorFunctionFactory;
}

export function createFuncMediator<E extends object>(
  registeredActors: ((arg: RunFuncTestTableArgs & E) => ActorFunctionFactory)[],
  additionalArgs: E,
): MediatorFunctionFactory {
  const bus = new BusFunctionFactory({ name: 'test-bus-function-factory' });
  const mediatorFunctionFactory = <MediatorFunctionFactory> new MediatorRace({
    name: 'test-mediator-function-factory',
    bus,
  });
  for (const constructor of registeredActors) {
    constructor({
      mediatorFunctionFactory,
      bus,
      name: 'test',
      ...additionalArgs,
    });
  }
  return mediatorFunctionFactory;
}

export function getMockSuperTypeProvider(): ISuperTypeProvider {
  return {
    cache: <any> new LRUCache<string, GeneralSuperTypeDict>({ max: 1_000 }),
    discoverer: _ => 'term',
  };
}

export function getMockEEActionContext(actionContext?: IActionContext): IActionContext {
  return new ActionContext({
    [KeysInitQuery.queryTimestamp.name]: new Date(Date.now()),
    [KeysInitQuery.functionArgumentsCache.name]: {},
    [KeysExpressionEvaluator.superTypeProvider.name]: getMockSuperTypeProvider(),
    [KeysInitQuery.dataFactory.name]: DF,
  }).merge(actionContext ?? new ActionContext());
}

export function getMockMediatorQueryOperation(): MediatorQueryOperation {
  return <any>{
    async mediate(_: any) {
      throw new Error('mediatorQueryOperation mock not implemented');
    },
  };
}

export function getMockMediatorFunctionFactory(): MediatorFunctionFactory {
  return <any>{
    async mediate(_: any) {
      throw new Error('mediatorFunctionFactory mock not implemented');
    },
  };
}

export function getMockMediatorMergeBindingsContext(): MediatorMergeBindingsContext {
  return <any>{
    async mediate(_: any) {
      return BF;
    },
  };
}

export function getMockEEFactory({
  mediatorQueryOperation,
  mediatorFunctionFactory,
  mediatorMergeBindingsContext,
}: Partial<IActorExpressionEvaluatorFactoryArgs> = {}): ActorExpressionEvaluatorFactory {
  return new ActorExpressionEvaluatorFactoryDefault({
    bus: new Bus({ name: 'testBusMock' }),
    name: 'mockEEFactory',
    mediatorQueryOperation: mediatorQueryOperation ?? getMockMediatorQueryOperation(),
    mediatorFunctionFactory: mediatorFunctionFactory ?? getMockMediatorFunctionFactory(),
    mediatorMergeBindingsContext: mediatorMergeBindingsContext ?? getMockMediatorMergeBindingsContext(),
  });
}

export function getMockMediatorExpressionEvaluatorFactory(
  args: Partial<IActorExpressionEvaluatorFactoryArgs> = {},
): MediatorExpressionEvaluatorFactory {
  return <any>{
    async mediate(arg: any) {
      // eslint-disable-next-line unicorn/no-useless-undefined
      return getMockEEFactory(args).run(arg, undefined);
    },
  };
}

export function int(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#integer'));
}

export function float(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#float'));
}

export function decimal(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#decimal'));
}

export function date(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#date'));
}

export function string(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#string'));
}

export function double(value: string): RDF.Term {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#double'));
}

export function nonLiteral(): RDF.Term {
  return DF.namedNode('http://example.org/');
}
