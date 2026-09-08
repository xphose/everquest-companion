// The native surface runs only in the location worker. Handles grant QUERY + VM_READ;
// there are no memory writes, hooks, injected modules, input calls or privilege changes.
import * as koffi from 'koffi'
import { readableAddress, type MemoryRead } from './profile'
import { sameExecutable } from './paths'

type Win32Fn = (...args: unknown[]) => unknown

interface NativeCalls {
  open: Win32Fn
  close: Win32Fn
  path: Win32Fn
  pids: Win32Fn
  modules: Win32Fn
  read: Win32Fn
}

export interface ProcessMemory {
  imagePath(): string | null
  imageBase(): bigint | null
  read: MemoryRead
  close(): void
}

export interface LocationNative {
  matchingProcesses(executable: string): number[]
  openPlayerProcess(pid: number): ProcessMemory | null
}

const MAX_PROCESSES = 4096
const PATH_CHARS = 32768
const QUERY_LIMITED = 0x1000
const QUERY_AND_READ = 0x0410

interface PathBuffers {
  chars: Buffer
  path: Buffer
}

function pathBuffers(): PathBuffers {
  return { chars: Buffer.alloc(4), path: Buffer.alloc(PATH_CHARS * 2) }
}

function bind(lib: koffi.IKoffiLib, prototype: string): Win32Fn {
  return lib.func(prototype)
}

function hasHandle(handle: unknown): boolean {
  return handle !== null && handle !== undefined && handle !== 0
}

function imagePath(api: NativeCalls, handle: unknown, buffers = pathBuffers()): string | null {
  const { chars, path } = buffers
  chars.writeUInt32LE(PATH_CHARS)
  if (api.path(handle, 0, path, chars) !== true) return null
  const length = chars.readUInt32LE()
  return length > 0 && length < PATH_CHARS ? path.toString('utf16le', 0, length * 2) : null
}

function processIds(api: NativeCalls): number[] {
  const pids = Buffer.alloc(MAX_PROCESSES * 4)
  const needed = Buffer.alloc(4)
  if (api.pids(pids, pids.length, needed) !== true) throw new Error('Process enumeration failed')
  const bytes = needed.readUInt32LE()
  // EnumProcesses gives no required capacity on truncation. A full buffer is not proof that
  // there is only one game, so refuse the sample rather than silently choosing a partial list.
  if (bytes >= pids.length || bytes % 4 !== 0) throw new Error('Process enumeration exceeded its bound')
  const result: number[] = []
  for (let offset = 0; offset < bytes; offset += 4) result.push(pids.readUInt32LE(offset))
  return result
}

function matchingProcesses(api: NativeCalls, executable: string): number[] {
  const matches: number[] = []
  // Reuse the long-path output buffer across this bounded scan; allocating 64 KB per process
  // would otherwise create tens of MB of short-lived garbage on every map sample.
  const buffers = pathBuffers()
  for (const pid of processIds(api)) {
    if (pid === 0) continue
    const handle = api.open(QUERY_LIMITED, false, pid)
    if (!hasHandle(handle)) continue
    try {
      const path = imagePath(api, handle, buffers)
      if (path && sameExecutable(path, executable)) matches.push(pid)
    } finally {
      api.close(handle)
    }
  }
  return matches
}

function imageBase(api: NativeCalls, handle: unknown): bigint | null {
  const module = Buffer.alloc(8)
  const needed = Buffer.alloc(4)
  // Only the first module (the executable) is needed; no module addresses leave this worker.
  if (api.modules(handle, module, module.length, needed, 2) !== true || needed.readUInt32LE() < 8) return null
  const base = module.readBigUInt64LE()
  return readableAddress(base) ? base : null
}

function memoryRead(api: NativeCalls, handle: unknown, address: bigint, size: number): Buffer | null {
  if (!readableAddress(address, size)) return null
  const buffer = Buffer.alloc(size)
  const count = Buffer.alloc(8)
  if (api.read(handle, address, buffer, size, count) !== true) return null
  return count.readBigUInt64LE() === BigInt(size) ? buffer : null
}

function openPlayerProcess(api: NativeCalls, pid: number): ProcessMemory | null {
  const handle = api.open(QUERY_AND_READ, false, pid)
  if (!hasHandle(handle)) return null
  let closed = false
  return {
    imagePath: () => closed ? null : imagePath(api, handle),
    imageBase: () => closed ? null : imageBase(api, handle),
    read: (address, size) => closed ? null : memoryRead(api, handle, address, size),
    close() {
      if (closed) return
      closed = true
      api.close(handle)
    }
  }
}

/** Native dependencies are loaded lazily after the Windows x64 gate in worker.ts. */
export function loadLocationNative(): LocationNative {
  const kernel = koffi.load('kernel32.dll')
  const psapi = koffi.load('psapi.dll')
  const api: NativeCalls = {
    open: bind(kernel, 'void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    close: bind(kernel, 'bool __stdcall CloseHandle(void *handle)'),
    path: bind(kernel, 'bool __stdcall QueryFullProcessImageNameW(void *handle, uint32 flags, _Out_ void *path, _Inout_ void *size)'),
    pids: bind(psapi, 'bool __stdcall EnumProcesses(_Out_ void *pids, uint32 size, _Out_ void *needed)'),
    modules: bind(psapi, 'bool __stdcall EnumProcessModulesEx(void *handle, _Out_ void *modules, uint32 size, _Out_ void *needed, uint32 flags)'),
    read: bind(kernel, 'bool __stdcall ReadProcessMemory(void *handle, uint64 address, _Out_ void *buffer, size_t size, _Out_ void *count)')
  }
  return {
    matchingProcesses: executable => matchingProcesses(api, executable),
    openPlayerProcess: pid => openPlayerProcess(api, pid)
  }
}
