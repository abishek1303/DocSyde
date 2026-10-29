import { createServer } from 'node:http';
createServer((_req, res) => res.end('ready')).listen(Number(process.argv[2]), '127.0.0.1');
