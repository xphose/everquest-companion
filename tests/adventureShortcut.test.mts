import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adventureAccelerator, DEFAULT_ADVENTURE_SHORTCUT } from '../src/shared/adventureShortcut'
import { adventureShortcutRegistration } from '../src/main/adventureShortcutRegistration'

test('Adventure shortcuts require intentional modifiers and a bounded key vocabulary', () => {
  assert.equal(adventureAccelerator(DEFAULT_ADVENTURE_SHORTCUT), 'Ctrl+Shift+Space')
  assert.equal(adventureAccelerator(' Shift + Alt + F12 '), 'Alt+Shift+F12')
  assert.equal(adventureAccelerator('CommandOrControl+7'), 'CommandOrControl+7')
  assert.equal(adventureAccelerator(''), '')
  for (const input of [
    null,
    {},
    [],
    'A',
    'Shift+A',
    'Ctrl+Ctrl+A',
    'Ctrl+CommandOrControl+A',
    'Ctrl+MediaPlayPause',
    'Alt+F25',
    'Ctrl++A',
    'Ctrl+A+B',
    'Ctrl+Space\nA',
    'x'.repeat(65)
  ]) {
    assert.equal(adventureAccelerator(input), null, `${JSON.stringify(input)} must not bind a key`)
  }
})

function rig() {
  let available = true
  let throws = false
  let toggles = 0
  let trigger: (() => void) | undefined
  const calls: string[] = []
  const controller = adventureShortcutRegistration({
    register: (accelerator, callback) => {
      calls.push(`register:${accelerator}`)
      if (throws) throw new Error('OS registration unavailable')
      trigger = available ? callback : undefined
      return available
    },
    unregister: (accelerator) => {
      calls.push(`unregister:${accelerator}`)
      trigger = undefined
    },
    toggle: () => {
      toggles++
    }
  })
  return {
    controller,
    calls,
    collide: () => {
      available = false
    },
    recover: () => {
      available = true
    },
    throwOnRegister: () => {
      throws = true
    },
    fire: () => trigger?.(),
    toggles: () => toggles
  }
}

test('a valid shortcut toggles through one registration and rebinding releases the old key first', () => {
  const r = rig()
  assert.deepEqual(r.controller.update(DEFAULT_ADVENTURE_SHORTCUT), {
    accelerator: DEFAULT_ADVENTURE_SHORTCUT,
    registered: true,
    error: null
  })
  r.fire()
  r.controller.update(DEFAULT_ADVENTURE_SHORTCUT)
  r.fire()
  assert.equal(r.toggles(), 2)
  assert.equal(r.calls.length, 1, 'unchanged settings do not churn the OS registration')
  r.controller.update('Alt+F9')
  assert.deepEqual(r.calls, [
    'register:Ctrl+Shift+Space',
    'unregister:Ctrl+Shift+Space',
    'register:Alt+F9'
  ])
  r.controller.stop()
  r.controller.stop()
  r.fire()
  assert.equal(r.calls.at(-1), 'unregister:Alt+F9')
  assert.equal(r.calls.length, 4, 'shutdown is idempotent')
  assert.equal(r.toggles(), 2)
})

test('bad renderer input preserves the working shortcut; empty explicitly disables it', () => {
  const r = rig()
  r.controller.update(DEFAULT_ADVENTURE_SHORTCUT)
  const rejected = r.controller.update('A')
  assert.equal(rejected.registered, true)
  assert.equal(rejected.accelerator, DEFAULT_ADVENTURE_SHORTCUT)
  assert.ok(rejected.error)
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.controller.update(''), {
    accelerator: '',
    registered: false,
    error: null
  })
  r.fire()
  assert.equal(r.toggles(), 0)
  assert.deepEqual(r.calls, ['register:Ctrl+Shift+Space', 'unregister:Ctrl+Shift+Space'])
})

test('OS collisions and thrown registration failures are reported honestly and can recover', () => {
  const r = rig()
  r.collide()
  const failed = r.controller.update(DEFAULT_ADVENTURE_SHORTCUT)
  assert.equal(failed.registered, false)
  assert.ok(failed.error)
  r.fire()
  assert.equal(r.toggles(), 0)
  r.recover()
  assert.equal(r.controller.update(DEFAULT_ADVENTURE_SHORTCUT).registered, true)
  r.throwOnRegister()
  const thrown = r.controller.update('Ctrl+F2')
  assert.equal(thrown.registered, false)
  assert.ok(thrown.error)
  assert.equal(r.calls.at(-2), 'unregister:Ctrl+Shift+Space')
})
