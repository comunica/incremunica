import { Queue } from '../lib';

describe('Queue', () => {
  let queue: Queue<number>;

  beforeEach(() => {
    queue = new Queue();
  });

  it('should be empty initially', () => {
    expect(queue).toHaveLength(0);
    expect(queue.peek()).toBeUndefined();
    expect(queue[Symbol.iterator]().next().done).toBe(true);
  });

  it('should push elements correctly', () => {
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(queue).toHaveLength(3);
    expect(queue.peek()).toBe(1);
  });

  it('should shift elements correctly', () => {
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(queue.shift()).toBe(1);
    expect(queue.peek()).toBe(2);
    expect(queue).toHaveLength(2);
  });

  it('should handle empty queue for shift', () => {
    expect(queue.shift()).toBeUndefined();
  });

  it('should correctly use iterator', () => {
    queue.push(1);
    queue.push(2);
    queue.push(3);

    const values = [ ...queue ];
    expect(values).toEqual([ 1, 2, 3 ]);
  });

  it('should correctly drain the queue', () => {
    queue.push(1);
    queue.push(2);
    queue.push(3);

    const values = [ ...queue.drain() ];
    expect(values).toEqual([ 1, 2, 3 ]);
    expect(queue).toHaveLength(0);
  });

  it('should clear the queue', () => {
    queue.push(1);
    queue.push(2);
    queue.push(3);

    queue.clear();
    expect(queue).toHaveLength(0);
    expect(queue.peek()).toBeUndefined();
  });

  it('should initialize with provided values', () => {
    const initialValues = [ 1, 2, 3 ];
    queue = new Queue(initialValues);
    expect(queue).toHaveLength(3);
    expect([ ...queue ]).toEqual(initialValues);
  });
});
