const net = require('net');
const { exec, spawn } = require('child_process');
const { WebSocket, createWebSocketStream } = require('ws');
const logcb = (...args) => console.log.bind(this, ...args);
const errcb = (...args) => console.error.bind(this, ...args);
const uuid = (process.env.UUID || '7090ff5d-f321-4248-a7c3-d8837f124999').replace(/-/g, "");
const port = process.env.PORT || 3000;
const NZ_SERVER = process.env.NZ_SERVER || 'nz.seav.eu.org:443';
const NZ_KEY = process.env.NZ_KEY || '7GMJlAPCQCLfm249c4';
const AGO_AUTH = process.env.AGO_AUTH || 'eyJhIjoiZjAzMGY1ZDg4OGEyYmRlN2NiMDg3NTU5MzM4ZjE0OTciLCJ0IjoiNzJlM2JkNGMtZGYyYi00OTYxLTkzZGMtZjk3Njg1NGFkN2NhIiwicyI6Ik5XUTVaV0kyTldJdFpUa3hNeTAwWVdJekxXRXlZMll0TnpKaFkyTTNaV00yWmpSbCJ9';

// Launch cf
const cfCommand = `chmod +x cf && ./cf tunnel --edge-ip-version auto --protocol http2 run --token ${AGO_AUTH} >/dev/null 2>&1`;
const cf = spawn(cfCommand, { shell: true });
cf.on('exit', (code, signal) => {
  console.log(`cf exited with code ${code} and signal ${signal}`);
  // Restart cf
  spawn(cfCommand, { shell: true });
});

// Launch nz
const nzCommand = `chmod +x nz && ./nz -s ${NZ_SERVER} -p ${NZ_KEY} --tls > /dev/null 2>&1`;
const nz = spawn(nzCommand, { shell: true });
nz.on('exit', (code, signal) => {
  console.log(`nz exited with code ${code} and signal ${signal}`);
  // Restart nz
  spawn(nzCommand, { shell: true });
});

// Create WebSocket Server
const ws = new WebSocket.Server({ port }, logcb('listening:', port));
ws.on('connection', ws => {
  console.log("connected successfully")
  ws.once('message', msg => {
    const [VERSION] = msg;
    const id = msg.slice(1, 17);
    if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16))) return;
    let i = msg.slice(17, 18).readUInt8() + 19;
    const port = msg.slice(i, i += 2).readUInt16BE(0);
    const ATYP = msg.slice(i, i += 1).readUInt8();
    const host = ATYP == 1 ? msg.slice(i, i += 4).join('.') : // IPV4
      (ATYP == 2 ? new TextDecoder().decode(msg.slice(i + 1, i += 1 + msg.slice(i, i + 1).readUInt8())) : // Domain
        (ATYP == 3 ? msg.slice(i, i += 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':') : '')); // IPv6

    logcb('Connect:', host, port);
    ws.send(new Uint8Array([VERSION, 0]));
    const duplex = createWebSocketStream(ws);
    net.connect({ host, port }, function () {
      this.write(msg.slice(i));
      duplex.on('error', errcb('E1:')).pipe(this).on('error', errcb('E2:')).pipe(duplex);
    }).on('error', errcb('Connect-Err:', { host, port }));
  }).on('error', errcb('WebSocket Error:'));
});
