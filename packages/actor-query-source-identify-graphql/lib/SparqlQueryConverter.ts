import type { ComunicaDataFactory } from '@comunica/types';
import type * as RDF from '@rdfjs/types';
import type { GraphQLArgument, GraphQLField, GraphQLObjectType } from 'graphql';
import { getNamedType, GraphQLID, buildSchema, isScalarType, GraphQLNonNull } from 'graphql';
import type { Algebra } from 'sparqlalgebrajs';

export class SparqlQueryConverter {
  private readonly factory: ComunicaDataFactory;
  private readonly context: Record<string, string>;
  private readonly entryFields: Field[];

  public constructor(factory: ComunicaDataFactory, context: Record<string, string>, schema_source: string) {
    this.factory = factory;
    this.context = context;

    schema_source = `
    scalar BoxedLiteral
    scalar RDFNode
    scalar DateTime
    scalar Date
    scalar Time
    ${schema_source}
    `;
    const schema = buildSchema(schema_source, {
      assumeValidSDL: true,
    });
    const subcriptionType = schema.getSubscriptionType() ?? (() => {
      throw new Error('Schema does not define a subscription type.');
    })();
    this.entryFields = Object.values(subcriptionType.getFields()).map(field => new Field(field));
  }

  public convertOperation(patterns: Algebra.Pattern[]): [string, Record<string, string>, Record<string, RawRDF>][] {
    const trees = this.patternsToTrees(patterns);

    if (trees.roots.length > 1) {
      throw new Error(`Multiple entrypoints found: ${trees.roots.length}`);
    }
    if (trees.roots.length <= 0) {
      throw new Error(`No entrypoints found`);
    }

    const tree = trees.roots[0];
    return filterFields(this.entryFields, tree).map(field => field.toQuery(tree));
  }

  private toSchemaNs(term: RDF.Term): RDF.Term {
    for (const [ prefix, ns ] of Object.entries(this.context)) {
      if (term.value.startsWith(ns)) {
        const local = term.value.slice(ns.length);
        return this.factory.namedNode(`${prefix}_${local}`);
      }
    }

    throw new Error(`Missing predicate prefix in context: ${term.value}`);
  }

  private patternsToTrees(patterns: Algebra.Pattern[]): Trees {
    const nodes: Record<string, TreeNode> = {};
    const roots: Record<string, TreeNode> = {};

    for (const pattern of patterns) {
      if (pattern.predicate.termType === 'Variable') {
        throw new Error(`Cannot convert queries with a variable predicate.`);
      }

      const subject = pattern.subject;
      const pred = this.toSchemaNs(pattern.predicate).value;
      const object = pattern.object;

      if (!nodes[subject.value]) {
        nodes[subject.value] = { term: subject, children: {}};
        roots[subject.value] = nodes[subject.value];
      }

      if (object.termType === 'Literal') {
        nodes[subject.value].children[pred] = { term: object, children: {}};
      } else {
        if (!nodes[object.value]) {
          nodes[object.value] = { term: object, children: {}};
        }
        nodes[subject.value].children[pred] = nodes[object.value];
      }

      if (roots[object.value]) {
        delete roots[object.value];
      }
    }

    return {
      roots: Object.values(roots),
      nodes,
    };
  }
}

class Field {
  private readonly field: GraphQLField<any, any, any>;
  private readonly fieldType: GraphQLObjectType;
  private readonly idArg: GraphQLArgument | undefined;
  private readonly idField: GraphQLField<any, any, any> | undefined;

  public constructor(field: GraphQLField<any, any, any>) {
    this.field = field;
    this.fieldType = <GraphQLObjectType>getNamedType(field.type);
    this.idArg = field.args.find(arg => getNamedType(arg.type) === GraphQLID);
    if (this.idArg === undefined && !isScalarType(this.fieldType)) {
      this.idField = Object.values(this.fieldType.getFields()).find(field =>
        getNamedType(field.type) === GraphQLID);
    }
  }

  public id(): string | undefined {
    if (this.idArg !== undefined) {
      return this.idArg.name;
    }
    if (this.idField !== undefined) {
      return this.idField.name;
    }
  }

  public scalarLeaf(): boolean {
    return isScalarType(this.fieldType);
  }

  public RDFLeaf(): boolean {
    return this.fieldType.name === 'RDFNode' || this.fieldType.name === 'BoxedLiteral';
  }

