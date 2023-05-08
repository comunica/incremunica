import type * as RDF from '@rdfjs/types';
import type { AsyncIterator } from 'asynciterator';

/**
 * An immutable solution mapping object.
 * This maps variables to a terms.
 */
export type Bindings = RDF.Bindings & { diff: boolean };

/**
 * A stream of bindings.
 * @see Bindings
 */
export type BindingsStream = AsyncIterator<Bindings> & RDF.ResultStream<Bindings>;
