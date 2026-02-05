import { ActionContext } from '@comunica/core';
import { BindingsFactory } from '@comunica/utils-bindings-factory';
import { DataFactory } from 'rdf-data-factory';
import { Algebra, Factory } from 'sparqlalgebrajs';
import { QuerySourceGraphql } from '../lib/QuerySourceGraphql';

const mediatorMergeBindingsContext: any = {
  mediate: () => ({}),
};

function createInteractiveSseMediatorHttp() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();

  return {
    mediator: {
      mediate: jest.fn(async() => {
        const stream = new ReadableStream({
          start(c) {
            controller = c;
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
          },
        });
      }),
    },

    emit(event: any) {
      controller.enqueue(
        encoder.encode(
          `event: next\n` +
          `data: ${JSON.stringify(event)}\n\n`,
        ),
      );
    },

    emitRaw(raw: string) {
      controller.enqueue(encoder.encode(`${raw}\n\n`));
    },

    close() {
      controller.close();
    },
  };
}

function createFailingMediatorHttp500() {
  return {
    mediate: jest.fn(async() => {
      return new Response('Internal Server Error', {
        status: 500,
        statusText: 'Internal Server Error',
      });
    }),
  };
}

function createMediatorHttpNoBody() {
  return {
    mediate: jest.fn(async() => {
      return new Response(null, {
        status: 200,
        statusText: 'OK',
      });
    }),
  };
}

const DF = new DataFactory();

const schemaSDL = `
type Subscription {
  onPersonAdded: ex_Person!
}

type ex_Person {
  id: ID!
  ex_name: String
  ex_age: Int
  ex_knows: [ex_Person!]!
  ex_date: Date
  ex_datetime: DateTime
  ex_time: Time
  ex_decimal: Float
  ex_false: Boolean
  ex_true: Boolean
  ex_rdf: RDFNode
  ex_lit: BoxedLiteral
}
`;

const context = { ex: 'http://example.com/' };

