"use strict";
// Client certificate loading for the OpenAI "certificate header" mode.
// Only the public certificate is ever kept: private keys are stripped and PKCS#12 bundles rejected.

const Cert = (() => {
  const b64 = {
    enc: (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); },
    dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
  };

  // Minimal DER reader: enough to pull subject CN, issuer CN and validity from an X.509 certificate.
  function tlv(buf, pos) {
    const tag = buf[pos];
    let len = buf[pos + 1], off = pos + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = len * 256 + buf[off + i];
      off += n;
    }
    return { tag, start: off, end: off + len };
  }
  function children(buf, node) {
    const out = [];
    for (let p = node.start; p < node.end;) { const c = tlv(buf, p); out.push(c); p = c.end; }
    return out;
  }
  const text = (buf, n) => new TextDecoder().decode(buf.slice(n.start, n.end));
  function time(buf, n) {
    let s = text(buf, n);
    if (n.tag === 0x17) s = (+s.slice(0, 2) < 50 ? "20" : "19") + s;   // UTCTime → 4-digit year
    return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14) || 0));
  }
  function commonName(buf, name) {
    for (const rdn of children(buf, name)) {
      for (const atv of children(buf, rdn)) {
        const [oid, val] = children(buf, atv);
        const o = buf.slice(oid.start, oid.end);
        if (o.length === 3 && o[0] === 0x55 && o[1] === 0x04 && o[2] === 0x03) return text(buf, val);
      }
    }
    return "";
  }
  function describe(der) {
    try {
      const cert = tlv(der, 0);
      const tbs = children(der, cert)[0];
      let f = children(der, tbs);
      if (f[0].tag === 0xa0) f = f.slice(1);                     // skip explicit version
      const [, , issuer, validity, subject] = f;
      const [nb, na] = children(der, validity);
      return { subject: commonName(der, subject), issuer: commonName(der, issuer), notBefore: time(der, nb).toISOString(), notAfter: time(der, na).toISOString() };
    } catch {
      return null;
    }
  }

  async function fingerprint(der) {
    try {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
      return [...h].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    } catch { return ""; }
  }

  // Returns { name, der (base64), fingerprint, subject, issuer, notAfter, warnings[] }.
  async function load(file) {
    if (/\.(pfx|p12)$/i.test(file.name)) {
      throw new Error("PFX/P12 files contain a private key and can't be sent as a header. Install it into Windows (double-click the file), then use “Installed certificate (mTLS)”.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asText = new TextDecoder().decode(bytes);
    const warnings = [];
    let der;
    if (asText.includes("-----BEGIN")) {
      const blocks = [...asText.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
      if (/PRIVATE KEY-----/.test(asText)) warnings.push("The file contained a private key. It was ignored and not stored.");
      if (!blocks.length) throw new Error("No certificate found in that file.");
      if (blocks.length > 1) warnings.push(`The file holds ${blocks.length} certificates; the first (leaf) is used.`);
      der = b64.dec(blocks[0][1].replace(/\s+/g, ""));
    } else if (bytes[0] === 0x30) {
      der = bytes;                                                  // binary DER (.cer / .der)
    } else {
      throw new Error("Unrecognised certificate format. Use a PEM (.pem/.crt) or DER (.cer/.der) file.");
    }
    const info = describe(der);
    if (!info) throw new Error("That file doesn't look like an X.509 certificate.");
    if (new Date(info.notAfter) < new Date()) warnings.push(`This certificate expired on ${info.notAfter.slice(0, 10)}.`);
    return { name: file.name, der: b64.enc(der), fingerprint: await fingerprint(der), ...info, warnings };
  }

  // Header value for the configured format. Header values can't contain newlines, hence the encodings.
  function headerValue(cert, format) {
    if (format === "pem-urlencoded") {
      const pem = `-----BEGIN CERTIFICATE-----\n${cert.der.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;
      return encodeURIComponent(pem);
    }
    return cert.der;                                                // single-line base64 DER
  }

  return { load, headerValue };
})();
