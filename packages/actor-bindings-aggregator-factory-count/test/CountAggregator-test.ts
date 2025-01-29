import type { ActorExpressionEvaluatorFactory } from '@comunica/bus-expression-evaluator-factory';
import type { IActionContext } from '@comunica/types';
import type { Bindings } from '@comunica/utils-bindings-factory';
import type { AggregateEvaluator, IBindingsAggregator } from '@incremunica/bus-bindings-aggregator-factory';
import { KeysBindings } from '@incremunica/context-entries';
import {
  BF,
  DF,
  getMockEEActionContext,
  getMockEEFactory,
  int,
  makeAggregate,
} from '@incremunica/dev-tools';
import type * as RDF from '@rdfjs/types';
import { CountAggregator } from '../lib';

async function runAggregator(aggregator: IBindingsAggregator, input: Bindings[]): Promise<RDF.Term | undefined> {
  for (const bindings of input) {
    await aggregator.putBindings(bindings);
  }
  return aggregator.result();
}

async function createAggregator({ expressionEvaluatorFactory, context, distinct }: {
  expressionEvaluatorFactory: ActorExpressionEvaluatorFactory;
  context: IActionContext;
  distinct: boolean;
}): Promise<CountAggregator> {
  return new CountAggregator(
    await expressionEvaluatorFactory.run({
      algExpr: makeAggregate('count', distinct).expression,
      context,
    }, undefined),
    distinct,
    true,
  );
}

describe('CountAggregator', () => {
  let expressionEvaluatorFactory: ActorExpressionEvaluatorFactory;
  let context: IActionContext;

  beforeEach(() => {
    expressionEvaluatorFactory = getMockEEFactory();

    context = getMockEEActionContext();
  });

  describe('non distinctive count', () => {
    let aggregator: IBindingsAggregator;

    beforeEach(async() => {
      aggregator = await createAggregator({ expressionEvaluatorFactory, context, distinct: false });
    });

    it('a list of bindings 1', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('3') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('4') ]]).setContextEntry(KeysBindings.isAddition, true),
      ];

      await expect(runAggregator(aggregator, input)).resolves.toEqual(int('4'));
    });

    it('a list of bindings 2', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('3') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('3') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([[ DF.variable('x'), int('4') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('4') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];

      await expect(runAggregator(aggregator, input)).resolves.toEqual(int('2'));
    });

    it('should error on a deletion if aggregator empty', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];

      await expect(runAggregator(aggregator, input)).rejects.toThrow(
        new Error('Cannot remove term "2"^^http://www.w3.org/2001/XMLSchema#integer from empty count aggregator'),
      );
    });

    it('should error on a deletion that has not been added', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('3') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];

      await expect(runAggregator(aggregator, input)).rejects.toThrow(
        new Error('Cannot remove term "2"^^http://www.w3.org/2001/XMLSchema#integer that was not added to count aggregator'),
      );
    });

    it('delete everything', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, false),
      ];

      await expect(runAggregator(aggregator, input)).resolves
        .toEqual((<AggregateEvaluator>aggregator).emptyValueTerm());
    });

    it('with respect to empty input', async() => {
      await expect(runAggregator(aggregator, [])).resolves.toEqual(int('0'));
    });
  });

  describe('distinctive count', () => {
    let aggregator: IBindingsAggregator;

    beforeEach(async() => {
      aggregator = await createAggregator({ expressionEvaluatorFactory, context, distinct: true });
    });

    it('a list of bindings 1', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([
          [ DF.variable('x'), int('1') ],
          [ DF.variable('y'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ];

      await expect(runAggregator(aggregator, input)).resolves.toEqual(int('2'));
    });

    it('a list of bindings 2', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), int('1') ],
          [ DF.variable('y'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
      ];

      await expect(runAggregator(aggregator, input)).resolves.toEqual(int('2'));
    });

    it('a list of bindings 3', async() => {
      const input = [
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('2') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), int('1') ],
          [ DF.variable('y'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, true),
        BF.bindings([[ DF.variable('x'), int('1') ]]).setContextEntry(KeysBindings.isAddition, false),
        BF.bindings([
          [ DF.variable('x'), int('1') ],
          [ DF.variable('y'), int('1') ],
        ]).setContextEntry(KeysBindings.isAddition, false),
      ];

      await expect(runAggregator(aggregator, input)).resolves.toEqual(int('1'));
    });

    it('with respect to empty input', async() => {
      await expect(runAggregator(aggregator, [])).resolves.toEqual(int('0'));
    });
  });
});
