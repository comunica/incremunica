import { ActorFunctionFactoryTermAddition } from '@comunica/actor-function-factory-term-addition';
import { ActorFunctionFactoryTermDivision } from '@comunica/actor-function-factory-term-division';
import { ActorFunctionFactoryTermSubtraction } from '@comunica/actor-function-factory-term-subtraction';
import type { ActorExpressionEvaluatorFactory } from '@comunica/bus-expression-evaluator-factory';
import type { MediatorFunctionFactory } from '@comunica/bus-function-factory';
import type { IActionQueryOperation } from '@comunica/bus-query-operation';
import { ActorQueryOperation } from '@comunica/bus-query-operation';
import type { MediatorTermComparatorFactory } from '@comunica/bus-term-comparator-factory';
import { KeysInitQuery } from '@comunica/context-entries';
import { Bus, ActionContext } from '@comunica/core';
import type { IActionContext } from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { SparqlOperator } from '@comunica/utils-expression-evaluator';
import { AverageAggregator } from '@incremunica/actor-bindings-aggregator-factory-average';
import { CountAggregator } from '@incremunica/actor-bindings-aggregator-factory-count';
import { GroupConcatAggregator } from '@incremunica/actor-bindings-aggregator-factory-group-concat';
import { MaxAggregator } from '@incremunica/actor-bindings-aggregator-factory-max';
import { MinAggregator } from '@incremunica/actor-bindings-aggregator-factory-min';
import { SampleAggregator } from '@incremunica/actor-bindings-aggregator-factory-sample';
import { SumAggregator } from '@incremunica/actor-bindings-aggregator-factory-sum';
import { WildcardCountAggregator } from '@incremunica/actor-bindings-aggregator-factory-wildcard-count';
import type {
  IActionBindingsAggregatorFactory,
  IActorBindingsAggregatorFactoryOutput,
  MediatorBindingsAggregatorFactory,
} from '@incremunica/bus-bindings-aggregator-factory';
import { KeysBindings } from '@incremunica/context-entries';
import {
  createFuncMediator,
  createTermCompMediator,
  getMockEEActionContext,
  getMockEEFactory,
  partialArrayifyAsyncIterator,
} from '@incremunica/dev-tools';
import { arrayifyStream } from 'arrayify-stream';
import { ArrayIterator, AsyncIterator } from 'asynciterator';
import { DataFactory } from 'rdf-data-factory';
import { Algebra } from 'sparqlalgebrajs';
import { ActorQueryOperationGroup } from '../lib';
import '@comunica/utils-jest';
import '@incremunica/jest';

const DF = new DataFactory();
const BF = new BindingsFactory(DF, {});
const mediatorMergeBindingsContext: any = {
  mediate: () => ({}),
};

const simpleXYZinput = {
  type: 'bgp',
  patterns: [
    {
      subject: {
        value: 'x',
      },
      predicate: {
        value: 'y',
      },
      object: {
        value: 'z',
      },
      graph: {
        value: '',
      },
      type: 'pattern',
    },
  ],
};

const countY: Algebra.BoundAggregate = {
  type: Algebra.types.EXPRESSION,
  expressionType: Algebra.expressionTypes.AGGREGATE,
  aggregator: 'count',
  expression: {
    type: Algebra.types.EXPRESSION,
    expressionType: Algebra.expressionTypes.TERM,
    term: DF.variable('y'),
  },
  distinct: false,
  variable: DF.variable('count'),
};

const sumZ: Algebra.BoundAggregate = {
  type: Algebra.types.EXPRESSION,
  expressionType: Algebra.expressionTypes.AGGREGATE,
  aggregator: 'sum',
  expression: {
    type: Algebra.types.EXPRESSION,
    expressionType: Algebra.expressionTypes.TERM,
    term: DF.variable('z'),
  },
  distinct: false,
  variable: DF.variable('sum'),
};

const mediatorFunctionFactory: MediatorFunctionFactory = createFuncMediator([
  args => new ActorFunctionFactoryTermAddition(args),
  args => new ActorFunctionFactoryTermSubtraction(args),
  args => new ActorFunctionFactoryTermDivision(args),
], {});

