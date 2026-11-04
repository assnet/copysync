/** Promessa resolvida de fora: o passo do login que espera o operador digitar. */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T) => void;
  reject!: (reason: unknown) => void;
  settled = false;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = (v) => { this.settled = true; res(v); };
      this.reject = (e) => { this.settled = true; rej(e); };
    });
    // Evita "unhandled rejection" quando ninguém chegou a esperar (ex.: cancelamento)
    this.promise.catch(() => undefined);
  }
}
