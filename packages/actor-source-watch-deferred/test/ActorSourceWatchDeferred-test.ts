import { EventEmitter } from 'events';
import { ActionContext, Bus } from '@comunica/core';
import type { IActionSourceWatch } from '@incremunica/bus-source-watch';
import { KeysSourceWatch } from '@incremunica/context-entries';
import { ActorSourceWatchDeferred } from '../lib';
import 'jest-rdf';
import '@comunica/utils-jest';

describe('ActorSourceWatchDeferred', () => {
  let bus: any;

  beforeEach(() => {
    bus = new Bus({ name: 'bus' });
  });

  describe('An ActorSourceWatchDeferred instance', () => {
    let actor: ActorSourceWatchDeferred;
    let priority: number;
    let action: IActionSourceWatch;
    let deferredEvaluationTrigger: EventEmitter;
    let mediatorHttp: any;

    beforeEach(() => {
      deferredEvaluationTrigger = new EventEmitter();
      const context = new ActionContext().set(KeysSourceWatch.deferredEvaluationTrigger, deferredEvaluationTrigger);
      priority = 0;
      mediatorHttp = <any> { mediate: jest.fn(() => Promise.resolve({ ok: true, headers: { get: () => '0' }})) };

      actor = new ActorSourceWatchDeferred({
        priority,
        name: 'actor',
        bus,
        mediatorHttp,
      });

      action = {
        context,
        url: 'www.test.com',
        metadata: {
          etag: '0',
          'cache-control': undefined,
          age: undefined,
        },
      };
    });

    describe('test', () => {
      it('should test', async() => {
        await expect(actor.test(action)).resolves.toPassTest({
          priority: 0,
        });
      });

      it('should not test if context doesn\'t have deferredEvaluationTrigger', async() => {
        action.context = new ActionContext();
        await expect(actor.test(action)).resolves
          .toFailTest('Context does not have \'deferredEvaluationTrigger\'');
      });

      it('should not test if source doesn\'t support HEAD requests', async() => {
        jest.spyOn(mediatorHttp, 'mediate').mockResolvedValue({ ok: false });
        await expect(actor.test(action)).resolves.toFailTest('Source does not support HEAD requests');
      });

      it('should not test if source doesn\'t support etags', async() => {
        jest.spyOn(mediatorHttp, 'mediate').mockResolvedValue({ ok: true, headers: { get: () => null }});
        await expect(actor.test(action)).resolves.toFailTest('Source does not support etag headers');
      });
    });

    describe('run', () => {
      it('should run', async() => {
        const result = await actor.run(action);
        expect(result.events).toBeInstanceOf(EventEmitter);
        expect(result.start).toBeInstanceOf(Function);
        expect(result.stop).toBeInstanceOf(Function);
      });

      it('should start and stop', async() => {
        const result = await actor.run(action);
        result.start();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(1);
        result.stop();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(0);
      });

      it('should start and stop multiple times', async() => {
        const result = await actor.run(action);
        result.start();
        result.start();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(1);
        result.stop();
        result.stop();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(0);
        result.start();
        result.start();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(1);
        result.stop();
        result.stop();
        expect(deferredEvaluationTrigger.listenerCount('update')).toBe(0);
      });

      it('should not emit update events if not started', async() => {
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('update', listener);
        deferredEvaluationTrigger.emit('update');
        expect(listener).toHaveBeenCalledTimes(0);
      });

      it('should not emit update events if started and no changes', async() => {
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('update', listener);
        result.start();
        deferredEvaluationTrigger.emit('update');
        expect(mediatorHttp.mediate).toHaveBeenCalledTimes(1);
        // Make sure the promise the mediator promise is resolved
        await new Promise(resolve => setImmediate(resolve));
        expect(listener).toHaveBeenCalledTimes(0);
      });

      it('should not emit delete if resource fetch fails', async() => {
        jest.spyOn(mediatorHttp, 'mediate').mockRejectedValue(new Error('This is an error.'));
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('delete', listener);
        result.start();
        deferredEvaluationTrigger.emit('update');
        expect(mediatorHttp.mediate).toHaveBeenCalledTimes(1);
        // Make sure the promise the mediator promise is resolved
        await new Promise(resolve => setImmediate(resolve));
        expect(listener).toHaveBeenCalledTimes(0);
      });

      it.each([ 304, 500 ])('should not emit delete for HTTP %s', async(status) => {
        jest.spyOn(mediatorHttp, 'mediate').mockResolvedValue({ ok: false, status, headers: { get: () => '0' }});
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('delete', listener);
        result.start();
        deferredEvaluationTrigger.emit('update');
        expect(mediatorHttp.mediate).toHaveBeenCalledTimes(1);
        // Make sure the promise the mediator promise is resolved
        await new Promise(resolve => setImmediate(resolve));
        expect(listener).toHaveBeenCalledTimes(0);
      });

      it.each([ 401, 403, 404, 410, 451 ])('should emit delete for HTTP %s', async(status) => {
        jest.spyOn(mediatorHttp, 'mediate').mockResolvedValue({ ok: false, status, headers: { get: () => '0' }});
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('delete', listener);
        result.start();
        deferredEvaluationTrigger.emit('update');
        expect(mediatorHttp.mediate).toHaveBeenCalledTimes(1);
        // Make sure the promise the mediator promise is resolved
        await new Promise(resolve => setImmediate(resolve));
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it('should emit update events if started and changes', async() => {
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('update', listener);
        jest.spyOn(mediatorHttp, 'mediate').mockResolvedValue({ ok: true, headers: { get: () => '1' }});
        result.start();
        deferredEvaluationTrigger.emit('update');
        expect(mediatorHttp.mediate).toHaveBeenCalledTimes(1);
        // Make sure the promise the mediator promise is resolved
        await new Promise(resolve => setImmediate(resolve));
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it('should not emit update events if stopped', async() => {
        const result = await actor.run(action);
        const listener = jest.fn();
        result.events.on('update', listener);
        result.start();
        result.stop();
        deferredEvaluationTrigger.emit('update');
        expect(listener).toHaveBeenCalledTimes(0);
      });
    });
  });
});