// An iterator that reads a buffer of bindings and stops if there is a null in the buffer
function testBufferIterator(buffer: (Bindings | null)[]) {
  const iterator = new AsyncIterator<Bindings>();
  iterator.read = () => {
    if (iterator.readable) {
      const element = buffer.shift();
      if (element === null) {
        iterator.readable = false;
      }
      return element;
    }
    return null;
  };
  return iterator;
}

function getDefaultMediatorQueryOperation() {
  return {
    mediate: (arg: any) => Promise.resolve({
      bindingsStream: new ArrayIterator([
        BF.bindings([[ DF.variable('a'), DF.literal('1') ]]),
        BF.bindings([[ DF.variable('a'), DF.literal('2') ]]),
        BF.bindings([[ DF.variable('a'), DF.literal('3') ]]),
      ], { autoStart: false }),
      metadata: () => Promise.resolve({ cardinality: 3 }),
      operated: arg,
      type: 'bindings',
      variables: [ DF.variable('a') ],
    }),
  };
}

interface ICaseOptions {
  inputBindings?: Bindings[] | AsyncIterator<Bindings>;
  groupVariables?: string[];
  inputVariables?: string[];
  aggregates?: Algebra.BoundAggregate[];
  inputOp?: any;
  cardinality?: number;
}
interface ICaseOutput {
  actor: ActorQueryOperationGroup;
  bus: any;
  mediatorQueryOperation: any;
  op: IActionQueryOperation;
}

async function aggregatorFactory(factory: ActorExpressionEvaluatorFactory, { expr, context }:
IActionBindingsAggregatorFactory):
  Promise<IActorBindingsAggregatorFactoryOutput> {
  const mediatorTermComparatorFactory: MediatorTermComparatorFactory = createTermCompMediator();
  context = getMockEEActionContext(context);

  const evaluator = await factory.run({
    algExpr: expr.expression,
    context,
  }, undefined);
  if (expr.aggregator === 'count') {
    if (expr.expression.wildcard) {
      return new WildcardCountAggregator(evaluator, expr.distinct);
    }
    return new CountAggregator(evaluator, expr.distinct);
  }
  if (expr.aggregator === 'sum') {
    return new SumAggregator(
      evaluator,
      expr.distinct,
      context.getSafe(KeysInitQuery.dataFactory),
      await mediatorFunctionFactory.mediate({
        functionName: SparqlOperator.ADDITION,
        context,
        requireTermExpression: true,
      }),
      await mediatorFunctionFactory.mediate({
        functionName: SparqlOperator.SUBTRACTION,
        context,
        requireTermExpression: true,
      }),
    );
  }
  if (expr.aggregator === 'avg') {
    return new AverageAggregator(
      evaluator,
      expr.distinct,
      context.getSafe(KeysInitQuery.dataFactory),
      await mediatorFunctionFactory.mediate({
        functionName: SparqlOperator.ADDITION,
        context,
        requireTermExpression: true,
      }),
      await mediatorFunctionFactory.mediate({
        functionName: SparqlOperator.SUBTRACTION,
        context,
        requireTermExpression: true,
      }),
      await mediatorFunctionFactory.mediate({
        functionName: SparqlOperator.DIVISION,
        context,
        requireTermExpression: true,
      }),
    );
  }
  if (expr.aggregator === 'min') {
    return new MinAggregator(
      evaluator,
      expr.distinct,
      await mediatorTermComparatorFactory.mediate({ context }),
    );
  }
  if (expr.aggregator === 'max') {
    return new MaxAggregator(
      evaluator,
      expr.distinct,
      await mediatorTermComparatorFactory.mediate({ context }),
    );
  }
  if (expr.aggregator === 'sample') {
    return new SampleAggregator(evaluator, expr.distinct);
  }
  if (expr.aggregator === 'group_concat') {
    return new GroupConcatAggregator(
      evaluator,
      expr.distinct,
      context.getSafe(KeysInitQuery.dataFactory),
      expr.separator,
    );
  }
  throw new Error(`Unsupported aggregator ${(<any> expr).aggregator}`);
}

