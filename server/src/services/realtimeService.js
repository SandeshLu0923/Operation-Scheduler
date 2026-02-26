let ioRef = null;

export function registerIo(io) {
  ioRef = io;
}

export function emitRealtime(event, payload) {
  if (ioRef) {
    ioRef.emit(event, payload);
  }
}
