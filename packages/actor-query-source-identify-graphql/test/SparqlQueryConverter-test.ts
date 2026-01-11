import { DataFactory } from 'rdf-data-factory';
import type { Algebra } from 'sparqlalgebrajs';
import { SparqlQueryConverter } from '../lib';

const DF = new DataFactory();

const schemaSDL = `
type Subscription {
  person(id: ID!): ex_Person
  persons: [ex_Person!]!
}

type ex_Person {
  id: ID!
  ex_name: String
  ex_age: Int
  ex_knows(id: ID): [ex_Person!]!
  ex_rdf: RDFNode
  ex_lit: BoxedLiteral
}
`;

const context = { ex: 'http://example.com/' };

function pattern(s: any, p: any, o: any): Algebra.Pattern {
  return <Algebra.Pattern>{ type: 'pattern', subject: s, predicate: p, object: o };
}

describe('SparqlQueryConverter', () => {
  let converter: SparqlQueryConverter;

  beforeEach(() => {
    converter = new SparqlQueryConverter(DF, context, schemaSDL);
  });

  it('constructor discovers entry fields from schema', () => {
    expect((<any>converter).entryFields).toHaveLength(2);
  });

  it('throws if subscription type missing', () => {
    expect(() => new SparqlQueryConverter(DF, {}, 'type Query { hello: String }'))
      .toThrow(/Schema does not define a subscription type/u);
  });

  it('throws if predicate prefix missing in context', () => {
    const converter = new SparqlQueryConverter(DF, {}, schemaSDL);
    const patterns = [
      pattern(DF.namedNode('s'), DF.namedNode('http://example.com/name'), DF.literal('alice')),
    ];
    expect(() => converter.convertOperation(patterns))
      .toThrow(/Missing predicate prefix in context/u);
  });

  describe('convertOperation', () => {
    it('throws if multiple roots', () => {
      const patterns = [
        pattern(DF.namedNode('a'), DF.namedNode('http://example.com/name'), DF.literal('x')),
        pattern(DF.namedNode('b'), DF.namedNode('http://example.com/age'), DF.literal('y')),
      ];

      expect(() => converter.convertOperation(patterns))
        .toThrow(/Multiple entrypoints/u);
    });

    it('throws if no roots', () => {
      const patterns = [
        pattern(DF.variable('a'), DF.namedNode('http://example.com/knows'), DF.variable('b')),
        pattern(DF.variable('b'), DF.namedNode('http://example.com/age'), DF.variable('a')),
      ];

      expect(() => converter.convertOperation(patterns))
        .toThrow(/No entrypoints/u);
    });

    it('handles ?s p o with literal object', () => {
      const patterns = [
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/age'),
          DF.literal('40', DF.namedNode('http://www.w3.org/2001/XMLSchema#integer')),
        ),
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/name'),
          DF.literal('Alice'),
        ),
      ];

      const result = converter.convertOperation(patterns);
      expect(result).toHaveLength(1);

      const [ query, variables, filterMap ] = result[0];
      expect(query).toBe(`persons { id ex_age @filter(if: "ex_age==40") ex_name @filter(if: "ex_name=='Alice'") }`);
      expect(variables).toEqual({
        s: 'persons_id',
      });
      expect(filterMap).toEqual({});
    });

    it('handles ?s p o with named node object', () => {
      const patterns = [
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/knows'),
          DF.namedNode('http://example.com/Bob'),
        ),
      ];

      const result = converter.convertOperation(patterns);
      expect(result).toHaveLength(1);

      const [ query, variables, filterMap ] = result[0];
      expect(query).toBe(`persons { id ex_knows(id: "http://example.com/Bob") { id } }`);
      expect(variables).toEqual({
        s: 'persons_id',
      });
      expect(filterMap).toEqual({});
    });

    it('handles s p ?o with expected literal object', () => {
      const patterns = [
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.namedNode('http://example.com/name'),
          DF.variable('o'),
        ),
      ];

      const result = converter.convertOperation(patterns);
      expect(result).toHaveLength(2);

      expect(result[0][0]).toBe(`person(id: "http://example.com/Alice") { ex_name }`);
      expect(result[0][1]).toEqual({
        o: 'person_ex_name',
      });
      expect(result[0][2]).toEqual({});

      expect(result[1][0]).toBe(`persons(id: "http://example.com/Alice") { ex_name }`);
      expect(result[1][1]).toEqual({
        o: 'persons_ex_name',
      });
      expect(result[1][2]).toEqual({});
    });

    it('handles s p ?o with expected named node object', () => {
      const patterns = [
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.namedNode('http://example.com/knows'),
          DF.variable('o'),
        ),
      ];

      const result = converter.convertOperation(patterns);
      expect(result).toHaveLength(2);

      const [ query, variables, filterMap ] = result[0];
      expect(query).toBe(`person(id: "http://example.com/Alice") { ex_knows { id } }`);
      expect(variables).toEqual({
        o: 'person_ex_knows_id',
      });
      expect(filterMap).toEqual({});
    });

    it('handles nested patterns', () => {
      const patterns = [
        pattern(
          DF.variable('person'),
          DF.namedNode('http://example.com/name'),
          DF.variable('name'),
        ),
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.namedNode('http://example.com/knows'),
          DF.variable('person'),
        ),
      ];

      const results = converter.convertOperation(patterns);
      expect(results).toHaveLength(2);

      const [ query, variables, filterMap ] = results[0];
      expect(query).toBe(`person(id: "http://example.com/Alice") { ex_knows { id ex_name } }`);
      expect(variables).toEqual({
        person: 'person_ex_knows_id',
        name: 'person_ex_knows_ex_name',
      });
      expect(filterMap).toEqual({});
    });

    it('throws on variable predicate', () => {
      const patterns = [
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.variable('p'),
          DF.literal('x'),
        ),
      ];

      expect(() => converter.convertOperation(patterns))
        .toThrow(/variable predicate/u);
    });

    it('handles variable RDFNode/BoxedLiteral types', () => {
      const patterns = [
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/rdf'),
          DF.variable('c'),
        ),
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/lit'),
          DF.variable('l'),
        ),
      ];

      const [ query, variables, filterMap ] = converter.convertOperation(patterns)[0];
      expect(query).toBe(`persons { id ex_rdf { _rawRDF } ex_lit { _rawRDF } }`);
      expect(variables).toEqual({
        s: 'persons_id',
        c: 'persons_ex_rdf__rawRDF',
        l: 'persons_ex_lit__rawRDF',
      });
      expect(filterMap).toEqual({});
    });

    it('handles literal RDFNode/BoxedLiteral types', () => {
      const patterns = [
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/rdf'),
          DF.literal('x'),
        ),
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/lit'),
          DF.literal('x'),
        ),
      ];

      const [ query, variables, filterMap ] = converter.convertOperation(patterns)[0];
      expect(query).toBe(`persons { id ex_rdf { _rawRDF } ex_lit { _rawRDF } }`);
      expect(variables).toEqual({
        s: 'persons_id',
      });
      expect(filterMap).toEqual({
        persons_ex_lit__rawRDF: {
          '@type': 'http://www.w3.org/2001/XMLSchema#string',
          '@value': 'x',
        },
        persons_ex_rdf__rawRDF: {
          '@type': 'http://www.w3.org/2001/XMLSchema#string',
          '@value': 'x',
        },
      });
    });

    it('handles namednode RDFNode types', () => {
      const patterns = [
        pattern(
          DF.variable('s'),
          DF.namedNode('http://example.com/rdf'),
          DF.namedNode('http://example.com/x'),
        ),
      ];

      const [ query, variables, filterMap ] = converter.convertOperation(patterns)[0];
      expect(query).toBe(`persons { id ex_rdf { _rawRDF } }`);
      expect(variables).toEqual({
        s: 'persons_id',
      });
      expect(filterMap).toEqual({
        persons_ex_rdf__rawRDF: {
          '@id': 'http://example.com/x',
        },
      });
    });

    it('returns no queries when patterns do not match the schema', () => {
      const patterns1 = [
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.namedNode('http://example.com/hobby'),
          DF.variable('o'),
        ),
      ];

      const result1 = converter.convertOperation(patterns1);
      expect(result1).toHaveLength(0);

      const patterns2 = [
        pattern(
          DF.namedNode('http://example.com/Alice'),
          DF.namedNode('http://example.com/knows'),
          DF.variable('person'),
        ),
        pattern(
          DF.variable('person'),
          DF.namedNode('http://example.com/name'),
          DF.namedNode('http://exapmle.com/bob'),
        ),
      ];

      const result2 = converter.convertOperation(patterns2);
      expect(result2).toHaveLength(0);
    });
  });
});
