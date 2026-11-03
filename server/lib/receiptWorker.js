// Renders receipt PDFs off the main thread: font parsing and subsetting take
// tens of milliseconds of CPU that would otherwise stall every other request.
import { parentPort } from 'node:worker_threads';
import { receiptPdf } from './receiptPdf.js';

parentPort.on('message', async ({ id, receipt }) => {
  try {
    const chunks = [];
    for await (const c of receiptPdf(receipt)) chunks.push(c);
    const buf = Buffer.concat(chunks);
    parentPort.postMessage({ id, pdf: buf }, [buf.buffer]);
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
