import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { LocationClient, type LocationWorker } from '../src/main/playerLocation/client.ts'
import { parseLocationRequest } from '../src/main/playerLocation/protocol.ts'

class FakeWorker extends EventEmitter implements LocationWorker {
  messages: unknown[] = []
  unrefCount = 0
  postMessage(message: unknown): void { this.messages.push(message) }
  unref(): void { this.unrefCount++ }
  reply(state = 'not-in-world'): void {
    const request = parseLocationRequest(this.messages.at(-1))
    assert.ok(request)
    this.emit('message', { id: request.id, result: { state, reason: 'Waiting' } })
  }
}

test('location requests coalesce while one sample is pending and cleanly close', async () => {
  const worker = new FakeWorker()
  const client = new LocationClient(() => worker)
  const first = client.read('root')
  assert.equal(client.read('root'), first)
  assert.equal(worker.messages.length, 1)
  assert.equal(worker.unrefCount, 1)
  worker.reply()
  assert.equal((await first).state, 'not-in-world')
  const next = client.read('root')
  client.close()
  assert.equal((await next).state, 'unavailable')
  assert.deepEqual(worker.messages.at(-1), { type: 'stop' })
  assert.equal((await client.read('root')).state, 'unavailable')
})

test('timeouts cooperatively stop native work and cannot spawn a replacement until exit', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const workers: FakeWorker[] = []
  const client = new LocationClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }, 100)
  const pending = client.read('root')
  const request = parseLocationRequest(workers[0].messages[0])!
  context.mock.timers.tick(101)
  assert.equal((await pending).state, 'unavailable')
  assert.deepEqual(workers[0].messages.at(-1), { type: 'stop' })
  // A late native reply must not resurrect a frame rejected for timeout.
  workers[0].emit('message', { id: request.id, result: { state: 'not-in-world', reason: 'Late' } })
  assert.equal((await client.read('root')).state, 'unavailable')
  assert.equal(workers.length, 1)
  workers[0].emit('exit', 0)
  const fresh = client.read('root')
  assert.equal(workers.length, 2)
  workers[1].reply()
  assert.equal((await fresh).state, 'not-in-world')
  client.close()
})

test('changing installation while a read is running invalidates the in-flight result', async () => {
  const worker = new FakeWorker()
  const client = new LocationClient(() => worker)
  const previous = client.read('old-root')
  assert.equal((await client.read('new-root')).state, 'unavailable')
  assert.equal((await previous).state, 'unavailable')
  assert.deepEqual(worker.messages.at(-1), { type: 'stop' })
  client.close()
})

test('worker faults, unexpected exit and invalid replies all clear an outstanding location read', async () => {
  for (const event of ['error', 'exit', 'message']) {
    const worker = new FakeWorker()
    const client = new LocationClient(() => worker)
    const pending = client.read('root')
    worker.emit(event, event === 'error' ? new Error('Native load failed') : 1)
    assert.equal((await pending).state, 'unavailable')
    client.close()
  }
})

test('a missing worker bundle becomes unavailable without throwing from the API', async () => {
  const client = new LocationClient(() => { throw new Error('Worker missing') })
  assert.equal((await client.read('root')).state, 'unavailable')
  client.close()
})
