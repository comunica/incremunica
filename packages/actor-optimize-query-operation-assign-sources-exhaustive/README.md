# Incremunica Assign Sources Exhaustive Optimize Query Operation Actor

[![npm version](https://badge.fury.io/js/%40incremunica%2Factor-optimize-query-operation-assign-sources-exhaustive.svg)](https://www.npmjs.com/package/@incremunica/actor-optimize-query-operation-assign-sources-exhaustive)

An [Optimize Query Operation](https://github.com/incremunica/incremunica/tree/master/packages/bus-optimize-query-operation) actor
that converts every quad pattern in the query to a union of quad patterns per source.
It will similarly handle property paths.

If only a single source is being queried over, it will attempt to assign the whole query operation to the source
if the source supports such operations. Otherwise, it will fallback to the union-based approach.

## Install

```bash
$ yarn add @incremunica/actor-optimize-query-operation-assign-sources-exhaustive
```

## Configure

After installing, this package can be added to your engine's configuration as follows:
```text
{
  "@context": [
    ...
    "https://linkedsoftwaredependencies.org/bundles/npm/@incremunica/actor-optimize-query-operation-assign-sources-exhaustive/^1.0.0/components/context.jsonld"
  ],
  "actors": [
    ...
    {
      "@id": "urn:comunica:default:optimize-query-operation/actors#assign-sources-exhaustive",
      "@type": "ActorOptimizeQueryOperationAssignSourcesExhaustive"
    }
  ]
}
```
