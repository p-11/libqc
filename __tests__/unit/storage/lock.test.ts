import { describe, expect, test } from 'vitest';
import { AsyncMutex } from '../../../src/storage/lock';

describe('AsyncMutex', () => {
  describe('basic execution', () => {
    test('runs the function and returns its result', async () => {
      const mutex = new AsyncMutex();
      const result = await mutex.run(() => Promise.resolve(42));
      expect(result).toBe(42);
    });

    test('runs the function and returns an object result', async () => {
      const mutex = new AsyncMutex();
      const result = await mutex.run(() => Promise.resolve({ a: 1, b: 'two' }));
      expect(result).toEqual({ a: 1, b: 'two' });
    });

    test('propagates rejection from fn', async () => {
      const mutex = new AsyncMutex();
      await expect(
        mutex.run(() => Promise.reject(new Error('boom')))
      ).rejects.toThrow('boom');
    });

    test('propagates thrown errors from fn', async () => {
      const mutex = new AsyncMutex();
      await expect(
        mutex.run(async () => {
          throw new Error('thrown');
        })
      ).rejects.toThrow('thrown');
    });
  });

  describe('serialization', () => {
    test('concurrent calls execute in FIFO order', async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];

      // Fire all three without awaiting so they queue up concurrently
      const p0 = mutex.run(async () => {
        await Promise.resolve(); // yield to let others queue
        order.push(0);
      });
      const p1 = mutex.run(async () => {
        order.push(1);
      });
      const p2 = mutex.run(async () => {
        order.push(2);
      });

      await Promise.all([p0, p1, p2]);
      expect(order).toEqual([0, 1, 2]);
    });

    test('operations do not interleave', async () => {
      const mutex = new AsyncMutex();
      const log: string[] = [];

      const p1 = mutex.run(async () => {
        log.push('p1-start');
        await new Promise(r => setTimeout(r, 0));
        log.push('p1-end');
      });

      const p2 = mutex.run(async () => {
        log.push('p2-start');
        await new Promise(r => setTimeout(r, 0));
        log.push('p2-end');
      });

      await Promise.all([p1, p2]);

      // p1 must fully complete before p2 starts
      expect(log).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end']);
    });

    test('multiple queued callers all complete in FIFO order', async () => {
      const mutex = new AsyncMutex();
      const order: number[] = [];

      const promises = [0, 1, 2, 3, 4].map(i =>
        mutex.run(async () => {
          order.push(i);
        })
      );

      await Promise.all(promises);
      expect(order).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('error recovery', () => {
    test('lock is released after fn throws — subsequent callers proceed', async () => {
      const mutex = new AsyncMutex();

      const failing = mutex.run(() => Promise.reject(new Error('fail')));
      const succeeding = mutex.run(() => Promise.resolve('ok'));

      const results = await Promise.allSettled([failing, succeeding]);

      expect(results[0].status).toBe('rejected');
      expect((results[0] as PromiseRejectedResult).reason.message).toBe('fail');
      expect(results[1].status).toBe('fulfilled');
      expect((results[1] as PromiseFulfilledResult<string>).value).toBe('ok');
    });

    test('callers queued after an error all still execute', async () => {
      const mutex = new AsyncMutex();
      const executed: number[] = [];

      const p0 = mutex.run(() => Promise.reject(new Error('err')));
      const p1 = mutex.run(async () => {
        executed.push(1);
      });
      const p2 = mutex.run(async () => {
        executed.push(2);
      });

      await Promise.allSettled([p0, p1, p2]);

      expect(executed).toEqual([1, 2]);
    });

    test('error in middle of queue does not block later waiters', async () => {
      const mutex = new AsyncMutex();
      const results: string[] = [];

      const p0 = mutex.run(async () => {
        results.push('first');
      });
      const p1 = mutex.run(() => Promise.reject(new Error('middle failed')));
      const p2 = mutex.run(async () => {
        results.push('third');
      });

      await Promise.allSettled([p0, p1, p2]);

      expect(results).toEqual(['first', 'third']);
    });
  });

  // NOTE: Calling mutex.run() from within a mutex.run() callback on the same
  // instance will deadlock. The inner run() appends to the chain that the outer
  // run() is currently holding, so the inner call will never resolve.
  // Always acquire the lock at the outermost call site only.
  // This behaviour is intentionally not tested to avoid hanging the test runner.
});
