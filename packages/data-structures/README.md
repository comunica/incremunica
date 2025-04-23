# Incremunica data structures

[![npm version](https://badge.fury.io/js/%40incremunica%2Fdata-structures.svg)](https://www.npmjs.com/package/@incremunica/data-structures)

A collection of reusable data structures.

## Install

```bash
$ yarn add @incremunica/data-structures
```

## Usage

### Queue
```typescript
import { Queue } from '@incremunica/data-structures';

const queue = new Queue<number>();
queue.push(1);
queue.push(2);
console.log(queue.shift()); // 1
console.log(queue.shift()); // 2
```

### DoublyLinkedList
```typescript
import { DoublyLinkedList } from '@incremunica/data-structures';

const list = new DoublyLinkedList<number>();
list.push(1); // list: [ 1 ]
list.addAt(1, 2); // list:  [ 1, 2 ]
list.unshift(0); // list:  [ 0, 1, 2 ]
console.log(list.pop()); // prints: 2 list: [ 0, 1 ]
console.log(list.shift()); // prints: 0 list: [ 1 ]
console.log(list.deleteAt(0)); // prints: 1 list: [ ]
```