function constructCase(
  { inputBindings, inputVariables = [], groupVariables = [], aggregates = [], inputOp, cardinality }: ICaseOptions,
): ICaseOutput {
  const bus: any = new Bus({ name: 'bus' });

  // Construct mediator
  const mediatorQueryOperation: any = inputBindings === undefined ?
    getDefaultMediatorQueryOperation() :
      {
        mediate: (arg: any) => Promise.resolve({
          bindingsStream: (Array.isArray(inputBindings)) ?
            new ArrayIterator(inputBindings, { autoStart: false }) :
            inputBindings,
          metadata: () => Promise.resolve({
            cardinality: (Array.isArray(inputBindings)) ? inputBindings.length : cardinality!,
            variables: inputVariables.map(name => ({ variable: DF.variable(name), canBeUndef: false })),
          }),
          operated: arg,
          type: 'bindings',
        }),
      };

  const expressionEvaluatorFactory = getMockEEFactory({
    mediatorQueryOperation,
    mediatorFunctionFactory,
  });
  const mediatorBindingsAggregatorFactory = <MediatorBindingsAggregatorFactory> {
    async mediate(args: IActionBindingsAggregatorFactory):
    Promise<IActorBindingsAggregatorFactoryOutput> {
      return await aggregatorFactory(expressionEvaluatorFactory, args);
    },
  };
  const operation: Algebra.Group = {
    type: Algebra.types.GROUP,
    input: inputOp,
    variables: groupVariables.map(name => DF.variable(name)) || [],
    aggregates: aggregates || [],
  };
  const op: any = { operation, context: getMockEEActionContext() };

  const actor = new ActorQueryOperationGroup({
    name: 'actor',
    bus,
    mediatorQueryOperation,
    mediatorMergeBindingsContext,
    mediatorBindingsAggregatorFactory,
  });
  return { actor, bus, mediatorQueryOperation, op };
}

function int(value: string) {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#integer'));
}

function float(value: string) {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#float'));
}

function decimal(value: string) {
  return DF.literal(value, DF.namedNode('http://www.w3.org/2001/XMLSchema#decimal'));
}

