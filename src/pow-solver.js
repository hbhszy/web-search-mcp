const fs = require("node:fs/promises");

class DeepSeekPowSolver {
  constructor(options = {}) {
    this.wasmPath = options.wasmPath;
    this.instance = null;
    this.readyPromise = null;
  }

  async init() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const wasmBytes = await fs.readFile(this.wasmPath);
        const { instance } = await WebAssembly.instantiate(wasmBytes, {});
        this.instance = instance;
        return instance;
      })();
    }

    return this.readyPromise;
  }

  get memory() {
    return this.instance.exports.memory;
  }

  writeString(text) {
    const bytes = Buffer.from(text, "utf8");
    const ptr = this.instance.exports.__wbindgen_export_0(bytes.length, 1);
    new Uint8Array(this.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  }

  solveChallenge(config) {
    return this.init().then(() => {
      const prefix = `${config.salt}_${config.expire_at}_`;
      const stackPtr = this.instance.exports.__wbindgen_add_to_stack_pointer;
      const wasmSolve = this.instance.exports.wasm_solve;

      const retptr = stackPtr(-16);
      let challengePtr = 0;
      let challengeLen = 0;
      let prefixPtr = 0;
      let prefixLen = 0;

      try {
        [challengePtr, challengeLen] = this.writeString(config.challenge);
        [prefixPtr, prefixLen] = this.writeString(prefix);

        wasmSolve(
          retptr,
          challengePtr,
          challengeLen,
          prefixPtr,
          prefixLen,
          Number(config.difficulty),
        );

        const view = new DataView(this.memory.buffer);
        const status = view.getInt32(retptr, true);
        if (status === 0) {
          throw new Error("DeepSeek PoW solver returned no answer");
        }

        const answer = Math.trunc(view.getFloat64(retptr + 8, true));
        const payload = {
          algorithm: config.algorithm,
          challenge: config.challenge,
          salt: config.salt,
          answer,
          signature: config.signature,
          target_path: config.target_path,
        };

        return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
      } finally {
        stackPtr(16);
      }
    });
  }
}

module.exports = {
  DeepSeekPowSolver,
};
