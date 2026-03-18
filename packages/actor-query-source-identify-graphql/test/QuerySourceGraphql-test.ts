import { ActionContext } from '@comunica/core';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { DataFactory } from 'rdf-data-factory';
import { Algebra, Factory } from 'sparqlalgebrajs';
import { AsyncResourceIterator } from '../lib/AsyncResourceIterator';
import { QuerySourceGraphql } from '../lib/QuerySourceGraphql';

const mediatorMergeBindingsContext: any = {
  mediate: () => ({}),
};

const mediatorHttp: any = {
  mediate: jest.fn(async(action: any) => {
    return new Response(new ReadableStream(), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
};

const DF = new DataFactory();

const schemaSDL = `
type Subscription {
  onPersonAdded: ex_Person!
  onPersonDeleted: ex_Person!
}

type ex_Person {
  id: ID!
  ex_name: String
}
`;

const context = { ex: 'http://example.com/' };

describe('QuerySourceGraphql', () => {
  let source: QuerySourceGraphql;
  let BF: BindingsFactory;
  let AF: Factory;

  beforeEach(async() => {
    BF = await BindingsFactory.create(mediatorMergeBindingsContext, new ActionContext(), DF);
    AF = new Factory(DF);

    source = new QuerySourceGraphql(
      'http://example.com/graphql',
      DF,
      BF,
      mediatorHttp,
      schemaSDL,
      context,
    );
  });

  it('should construct a graphql query source', async() => {
    await expect(source.getSelectorShape()).resolves.toEqual({
      type: 'disjunction',
      children: [
        {
          type: 'operation',
          operation: {
            operationType: 'type',
            type: Algebra.types.JOIN,
          },
        },
        {
          type: 'operation',
          operation: {
            operationType: 'type',
            type: Algebra.types.BGP,
          },
        },
        {
          type: 'operation',
          operation: {
            operationType: 'pattern',
            pattern: AF.createPattern(
              DF.variable('s'),
              DF.variable('p'),
              DF.variable('o'),
            ),
          },
          variablesOptional: [
            DF.variable('s'),
            DF.variable('p'),
            DF.variable('o'),
          ],
        },
      ],
    });
  });

  it('should only support querying bindings', () => {
    expect(() => source.queryBoolean(AF.createAsk(AF.createNop()), new ActionContext()))
      .toThrow('queryBoolean is not implemented in QuerySourceGraphql');
    expect(() => source.queryQuads(AF.createNop(), new ActionContext()))
      .toThrow('queryQuads is not implemented in QuerySourceGraphql');
    expect(() => source.queryVoid(AF.createNop(), new ActionContext()))
      .toThrow('queryVoid is not implemented in QuerySourceGraphql');
  });

  it('should return a string representation', () => {
    expect(source.toString()).toBe('QuerySourceGraphql(http://example.com/graphql)');
  });

  describe('queryBindings', () => {
    it('should create a bindings iterator', async() => {
      const pattern = AF.createPattern(
        DF.variable('s'),
        DF.namedNode('http://example.com/name'),
        DF.variable('name'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());

      expect(stream).toBeInstanceOf(AsyncResourceIterator);
    });

    it('should attach metadata to the iterator', async() => {
      const pattern = AF.createPattern(
        DF.variable('s'),
        DF.namedNode('http://example.com/name'),
        DF.variable('name'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());

      const metadata = await stream.getProperty('metadata');

      expect(metadata.variables).toHaveLength(2);
    });
  });
});
