/** A routine publication invalidated an in-flight read; retry once against the current cursor. */
export class JournalObservationChanged extends Error {
  constructor() { super('Quest observations changed while reading. Refresh the journal.') }
}
