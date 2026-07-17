/**
 * Resumable, direct-to-R2 chunked upload.
 *
 * Assume the network will drop. A learner recording a six-minute recitation on a
 * phone in a compound with two bars of signal is the design case, not the edge
 * case. A single failed part is retried; the other parts are not re-sent.
 */
(function () {
  const RETRIES = 4;

  async function upload(file, { onProgress } = {}) {
    const begin = await postJson('/api/v1/assets/upload', {
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      bytes: file.size,
    });

    const { assetId, partSize, parts } = begin;
    const done = [];
    let sent = 0;

    try {
      for (const part of parts) {
        const start = (part.partNumber - 1) * partSize;
        const chunk = file.slice(start, Math.min(start + partSize, file.size));
        if (chunk.size === 0) continue;

        const etag = await putWithRetry(part.url, chunk);
        done.push({ partNumber: part.partNumber, etag });

        sent += chunk.size;
        onProgress?.(Math.round((sent / file.size) * 100));
      }

      const result = await postJson(`/api/v1/assets/${assetId}/complete`, { parts: done });
      return result.asset;
    } catch (err) {
      // Do not leave paid-for orphans in the bucket.
      await fetch(`/api/v1/assets/${assetId}/upload`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrf() },
      }).catch(() => {});
      throw err;
    }
  }

  async function putWithRetry(url, chunk) {
    let lastError;
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        const res = await fetch(url, { method: 'PUT', body: chunk });
        if (!res.ok) throw new Error(`R2 returned ${res.status}`);
        const etag = res.headers.get('ETag');
        if (!etag) throw new Error('R2 did not return an ETag — check bucket CORS exposes it');
        return etag;
      } catch (err) {
        lastError = err;
        // 1s, 2s, 4s, 8s. The connection may simply be walking back into range.
        await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
      }
    }
    throw new Error(`A part failed after ${RETRIES} attempts: ${lastError.message}`);
  }

  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf() },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Request failed (${res.status})`);
    return data;
  }

  window.lintelUpload = upload;
})();