describe('QuerySourceGraphql', () => {
  let source: QuerySourceGraphql;
  let BF: BindingsFactory;
  let AF: Factory;
  let sse: any;

  beforeEach(async() => {
    BF = await BindingsFactory.create(mediatorMergeBindingsContext, new ActionContext(), DF);
    AF = new Factory(DF);
    sse = createInteractiveSseMediatorHttp();

    source = new QuerySourceGraphql(
      'http://example.com/graphql',
      DF,
      BF,
      sse.mediator,
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
    it('should query patterns', async() => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/age'),
        DF.variable('age'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(3);
        expect(results[0].get(DF.variable('age'))?.value).toBe('15');
        expect(results[1].get(DF.variable('age'))?.value).toBe('20');
        expect(results[2].get(DF.variable('age'))?.value).toBe('25');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Alice', ex_age: 15 }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Bob', ex_age: 20 }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Carol', ex_age: 25 }},
      });

      // Close the SSE channel
      sse.close();
    });

    it('should query a BGP', async() => {
      const bgp = AF.createBgp([
        AF.createPattern(
          DF.variable('person'),
          DF.namedNode('http://example.com/name'),
          DF.variable('name'),
        ),
      ]);

      const stream = source.queryBindings(bgp, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(3);
        expect(results[0].get(DF.variable('name'))?.value).toBe('alice');
        expect(results[1].get(DF.variable('name'))?.value).toBe('bob');
        expect(results[2].get(DF.variable('name'))?.value).toBe('carol');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Alice', ex_name: 'alice' }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Bob', ex_name: 'bob' }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Carol', ex_name: 'carol' }},
      });

      // Close the SSE channel
      sse.close();
    });

    it('should query BGP joins', async() => {
      const join = AF.createJoin(
        [
          AF.createBgp([
            AF.createPattern(
              DF.variable('person'),
              DF.namedNode('http://example.com/knows'),
              DF.variable('friend'),
            ),
          ]),
          AF.createBgp([
            AF.createPattern(
              DF.variable('friend'),
              DF.namedNode('http://example.com/name'),
              DF.variable('name'),
            ),
          ]),
        ],
      );

      const stream = source.queryBindings(join, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(1);
        expect(results[0].get(DF.variable('person'))?.value).toBe('http://example.com/Alice');
        expect(results[0].get(DF.variable('friend'))?.value).toBe('http://example.com/Bob');
        expect(results[0].get(DF.variable('name'))?.value).toBe('bob');
      });

      // Emit SSE event
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Alice',
            ex_knows: [
              { id: 'http://example.com/Bob', ex_name: 'bob' },
            ],
          },
        },
      });

      // Close the SSE channel
      sse.close();
    });

    it('should query a BGP projects', async() => {
      const project = AF.createProject(
        AF.createBgp([
          AF.createPattern(
            DF.variable('person'),
            DF.namedNode('http://example.com/name'),
            DF.variable('name'),
          ),
        ]),
        [ DF.variable('person'), DF.variable('name') ],
      );

      const stream = source.queryBindings(project, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(3);
        expect(results[0].get(DF.variable('name'))?.value).toBe('alice');
        expect(results[1].get(DF.variable('name'))?.value).toBe('bob');
        expect(results[2].get(DF.variable('name'))?.value).toBe('carol');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Alice', ex_name: 'alice' }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Bob', ex_name: 'bob' }},
      });
      sse.emit({
        data: { onPersonAdded: { id: 'http://example.com/Carol', ex_name: 'carol' }},
      });

      // Close the SSE channel
      sse.close();
    });

    it('should fail with other types', async() => {
      const ask = AF.createAsk(
        AF.createBgp([
          AF.createPattern(
            DF.variable('person'),
            DF.namedNode('http://example.com/name'),
            DF.variable('name'),
          ),
        ]),
      );

      expect(() => source.queryBindings(ask, new ActionContext()))
        .toThrow(/Unsupported operation type/u);
    });

    it('should convert graphql values to literals', async() => {
      const bgp = AF.createBgp([
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/age'),
          DF.variable('age'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/decimal'),
          DF.variable('decimal'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/false'),
          DF.variable('false'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/true'),
          DF.variable('true'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/date'),
          DF.variable('date'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/datetime'),
          DF.variable('datetime'),
        ),
        AF.createPattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/time'),
          DF.variable('time'),
        ),
      ]);

      const stream = source.queryBindings(bgp, new ActionContext());
      const results: any[] = [];

      await new Promise<void>((resolve, reject) => {
        stream.on('data', data => results.push(data));
        stream.on('error', reject);
        stream.on('end', resolve);

        // Emit SSE event
        sse.emit({
          data: {
            onPersonAdded: {
              id: 'http://example.com/Alice',
              ex_age: 36,
              ex_decimal: 0.59,
              ex_true: true,
              ex_false: false,
              ex_date: '2024-01-01',
              ex_datetime: '2024-01-01T12:30:00Z',
              ex_time: '12:30:00',
            },
          },
        });

        // Close the SSE channel
        sse.close();
      });

      // Assertions
      expect(results).toHaveLength(1);

      expect(results[0].get(DF.variable('age'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#integer');

      expect(results[0].get(DF.variable('decimal'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#decimal');

      expect(results[0].get(DF.variable('true'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#boolean');

      expect(results[0].get(DF.variable('false'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#boolean');

      expect(results[0].get(DF.variable('date'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#date');

      expect(results[0].get(DF.variable('datetime'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#dateTime');

      expect(results[0].get(DF.variable('time'))?.datatype.value)
        .toBe('http://www.w3.org/2001/XMLSchema#time');
    });

    it('should filter when querying with RDF nodes', () => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/rdf'),
        DF.namedNode('http://example.com/ok'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(1);
        expect(results[0].get(DF.variable('person'))?.value).toBe('http://example.com/Alice');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Alice',
            ex_rdf: { _rawRDF: { '@id': 'http://example.com/ok' }},
          },
        },
      });
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Bob',
            ex_rdf: { _rawRDF: { '@id': 'http://example.com/notok' }},
          },
        },
      });

      // Close the SSE channel
      sse.close();
    });

    it('should filter when querying with Boxed Literals', () => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/lit'),
        DF.literal('ok'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(1);
        expect(results[0].get(DF.variable('person'))?.value).toBe('http://example.com/Alice');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Alice',
            ex_lit: { _rawRDF: {
              '@type': 'http://www.w3.org/2001/XMLSchema#string',
              '@value': 'ok',
            }},
          },
        },
      });
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Bob',
            ex_lit: { _rawRDF: {
              '@type': 'http://www.w3.org/2001/XMLSchema#integer',
              '@value': 26,
            }},
          },
        },
      });

      // Close the SSE channel
      sse.close();
    });

    it('should convert raw RDF values', () => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/rdf'),
        DF.variable('o'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => {
        // Assertions
        expect(results).toHaveLength(2);
        expect(results[0].get(DF.variable('o'))?.value).toBe('ok');
        expect(results[1].get(DF.variable('o'))?.value).toBe('http://example.com/ok');
      });

      // Emit multiple SSE events in order
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Alice',
            ex_rdf: { _rawRDF: {
              '@type': 'http://www.w3.org/2001/XMLSchema#string',
              '@value': 'ok',
            }},
          },
        },
      });
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Bob',
            ex_rdf: { _rawRDF: {
              '@id': 'http://example.com/ok',
            }},
          },
        },
      });

      // Close the SSE channel
      sse.close();
    });

    it('should handle empty SSE data events', async() => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/name'),
        DF.variable('name'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());
      const results: any[] = [];

      stream.on('data', data => results.push(data));
      stream.on('end', () => expect(results).toHaveLength(0));

      sse.emitRaw(`event: next\ndata:`);

      sse.close();
    });

    it('should fail on malformed raw RDF values', async() => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/rdf'),
        DF.variable('o'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());

      // Emit multiple SSE events in order
      sse.emit({
        data: {
          onPersonAdded: {
            id: 'http://example.com/Alice',
            ex_rdf: { _rawRDF: {
              '@malformed': 'x',
            }},
          },
        },
      });

      await expect(
        new Promise((_, reject) => {
          stream.on('error', reject);
        }),
      ).rejects.toThrow(/Invalid RawRDF format/u);
    });

    it('should fail when no viable query can be constructed', () => {
      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/fail'),
        DF.variable('x'),
      );

      expect(() => source.queryBindings(pattern, new ActionContext()))
        .toThrow(/Unable to convert SPARQL Query to Graphql Query for source/u);
    });

    it('should fail when response has no body', async() => {
      const mediatorHttp = createMediatorHttpNoBody();

      const source = new QuerySourceGraphql(
        'http://example.com/graphql',
        DF,
        BF,
        <any>mediatorHttp,
        schemaSDL,
        context,
      );

      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/name'),
        DF.variable('name'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());

      await expect(
        new Promise((_, reject) => {
          stream.on('error', reject);
        }),
      ).rejects.toThrow('Unable to parse body of subscription stream');
    });

    it('should fail when no connection can be made to the source', async() => {
      const mediatorHttp = createFailingMediatorHttp500();

      const source = new QuerySourceGraphql(
        'http://example.com/graphql',
        DF,
        BF,
        <any>mediatorHttp,
        schemaSDL,
        context,
      );

      const pattern = AF.createPattern(
        DF.variable('person'),
        DF.namedNode('http://example.com/name'),
        DF.variable('name'),
      );

      const stream = source.queryBindings(pattern, new ActionContext());

      await expect(
        new Promise((_, reject) => {
          stream.on('error', reject);
        }),
      ).rejects.toThrow(/Unable to start subscription stream/u);
    });
  });
});