  public toQuery(node: TreeNode): [string, Record<string, string>, Record<string, RawRDF>] {
    const varMap: Record<string, string> = {};
    const filterMap: Record<string, RawRDF> = {};
    let query = this.field.name;

    if (Object.keys(node.children).length > 0) {
      // Not a leaf node
      if (node.term.termType === 'NamedNode') {
        query += `(${this.id()}: "${node.term.value}")`;
      }

      query += ' { ';

      if (node.term.termType === 'Variable') {
        query += `${this.id()} `;
        varMap[node.term.value] = `${this.field.name}_${this.id()}`;
      }

      // Recursively add children
      for (const [ pred, child ] of Object.entries(node.children)) {
        const field = this.subField(pred);
        const [ childQuery, childVarMap, childFilterMap ] = field.toQuery(child);

        query += `${childQuery} `;

        // Update mapped variables
        for (const [ variable, mappedId ] of Object.entries(childVarMap)) {
          varMap[variable] = `${this.field.name}_${mappedId}`;
        }
        // Update filters
        for (const [ filterId, filterValue ] of Object.entries(childFilterMap)) {
          filterMap[`${this.field.name}_${filterId}`] = filterValue;
        }
      }

      query += '} ';
    } else if (node.term.termType === 'Variable') {
      // Leaf node with a variable
      if (this.RDFLeaf()) {
        query += ' { _rawRDF } ';
        varMap[node.term.value] = `${this.field.name}__rawRDF`;
      } else if (this.scalarLeaf()) {
        varMap[node.term.value] = this.field.name;
      } else {
        query += ' { id } ';
        varMap[node.term.value] = `${this.field.name}_id`;
      }
    } else if (node.term.termType === 'Literal') {
      // Leaf node with a literal
      if (this.RDFLeaf()) {
        query += ' { _rawRDF } ';
        filterMap[`${this.field.name}__rawRDF`] = {
          '@value': node.term.value,
          '@type': node.term.datatype.value,
        };
      } else {
        query += ` @filter(if: "${this.field.name}==${valueFromLiteral(node.term)}") `;
      }
    } else if (node.term.termType === 'NamedNode') {
      // Leaf node with a NamedNode
      if (this.RDFLeaf()) {
        query += ' { _rawRDF } ';
        filterMap[`${this.field.name}__rawRDF`] = {
          '@id': node.term.value,
        };
      } else {
        query += `(id: "${node.term.value}") { id } `;
      }
    }

    return [ query.replaceAll(/\s+/ug, ' ').trim(), varMap, filterMap ];
  }

  public withId(subj: RDF.Term): boolean {
    if (subj.termType === 'Variable') {
      return !this.idArg || !(this.idArg.type instanceof GraphQLNonNull);
    }
    return this.idArg !== undefined || this.idField !== undefined;
  }

  public withPredNode(pred: string, node: TreeNode): boolean {
    if (!(pred in this.fieldType.getFields())) {
      return false;
    }
    const field = new Field(this.fieldType.getFields()[pred]);

    // Literals are only found on leafs
    if (node.term.termType === 'Literal') {
      return field.scalarLeaf();
    }

    // RDFNode accepts all term types
    if (field.fieldType.name === 'RDFNode') {
      return true;
    }

    // Check if this field accepts the node term
    if (!field.withId(node.term)) {
      return false;
    }

    for (const [ child_pred, child_node ] of Object.entries(node.children)) {
      // Check if this field accepts the children terms
      if (!field.withPredNode(child_pred, child_node)) {
        return false;
      }
    }

    return true;
  }

  public subField(pred: string): Field {
    return new Field(this.fieldType.getFields()[pred]);
  }
}

function valueFromLiteral(term: RDF.Literal): string {
  const dt = term.datatype.value;

  // Common XSD numeric types
  const numericTypes = [
    'http://www.w3.org/2001/XMLSchema#integer',
    'http://www.w3.org/2001/XMLSchema#decimal',
    'http://www.w3.org/2001/XMLSchema#double',
    'http://www.w3.org/2001/XMLSchema#float',
  ];

  // Booleans
  const booleanType = 'http://www.w3.org/2001/XMLSchema#boolean';

  if (numericTypes.includes(dt) || booleanType.includes(dt)) {
    return term.value;
  }
  return `'${term.value}'`;
}

function filterFields(fields: Field[], node: TreeNode): Field[] {
  let filtered = [ ...fields ];

  filtered = filtered.filter(field => field.withId(node.term));

  for (const [ p, child ] of Object.entries(node.children)) {
    filtered = filtered.filter(field => field.withPredNode(p, child));
  }

  return filtered;
}

export interface RawRDF {
  '@id'?: string;
  '@value'?: string;
  '@type'?: string;
}

interface TreeNode {
  term: RDF.Term;
  children: Record<string, TreeNode>;
}

interface Trees {
  roots: TreeNode[];
  nodes: Record<string, TreeNode>;
}