describe('ActorQueryOperationGroup', () => {
  let bus: any;
  let mediatorQueryOperation: any;
  let mediatorBindingsAggregatorFactory: MediatorBindingsAggregatorFactory;
  let context: IActionContext;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
    mediatorQueryOperation = getDefaultMediatorQueryOperation();
    const expressionEvaluatorFactory = getMockEEFactory({
      mediatorQueryOperation,
      mediatorFunctionFactory,
    });
    mediatorBindingsAggregatorFactory = <MediatorBindingsAggregatorFactory> {
      async mediate(args: IActionBindingsAggregatorFactory):
      Promise<IActorBindingsAggregatorFactoryOutput> {
        return await aggregatorFactory(expressionEvaluatorFactory, args);
      },
    };
    context = getMockEEActionContext();
  });

  describe('The ActorQueryOperationGroup module', () => {
    it('should be a function', () => {
      expect(ActorQueryOperationGroup).toBeInstanceOf(Function);
    });

    it('should be a ActorQueryOperationGroup constructor', () => {
      expect(new (<any> ActorQueryOperationGroup)({ name: 'actor', bus, mediatorQueryOperation }))
        .toBeInstanceOf(ActorQueryOperationGroup);
      expect(new (<any> ActorQueryOperationGroup)({ name: 'actor', bus, mediatorQueryOperation }))
        .toBeInstanceOf(ActorQueryOperation);
    });

    it('should not be able to create new ActorQueryOperationGroup objects without \'new\'', () => {
      expect(() => {
        (<any> ActorQueryOperationGroup)();
      }).toThrow(`Class constructor ActorQueryOperationGroup cannot be invoked without 'new'`);
    });
  });

  describe('An ActorQueryOperationGroup instance', () => {
    it('should test on group', async() => {
      const { actor, op } = constructCase({});
      await expect(actor.test(op)).resolves.toPassTestVoid();
    });

    it('should not test on non-group', async() => {
      const op: any = { operation: { type: 'some-other-type' }};
      const { actor } = constructCase({});
      await expect(actor.test(op)).resolves.toFailTest(`Actor actor only supports group operations, but got some-other-type`);
    });

    it('should test but not run on unsupported operators', async() => {
      const op: any = {
        operation: {
          type: Algebra.types.GROUP,
          input: undefined,
          variables: undefined,
          aggregates: [{ expression: {
            args: [],
            expressionType: 'operator',
            operator: 'DUMMY',
          }}],
        },
        context: new ActionContext({ [KeysInitQuery.dataFactory.name]: DF }),
      };
      const { actor } = constructCase({});
      await expect(actor.test(op)).resolves.toPassTestVoid();
      await expect(actor.run(op, undefined)).rejects.toThrow('operation.variables is not iterable');
    });

    it('should test on distinct aggregate', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [{ ...countY, distinct: true }],
      });
      await expect(actor.test(op)).resolves.toPassTestVoid();
    });

    it('should end', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
      ]});
      output.bindingsStream.destroy();
      expect(output.bindingsStream.ended).toBeTruthy();
    });

    it('should fail on deletion that does not exist', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]).setContextEntry(KeysBindings.isAddition, false),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(new Promise((resolve, reject) => {
        output.bindingsStream.read();
        output.bindingsStream.on('error', reject);
      })).rejects.toThrow('Received deletion for non-existing addition');
    });

    it('should fail if mediatorBindingsAggregatorFactory fails', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('non_existing_aggregation', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(new Promise((resolve, reject) => {
        output.bindingsStream.read();
        output.bindingsStream.on('error', reject);
      })).rejects.toThrow('Unsupported aggregator non_existing_aggregation');
    });

    it('should fail if mediatorBindingsAggregatorFactory fails with respect to empty input', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('non_existing_aggregation', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(new Promise((resolve, reject) => {
        output.bindingsStream.read();
        output.bindingsStream.read();
        output.bindingsStream.on('error', reject);
      })).rejects.toThrow('Unsupported aggregator non_existing_aggregation');
    });

    it('should fail if the source fails', async() => {
      const iterator = new AsyncIterator<Bindings>();
      iterator.read = () => {
        iterator.destroy(new Error('Source error.'));
        return null;
      };
      iterator.readable = true;
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('non_existing_aggregation', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(new Promise((resolve, reject) => {
        output.bindingsStream.read();
        output.bindingsStream.on('error', reject);
      })).rejects.toThrow('Unhandled error. (Error: Source error');
    });

    it('should group on a single var', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
      ]});
    });

    it('should group on a single var with deletions (1)', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({
        variables: [
          { variable: DF.variable('x'), canBeUndef: false },
        ],
      });
    });

    it('should group on a single var with deletions (2)', async() => {
      const buffer = [
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
        null,
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];
      const iterator = new AsyncIterator<Bindings>();
      iterator.read = () => {
        if (iterator.readable) {
          const element = buffer.shift();
          if (element === null) {
            iterator.readable = false;
          }
          return element;
        }
        return null;
      };
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
        cardinality: 3,
      });

      const output = <any> await actor.run(op, undefined);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]).setContextEntry(KeysBindings.isAddition, false),
      ]);
    });

    it('should group on multiple vars', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
        ],
        groupVariables: [ 'x', 'y' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 4)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
        { variable: DF.variable('y'), canBeUndef: false },
      ]});
    });

    it('should group on multiple vars with deletions', async() => {
      const iterator = testBufferIterator([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [ 'x', 'y' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
    });

    it('should aggregate single vars', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('count'), int('1') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
        { variable: DF.variable('count'), canBeUndef: false },
      ]});
    });

    it('should aggregate single vars with deletions', async() => {
      const iterator = testBufferIterator([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY ],
      });

      const output = <any> await actor.run(op, undefined);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 4)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('count'), int('1') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
    });

    it('should aggregate multiple vars', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
            [ DF.variable('z'), int('2') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('3') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('4') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('5') ],
          ]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY, sumZ ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
          [ DF.variable('sum'), int('8') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('4') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
        { variable: DF.variable('count'), canBeUndef: false },
        { variable: DF.variable('sum'), canBeUndef: false },
      ]});
    });

    it('should aggregate multiple vars with deletions', async() => {
      const iterator = testBufferIterator([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('1') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
          [ DF.variable('z'), int('2') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('4') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('5') ],
        ]),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('5') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        null,
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('y'), DF.literal('aaa') ],
          [ DF.variable('z'), int('4') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('y'), DF.literal('bbb') ],
          [ DF.variable('z'), int('2') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY, sumZ ],
      });

      const output = <any> await actor.run(op, undefined);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
          [ DF.variable('sum'), int('3') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 4)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
          [ DF.variable('sum'), int('3') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
          [ DF.variable('sum'), int('8') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('4') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('3') ],
          [ DF.variable('sum'), int('8') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('2') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('2') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('4') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ]);
    });

    it('should aggregate multi variable distinct', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
            [ DF.variable('z'), int('2') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
            [ DF.variable('z'), int('2') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('3') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), DF.literal('aaa') ],
            [ DF.variable('z'), int('4') ],
          ]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [{ ...countY, distinct: true }, sumZ ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('x'), DF.literal('aaa') ],
          [ DF.variable('count'), int('2') ],
          [ DF.variable('sum'), int('7') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('bbb') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('3') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('count'), int('1') ],
          [ DF.variable('sum'), int('4') ],
        ]),
      ]);
    });

    it('should aggregate implicit', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('bbb') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('aaa') ],
          ]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('count'), int('5') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('count'), canBeUndef: false },
      ]});
    });

    // https://www.w3.org/TR/sparql11-query/#aggregateExample2
    it('should handle aggregate errors', async() => {
      const sumY: Algebra.BoundAggregate = {
        type: Algebra.types.EXPRESSION,
        expressionType: Algebra.expressionTypes.AGGREGATE,
        aggregator: 'sum',
        expression: {
          type: Algebra.types.EXPRESSION,
          expressionType: Algebra.expressionTypes.TERM,
          term: DF.variable('y'),
        },
        distinct: false,
        variable: DF.variable('sum'),
      };

      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('bbb') ],
            [ DF.variable('y'), DF.literal('not an int') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('ccc') ],
            [ DF.variable('y'), int('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('aaa') ],
            [ DF.variable('y'), DF.literal('not an int') ],
          ]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ sumY ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('ccc') ],
          [ DF.variable('sum'), int('1') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
        { variable: DF.variable('sum'), canBeUndef: false },
      ]});
    });

    it('should pass errors in the input stream', async() => {
      const inputBindings = [
        BF.bindings([
          [ DF.variable('x'), DF.literal('a') ],
          [ DF.variable('y'), int('1') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('b') ],
          [ DF.variable('y'), int('2') ],
        ]),
        BF.bindings([
          [ DF.variable('x'), DF.literal('c') ],
          [ DF.variable('y'), int('3') ],
        ]),
      ];
      const bindingsStream = new ArrayIterator(inputBindings).transform({
        autoStart: false,
        transform(result, done, push) {
          push(result);
          bindingsStream.emit('error', 'Test error');
          done();
        },
      });
      const myMediatorQueryOperation = {
        mediate: (arg: any) => Promise.resolve({
          bindingsStream,
          metadata: () => Promise.resolve({ cardinality: inputBindings.length }),
          operated: arg,
          type: 'bindings',
          variables: [ 'x', 'y' ],
        }),
      };
      const { op } = constructCase({
        inputBindings: [],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ countY ],
      });

      const actor = new ActorQueryOperationGroup({
        name: 'actor',
        bus,
        mediatorQueryOperation: <any> myMediatorQueryOperation,
        mediatorMergeBindingsContext,
        mediatorBindingsAggregatorFactory,
      });

      await expect(async() => arrayifyStream((<any> await actor.run(op, undefined)).bindingsStream))
        .rejects
        .toBeTruthy();
    });

    const aggregateOn = (aggregator: string, inVar: string, outVar: string): Algebra.BoundAggregate => {
      return {
        type: Algebra.types.EXPRESSION,
        expressionType: Algebra.expressionTypes.AGGREGATE,
        aggregator: <any> aggregator,
        expression: {
          type: Algebra.types.EXPRESSION,
          expressionType: Algebra.expressionTypes.TERM,
          term: DF.variable(inVar),
        },
        distinct: false,
        variable: DF.variable(outVar),
      };
    };

    it('should be able to count', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('count', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('4') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toEqual({
        cardinality: 4,
        variables: [
          { variable: DF.variable('c'), canBeUndef: false },
        ],
      });
    });
    it('should be able to count distinct', async() => {
      const aggregate = aggregateOn('count', 'x', 'c');
      aggregate.distinct = true;
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
        ],
        groupVariables: [ ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregate ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('1') ],
        ]),
      ]);
      await expect(output.metadata()).resolves.toEqual({
        cardinality: 4,
        variables: [
          { variable: DF.variable('c'), canBeUndef: false },
        ],
      });
    });

    it('should be able to count with respect to empty input with group variables', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('g'), DF.literal('a') ], [ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('g'), DF.literal('b') ], [ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('g'), DF.literal('c') ], [ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('g'), DF.literal('b') ], [ DF.variable('x'), int('4') ]]),
          BF.bindings([[ DF.variable('g'), DF.literal('a') ], [ DF.variable('x'), int('5') ]]),
        ],
        groupVariables: [ 'g' ],
        inputVariables: [ 'g', 'x' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('count', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('g'), DF.literal('a') ], [ DF.variable('c'), int('2') ]]),
        BF.bindings([[ DF.variable('g'), DF.literal('b') ], [ DF.variable('c'), int('2') ]]),
        BF.bindings([[ DF.variable('g'), DF.literal('c') ], [ DF.variable('c'), int('1') ]]),
      ]);
      await expect(output.metadata()).resolves.toEqual({
        cardinality: 5,
        variables: [
          { variable: DF.variable('g'), canBeUndef: false },
          { variable: DF.variable('c'), canBeUndef: false },
        ],
      });
    });

    it('should be able to count with respect to empty input without group variables', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('count', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('0') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('c'), canBeUndef: false },
        ]});
    });

    it('should be able to count with respect to a deletion and empty input without group variables', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('count', 'x', 'c') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('0') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 2, variables: [
          { variable: DF.variable('c'), canBeUndef: false },
        ]});
    });

    it('should be able to count with respect to additions and deletions and empty inputs', async() => {
      const buffer = [
        null,
        BF.bindings([[ DF.variable('x'), int('1') ]]),
        null,
        BF.bindings([[ DF.variable('x'), int('2') ]]),
        null,
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        null,
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];
      const iterator = new AsyncIterator<Bindings>();
      iterator.read = () => {
        if (iterator.readable) {
          const element = buffer.shift();
          if (element === null) {
            iterator.readable = false;
          }
          return element;
        }
        return null;
      };
      const { op, actor } = constructCase({
        inputBindings: iterator,
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('count', 'x', 'c') ],
        cardinality: 1,
      });
      const mediateSpy = jest.spyOn((<any> actor).mediatorBindingsAggregatorFactory, 'mediate');

      const output = <any> await actor.run(op, undefined);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('0') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('0') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('c'), int('1') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('c'), int('2') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('2') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('c'), int('1') ],
        ]),
      ]);
      iterator.readable = true;
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 2)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([
          [ DF.variable('c'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('c'), int('0') ],
        ]),
      ]);
      expect(mediateSpy).toHaveBeenCalledTimes(2);
    });

    it('should be able to sum', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('sum', 'x', 's') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('s'), int('10') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('s'), canBeUndef: false },
        ]});
    });

    it('should be able to sum with respect to empty input', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('sum', 'x', 's') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('s'), int('0') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('s'), canBeUndef: false },
        ]});
    });

    it('should sum with regard to type promotion', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('1', DF.namedNode('http://www.w3.org/2001/XMLSchema#byte')) ],
          ]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([
            [ DF.variable('x'), float('3') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('4', DF.namedNode('http://www.w3.org/2001/XMLSchema#nonNegativeInteger')) ],
          ]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('sum', 'x', 's') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('s'), float('10') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('s'), canBeUndef: false },
        ]});
    });

    it('should be able to min', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('4') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('1') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('min', 'x', 'm') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('m'), int('1') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('m'), canBeUndef: false },
        ]});
    });

    it('should be able to min with respect to the empty set', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('min', 'x', 'm') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings(),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('m'), canBeUndef: false },
        ]});
    });

    it('should be able to max', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('max', 'x', 'm') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([[ DF.variable('m'), int('4') ]]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('m'), canBeUndef: false },
        ]});
    });

    it('should be able to max with respect to the empty set', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('max', 'x', 'm') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings(),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('m'), canBeUndef: false },
        ]});
    });

    it('should be able to avg', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), float('1') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), float('2') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), float('3') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), float('4') ],
          ]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('avg', 'x', 'a') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([[ DF.variable('a'), float('2.5') ]]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('a'), canBeUndef: false },
        ]});
    });

    it('should be able to avg with respect to type preservation', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([
            [ DF.variable('x'), DF.literal('1', DF.namedNode('http://www.w3.org/2001/XMLSchema#byte')) ],
          ]),
          BF.bindings([
            [ DF.variable('x'), int('2') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), int('3') ],
          ]),
          BF.bindings([
            [ DF.variable('x'), DF.literal('4', DF.namedNode('http://www.w3.org/2001/XMLSchema#nonNegativeInteger')) ],
          ]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('avg', 'x', 'a') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('a'), decimal('2.5') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('a'), canBeUndef: false },
        ]});
    });

    it('should be able to avg with respect to empty input', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('avg', 'x', 'a') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('a'), int('0') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('a'), canBeUndef: false },
        ]});
    });

    it('should be able to sample', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('sample', 'x', 's') ],
      });

      const output = <any> await actor.run(op, undefined);
      expect((await partialArrayifyAsyncIterator(output.bindingsStream, 1))[0]).toBeTruthy();
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('s'), canBeUndef: false },
        ]});
    });

    it('should be able to sample with respect to the empty input', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('sample', 'x', 's') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings(),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('s'), canBeUndef: false },
        ]});
    });

    it('should be able to group_concat', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('group_concat', 'x', 'g') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('g'), DF.literal('1 2 3 4') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('g'), canBeUndef: false },
        ]});
    });

    it('should be able to group_concat with respect to the empty input', async() => {
      const { op, actor } = constructCase({
        inputBindings: [],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('group_concat', 'x', 'g') ],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('g'), DF.literal('') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 0, variables: [
          { variable: DF.variable('g'), canBeUndef: false },
        ]});
    });

    it('should be able to group_concat with respect to a custom separator', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), int('1') ]]),
          BF.bindings([[ DF.variable('x'), int('2') ]]),
          BF.bindings([[ DF.variable('x'), int('3') ]]),
          BF.bindings([[ DF.variable('x'), int('4') ]]),
        ],
        groupVariables: [],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [ aggregateOn('group_concat', 'x', 'g') ],
      });
      op.operation.aggregates[0].separator = ';';

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 1)).resolves.toEqualBindingsArray([
        BF.bindings([
          [ DF.variable('g'), DF.literal('1;2;3;4') ],
        ]),
      ]);
      await expect(output.metadata()).resolves
        .toEqual({ cardinality: 4, variables: [
          { variable: DF.variable('g'), canBeUndef: false },
        ]});
    });

    it('should return before executing the grouping', async() => {
      const { op, actor } = constructCase({
        inputBindings: [
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
          BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        ],
        groupVariables: [ 'x' ],
        inputVariables: [ 'x', 'y', 'z' ],
        inputOp: simpleXYZinput,
        aggregates: [],
      });

      const output = <any> await actor.run(op, undefined);
      await expect(partialArrayifyAsyncIterator(output.bindingsStream, 3)).resolves.toBeIsomorphicBindingsArray([
        BF.bindings([[ DF.variable('x'), DF.literal('aaa') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('bbb') ]]),
        BF.bindings([[ DF.variable('x'), DF.literal('ccc') ]]),
      ]);
      await expect(output.metadata()).resolves.toMatchObject({ variables: [
        { variable: DF.variable('x'), canBeUndef: false },
      ]});
    });
  });
});
