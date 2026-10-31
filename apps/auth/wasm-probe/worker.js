import decode, { init } from "@jsquash/jpeg/decode.js";
import wasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
init(wasm);
export default {
  async fetch(req) {
    try {
      const start = Date.now();
      const data = await decode(await req.arrayBuffer(), { preserveOrientation: true });
      return Response.json({
        width: data.width,
        height: data.height,
        bytes: data.data.byteLength,
        ms: Date.now() - start,
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  },
};
